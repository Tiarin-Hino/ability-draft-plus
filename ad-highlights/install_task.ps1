<#
Registers a Windows Task Scheduler job that runs run_daily.cmd every day at 04:00 *local time*
(if this PC is set to Central European Time that is 04:00 CET/CEST year-round, DST handled by Windows).

Usage (PowerShell, from this folder):
  .\install_task.ps1                # 04:00 daily
  .\install_task.ps1 -At 05:30      # different time
  .\install_task.ps1 -Wake          # also wake the PC from sleep to run it
  .\install_task.ps1 -Uninstall

The task runs as your user via S4U (no stored password, works while locked or logged out; needs
no admin rights). If the PC was off/asleep at 04:00, StartWhenAvailable runs it at next boot/wake.
#>
param(
  [string]$At = "04:00",
  [switch]$Wake,
  [switch]$Uninstall,
  [string]$TaskName = "AD Highlights Daily"
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed task '$TaskName'."
  exit 0
}

$cmd = Join-Path $here "run_daily.cmd"
if (-not (Test-Path $cmd)) { throw "run_daily.cmd not found next to this script" }

$action    = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"`"$cmd`"`"" -WorkingDirectory $here
$trigger   = New-ScheduledTaskTrigger -Daily -At $At
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
             -MultipleInstances IgnoreNew -WakeToRun:$Wake.IsPresent -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description "Finds clip-worthy Ability Draft moments (ad-highlights) and writes out\latest.md" -Force | Out-Null

$t = Get-ScheduledTask -TaskName $TaskName
Write-Host "Registered '$TaskName' -> daily at $At (local). Next run: $((Get-ScheduledTaskInfo $t).NextRunTime)"
Write-Host "Run it now with:  Start-ScheduledTask -TaskName '$TaskName'"
