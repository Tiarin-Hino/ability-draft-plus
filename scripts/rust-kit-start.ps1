<#
.SYNOPSIS
    Builds and launches the standalone Ability Draft Plus Rust Suite
    (ad-control-panel + ad-daemon + optional ad-overlay).
.EXAMPLE
    .\scripts\rust-kit-start.ps1
    .\scripts\rust-kit-start.ps1 -WithOverlay -AutoRescan
    .\scripts\rust-kit-start.ps1 -OverlayOnly -AutoRescan
    .\scripts\rust-kit-start.ps1 -Release -DaemonOnly -Port 41234
#>
[CmdletBinding()]
param(
    [int]$Port = 41234,
    [switch]$Release,
    [switch]$WithOverlay,
    [switch]$OverlayOnly,
    [switch]$DaemonOnly,
    [switch]$AutoRescan
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$rustDir = Join-Path $repoRoot "rust"
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

Write-Host "Stopping any existing ad-control-panel / ad-overlay / ad-daemon processes..." -ForegroundColor Yellow
Stop-Process -Name "ad-control-panel", "ad-overlay", "ad-daemon" -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300

$buildArgs = @("build", "--workspace")
$profileDir = "debug"
if ($Release) {
    $buildArgs += "--release"
    $profileDir = "release"
}

Write-Host "Building Rust workspace ($profileDir)..." -ForegroundColor Cyan
Push-Location $rustDir
try {
    & cargo @buildArgs
    if ($LASTEXITCODE -ne 0) {
        throw "cargo build failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

$targetDir = Join-Path $rustDir "target\$profileDir"
$daemonExe = Join-Path $targetDir "ad-daemon.exe"
$overlayExe = Join-Path $targetDir "ad-overlay.exe"
$panelExe = Join-Path $targetDir "ad-control-panel.exe"

if (-not (Test-Path $daemonExe)) {
    throw "Missing daemon binary: $daemonExe"
}

$daemonPsi = New-Object System.Diagnostics.ProcessStartInfo
$daemonPsi.FileName = $daemonExe
$daemonPsi.WorkingDirectory = $repoRoot
$daemonPsi.UseShellExecute = $false
$daemonPsi.EnvironmentVariables["AD_DAEMON_PORT"] = "$Port"
if ($AutoRescan) {
    $daemonPsi.EnvironmentVariables["AD_AUTO_RESCAN"] = "1"
}

Write-Host "Starting ad-daemon on http://127.0.0.1:$Port ..." -ForegroundColor Cyan
$daemonProc = [System.Diagnostics.Process]::Start($daemonPsi)
$overlayProc = $null

try {
    $healthUrl = "http://127.0.0.1:$Port/health"
    $health = $null
    for ($i = 0; $i -lt 50; $i++) {
        if ($daemonProc.HasExited) {
            throw "ad-daemon exited unexpectedly with code $($daemonProc.ExitCode)"
        }
        try {
            $resp = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
            if ($resp.status -eq "ok") {
                $health = $resp
                break
            }
        } catch {
            Start-Sleep -Milliseconds 300
        }
    }

    if ($null -eq $health) {
        throw "Timed out waiting for ad-daemon at $healthUrl"
    }

    $heroesCount = if ($health.db_summary) { $health.db_summary.heroes_count } else { 0 }
    $abilitiesCount = if ($health.db_summary) { $health.db_summary.abilities_count } else { 0 }
    Write-Host ("ad-daemon ready | backend={0} layouts={1} templates={2} db={3}h/{4}a gsi={5}" -f `
        $health.capture_backend, $health.layouts_loaded, $health.pick_templates_loaded, `
        $heroesCount, $abilitiesCount, $health.gsi_connected) -ForegroundColor Green

    if ($DaemonOnly) {
        Write-Host "Running in -DaemonOnly mode. Press Ctrl+C to stop ad-daemon." -ForegroundColor Gray
        $daemonProc.WaitForExit()
        return
    }

    if ($OverlayOnly) {
        if (-not (Test-Path $overlayExe)) {
            throw "Missing overlay binary: $overlayExe"
        }
        Write-Host "Starting ad-overlay (Ctrl+Shift+S = Scan, Ctrl+Shift+R = Reset)..." -ForegroundColor Cyan
        $overlayPsi = New-Object System.Diagnostics.ProcessStartInfo
        $overlayPsi.FileName = $overlayExe
        $overlayPsi.WorkingDirectory = $repoRoot
        $overlayPsi.UseShellExecute = $false
        $overlayPsi.EnvironmentVariables["AD_DAEMON_URL"] = "http://127.0.0.1:$Port"
        $overlayProc = [System.Diagnostics.Process]::Start($overlayPsi)
        $overlayProc.WaitForExit()
        return
    }

    if ($WithOverlay) {
        if (-not (Test-Path $overlayExe)) {
            throw "Missing overlay binary: $overlayExe"
        }
        Write-Host "Starting ad-overlay alongside Control Panel..." -ForegroundColor Cyan
        $overlayPsi = New-Object System.Diagnostics.ProcessStartInfo
        $overlayPsi.FileName = $overlayExe
        $overlayPsi.WorkingDirectory = $repoRoot
        $overlayPsi.UseShellExecute = $false
        $overlayPsi.EnvironmentVariables["AD_DAEMON_URL"] = "http://127.0.0.1:$Port"
        $overlayProc = [System.Diagnostics.Process]::Start($overlayPsi)
    }

    if (-not (Test-Path $panelExe)) {
        throw "Missing Control Panel binary: $panelExe"
    }
    Write-Host "Starting native ad-control-panel (use 'Launch Overlay' button inside Dashboard)..." -ForegroundColor Cyan
    $panelPsi = New-Object System.Diagnostics.ProcessStartInfo
    $panelPsi.FileName = $panelExe
    $panelPsi.WorkingDirectory = $repoRoot
    $panelPsi.UseShellExecute = $false
    $panelPsi.EnvironmentVariables["AD_DAEMON_PORT"] = "$Port"
    $panelPsi.EnvironmentVariables["AD_DAEMON_URL"] = "http://127.0.0.1:$Port"
    $panelProc = [System.Diagnostics.Process]::Start($panelPsi)
    $panelProc.WaitForExit()
} finally {
    if ($overlayProc -and -not $overlayProc.HasExited) {
        Stop-Process -Id $overlayProc.Id -Force -ErrorAction SilentlyContinue
    }
    Stop-Process -Name "ad-overlay" -Force -ErrorAction SilentlyContinue
    if ($daemonProc -and -not $daemonProc.HasExited) {
        Write-Host "Stopping ad-daemon..." -ForegroundColor Yellow
        Stop-Process -Id $daemonProc.Id -Force -ErrorAction SilentlyContinue
    }
}
