<#
.SYNOPSIS
    Build the Android native APK or release App Bundle and copy it into build/.
.DESCRIPTION
    Requires Node 22+, npm, JDK 17 and Android SDK 36. Uses the checked-in Gradle
    Wrapper and .env public app/Google
    settings and optional SDK paths. No SDK installation, device test or store upload.
    Release uses signing environment variables when configured; otherwise it is unsigned.
    The package and its .sha256 are named from versionName in app/build.gradle.kts.
.PARAMETER Release
    Build a release AAB instead of a debug APK.
.PARAMETER Signed
    Require signing environment variables and build a release AAB.
.PARAMETER GradlePath
    Optional Gradle executable override; defaults to the checked-in gradlew.bat.
.EXAMPLE
    .\scripts\windows\Build-AndroidApp.ps1 -Release
#>
[CmdletBinding()]
param([switch]$Release, [switch]$Signed, [string]$GradlePath = '')
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$SavedSdkEnvironment = @{}
Push-Location $ProjectRoot
try {
    if ($Signed) { $Release = $true }
    foreach ($Name in @('WORK_FLEET_REQUIRE_SIGNED_ANDROID', 'GRADLE_USER_HOME')) {
        $SavedSdkEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
    }
    if (-not $env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME = Join-Path $ProjectRoot 'build/gradle-home' }
    if ($Signed) {
        foreach ($Name in @('WORK_FLEET_ANDROID_KEYSTORE', 'WORK_FLEET_ANDROID_KEY_ALIAS', 'WORK_FLEET_ANDROID_STORE_PASSWORD', 'WORK_FLEET_ANDROID_KEY_PASSWORD')) {
            if (-not [Environment]::GetEnvironmentVariable($Name, 'Process')) { throw "Signed release requires $Name in the process/CI environment; do not put passwords in .env." }
        }
        $env:WORK_FLEET_REQUIRE_SIGNED_ANDROID = '1'
    }
    $SdkSettings = (& node scripts/toolchain-env.mjs | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0) { throw 'Could not read SDK configuration.' }
    foreach ($Name in @('ANDROID_HOME', 'JAVA_HOME', 'GRADLE_HOME', 'ANDROID_USER_HOME')) {
        $SavedSdkEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
        if ($SdkSettings.$Name) { [Environment]::SetEnvironmentVariable($Name, $SdkSettings.$Name, 'Process') }
    }
    if (-not $env:ANDROID_USER_HOME) { $env:ANDROID_USER_HOME = Join-Path $ProjectRoot 'build/toolchain/android-user' }
    if (-not $GradlePath) { $GradlePath = Join-Path $ProjectRoot 'src/native/android/gradlew.bat' }
    if (-not (Get-Command $GradlePath -ErrorAction SilentlyContinue)) { throw 'Gradle Wrapper is missing. Restore src/native/android/gradlew.bat or set -GradlePath.' }
    if (-not $env:ANDROID_HOME -and -not (Test-Path -LiteralPath src/native/android/local.properties)) { throw 'Set ANDROID_HOME or open src/native/android in Android Studio to configure the SDK.' }
    if ($Release) {
        & node scripts/check-config.mjs --platform android
        if ($LASTEXITCODE -ne 0) { throw 'Release settings are incomplete.' }
    }
    $AndroidVersion = & node scripts/platform-version.mjs --platform android
    if ($LASTEXITCODE -ne 0) { throw 'Could not read versionName from src/native/android/app/build.gradle.kts.' }
    $Task = if ($Release) { 'bundleRelease' } else { 'assembleDebug' }
    $Output = "src/native/android/app/build/outputs/apk/debug/WorkFleet-$AndroidVersion-android-debug.apk"
    if ($Release) { $Output = "src/native/android/app/build/outputs/bundle/release/WorkFleet-$AndroidVersion-android-release.aab" }
    & $GradlePath -p src/native/android --no-daemon --console plain $Task
    if ($LASTEXITCODE -ne 0) { throw 'Android native build failed.' }
    if (-not (Test-Path -LiteralPath $Output -PathType Leaf)) { throw "Expected Gradle output $Output was not produced." }
    $Delivery = Join-Path $ProjectRoot 'build'
    New-Item -ItemType Directory -Path $Delivery -Force | Out-Null
    $Package = Join-Path $Delivery (Split-Path -Leaf $Output)
    Copy-Item -LiteralPath $Output -Destination $Package -Force
    $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Package).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText("$Package.sha256", "$Hash  $(Split-Path -Leaf $Package)`n")
    Write-Output "Android package: $Package"
} finally {
    Pop-Location
    foreach ($Name in $SavedSdkEnvironment.Keys) { [Environment]::SetEnvironmentVariable($Name, $SavedSdkEnvironment[$Name], 'Process') }
}
