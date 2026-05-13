#Requires -Version 5.1
<#
.SYNOPSIS
  Lists scheduled tasks named Cursor* whose action may flash a visible console on Windows.

.DESCRIPTION
  Tasks that invoke powershell.exe / cmd.exe directly (without wscript + Run-Hidden.vbs) often
  produce a brief console window. Use this script after edits to Task Scheduler.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\Get-CursorScheduledTaskConsoleRisk.ps1
#>
$ErrorActionPreference = 'SilentlyContinue'
$rows = @()
Get-ScheduledTask | Where-Object { $_.TaskName -like 'Cursor*' } | ForEach-Object {
  $tn = $_.TaskName
  foreach ($a in @($_.Actions)) {
    $ex = [string]$a.Execute
    $arg = [string]$a.Arguments
    if ([string]::IsNullOrWhiteSpace($ex)) { continue }
    $risk = $false
    $reason = ''
    $leaf = Split-Path -Leaf $ex
    if ($leaf -match '(?i)^(powershell|pwsh|cmd)\.exe$') {
      if ($arg -notmatch '(?i)wscript|Run-Hidden\.vbs') {
        $risk = $true
        $reason = 'Launches a console host directly; prefer wscript.exe + Run-Hidden.vbs (see docs/setup).'
      }
    }
    $rows += [pscustomobject]@{
      Task      = $tn
      Execute   = $ex
      Arguments = if ($arg.Length -gt 120) { $arg.Substring(0, 120) + '...' } else { $arg }
      Risk      = $risk
      Note      = $reason
    }
  }
}
if ($rows.Count -eq 0) {
  Write-Host 'No scheduled tasks matching Cursor* were found.'
  exit 0
}
$rows | Sort-Object Task, Execute | Format-Table -AutoSize
$bad = @($rows | Where-Object { $_.Risk })
if ($bad.Count -gt 0) {
  Write-Host ("`n{0} action(s) may flash a console. Rebuild tasks with wscript + Run-Hidden.vbs (see docs/setup/windows-basic-memory-always-on.md)." -f $bad.Count)
  exit 1
}
Write-Host "`nNo high-risk Cursor* task actions detected (by this heuristic)."
exit 0
