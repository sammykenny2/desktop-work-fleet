<#
.SYNOPSIS
    Install the pinned Android build tools inside this workspace.
.DESCRIPTION
    Downloads official SDK command-line tools and Gradle, checks their published
    SHA-256 checksums, and installs API 36 plus Build Tools 35.0.0. Requires an
    existing JDK 17+. Writes only build/toolchain; no machine PATH or registry edits.
    Google SDK license: https://developer.android.com/studio#terms-and-conditions
.PARAMETER AcceptSdkLicenses
    Confirm acceptance of Google's SDK terms and package licenses for this install.
.EXAMPLE
    .\scripts\windows\Install-AndroidToolchain.ps1 -AcceptSdkLicenses
#>
[CmdletBinding()]
param([switch]$AcceptSdkLicenses)
$ErrorActionPreference = 'Stop'
if (-not $AcceptSdkLicenses) { throw 'Read https://developer.android.com/studio#terms-and-conditions, then use -AcceptSdkLicenses to install the Google SDK.' }
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ToolchainRoot = Join-Path $ProjectRoot 'build/toolchain'
$Downloads = Join-Path $ToolchainRoot 'downloads'
$SdkRoot = Join-Path $ToolchainRoot 'android-sdk'
$GradleRoot = Join-Path $ToolchainRoot 'gradle-8.13-dist'
$ToolsRoot = Join-Path $ToolchainRoot 'android-tools-15859902'
$SavedJavaHome = $env:JAVA_HOME
$SavedAndroidUserHome = $env:ANDROID_USER_HOME
$SavedGradleHome = $env:GRADLE_USER_HOME
$SdkLog = Join-Path $ToolchainRoot 'sdk-install.log'
function Get-ToolArchive([string]$Url, [string]$FileName, [string]$Hash) {
    $Archive = Join-Path $Downloads $FileName
    if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) {
        Write-Host "Downloading $FileName"
        Invoke-WebRequest -Uri $Url -OutFile ($Archive + '.partial')
        if ((Get-FileHash -LiteralPath ($Archive + '.partial') -Algorithm SHA256).Hash -ne $Hash) { throw "Checksum mismatch: $FileName" }
        Move-Item -LiteralPath ($Archive + '.partial') -Destination $Archive
    }
    if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ne $Hash) { throw "Checksum mismatch: $FileName" }
    return $Archive
}
Push-Location $ProjectRoot
try {
    $SdkSettings = (& node scripts/toolchain-env.mjs | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0) { throw 'Could not read SDK paths.' }
    if ($SdkSettings.JAVA_HOME) { $env:JAVA_HOME = $SdkSettings.JAVA_HOME }
    if (-not $env:JAVA_HOME) {
        $JavaCommand = Get-Command javac -ErrorAction Stop
        $env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $JavaCommand.Source)
    }
    if (-not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/javac.exe') -PathType Leaf)) { throw 'An existing JDK 17+ is required.' }
    New-Item -ItemType Directory -Path $Downloads, $SdkRoot -Force | Out-Null
    $env:ANDROID_USER_HOME = Join-Path $ToolchainRoot 'android-user'
    $env:GRADLE_USER_HOME = Join-Path $ProjectRoot 'build/gradle-home'
    $GradleArchive = Get-ToolArchive 'https://services.gradle.org/distributions/gradle-8.13-bin.zip' 'gradle-8.13-bin.zip' '20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78'
    $ToolsArchive = Get-ToolArchive 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' 'commandlinetools-win-15859902_latest.zip' '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
    $GradleExecutable = Join-Path $GradleRoot 'gradle-8.13/bin/gradle.bat'
    $SdkManager = Join-Path $ToolsRoot 'cmdline-tools/bin/sdkmanager.bat'
    if (-not (Test-Path -LiteralPath $GradleExecutable -PathType Leaf)) { Expand-Archive -LiteralPath $GradleArchive -DestinationPath $GradleRoot -Force }
    if (-not (Test-Path -LiteralPath $SdkManager -PathType Leaf)) { Expand-Archive -LiteralPath $ToolsArchive -DestinationPath $ToolsRoot -Force }
    1..32 | ForEach-Object { 'y' } | & $SdkManager "--sdk_root=$SdkRoot" --licenses > $SdkLog
    if ($LASTEXITCODE -ne 0) { Get-Content -LiteralPath $SdkLog -Tail 15; throw 'SDK license installation failed.' }
    & $SdkManager "--sdk_root=$SdkRoot" 'platforms;android-36' 'build-tools;35.0.0' >> $SdkLog
    if ($LASTEXITCODE -ne 0) { Get-Content -LiteralPath $SdkLog -Tail 15; throw 'SDK package installation failed.' }
    $Paths = @{ ANDROID_HOME = $SdkRoot; JAVA_HOME = $env:JAVA_HOME; GRADLE_HOME = (Join-Path $GradleRoot 'gradle-8.13') }
    $Paths | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ToolchainRoot 'android.json') -Encoding utf8
    Write-Output 'Workspace Android toolchain installed. Run scripts/windows/Build-AndroidApp.ps1.'
} finally {
    Pop-Location
    $env:JAVA_HOME = $SavedJavaHome
    $env:ANDROID_USER_HOME = $SavedAndroidUserHome
    $env:GRADLE_USER_HOME = $SavedGradleHome
}
