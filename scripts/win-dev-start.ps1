# win-dev-start.ps1 - One-click local dev startup for Windows.
#
# Brings up docker-compose Postgres, starts the Vite dev server, then
# launches the desktop app via `cargo run` (not `pnpm tauri dev` — see note
# in step 3 below).

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Write-Step($msg) {
    Write-Host "==> $msg" -ForegroundColor Cyan
}

# ---- 0. Refuse to start on top of an already-running Vite -------------------
$existing = Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Port 1420 is already in use (PID $($existing.OwningProcess | Select-Object -First 1))." -ForegroundColor Red
    Write-Host "Run win-dev-stop.ps1 first, or stop that process manually, then re-run this script." -ForegroundColor Red
    exit 1
}

# ---- 1. Ensure Docker Desktop is running ------------------------------------
Write-Step "Checking Docker Desktop..."
$dockerReady = $false
try { docker info *>$null; $dockerReady = $true } catch { $dockerReady = $false }

if (-not $dockerReady) {
    Write-Step "Starting Docker Desktop (waiting for engine)..."
    $dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) { Start-Process $dockerExe }
    $deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $deadline) {
        try { docker info *>$null; $dockerReady = $true; break } catch {}
        Start-Sleep -Seconds 3
    }
    if (-not $dockerReady) {
        Write-Host "Docker did not become ready in time. Start it manually and re-run this script." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Docker is ready." -ForegroundColor Green

# ---- 2. Bring up Postgres ----------------------------------------------------
Write-Step "Starting docker-compose services (Postgres)..."
docker compose up -d

Write-Step "Waiting for Postgres to be healthy..."
$deadline = (Get-Date).AddSeconds(120)
$healthy = $false
while ((Get-Date) -lt $deadline) {
    $pg = (docker inspect --format '{{.State.Health.Status}}' agentchat-postgres 2>$null)
    if ($pg -eq "healthy") { $healthy = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $healthy) {
    Write-Host "Postgres did not become healthy in time." -ForegroundColor Red
    exit 1
}
Write-Host "Postgres is healthy." -ForegroundColor Green

# ---- 3. Start Vite in its own window -----------------------------------------
# Runs `npm exec vite` directly (not `pnpm tauri dev`) and then `cargo run`
# directly against src-tauri instead of the tauri-cli, per this project's
# NEW_TOOL_PLAN_V2.md §11: tauri.conf.json's beforeDevCommand pattern uses
# POSIX `exec`, which cmd.exe can't run, and the tauri-cli's own
# devUrl-readiness poll has been unreliable on Windows in a sibling project.
# Vite must bind 127.0.0.1 explicitly (see vite.config.ts) — it defaults to
# IPv6-only (::1) on this machine, which tauri.conf.json's 127.0.0.1 devUrl
# then can't reach.
Write-Step "Starting Vite dev server (http://127.0.0.1:1420)..."
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$RepoRoot'; Write-Host 'Agent Chat UI (Vite)' -ForegroundColor Cyan; npm exec vite -- --port 1420 --strictPort"
)

Write-Step "Waiting for Vite..."
$deadline = (Get-Date).AddSeconds(60)
$viteReady = $false
while ((Get-Date) -lt $deadline) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:1420/" -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -eq 200) { $viteReady = $true; break }
    } catch {}
    Start-Sleep -Seconds 2
}
if (-not $viteReady) {
    Write-Host "Vite did not become ready in time - check the Vite window for errors." -ForegroundColor Red
    exit 1
}
Write-Host "Vite is up." -ForegroundColor Green

# ---- 4. Launch the desktop app ------------------------------------------------
Write-Step "Building and launching Agent Chat (first run after code changes can take a while)..."
$tauriDir = Join-Path $RepoRoot "src-tauri"
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$tauriDir'; Write-Host 'Agent Chat desktop app' -ForegroundColor Cyan; cargo run"
)

Write-Host ""
Write-Host "All set. Two windows were opened: Vite and the desktop app build/run log." -ForegroundColor Green
Write-Host "The Agent Chat window will appear once the Rust build finishes." -ForegroundColor Green
