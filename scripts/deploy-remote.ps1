# 本地一键部署：打包当前提交 -> 上传 -> 迁移 -> 硬重启 -> 部署前端 -> 健康检查
#
# 为什么不让服务器 git pull：阿里云到 GitHub 的 TLS 经常断（HTTP2 framing error），
# 每次重试 30–60 秒；本地打包上传约 2 秒。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/deploy-remote.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/deploy-remote.ps1 -Ref HEAD -HostName 47.104.99.197

param(
  [string]$HostName = "47.104.99.197",
  [string]$UserName = "root",
  [string]$Ref = "HEAD",
  [string]$KeyPath = "$env:USERPROFILE\.ssh\mindmeter_ecs"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$tar = Join-Path $env:TEMP "mm_code.tar.gz"

function Invoke-RemoteScript {
  param([string]$Body)
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($Body -replace "`r`n", "`n")))
  ssh -i $KeyPath -o ConnectTimeout=20 "${UserName}@${HostName}" "echo $b64 | base64 -d | bash"
}

Write-Host "[1/5] 打包 $Ref" -ForegroundColor Cyan
Push-Location $repo
try { git archive --format=tar.gz -o $tar $Ref } finally { Pop-Location }
Write-Host ("       {0:N2} MB" -f ((Get-Item $tar).Length / 1MB))

Write-Host "[2/5] 上传" -ForegroundColor Cyan
$t0 = Get-Date
scp -q -i $KeyPath -o ConnectTimeout=20 $tar "${UserName}@${HostName}:/tmp/mm_code.tar.gz"
Write-Host ("       {0:N1} 秒" -f ((Get-Date) - $t0).TotalSeconds)
Remove-Item $tar -Force -ErrorAction SilentlyContinue

Write-Host "[3/5] 解包 + 迁移 + 硬重启" -ForegroundColor Cyan
$deploy = @(
  'set -e',
  'cd /opt/mindmeter/src',
  'tar xzf /tmp/mm_code.tar.gz',
  'rm -f /tmp/mm_code.tar.gz',
  'set -a; . /etc/mindmeter/migrate.env; set +a',
  '.venv/bin/python -m alembic -c code/backend/alembic.ini upgrade head 2>&1 | tail -2',
  'systemctl stop mindmeter || true',
  'pkill -f "uvicorn app.main:app" || true',
  'for i in $(seq 1 15); do ss -ltn 2>/dev/null | grep -q ":8000" || break; sleep 1; done',
  'systemctl start mindmeter'
) -join "`n"
Invoke-RemoteScript $deploy

Write-Host "[4/5] 部署前端" -ForegroundColor Cyan
Invoke-RemoteScript '/opt/mindmeter/deploy-web.sh'

Write-Host "[5/5] 健康检查" -ForegroundColor Cyan
$probe = @(
  'T=$(cat /etc/mindmeter/api-token)',
  'curl -s -m 8 -H "X-MM-Token: $T" http://127.0.0.1:8000/api/v1/health'
) -join "`n"

$health = ""
for ($i = 1; $i -le 30; $i++) {
  $health = Invoke-RemoteScript $probe
  if ($health -match '"status":"ok"') { break }
  Start-Sleep -Milliseconds 1500
}
Write-Host $health

if ($health -match '"status":"ok"') {
  Write-Host "部署成功: http://$HostName/" -ForegroundColor Green
} else {
  Write-Host "健康检查未通过：ssh $UserName@$HostName 'journalctl -u mindmeter -n 50'" -ForegroundColor Red
  exit 1
}
