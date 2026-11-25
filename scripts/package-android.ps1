$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$version = (Get-Content -Raw package.json | ConvertFrom-Json).version
$toolsRoot = Join-Path $projectRoot 'release/android-build-tools'
$javaMajor = 0
if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/javac.exe'))) {
    $javaVersion = & (Join-Path $env:JAVA_HOME 'bin/javac.exe') --version 2>&1 | Out-String
    if ($javaVersion -match 'javac (\d+)') { $javaMajor = [int]$Matches[1] }
}
if ($javaMajor -lt 21) {
    $env:JAVA_HOME = (Get-ChildItem -LiteralPath (Join-Path $toolsRoot 'jdk') -Directory | Select-Object -First 1).FullName
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $toolsRoot 'sdk' }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = Join-Path $toolsRoot 'gradle-home'
$env:PATH = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:PATH
$buildTools = Join-Path $env:ANDROID_HOME 'build-tools/36.0.0'
if (-not (Test-Path -LiteralPath (Join-Path $buildTools 'apksigner.bat'))) { throw 'Install Android SDK platform 36 and build-tools 36.0.0 first' }
$secretDirectory = Join-Path $projectRoot 'secrets/android-release'
$keyStore = Join-Path $secretDirectory 'partyup-release.p12'
$passwordFile = Join-Path $secretDirectory 'signing-password.txt'
if (-not (Test-Path -LiteralPath $secretDirectory)) {
    New-Item -ItemType Directory -Path $secretDirectory -Force > $null
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls $secretDirectory /inheritance:r /grant:r ($identity + ':(OI)(CI)F') 'SYSTEM:(OI)(CI)F' > $null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot protect signing directory' }
}
if (-not (Test-Path -LiteralPath $keyStore)) {
    if (Test-Path -LiteralPath $passwordFile) { throw 'Password exists without keystore; restore the original key before signing' }
    $passwordBytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($passwordBytes) } finally { $random.Dispose() }
    $env:PARTYUP_ANDROID_STORE_PASSWORD = [Convert]::ToBase64String($passwordBytes)
    [IO.File]::WriteAllText($passwordFile, $env:PARTYUP_ANDROID_STORE_PASSWORD, [Text.UTF8Encoding]::new($false))
    & (Join-Path $env:JAVA_HOME 'bin/keytool.exe') -genkeypair -keystore $keyStore -storetype PKCS12 -alias partyup -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=PartyUp Release, O=PartyUp' -storepass:env PARTYUP_ANDROID_STORE_PASSWORD -keypass:env PARTYUP_ANDROID_STORE_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw 'Signing key creation failed' }
} else { $env:PARTYUP_ANDROID_STORE_PASSWORD = [IO.File]::ReadAllText($passwordFile).Trim() }
try {
    Push-Location android
    try {
        & .\gradlew.bat --no-daemon --console=plain assembleRelease testReleaseUnitTest lintRelease
        if ($LASTEXITCODE -ne 0) { throw 'Android build or checks failed' }
    } finally { Pop-Location }
    $unsigned = Join-Path $projectRoot 'android/app/build/outputs/apk/release/app-release-unsigned.apk'
    $aligned = Join-Path $projectRoot "release/PartyUp-$version-Android-aligned.apk"
    $outputApk = Join-Path $projectRoot "release/PartyUp-$version-Android.apk"
    & (Join-Path $buildTools 'zipalign.exe') -f -P 16 4 $unsigned $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed' }
    & (Join-Path $buildTools 'apksigner.bat') sign --ks $keyStore --ks-key-alias partyup --ks-pass env:PARTYUP_ANDROID_STORE_PASSWORD --key-pass env:PARTYUP_ANDROID_STORE_PASSWORD --v4-signing-enabled false --out $outputApk $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed' }
    & (Join-Path $buildTools 'apksigner.bat') verify --verbose --print-certs $outputApk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
    & (Join-Path $buildTools 'zipalign.exe') -c -P 16 -v 4 $outputApk | Select-Object -Last 1
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment verification failed' }
    $badging = & (Join-Path $buildTools 'aapt.exe') dump badging $outputApk
    if ($LASTEXITCODE -ne 0) { throw 'APK metadata verification failed' }
    $badgingText = $badging -join "`n"
    if ($badgingText.Contains('application-debuggable') -or -not $badgingText.Contains("name='com.partyup.app'") -or -not $badgingText.Contains("versionName='$version'")) { throw 'Unexpected APK package/version or debug build' }
    $badging | Select-String "package:|sdkVersion:|targetSdkVersion:|application-label:|launchable-activity:"
    Write-Output ('Signed release APK: ' + $outputApk)
    Write-Output ('Keep a private backup of the signing key and password in: ' + $secretDirectory)
} finally { Remove-Item Env:PARTYUP_ANDROID_STORE_PASSWORD -ErrorAction SilentlyContinue }
