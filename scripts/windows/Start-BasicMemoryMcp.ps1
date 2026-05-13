# Long-running basic-memory MCP (Streamable HTTP) for Cursor.
# In Cursor `mcp.json` use: "url": "http://127.0.0.1:8000/mcp"
# Idempotent: if port 8000 is already listening, exits 0.

param(
    [string]$VaultPath = "$HOME\Documents\cursor-memory-vault",
    [string]$ListenHost = "127.0.0.1",
    [int]$Port = 8000,
    [string]$PathPrefix = "/mcp"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$env:BASIC_MEMORY_HOME = (Resolve-Path -LiteralPath $VaultPath).Path
$localBin = Join-Path $HOME ".local\bin"
if (Test-Path -LiteralPath $localBin) {
    $env:Path = "$localBin;$env:Path"
}

$uvx = Join-Path $localBin "uvx.exe"
if (-not (Test-Path -LiteralPath $uvx)) {
    throw "uvx not found at $uvx. Install uv: https://docs.astral.sh/uv/getting-started/installation/"
}

$listen = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listen) {
    Write-Host "MCP already listening on port $Port; skipping start."
    exit 0
}

Write-Host "Starting basic-memory MCP at http://${ListenHost}:${Port}${PathPrefix} vault=$($env:BASIC_MEMORY_HOME)"
& $uvx @(
    "basic-memory", "mcp",
    "--transport", "streamable-http",
    "--host", $ListenHost,
    "--port", "$Port",
    "--path", $PathPrefix
)
