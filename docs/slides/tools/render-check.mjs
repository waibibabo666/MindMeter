#!/usr/bin/env node
/**
 * 渲染检查：逐页截图 + 内容溢出检测。
 *
 * 前置：先起 Slidev 开发服务：
 *   slidev slides.md --port 3030
 * 用法：
 *   node slidev/tools/render-check.mjs [--count 25] [--out test-results/slides]
 * 退出码：任一页出现 >8px 的溢出时为 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const count = Number(getArg('--count', '25'));
const outDir = path.resolve(getArg('--out', 'test-results/slides'));
const base = getArg('--base', 'http://127.0.0.1:3030');

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  colorScheme: 'dark', // 验证 colorSchema: light 是否压过系统深色
});
const page = await context.newPage();

const rows = [];
for (let n = 1; n <= count; n += 1) {
  await page.goto(`${base}/${n}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const probe = await page.evaluate(() => {
    const active = document.querySelector('.slidev-page-active');
    if (!active) return { error: 'no-active-page' };
    const box = active.getBoundingClientRect();
    let maxBottom = box.top;
    let maxRight = box.left;
    for (const node of active.querySelectorAll('*')) {
      const r = node.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        maxBottom = Math.max(maxBottom, r.bottom);
        maxRight = Math.max(maxRight, r.right);
      }
    }
    return {
      htmlClass: document.documentElement.className,
      overflowY: Math.round(maxBottom - box.bottom),
      overflowX: Math.round(maxRight - box.right),
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
  });
  if (probe.error) {
    rows.push({ n, error: probe.error });
    continue;
  }
  await page.screenshot({ path: path.join(outDir, `slide-${String(n).padStart(2, '0')}.png`) });
  rows.push({ n, ...probe });
}

await browser.close();

let bad = 0;
console.log('| 页 | 画面 | 高 | overflowY | overflowX |');
console.log('| --- | --- | --- | --- | --- |');
for (const r of rows) {
  if (r.error) {
    bad += 1;
    console.log(`| ${r.n} | ${r.error} | - | - | - |`);
    continue;
  }
  const flag = r.overflowY > 8 || r.overflowX > 8 ? ' ⚠️' : '';
  if (flag) bad += 1;
  console.log(`| ${r.n} | ${r.width}×${r.height} | html=${r.htmlClass} | ${r.overflowY} | ${r.overflowX}${flag} |`);
}

console.log(`\n截图目录：${path.relative(process.cwd(), outDir)}`);
console.log(bad === 0 ? '✅ 无溢出' : `❌ ${bad} 页存在溢出或渲染异常`);
process.exit(bad === 0 ? 0 : 1);
