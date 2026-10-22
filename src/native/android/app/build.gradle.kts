import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import java.io.File
import java.util.UUID
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.artifacts.result.ResolvedArtifactResult
import org.gradle.maven.MavenModule
import org.gradle.maven.MavenPomArtifact

plugins { id("com.android.application") }
abstract class NativeNoticesTask : Exec() {
    @get:OutputDirectory abstract val assetsDirectory: DirectoryProperty
}
abstract class WebAssetsTask : Exec() {
    @get:OutputDirectory abstract val assetsDirectory: DirectoryProperty
}
val repositoryRoot = rootProject.projectDir.resolve("../../../")
// A Dock-launched macOS IDE starts the daemon with the launchd PATH, which the JVM keeps using
// for bare command names; resolve node/npm against the PATH the IDE hands to this build instead.
fun pathTool(name: String): String =
    if (System.getProperty("os.name").startsWith("Windows")) name
    else providers.environmentVariable("PATH").orNull.orEmpty().split(File.pathSeparator).filter { File(it).isAbsolute }
        .map { File(it, name) }.firstOrNull { it.isFile && it.canExecute() }?.absolutePath ?: name
val nodeExecutable = providers.gradleProperty("workFleetNode").orElse(providers.environmentVariable("WORK_FLEET_NODE")).orElse(providers.provider { pathTool("node") }).get()
val npmExecutable = providers.gradleProperty("workFleetNpm").orElse(providers.environmentVariable("WORK_FLEET_NPM")).orElse(providers.provider { pathTool("npm") }).get()
val configJson = providers.exec {
    workingDir(repositoryRoot)
    commandLine(nodeExecutable, "scripts/android-config.mjs")
}.standardOutput.asText.get()
val config = JsonSlurper().parseText(configJson) as Map<*, *>
val configuredId = config["appId"] as? String ?: ""
val signingVariables = listOf("WORK_FLEET_ANDROID_KEYSTORE", "WORK_FLEET_ANDROID_KEY_ALIAS", "WORK_FLEET_ANDROID_STORE_PASSWORD", "WORK_FLEET_ANDROID_KEY_PASSWORD")
val signingValues = signingVariables.map { System.getenv(it).orEmpty() }
val hasSigning = signingValues.all { it.isNotBlank() }
val requireSigned = System.getenv("WORK_FLEET_REQUIRE_SIGNED_ANDROID") == "1"
require(!requireSigned || hasSigning) { "Signed release requires all four Android signing environment variables. See docs/release/README.md." }

android {
    namespace = "app.workfleet.nativehost"
    compileSdk = 36
    defaultConfig {
        applicationId = configuredId.ifEmpty { "app.workfleet.preview" }
        minSdk = 28
        targetSdk = 36
        versionCode = 306
        versionName = "0.3.6"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/notices").get().asFile)
    // CI restores the existing debug key so device updates and Google OAuth keep the same signer.
    providers.environmentVariable("WORK_FLEET_ANDROID_DEBUG_KEYSTORE").orNull?.let { keyPath ->
        signingConfigs.getByName("debug") {
            storeFile = File(keyPath).also { require(it.isAbsolute && it.isFile) { "Debug keystore must be an existing absolute file." } }
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }
    if (hasSigning) {
        signingConfigs.create("release") {
            storeFile = File(signingValues[0]).also {
                require(it.isAbsolute && it.isFile) { "Android signing keystore must be an existing absolute file path." }
            }
            keyAlias = signingValues[1]
            storePassword = signingValues[2]
            keyPassword = signingValues[3]
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (hasSigning) signingConfig = signingConfigs.getByName("release")
        }
    }
}
// APK/AAB names carry versionName, the Android version record, so every machine builds the same file names.
base { archivesName.set("WorkFleet-${android.defaultConfig.versionName}-android") }

val installWebDependencies = tasks.register<Exec>("installWebDependencies") {
    workingDir(repositoryRoot)
    inputs.files(repositoryRoot.resolve("package.json"), repositoryRoot.resolve("package-lock.json"))
    outputs.dir(repositoryRoot.resolve("node_modules"))
    if (System.getProperty("os.name").startsWith("Windows")) {
        commandLine("cmd.exe", "/d", "/c", npmExecutable, "ci", "--ignore-scripts", "--no-audit", "--no-fund")
    } else {
        commandLine(npmExecutable, "ci", "--ignore-scripts", "--no-audit", "--no-fund")
    }
}
val buildWebAssets = tasks.register<WebAssetsTask>("buildWebAssets") {
    dependsOn(installWebDependencies)
    workingDir(repositoryRoot)
    assetsDirectory.set(layout.buildDirectory.dir("generated/web-assets"))
    inputs.files(repositoryRoot.resolve("scripts/build-web.mjs"), repositoryRoot.resolve("scripts/config.mjs"), repositoryRoot.resolve("package.json"), repositoryRoot.resolve("package-lock.json"), repositoryRoot.resolve("LICENSE"), repositoryRoot.resolve("THIRD-PARTY-NOTICES.md"))
    for (folder in listOf("app", "core", "layout", "interaction", "storage", "sources", "backup", "desktop", "i18n")) {
        inputs.dir(repositoryRoot.resolve("src/$folder"))
    }
    for (name in listOf("bridge.js", "files.js", "capture.js", "shortcuts.js", "google.js")) {
        inputs.file(repositoryRoot.resolve("src/native/$name"))
    }
    inputs.property("publicConfig", configJson)
    val destination = assetsDirectory.get().asFile
    commandLine(nodeExecutable, "scripts/build-web.mjs", "--output", destination.absolutePath,
        "--config-output", destination.resolve("config/public.json").absolutePath)
}
val validateReleaseConfig = tasks.register<Exec>("validateReleaseConfig") {
    workingDir(repositoryRoot)
    commandLine(nodeExecutable, "scripts/android-config.mjs", "--check-release")
}
val copyNotices = tasks.register<Copy>("copyProjectNotices") {
    from(repositoryRoot.resolve("LICENSE"), repositoryRoot.resolve("THIRD-PARTY-NOTICES.md"))
    into(layout.buildDirectory.dir("generated/notices/licenses"))
}
tasks.named("preBuild") { dependsOn(copyNotices) }
tasks.matching { it.name == "preReleaseBuild" }.configureEach { dependsOn(validateReleaseConfig) }
val noticesBuildId = UUID.randomUUID().toString()
androidComponents.onVariants { variant ->
    variant.sources.assets?.addGeneratedSourceDirectory(buildWebAssets) { it.assetsDirectory }
    val runtime = configurations.named("${variant.name}RuntimeClasspath")
    val metadata = layout.buildDirectory.file("generated/native-dependencies/${variant.name}-$noticesBuildId.json")
    val collect = tasks.register<NativeNoticesTask>("collect${variant.name.replaceFirstChar { it.uppercase() }}NativeNotices") {
        assetsDirectory.set(layout.buildDirectory.dir("generated/native-notices/${variant.name}-$noticesBuildId"))
        inputs.files(runtime)
        inputs.file(repositoryRoot.resolve("scripts/generate-android-notices.mjs"))
        inputs.file(repositoryRoot.resolve("src/native/licenses/apache-2.0-LICENSE.txt"))
        inputs.property("variant", variant.name)
        doFirst {
            val artifacts = runtime.get().resolvedConfiguration.resolvedArtifacts.sortedBy { it.id.displayName }
            val result = project.dependencies.createArtifactResolutionQuery()
                .forComponents(artifacts.map { it.id.componentIdentifier }.distinct())
                .withArtifacts(MavenModule::class.java, MavenPomArtifact::class.java).execute()
            val poms = result.resolvedComponents.associate { component ->
                component.id.displayName to component.getArtifacts(MavenPomArtifact::class.java)
                    .filterIsInstance<ResolvedArtifactResult>().firstOrNull()?.file?.absolutePath
            }
            val rows = artifacts.map { artifact ->
                val module = artifact.moduleVersion.id
                mapOf("group" to module.group, "name" to module.name, "version" to module.version,
                    "file" to artifact.file.absolutePath, "pom" to poms[artifact.id.componentIdentifier.displayName])
            }
            val input = metadata.get().asFile
            input.parentFile.mkdirs()
            input.writeText(JsonOutput.prettyPrint(JsonOutput.toJson(mapOf("variant" to variant.name, "artifacts" to rows))))
            commandLine(nodeExecutable, repositoryRoot.resolve("scripts/generate-android-notices.mjs").absolutePath,
                "--input", input.absolutePath, "--output", assetsDirectory.get().asFile.absolutePath)
        }
    }
    variant.sources.assets?.addGeneratedSourceDirectory(collect) { it.assetsDirectory }
}
tasks.matching { it.name.contains("Release") }.configureEach {
    doFirst {
        require(configuredId.isNotEmpty()) { "Release requires WORK_FLEET_APP_ID in .env. Sync Gradle after configuring it." }
        require(hasSigning || signingValues.all { it.isBlank() }) { "Set all four Android signing environment variables, or leave all unset for an unsigned AAB." }
    }
}
dependencies {
    testImplementation("junit:junit:4.13.2")
    implementation("androidx.webkit:webkit:1.16.0")
    implementation("com.google.android.gms:play-services-auth:22.0.0")
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
}
