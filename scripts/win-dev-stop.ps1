# win-dev-stop.ps1 - Stop everything win-dev-start.ps1 started.
#
# Kills agentchat.exe and the Vite dev server (by port), then stops (not
# removes) the docker-compose services so next startup is fast.

$ErrorActionPreference = "SilentlyContinue"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Write-Step($msg) {
    Write-Host "==> $msg" -ForegroundColor Cyan
}

Write-Step "Stopping Agent Chat desktop app..."
Get-Process agentchat -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Step "Stopping Vite dev server (port 1420)..."
$vitePids = (Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
foreach ($p in $vitePids) {
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
}

Write-Step "Stopping docker-compose services (data is preserved; use 'docker compose down' to remove containers)..."
docker compose stop

Write-Host ""
Write-Host "Everything stopped. Run win-dev-start.ps1 (or the desktop shortcut) to start again." -ForegroundColor Green
