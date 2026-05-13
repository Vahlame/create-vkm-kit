# Live monitor: 1s steps; on each spawn logs parent PID, parent name, and Win32_Process.CommandLine (truncated).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\monitor-console-live.ps1
# Optional: -Iterations 120 -IntervalSeconds 1 -CommandLineMax 400
param(
  [int]$IntervalSeconds = 1,
  [int]$Iterations = 75,
  [int]$CommandLineMax = 280
)
$ErrorActionPreference = 'SilentlyContinue'
$prev = @{}
Write-Host "Monitor ${Iterations}s @ ${IntervalSeconds}s. Consola + padre + CommandLine (max $CommandLineMax chars)."

function Get-ProcName([int]$ProcessId) {
  try { (Get-Process -Id $ProcessId -ErrorAction Stop).ProcessName } catch { return '?' }
}

function Get-ProcessMeta([int]$ProcessId) {
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    $cmd = $p.CommandLine
    if ($null -ne $cmd) {
      $cmd = $cmd -replace "`r?`n", ' '
      if ($cmd.Length -gt $CommandLineMax) {
        $cmd = $cmd.Substring(0, $CommandLineMax) + '...'
      }
    }
    return @{
      ParentProcessId = [int]$p.ParentProcessId
      CommandLine     = $cmd
    }
  } catch {
    return @{ ParentProcessId = $null; CommandLine = $null }
  }
}
for ($i = 0; $i -lt $Iterations; $i++) {
  $current = Get-Process | Where-Object {
    $n = $_.ProcessName
    ($n -eq 'cmd') -or ($n -eq 'conhost') -or ($n -eq 'wscript') -or ($n -eq 'cscript') -or
    ($n -like 'powershell*') -or ($n -like 'pwsh*')
  }
  $map = @{}
  foreach ($p in $current) { $map[$p.Id] = $p.ProcessName }
  $currIds = @($map.Keys)
  if ($i -gt 0) {
    $started = @($currIds | Where-Object { -not $prev.ContainsKey($_) })
    $ended = @($prev.Keys | Where-Object { $currIds -notcontains $_ })
    if ($started.Count -gt 0 -or $ended.Count -gt 0) {
      $ts = Get-Date -Format 'HH:mm:ss.fff'
      Write-Host "[$ts] +$($started.Count) -$($ended.Count)"
      foreach ($id in $started) {
        $nm = $map[$id]
        $meta = Get-ProcessMeta $id
        $pp = $meta.ParentProcessId
        $pn = if ($null -ne $pp) { Get-ProcName $pp } else { '?' }
        $cmd = if ($null -ne $meta.CommandLine -and $meta.CommandLine -ne '') { $meta.CommandLine } else { '(n/a)' }
        Write-Host "  + $nm pid=$id parent=$pp ($pn)"
        Write-Host "      cmd: $cmd"
      }
      foreach ($id in $ended) {
        Write-Host "  - $($prev[$id]) pid=$id"
      }
    }
  } else {
    $ts = Get-Date -Format 'HH:mm:ss.fff'
    $c = @($current | Group-Object ProcessName | Sort-Object Count -Descending | ForEach-Object { "$($_.Name)=$($_.Count)" })
    Write-Host "[$ts] baseline: $($c -join ' | ')"
  }
  $prev = @{}
  foreach ($k in $map.Keys) { $prev[$k] = $map[$k] }
  Start-Sleep -Seconds $IntervalSeconds
}
Write-Host '--- fin ---'
