# Dot-source this file so the variables remain in your current PowerShell:
#   . .\setup.ps1

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$varsPath = Join-Path $root 'server\.dev.vars'

if (-not (Test-Path -LiteralPath $varsPath)) {
  throw "Missing $varsPath. Create it from server/.dev.vars.example first."
}

$secretLine = Get-Content -LiteralPath $varsPath |
  Where-Object { $_ -like 'DESKTOP_HMAC_SECRET=*' } |
  Select-Object -First 1

if (-not $secretLine) {
  throw 'DESKTOP_HMAC_SECRET is missing from server/.dev.vars.'
}

$gatewayAccessKey = $secretLine.Substring($secretLine.IndexOf('=') + 1).Trim()
if (-not $gatewayAccessKey) {
  throw 'DESKTOP_HMAC_SECRET is empty in server/.dev.vars.'
}

$env:VAANI_GATEWAY_URL = 'https://vanni-server.kabootr.com'
$env:VAANI_GATEWAY_ACCESS_KEY = $gatewayAccessKey

Write-Host 'Vaani gateway environment configured for this PowerShell session.'
Write-Host "VAANI_GATEWAY_URL=$env:VAANI_GATEWAY_URL"
