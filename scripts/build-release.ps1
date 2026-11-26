# 三端 0.2.0 打包：前端构建 + Windows NSIS 安装包 + Android 签名 APK
# 必须在真实 PowerShell 窗口运行（沙箱无法建立本地回环，Gradle/JVM 会失败）。
#
# 用法：
#   .\scripts\build-release.ps1              # 构建全部
#   .\scripts\build-release.ps1 -SkipWindows # 只构建 Android

param(
  [switch]$SkipWindows,
  [switch]$SkipAndroid
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts/native-env.ps1') -WithProxy

$version = (Get-Content (Join-Path $repo 'native/package.json') -Raw | ConvertFrom-Json).version
$installers = Join-Path $repo 'dist/installers'
New-Item -ItemType Directory -Force -Path $installers | Out-Null

Write-Host "=== 打包版本 $version ===" -ForegroundColor Cyan

$results = [ordered]@{}

if (-not $SkipWindows) {
  Write-Host "=== Windows NSIS 安装包 ===" -ForegroundColor Cyan
  Push-Location (Join-Path $repo 'native')
  try {
    & npm run desktop:build -- --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw 'Windows 构建失败' }
  } finally { Pop-Location }

  $nsis = Join-Path $repo 'native/src-tauri/target/release/bundle/nsis'
  $setup = Get-ChildItem -LiteralPath $nsis -Filter '*setup.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $setup) { throw "未找到 NSIS 安装包：$nsis" }
  $target = Join-Path $installers "renewal-$version-windows-x64-setup.exe"
  Copy-Item -LiteralPath $setup.FullName -Destination $target -Force
  $results.windows = $target
  Write-Host "Windows: $target" -ForegroundColor Green
}

if (-not $SkipAndroid) {
  Write-Host "=== Android ARM64 APK ===" -ForegroundColor Cyan
  & (Join-Path $repo 'native/scripts/build-android.ps1') -Targets aarch64
  if ($LASTEXITCODE -ne 0) { throw 'Android 构建失败' }

  $apk = Get-ChildItem -LiteralPath (Join-Path $repo 'native/src-tauri/gen/android/app/build/outputs/apk/universal/release') -Filter '*.apk' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $apk) { throw '未找到 Android APK 输出' }

  $signed = Join-Path $installers "renewal-$version-arm64.apk"
  & node (Join-Path $repo 'native/scripts/sign-android.mjs') --input $apk.FullName --output $signed
  if ($LASTEXITCODE -ne 0) { throw 'APK 签名失败' }
  $results.android = $signed
  Write-Host "Android: $signed" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== 校验值 ===" -ForegroundColor Cyan
$sums = @()
foreach ($key in $results.Keys) {
  $file = $results[$key]
  $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower()
  $size = (Get-Item -LiteralPath $file).Length
  $name = Split-Path -Leaf $file
  $sums += "$hash  $name"
  Write-Host ("{0}`n  {1} bytes`n  sha256 {2}" -f $name, $size, $hash)
}

$sums | Set-Content -LiteralPath (Join-Path $installers 'SHA256SUMS.txt') -Encoding UTF8
Write-Host ""
Write-Host "已写入 $installers\SHA256SUMS.txt" -ForegroundColor Green
