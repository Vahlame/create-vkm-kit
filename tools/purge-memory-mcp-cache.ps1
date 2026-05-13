$ErrorActionPreference = "SilentlyContinue"
Remove-Item -LiteralPath "$env:LOCALAPPDATA\cursor-memory" -Recurse -Force
Get-ChildItem -Path "$env:USERPROFILE\.cursor\projects" -Recurse -Directory | Where-Object {
  $_.Name -eq "user-basic-memory" -or $_.Name -eq "user-obsidian-memory-hybrid"
} | ForEach-Object {
  Remove-Item -LiteralPath $_.FullName -Recurse -Force
  Write-Host "Removed:" $_.FullName
}
Write-Host "purge-mcp-cache done"
