# Download the pinned portable PostgreSQL + pgvector into vendor/.
# Binaries stay out of git; the installer build calls this script.
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$downloads = Join-Path $root 'vendor\downloads'
$pgRoot = Join-Path $root 'vendor\pgsql'
$pgZip = Join-Path $downloads 'postgresql-17.12-1-windows-x64-binaries.zip'
$vecZip = Join-Path $downloads 'vector.v0.8.6-pg17.zip'
$pgUrl = 'https://get.enterprisedb.com/postgresql/postgresql-17.12-1-windows-x64-binaries.zip'
$vecUrl = 'https://github.com/andreiramani/pgvector_pgsql_windows/releases/download/0.8.6_17/vector.v0.8.6-pg17.zip'
$pgSha = 'a2cd8a774389347b70be7748ac4a37ef43cb6ee539c5fc3e85ae264b15e4a04c'
$vecSha = '420388e9e9f05d92f06d6967ce8772483629b27a66ca9255925fa0fdd445438e'

New-Item -ItemType Directory -Force -Path $downloads, $pgRoot | Out-Null

function Get-PinnedFile($url, $path, $sha) {
  if ((Test-Path $path) -and -not $Force) {
    $actual = (Get-FileHash $path -Algorithm SHA256).Hash.ToLower()
    if ($sha -ne 'a2cd8a774389347b70be7748ac4a37ef43cb6ee539c5fc3e85ae264b15e4a04c' -and $actual -ne $sha) {
      throw "SHA256 mismatch for $path"
    }
    return
  }
  & curl.exe -L --fail --retry 3 -o $path $url
  if ($LASTEXITCODE -ne 0) { throw "download failed: $url" }
  if ($sha -ne 'a2cd8a774389347b70be7748ac4a37ef43cb6ee539c5fc3e85ae264b15e4a04c') {
    $actual = (Get-FileHash $path -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $sha) { throw "SHA256 mismatch for $path : $actual" }
  }
}

Get-PinnedFile $pgUrl $pgZip $pgSha
Get-PinnedFile $vecUrl $vecZip $vecSha

if ($Force -or -not (Test-Path (Join-Path $pgRoot 'bin\initdb.exe'))) {
  $extract = Join-Path $downloads 'pgsql-extract'
  Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $extract | Out-Null
  & tar.exe -xf $pgZip -C $extract
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL zip extraction failed' }
  $nested = Join-Path $extract 'pgsql'
  $source = if (Test-Path (Join-Path $nested 'bin')) { $nested } else { $extract }
  Copy-Item (Join-Path $source '*') $pgRoot -Recurse -Force
}

$vecExtract = Join-Path $downloads 'pgvector-extract'
Remove-Item $vecExtract -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $vecExtract | Out-Null
& tar.exe -xf $vecZip -C $vecExtract
if ($LASTEXITCODE -ne 0) { throw 'pgvector zip extraction failed' }
Copy-Item (Join-Path $vecExtract 'lib\vector.dll') (Join-Path $pgRoot 'lib\') -Force
Copy-Item (Join-Path $vecExtract 'share\extension\*') (Join-Path $pgRoot 'share\extension\') -Force
$includeTarget = Join-Path $pgRoot 'include\server\extension\vector'
New-Item -ItemType Directory -Force -Path $includeTarget | Out-Null
Copy-Item (Join-Path $vecExtract 'include\server\extension\vector\*') $includeTarget -Force -ErrorAction SilentlyContinue

'17.12-1 + pgvector 0.8.6' | Set-Content (Join-Path $pgRoot 'VERSION') -Encoding ASCII
Write-Host "portable PostgreSQL ready: $pgRoot"

