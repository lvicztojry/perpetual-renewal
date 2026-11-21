param([switch]$WithProxy)
$ErrorActionPreference = 'Stop'
$nativeProjectRoot = Split-Path -Parent $PSScriptRoot
$nativeToolRoot = Join-Path $nativeProjectRoot '.build-tools'
$env:CARGO_HOME = Join-Path $nativeToolRoot 'cargo'
$env:RUSTUP_HOME = Join-Path $nativeToolRoot 'rustup'
$env:GRADLE_USER_HOME = Join-Path $nativeToolRoot 'gradle'
$env:ANDROID_USER_HOME = Join-Path $nativeToolRoot 'android-user'
$env:ANDROID_HOME = Join-Path $nativeToolRoot 'android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$nativeJdk = Get-ChildItem -LiteralPath (Join-Path $nativeToolRoot 'java') -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/java.exe') } | Select-Object -First 1
if ($nativeJdk) { $env:JAVA_HOME = $nativeJdk.FullName }
$nativeNdk = Get-ChildItem -LiteralPath (Join-Path $env:ANDROID_HOME 'ndk') -Directory -ErrorAction SilentlyContinue | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if ($nativeNdk) { $env:NDK_HOME = $nativeNdk.FullName }
$env:PATH = "$env:CARGO_HOME\bin;$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:PATH"
$env:CARGO_BUILD_JOBS = '2'
$nativeTemp = Join-Path $nativeProjectRoot '.tmp-native-build/temp'
New-Item -ItemType Directory -Force -Path $nativeTemp | Out-Null
$env:TEMP = $nativeTemp
$env:TMP = $nativeTemp
if ($WithProxy) {
    $nativeProxy = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
    if ($nativeProxy.ProxyEnable -eq 1 -and $nativeProxy.ProxyServer -match '^127\.0\.0\.1:(\d+)$') {
        $nativeProxyPort = $Matches[1]
        if (-not $env:HTTPS_PROXY) { $env:HTTPS_PROXY = "http://127.0.0.1:$nativeProxyPort" }
        if (-not $env:HTTP_PROXY) { $env:HTTP_PROXY = "http://127.0.0.1:$nativeProxyPort" }
        if (-not $env:NO_PROXY) { $env:NO_PROXY = "localhost,127.0.0.1,::1" }
        $nativeJvmProxy = "-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=$nativeProxyPort -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=$nativeProxyPort -Dhttp.nonProxyHosts=localhost|127.*"
        if ($env:JAVA_TOOL_OPTIONS -notlike '*-Dhttps.proxyHost=*') { $env:JAVA_TOOL_OPTIONS = "$env:JAVA_TOOL_OPTIONS $nativeJvmProxy".Trim() }
    }
}
