<#
.SYNOPSIS
    Build the Android native APK or release App Bundle.
.DESCRIPTION
    Requires JDK 17, Android SDK 36 and Gradle 8.13. Uses .env public app/Google
    settings and optional SDK paths. No SDK installation, device test or store upload.
    Release produces an unsigned AAB for the user's signing pipeline.
.PARAMETER Release
    Build an unsigned release AAB instead of a debug APK.
.PARAMETER GradlePath
    Gradle executable path; defaults to gradle on PATH.
.EXAMPLE
    .\scripts\windows\Build-AndroidApp.ps1 -Release
#>
[CmdletBinding()]
param([switch]$Release, [string]$GradlePath = 'gradle')
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$SavedSdkEnvironment = @{}
Push-Location $ProjectRoot
try {
    $SdkSettings = (& node scripts/toolchain-env.mjs | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0) { throw 'Could not read SDK configuration.' }
    foreach ($Name in @('ANDROID_HOME', 'JAVA_HOME')) {
        $SavedSdkEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
        if ($SdkSettings.$Name) { [Environment]::SetEnvironmentVariable($Name, $SdkSettings.$Name, 'Process') }
    }
    if (-not (Get-Command $GradlePath -ErrorAction SilentlyContinue)) { throw 'Gradle 8.13 is required. Set -GradlePath or install Gradle in your build environment.' }
    if (-not $env:ANDROID_HOME) { throw 'Set ANDROID_HOME in .env or the build environment.' }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Web asset build failed.' }
    $Task = if ($Release) { 'bundleRelease' } else { 'assembleDebug' }
    & $GradlePath -p src/native/android --no-daemon $Task
    if ($LASTEXITCODE -ne 0) { throw 'Android native build failed.' }
    Write-Output 'Android output: src/native/android/app/build/outputs'
} finally {
    Pop-Location
    foreach ($Name in $SavedSdkEnvironment.Keys) { [Environment]::SetEnvironmentVariable($Name, $SavedSdkEnvironment[$Name], 'Process') }
}
