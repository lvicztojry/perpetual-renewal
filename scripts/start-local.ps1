$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$siteUrl = 'http://localhost:3000'
$loginUrl = "$siteUrl/login"
$logOut = Join-Path $projectRoot '.tmp-local-dev.out.log'
$logErr = Join-Path $projectRoot '.tmp-local-dev.err.log'

function Test-TcpPort {
    param([int]$Port)

    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($pending)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Test-ProjectReady {
    try {
        $response = Invoke-WebRequest -Uri $loginUrl -UseBasicParsing -TimeoutSec 3
        $isNextApp = $response.Headers['X-Powered-By'] -match 'Next\.js' -or
            $response.Content.Contains('/_next/')
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500 -and $isNextApp)
    } catch {
        return $false
    }
}

Set-Location $projectRoot

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    throw 'Node.js was not found. Install Node.js, then run this launcher again.'
}

$nextCli = Join-Path $projectRoot 'node_modules/next/dist/bin/next'
if (-not (Test-Path -LiteralPath $nextCli)) {
    throw 'Dependencies are missing. Run npm ci in the project folder, then run this launcher again.'
}

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.env.local'))) {
    Write-Warning 'No root .env.local found. Database, email, or model features may be unavailable.'
}

if (Test-ProjectReady) {
    Write-Host 'The app is already running. Opening the existing page.' -ForegroundColor Green
} else {
    if (Test-TcpPort -Port 3000) {
        throw 'Port 3000 is occupied by another app. Close it or change the port in scripts/start-local.ps1.'
    }

    Write-Host 'Starting the app in the background...' -ForegroundColor Cyan
    $null = Start-Process -FilePath $nodeCommand.Source `
        -ArgumentList @('node_modules/next/dist/bin/next', 'dev', '--hostname', 'localhost', '--port', '3000') `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $logOut `
        -RedirectStandardError $logErr `
        -PassThru

    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Seconds 1
        if (Test-ProjectReady) {
            $ready = $true
            break
        }
    }

    if (-not $ready) {
        throw "The app did not become ready within 60 seconds. Check the local log: $logErr"
    }
}

Start-Process $siteUrl
Write-Host "Opened $siteUrl" -ForegroundColor Green
