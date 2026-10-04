import groovy.json.JsonSlurper

plugins { id("com.android.application") }
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
    sourceSets["main"].assets.srcDirs(repositoryRoot.resolve("build/app"), layout.buildDirectory.dir("generated/config"))
    if (hasSigning) {
        signingConfigs.create("release") {
            storeFile = java.io.File(signingValues[0]).also {
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
tasks.named("preBuild") { dependsOn(copyConfig) }
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
