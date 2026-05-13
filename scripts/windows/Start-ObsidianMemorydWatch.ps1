# Start obsidian-memoryd watch (debounced git sync on vault file changes).
# Requires: obsidian-memoryd.exe under %LOCALAPPDATA%\cursor-memory\bin (build with go).

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$vault = Join-Path $HOME "Documents\cursor-memory-vault"
$env:BASIC_MEMORY_HOME = (Resolve-Path -LiteralPath $vault).Path

$exe = Join-Path $env:LOCALAPPDATA "cursor-memory\bin\obsidian-memoryd.exe"
if (-not (Test-Path -LiteralPath $exe)) {
    throw "Missing $exe. Build: go build -o `"$exe`" ./cmd/obsidian-memoryd (from cursor-obsidian-memory-guide repo)."
}

Write-Host "obsidian-memoryd watch vault=$($env:BASIC_MEMORY_HOME)"
& $exe @("watch")
