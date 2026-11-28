# 生成可离线分发的两种产物：
#   1) 静态站 dist/（需要本地 HTTP 服务打开，例如 python -m http.server）
#   2) PDF（双击即可看，最稳的离线方式）
# 用法：在 docs/slides 目录双击或执行 powershell -File export-offline.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host '1/2 构建静态站 → dist/' -ForegroundColor Green
& npx --yes @slidev/cli build slides.md --out dist

Write-Host '2/2 导出 PDF → MindMeter-汇报.pdf（需要 playwright chromium）' -ForegroundColor Green
& npx --yes @slidev/cli export slides.md --output 'MindMeter-汇报.pdf'

Write-Host '完成：dist/ 静态站；MindMeter-汇报.pdf 可直接双击放映。' -ForegroundColor Green
