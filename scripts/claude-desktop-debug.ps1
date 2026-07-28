<#
.SYNOPSIS
  Restarts Claude Desktop with its DevTools port open, so vkm-kit can apply `/model` and
  `/effort` to a running session without touching your keyboard or your foreground window.

.DESCRIPTION
  Claude Desktop is Electron. Its renderer accepts input over the Chrome DevTools Protocol
  regardless of which window is focused — the only mechanism that can right-size a session
  while you work in another app. Windows itself blocks every alternative: Chromium takes
  keystrokes only when its window is active (measured — with the window minimized, not one
  posted character arrived), and its UI Automation tree exposes the prompt read-only.

  The port is not open by default, and this script is the adaptation that opens it.

.NOTES
  READ THIS BEFORE RUNNING IT.

  `--remote-debugging-port` lets ANY process running as you drive the app: read the
  conversation, execute JavaScript in it, act as you. It listens on 127.0.0.1 only, so it is
  not reachable from the network, but it removes the boundary between the app and every
  other program on the machine. That is a real trade-off, not a formality — turn it on if
  you want this automation, and close it (restart the app normally) when you don't.

  It also RESTARTS the app: any session open in it is interrupted.

.EXAMPLE
  pwsh -File scripts/claude-desktop-debug.ps1
  pwsh -File scripts/claude-desktop-debug.ps1 -Port 9333
  pwsh -File scripts/claude-desktop-debug.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [ValidateRange(1024, 65535)] [int] $Port = 9222,
  [switch] $Force
)

$ErrorActionPreference = 'Stop'

$pkg = Get-AppxPackage -Name '*Claude*' | Select-Object -First 1
if (-not $pkg) { throw 'Claude Desktop (MSIX package) not found on this machine.' }
$appId = (Get-AppxPackageManifest $pkg).Package.Applications.Application.Id
$target = "shell:AppsFolder\$($pkg.PackageFamilyName)!$appId"

$running = Get-Process -Name 'claude' -ErrorAction SilentlyContinue
if ($running -and -not $Force) {
  Write-Host "Claude Desktop is running ($($running.Count) processes)." -ForegroundColor Yellow
  Write-Host 'Restarting it will interrupt any session open there. Re-run with -Force to proceed.'
  return
}

if ($PSCmdlet.ShouldProcess($target, "restart with --remote-debugging-port=$Port")) {
  if ($running) {
    $running | Stop-Process -Force
    Start-Sleep -Seconds 2
  }
  Start-Process -FilePath 'explorer.exe' -ArgumentList "$target"
  Start-Sleep -Seconds 6

  # Never report success from the fact that a launch command returned: check the port.
  $ok = $false
  foreach ($i in 1..10) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 -UseBasicParsing
      if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { Start-Sleep -Seconds 2 }
  }
  if ($ok) {
    Write-Host "DevTools port $Port is open. Set VKM_EFFORT_APPLY=keys to let the effort gate use it." -ForegroundColor Green
  } else {
    Write-Warning @"
The app restarted but port $Port never answered.
MSIX activation does not always forward command-line arguments; if this build ignores them,
this automation is not available and the effort gate falls back to its notice + persistence.
"@
  }
}
