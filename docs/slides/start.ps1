# 双击 start.cmd 即可启动（本机已安装 @slidev/cli，离线可用）
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host 'MindMeter 汇报幻灯片 · 正在启动 http://localhost:3030 ...' -ForegroundColor Green
Write-Host '提示：按 p 进演讲者模式，Ctrl+C 停止。' -ForegroundColor DarkGray

$slidev = Get-Command slidev -ErrorAction SilentlyContinue
if ($slidev) {
  & slidev slides.md --port 3030 --open
} else {
  Write-Host '未找到全局 slidev，改用 npx（首次运行需要联网安装）...' -ForegroundColor Yellow
  & npx --yes @slidev/cli slides.md --port 3030 --open
}
