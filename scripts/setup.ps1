# One-time developer setup for the hosted web app (Windows x64).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt
npm ci

# 便携 PostgreSQL + pgvector：本地一键起库/E2E 需要它
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'fetch_pgsql.ps1')

Write-Host ""
Write-Host "Setup complete. 本地跑起来（库+迁移+服务，浏览器打开 http://127.0.0.1:8100）："
Write-Host "  python scripts/e2e_server.py"
Write-Host "只想要一个一次性测试库："
Write-Host "  python scripts/e2e_server.py --db-only"
Write-Host "检查：npm run check; npm run test:e2e; python scripts/smoke_web_deploy.py http://127.0.0.1:8100"
Write-Host "详见 docs/software/local-development.md（部署见 docs/software/deploy-render.md）"
