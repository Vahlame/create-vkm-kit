# Resets local agent memory: archives old vault, fresh scaffold from kit examples, Cursor MCP (basic-memory only), removes Cursor* scheduled tasks.
# Run from repo: powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\windows-reset-agent-memory.ps1
$ErrorActionPreference = "Stop"
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$homeDir = $env:USERPROFILE
$docs = Join-Path $homeDir "Documents"
$vault = Join-Path $docs "cursor-memory-vault"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$examples = Join-Path $repo "examples"
if (-not (Test-Path $examples)) { throw "examples not found: $examples" }

$mcp = Join-Path $homeDir ".cursor\mcp.json"
if (Test-Path $mcp) {
  Copy-Item $mcp "$mcp.pre-reset-$ts.bak" -Force
}

# Archive existing vault (recoverable). Move-Item can fail if .git is locked — then mirror + delete.
if (Test-Path $vault) {
  $arch = Join-Path $docs "cursor-memory-vault__ARCHIVED_$ts"
  Write-Host "Archiving vault -> $arch"
  try {
    Move-Item -LiteralPath $vault -Destination $arch -ErrorAction Stop
  } catch {
    Write-Host "Move-Item failed ($($_.Exception.Message)); using robocopy + Remove-Item"
    New-Item -ItemType Directory -Path $arch -Force | Out-Null
    robocopy $vault $arch /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NC /NS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy archive failed: $LASTEXITCODE" }
    Remove-Item -LiteralPath $vault -Recurse -Force
  }
}

Write-Host "Seeding vault from examples/"
New-Item -ItemType Directory -Path $vault -Force | Out-Null
robocopy $examples $vault /E /NFL /NDL /NJH /NJS /NC /NS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }

New-Item -ItemType Directory -Path (Join-Path $vault ".obsidian") -Force | Out-Null
$exApp = Join-Path $examples ".obsidian\app.json"
if (Test-Path $exApp) {
  Copy-Item $exApp (Join-Path $vault ".obsidian\app.json") -Force
} else {
  Set-Content -Path (Join-Path $vault ".obsidian\app.json") -Value "{}" -Encoding utf8
}

$exAppMd = Join-Path $vault "PROJECTS\example-app.md"
if (Test-Path $exAppMd) { Remove-Item $exAppMd -Force }

Push-Location $repo
try {
  & node (Join-Path $repo "packages\create-obsidian-memory\dist\index.js") @(
    "--non-interactive",
    "--vault", $vault
  )
  if ($LASTEXITCODE -ne 0) { throw "create-obsidian-memory exited $LASTEXITCODE" }
} finally {
  Pop-Location
}

# Clean MCP: only basic-memory (stdio). Re-add hybrid from config/mcp/obsidian-memory-hybrid.json if needed.
$only = [ordered]@{
  mcpServers = [ordered]@{
    "basic-memory" = [ordered]@{
      command = "uvx"
      args      = @("basic-memory", "mcp")
      env       = @{ BASIC_MEMORY_HOME = $vault }
    }
  }
}
$mcpDir = Split-Path $mcp -Parent
New-Item -ItemType Directory -Path $mcpDir -Force | Out-Null
$only | ConvertTo-Json -Depth 10 | Set-Content -Path $mcp -Encoding utf8

$taskNames = @(
  "CursorBasicMemoryHttpMcp",
  "CursorObsidianMcpWatchdog",
  "CursorMemoryAutoSync",
  "CursorMemoryVaultSync",
  "CursorObsidianMemorydWatch"
)
foreach ($tn in $taskNames) {
  cmd /c "schtasks /Delete /TN `"$tn`" /F 1>nul 2>nul"
  if ($LASTEXITCODE -eq 0) { Write-Host "Removed task: $tn" } else { Write-Host "(not present) $tn" }
}

Write-Host "Done. Reload Cursor (Developer: Reload Window)."
Write-Host "Archived vault (if any): cursor-memory-vault__ARCHIVED_$ts"
Write-Host "MCP backup: $mcp.pre-reset-$ts.bak"
