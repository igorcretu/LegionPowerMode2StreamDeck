# Run this ONCE, as Administrator (right-click -> Run with PowerShell as admin,
# or from an elevated prompt: powershell -ExecutionPolicy Bypass -File install-task.ps1).
#
# Registers a Scheduled Task that runs helper.ps1 elevated (RunLevel = Highest).
# Because this account is a member of BUILTIN\Administrators, Task Scheduler will
# launch that task with a full admin token WITHOUT a UAC prompt every time it's
# triggered afterwards (including via `schtasks /run` from a non-elevated process) —
# only this one-time registration step needs an elevated prompt.

$ErrorActionPreference = 'Stop'
$TaskName = 'IgorCretu-LegionPowerModeHelper'
$HelperPath = Join-Path $PSScriptRoot 'helper.ps1'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator (one-time only)."
    exit 1
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$HelperPath`""

$trigger = New-ScheduledTaskTrigger -AtLogOn

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName'. Starting it now..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 1
Write-Host (Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo | Format-List | Out-String)
Write-Host "Done. The helper should now be listening on \\.\pipe\igorcretu-legion-powermode"
