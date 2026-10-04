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
val repositoryRoot = rootProject.projectDir.resolve("../../../")
val publicConfig = repositoryRoot.resolve("build/config/public.json")
val config = if (publicConfig.exists()) JsonSlurper().parse(publicConfig) as Map<*, *> else emptyMap<Any, Any>()
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
        versionCode = 10000
        versionName = "1.0.0"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    sourceSets["main"].assets.srcDirs(repositoryRoot.resolve("build/app"), layout.buildDirectory.dir("generated/config"), layout.buildDirectory.dir("generated/notices"))
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

val copyConfig = tasks.register<Copy>("copyPublicConfig") {
    from(publicConfig)
    into(layout.buildDirectory.dir("generated/config/config"))
}
val copyNotices = tasks.register<Copy>("copyProjectNotices") {
    from(repositoryRoot.resolve("LICENSE"), repositoryRoot.resolve("THIRD-PARTY-NOTICES.md"))
    into(layout.buildDirectory.dir("generated/notices/licenses"))
}
tasks.named("preBuild") { dependsOn(copyConfig, copyNotices) }
val noticesBuildId = UUID.randomUUID().toString()
androidComponents.onVariants { variant ->
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
            commandLine("node", repositoryRoot.resolve("scripts/generate-android-notices.mjs").absolutePath,
                "--input", input.absolutePath, "--output", assetsDirectory.get().asFile.absolutePath)
        }
    }
    variant.sources.assets?.addGeneratedSourceDirectory(collect) { it.assetsDirectory }
}
tasks.matching { it.name.contains("Release") }.configureEach {
    doFirst {
        require(configuredId.isNotEmpty()) { "Release requires WORK_FLEET_APP_ID in .env and npm run build." }
        require(hasSigning || signingValues.all { it.isBlank() }) { "Set all four Android signing environment variables, or leave all unset for an unsigned AAB." }
    }
}
dependencies {
    implementation("androidx.webkit:webkit:1.16.0")
    implementation("com.google.android.gms:play-services-auth:22.0.0")
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
}
