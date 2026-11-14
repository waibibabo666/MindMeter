# One-time developer setup for Windows x64.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'fetch_pgsql.ps1')

Write-Host ""
Write-Host "Setup complete."
Write-Host "Start:  .\MindMeter.vbs   (no console)  or  .\MindMeter.cmd"
Write-Host "Checks: npm run check; npm run test:e2e"
Write-Host "Backend tests need MM_TEST_DATABASE_URL (see docs/software/local-runtime.md)."
