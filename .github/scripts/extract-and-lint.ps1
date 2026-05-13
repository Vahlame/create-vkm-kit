<#
.SYNOPSIS
    Extracts embedded PowerShell code blocks from the archived v1 prompt and
    runs PSScriptAnalyzer over them.

.DESCRIPTION
    The prompt embeds multiple PowerShell scripts inside fenced code blocks. They cannot
    be linted in place, so this script parses the markdown, writes each block to
    a temp file with the heading-derived name when possible, and invokes the
    analyzer. Exits non-zero if any error or warning is found.

    Used by CI (.github/workflows/lint.yml) and by contributors locally.
#>

[CmdletBinding()]
param(
    [string]$PromptPath = "docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md",
    [string]$OutDir = (Join-Path ([IO.Path]::GetTempPath()) "prompt-ps-extract")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $PromptPath)) {
    throw "Prompt not found at $PromptPath"
}

if (Test-Path -LiteralPath $OutDir) {
    Remove-Item -Recurse -Force $OutDir
}
New-Item -ItemType Directory -Path $OutDir | Out-Null

$lines = Get-Content -LiteralPath $PromptPath
$inBlock = $false
$currentLang = $null
$buffer = New-Object System.Text.StringBuilder
$lastHeading = "block"
$index = 0
$extracted = @()

foreach ($line in $lines) {
    if ($line -match '^###\s+\d+\.\d+\s+`([^`]+)`') {
        $lastHeading = $matches[1] -replace '[^A-Za-z0-9._-]', '_'
        continue
    }
    if ($line -match '^```(\w+)?\s*$') {
        if (-not $inBlock) {
            $inBlock = $true
            $currentLang = $matches[1]
            $buffer.Clear() | Out-Null
            continue
        }
        if ($currentLang -eq 'powershell') {
            $index++
            $name = "$([string]::Format('{0:D2}', $index))_$lastHeading"
            if ($name -notmatch '\.ps1$') { $name += '.ps1' }
            $path = Join-Path $OutDir $name
            Set-Content -LiteralPath $path -Value $buffer.ToString() -Encoding UTF8
            $extracted += $path
        }
        $inBlock = $false
        $currentLang = $null
        continue
    }
    if ($inBlock) {
        $buffer.AppendLine($line) | Out-Null
    }
}

if ($extracted.Count -eq 0) {
    throw "No PowerShell blocks were extracted from $PromptPath"
}

Write-Host "Extracted $($extracted.Count) PowerShell blocks to $OutDir"

if (-not (Get-Module -ListAvailable -Name PSScriptAnalyzer)) {
    Write-Host "Installing PSScriptAnalyzer..."
    if (-not (Get-PackageProvider -Name NuGet -ListAvailable -ErrorAction SilentlyContinue)) {
        Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser | Out-Null
    }
    if ((Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue).InstallationPolicy -ne 'Trusted') {
        Set-PSRepository -Name PSGallery -InstallationPolicy Trusted
    }
    Install-Module -Name PSScriptAnalyzer -Scope CurrentUser -Force -ErrorAction Stop
}
Import-Module PSScriptAnalyzer

$severities = @('Error', 'Warning')
$excludeRules = @(
    'PSAvoidUsingWriteHost',
    'PSUseShouldProcessForStateChangingFunctions',
    'PSUseSingularNouns'
)

$findings = @()
foreach ($file in $extracted) {
    $results = Invoke-ScriptAnalyzer -Path $file -Severity $severities -ExcludeRule $excludeRules
    if ($results) {
        foreach ($r in $results) {
            $findings += [pscustomobject]@{
                File     = Split-Path -Leaf $file
                Line     = $r.Line
                Severity = $r.Severity
                Rule     = $r.RuleName
                Message  = $r.Message
            }
        }
    }
}

if ($findings.Count -eq 0) {
    Write-Host "PSScriptAnalyzer: 0 findings."
    exit 0
}

Write-Host ""
Write-Host "PSScriptAnalyzer findings:"
$findings | Format-Table -AutoSize | Out-String | Write-Host
exit 1
