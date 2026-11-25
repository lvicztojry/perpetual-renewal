# 只编译 Android 工程的 Kotlin 源码，用于快速验证原生插件（如 SpeechPlugin.kt）
# 是否语法/类型正确，不跑完整的 Rust 交叉编译与打包。
#
# 为什么需要它：`npm --prefix native run android:build` 会先编译 Rust 再打包，
# 全程数分钟；改 Kotlin 时先跑这个脚本能在 30 秒内拿到编译错误。
#
# 注意：必须在真实终端里运行。在受限沙箱中执行时，JVM 无法建立本地回环连接，
# 会报 "java.io.IOException: Unable to establish loopback connection"，
# 那是沙箱限制而不是代码问题。

$ErrorActionPreference = "Continue"

$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$env:JAVA_HOME = Join-Path $repo ".build-tools\java\jdk-21.0.13.1+2"
$env:ANDROID_HOME = Join-Path $repo ".build-tools\android-sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = Join-Path $repo ".build-tools\gradle"

$androidDir = Join-Path $repo "native\src-tauri\gen\android"
if (-not (Test-Path (Join-Path $androidDir "gradlew.bat"))) {
  Write-Error "Android project missing. Run: npm --prefix native run android:init"
  exit 1
}

Set-Location $androidDir

Write-Host "=== compiling Android Kotlin ==="
.\gradlew.bat :app:compileUniversalReleaseKotlin --offline 2>&1 | Select-Object -Last 30
$code = $LASTEXITCODE
Write-Host "=== exit code: $code ==="
exit $code
