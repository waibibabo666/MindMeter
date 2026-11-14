# Download the pinned offline ASR model (Vosk, Chinese small) into vendor/.
# Binaries stay out of git; the installer build calls this script.
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$downloads = Join-Path $root 'vendor\downloads'
$modelRoot = Join-Path $root 'vendor\vosk-model-small-cn'
$zip = Join-Path $downloads 'vosk-model-small-cn-0.22.zip'
$url = 'https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip'

New-Item -ItemType Directory -Force -Path $downloads | Out-Null

if ($Force -or -not (Test-Path $zip)) {
  # --ssl-no-revoke: some networks fail the revocation check on this host.
  & curl.exe -L --fail --ssl-no-revoke --retry 3 -o $zip $url
  if ($LASTEXITCODE -ne 0) { throw "download failed: $url" }
}

if ($Force -or -not (Test-Path (Join-Path $modelRoot 'am\final.mdl'))) {
  if (Test-Path $modelRoot) { Remove-Item $modelRoot -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath (Join-Path $root 'vendor') -Force
  $extracted = Join-Path $root 'vendor\vosk-model-small-cn-0.22'
  if (Test-Path $extracted) { Move-Item -Path $extracted -Destination $modelRoot -Force }
}

if (-not (Test-Path (Join-Path $modelRoot 'am\final.mdl'))) {
  throw "model extraction failed: $modelRoot"
}

Write-Host "offline ASR model ready: $modelRoot"
