param(
    [int]$Port = 3001
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$url = "http://127.0.0.1:$Port/health"
$resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5

Write-Host "Health URL: $url"
Write-Host "StatusCode: $($resp.StatusCode)"

if ($resp.StatusCode -ne 200) {
    throw "MCP health check fallo."
}
