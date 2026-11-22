param(
    [ValidateSet('aarch64','armv7','x86_64')][string[]]$Targets = @('aarch64','armv7','x86_64'),
    [switch]$DebugBuild
)
$ErrorActionPreference = 'Stop'
$nativeRoot = Split-Path -Parent $PSScriptRoot
$nativeRepository = Split-Path -Parent $nativeRoot
. (Join-Path $nativeRepository 'scripts/native-env.ps1') -WithProxy
$env:CARGO_PROFILE_DEV_DEBUG = '0'
$env:CARGO_BUILD_JOBS = '1'
$nativeProfile = if ($DebugBuild) { 'debug' } else { 'release' }
$nativeProfileTitle = if ($DebugBuild) { 'Debug' } else { 'Release' }
$nativeCli = Join-Path $nativeRoot 'node_modules/@tauri-apps/cli/tauri.js'
$nativeGenerated = Join-Path $nativeRoot 'src-tauri/gen/android'
$nativeLogs = Join-Path $nativeRepository '.tmp-native-build'
$nativeMap = @{
    aarch64 = @('aarch64-linux-android','arm64-v8a','arm64','Arm64')
    armv7 = @('armv7-linux-androideabi','armeabi-v7a','arm','Arm')
    x86_64 = @('x86_64-linux-android','x86_64','x86_64','X86_64')
}
& node (Join-Path $PSScriptRoot 'prepare-mobile.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Android project preparation failed.' }
Push-Location $nativeRoot
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    $nativeSkipFrontend = Join-Path $nativeLogs 'android-compiled-frontend.json'
    '{"build":{"beforeBuildCommand":""}}' | Set-Content -LiteralPath $nativeSkipFrontend -Encoding UTF8
    foreach ($nativeTarget in $Targets) {
        $nativeLog = Join-Path $nativeLogs "android-$nativeTarget-$nativeProfile.log"
        $nativeArguments = @($nativeCli,'android','build','--apk','--target',$nativeTarget,'--config',$nativeSkipFrontend)
        if ($DebugBuild) { $nativeArguments += '--debug' }
        $nativePreviousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & node @nativeArguments *> $nativeLog
        $nativeResult = $LASTEXITCODE
        $ErrorActionPreference = $nativePreviousErrorActionPreference
        if ($nativeResult -ne 0) {
            $nativeFailure = Get-Content -LiteralPath $nativeLog -Raw
            if ($nativeFailure -notmatch 'Creation symbolic link is not allowed|privilege is not held') {
                Write-Output $nativeFailure.Substring([Math]::Max(0,$nativeFailure.Length-3500))
                throw "Android Rust compilation failed for $nativeTarget."
            }
        }
        $nativeCompiled = Join-Path $nativeRoot "src-tauri/target/$($nativeMap[$nativeTarget][0])/$nativeProfile/librenewal_local.so"
        if (-not (Test-Path -LiteralPath $nativeCompiled)) { throw 'Compiled Android library is missing.' }
        $nativeJniDirectory = Join-Path $nativeGenerated "app/src/main/jniLibs/$($nativeMap[$nativeTarget][1])"
        New-Item -ItemType Directory -Force -Path $nativeJniDirectory | Out-Null
        $nativeJniLibrary = Join-Path $nativeJniDirectory 'librenewal_local.so'
        $nativeExisting = Get-Item -LiteralPath $nativeJniLibrary -ErrorAction SilentlyContinue
        if (-not $nativeExisting -or -not $nativeExisting.LinkType) { Copy-Item -LiteralPath $nativeCompiled -Destination $nativeJniLibrary -Force }
        Write-Output "Android native library ready: $nativeTarget ($nativeProfile)."
    }
    $nativeGradleProperties = Join-Path $nativeGenerated 'gradle.properties'
    $nativeProperties = Get-Content -LiteralPath $nativeGradleProperties -Raw
    $nativeProperties = $nativeProperties -replace 'org.gradle.jvmargs=.*','org.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8'
    if ($nativeProperties -notmatch '(?m)^org.gradle.workers.max=') { $nativeProperties += "`norg.gradle.workers.max=2`nkotlin.compiler.execution.strategy=in-process`n" }
    Set-Content -LiteralPath $nativeGradleProperties -Value $nativeProperties -Encoding UTF8
    $nativeGradleArguments = @("assembleUniversal$nativeProfileTitle",'--no-daemon','--no-configuration-cache','--max-workers=2',"-PabiList=$(($Targets | ForEach-Object {$nativeMap[$_][1]}) -join ',')","-ParchList=$(($Targets | ForEach-Object {$nativeMap[$_][2]}) -join ',')","-PtargetList=$($Targets -join ',')")
    if ($env:HTTPS_PROXY -match '^http://([^:]+):(\d+)$') {
        $nativeGradleArguments += @("-Dhttps.proxyHost=$($Matches[1])","-Dhttps.proxyPort=$($Matches[2])","-Dhttp.proxyHost=$($Matches[1])","-Dhttp.proxyPort=$($Matches[2])")
    }
    foreach ($nativeTarget in $Targets) { $nativeGradleArguments += @('-x',"rustBuild$($nativeMap[$nativeTarget][3])$nativeProfileTitle") }
    Push-Location $nativeGenerated
    try { & ./gradlew.bat @nativeGradleArguments; if($LASTEXITCODE -ne 0) { throw 'Android Gradle packaging failed.' } }
    finally { Pop-Location }
    Get-ChildItem -LiteralPath (Join-Path $nativeGenerated "app/build/outputs/apk/universal/$nativeProfile") -Filter '*.apk' | Select-Object -ExpandProperty FullName
} finally { Pop-Location }
