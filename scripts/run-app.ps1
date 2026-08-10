# run-app.ps1 - Quick-launch for the packaged release build.
#
# Ensures Postgres is up (usually already running, so this is fast), then
# launches the release exe directly. No Vite/dev server involved -this is
# for using the app, not developing it (use win-dev-start.ps1 for that).
#
# Launched with -WindowStyle Hidden from the desktop shortcut, so Write-Host
# is invisible -any failure the user needs to actually see must go through
# a message box instead, or a double-click that silently does nothing just
# looks like "the shortcut is broken".

$ErrorActionPreference = "SilentlyContinue"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

Add-Type -AssemblyName System.Windows.Forms
function Show-Error($message) {
    [System.Windows.Forms.MessageBox]::Show($message, "Agent Chat", "OK", "Error") | Out-Null
}

$exe = Join-Path $RepoRoot "src-tauri\target\release\agentchat.exe"
if (-not (Test-Path $exe)) {
    Show-Error("Khong tim thay ban build tai:`n$exe`n`nChay lai: cd src-tauri; cargo build --release")
    exit 1
}

# Native commands (docker) write routine status to stderr; under a strict
# ErrorActionPreference that gets promoted to a terminating error even on
# exit code 0, so these are run without one and their own exit code is
# checked explicitly instead of relying on try/catch around the call.
docker info > $null 2>&1
$dockerReady = ($LASTEXITCODE -eq 0)
if ($dockerReady) {
    docker compose up -d > $null 2>&1
    $deadline = (Get-Date).AddSeconds(30)
    $pgHealthy = $false
    while ((Get-Date) -lt $deadline) {
        $pg = (docker inspect --format '{{.State.Health.Status}}' agentchat-postgres 2>$null)
        if ($pg -eq "healthy") { $pgHealthy = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $pgHealthy) {
        Show-Error("Postgres khong san sang sau 30 giay (trang thai cuoi: $pg).`nUng dung van se mo nhung co the khong ket noi duoc database.")
    }
} else {
    Show-Error("Docker Desktop chua chay - hay mo Docker Desktop truoc, Agent Chat can Postgres de hoat dong.")
    exit 1
}

$proc = Start-Process $exe -PassThru
# A build/migration crash exits almost immediately - give it a moment, then
# surface that instead of leaving the user staring at a desktop that did
# nothing when they double-clicked.
Start-Sleep -Seconds 2
if ($proc.HasExited) {
    Show-Error("Agent Chat da tat ngay sau khi mo (exit code $($proc.ExitCode)).`nCo the do loi migration hoac build - kiem tra lai voi: cd src-tauri; cargo run")
}
