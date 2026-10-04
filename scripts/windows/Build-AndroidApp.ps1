<#
.SYNOPSIS
    Build the Android native APK or release App Bundle.
.DESCRIPTION
    Requires JDK 17, Android SDK 36 and Gradle 8.13. Uses .env public app/Google
    settings and optional SDK paths. No SDK installation, device test or store upload.
    Release uses signing environment variables when configured; otherwise it is unsigned.
.PARAMETER Release
    Build a release AAB instead of a debug APK.
.PARAMETER Signed
    Require signing environment variables and build a release AAB.
.PARAMETER GradlePath
    Gradle executable path; defaults to gradle on PATH.
.EXAMPLE
    .\scripts\windows\Build-AndroidApp.ps1 -Release
#>
[CmdletBinding()]
param([switch]$Release, [switch]$Signed, [string]$GradlePath = 'gradle')
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
    if ($GradlePath -eq 'gradle' -and $env:GRADLE_HOME) { $GradlePath = Join-Path $env:GRADLE_HOME 'bin/gradle.bat' }
    if (-not (Get-Command $GradlePath -ErrorAction SilentlyContinue)) { throw 'Gradle 8.13 is required. Set -GradlePath or install Gradle in your build environment.' }
    if (-not $env:ANDROID_HOME) { throw 'Set ANDROID_HOME in .env or the build environment.' }
    if ($Release) {
        & node scripts/check-config.mjs --platform android
        if ($LASTEXITCODE -ne 0) { throw 'Release settings are incomplete.' }
    }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Web asset build failed.' }
    $Task = if ($Release) { 'bundleRelease' } else { 'assembleDebug' }
    & $GradlePath -p src/native/android --no-daemon --console plain $Task
    if ($LASTEXITCODE -ne 0) { throw 'Android native build failed.' }
    Write-Output 'Android output: src/native/android/app/build/outputs'
} finally {
    Pop-Location
    foreach ($Name in $SavedSdkEnvironment.Keys) { [Environment]::SetEnvironmentVariable($Name, $SavedSdkEnvironment[$Name], 'Process') }
}
