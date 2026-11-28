#!/usr/bin/env node
/**
 * 生成「团队协作」图：Issue → PR → CI → 合并 的工作流 + 最近真实合并记录。
 *
 * 数据来源：gh CLI（只读）。输出 docs/slides/images/collab-board.svg / .png
 * 用法：node docs/slides/tools/make-collab.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const OUT_DIR = path.join(ROOT, 'docs', 'slides', 'images');
const REPO = 'waibibabo666/MindMeter';
const SNAPSHOT = new Date().toISOString().slice(0, 10);

const gh = (args) => JSON.parse(execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8' }));
const prs = gh(['pr', 'list', '-R', REPO, '--state', 'merged', '--limit', '200', '--json', 'number,title,author,mergedAt']);
const issues = gh(['issue', 'list', '-R', REPO, '--state', 'closed', '--limit', '200', '--json', 'number,title,closedAt']);

const authorColors = {
  waibibabo666: '#15803d',
  '1213lz': '#22c55e',
  xlr268: '#4f46e5',
  'SONG-bot418': '#b45309',
};
const authorCounts = {};
for (const pr of prs) {
  const login = pr.author?.login || 'unknown';
  authorCounts[login] = (authorCounts[login] || 0) + 1;
}

const recent = [];
const seenAuthors = new Set();
const sorted = prs.slice().sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt)));
for (const pr of sorted) {
  const login = pr.author?.login || 'unknown';
  if (seenAuthors.has(login)) continue;
  seenAuthors.add(login);
  recent.push(pr);
  if (recent.length === 4) break;
}
for (const pr of sorted) {
  if (recent.length >= 5) break;
  if (recent.includes(pr)) continue;
  recent.push(pr);
}

// ---------- SVG 基础 ----------
const W = 1600;
const H = 806;
const PAD = 72;
const parts = [];
const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const wrap = (text, size) => {
  const tokens = String(text).match(/[A-Za-z0-9._#()/:-]+|[^\s]/g) || [];
  const out = [];
  let line = '';
  for (const token of tokens) {
    if (!line) {
      line = token;
      continue;
    }
    if ((line + token).length > size) {
      out.push(line);
      line = token;
    } else {
      line += token;
    }
  }
  if (line) out.push(line);
  return out;
};
// 卡片标题最多两行，放不下就省略
const cardLines = (text) => {
  const lines = wrap(text, 16);
  if (lines.length <= 2) return lines;
  return [lines[0], `${lines[1].slice(0, 14)}…`];
};

parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Microsoft YaHei','Segoe UI',Arial,sans-serif">`);
parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);

// 标题
parts.push(`<text x="${PAD}" y="84" font-size="38" font-weight="700" fill="#1f2328">团队协作：Issue → PR → CI → 合并</text>`);
parts.push(`<text x="${PAD}" y="122" font-size="17" fill="#6b7280">GitHub 仓库快照 ${SNAPSHOT} · ${REPO} · 数据来自 gh CLI（只读）</text>`);

// KPI
const kpis = [
  { label: 'Issue（全部关闭）', value: String(issues.length), color: '#15803d' },
  { label: 'PR（已合并）', value: String(prs.length), color: '#22c55e' },
  { label: 'CI 检查项', value: '5', color: '#4f46e5' },
  { label: '参与成员', value: String(Object.keys(authorCounts).length), color: '#b45309' },
];
const chipW = 328;
const chipGap = 32;
kpis.forEach((kpi, index) => {
  const x = PAD + index * (chipW + chipGap);
  parts.push(`<rect x="${x}" y="152" width="${chipW}" height="70" rx="14" fill="#f8faf9" stroke="#e2e8e5"/>`);
  parts.push(`<rect x="${x}" y="152" width="6" height="70" rx="3" fill="${kpi.color}"/>`);
  parts.push(`<text x="${x + 24}" y="182" font-size="14.5" fill="#6b7280">${kpi.label}</text>`);
  parts.push(`<text x="${x + 24}" y="210" font-size="26" font-weight="700" fill="#1f2328">${kpi.value}</text>`);
});

// 工作流
const steps = [
  { n: '1', title: 'Issue 立项', detail: `已关闭 ${issues.length} 条` },
  { n: '2', title: '分支开发', detail: 'feature/fix 分支' },
  { n: '3', title: 'PR 评审', detail: `已合并 ${prs.length} 个` },
  { n: '4', title: 'CI 五项', detail: '后端/E2E/文档/格式/密钥' },
  { n: '5', title: '合并 develop', detail: '集成与回归' },
  { n: '6', title: '发布 main', detail: 'release PR' },
];
const boxW = 216;
const boxH = 108;
const boxY = 280;
const boxGap = (W - PAD * 2 - boxW * steps.length) / (steps.length - 1);
steps.forEach((step, index) => {
  const x = PAD + index * (boxW + boxGap);
  parts.push(`<rect x="${x}" y="${boxY}" width="${boxW}" height="${boxH}" rx="16" fill="#ffffff" stroke="#d8e3dc" stroke-width="1.5"/>`);
  parts.push(`<circle cx="${x + 30}" cy="${boxY + 30}" r="15" fill="#f0fdf4" stroke="#bbf7d0"/>`);
  parts.push(`<text x="${x + 30}" y="${boxY + 35}" font-size="15" font-weight="700" fill="#15803d" text-anchor="middle">${step.n}</text>`);
  parts.push(`<text x="${x + 58}" y="${boxY + 35}" font-size="19" font-weight="700" fill="#1f2328">${esc(step.title)}</text>`);
  parts.push(`<text x="${x + 20}" y="${boxY + 74}" font-size="13.5" fill="#6b7280">${esc(step.detail)}</text>`);
  if (index < steps.length - 1) {
    const ax = x + boxW + 6;
    const ay = boxY + boxH / 2;
    parts.push(`<path d="M${ax} ${ay}h${boxGap - 12}" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/>`);
    parts.push(`<path d="M${ax + boxGap - 16} ${ay - 5}l6 5-6 5" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
});

// 最近合并卡片
parts.push(`<text x="${PAD}" y="460" font-size="24" font-weight="700" fill="#1f2328">最近合并的 PR（真实记录）</text>`);
const cardW = 272;
const cardH = 264;
const cardGap = (W - PAD * 2 - cardW * recent.length) / (recent.length - 1);
recent.forEach((pr, index) => {
  const x = PAD + index * (cardW + cardGap);
  const y = 486;
  const color = authorColors[pr.author?.login] || '#64748b';
  parts.push(`<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="16" fill="#ffffff" stroke="#e2e8e5" stroke-width="1.5"/>`);
  parts.push(`<rect x="${x}" y="${y}" width="${cardW}" height="6" rx="3" fill="${color}"/>`);
  parts.push(`<text x="${x + 22}" y="${y + 44}" font-size="20" font-weight="700" fill="#1f2328">#${pr.number}</text>`);
  const lines = cardLines(pr.title);
  lines.forEach((line, i) => {
    parts.push(`<text x="${x + 22}" y="${y + 80 + i * 26}" font-size="16" fill="#334155">${esc(line)}</text>`);
  });
  parts.push(`<circle cx="${x + 30}" cy="${y + cardH - 42}" r="10" fill="${color}" opacity="0.15"/>`);
  parts.push(`<text x="${x + 30}" y="${y + cardH - 37}" font-size="12" font-weight="700" fill="${color}" text-anchor="middle">${esc((pr.author?.login || '?')[0].toUpperCase())}</text>`);
  parts.push(`<text x="${x + 48}" y="${y + cardH - 36}" font-size="14" fill="#6b7280">${esc(pr.author?.login || 'unknown')}</text>`);
  parts.push(`<text x="${x + 22}" y="${y + cardH - 14}" font-size="12.5" fill="#9aa1aa">${esc(String(pr.mergedAt).slice(0, 10))}</text>`);
});

parts.push('</svg>');

fs.mkdirSync(OUT_DIR, { recursive: true });
const svgPath = path.join(OUT_DIR, 'collab-board.svg');
fs.writeFileSync(svgPath, parts.join('\n'), 'utf8');
console.log(`SVG 已生成：${path.relative(ROOT, svgPath)}（PR ${prs.length}，Issue ${issues.length}）`);

// ---------- PNG ----------
try {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await page.setContent(`<style>html,body{margin:0;padding:0;background:#fff}svg{display:block}</style>${fs.readFileSync(svgPath, 'utf8')}`);
  const pngPath = path.join(OUT_DIR, 'collab-board.png');
  await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: W, height: H } });
  await browser.close();
  console.log(`PNG 已生成：${path.relative(ROOT, pngPath)}`);
} catch (error) {
  console.error('PNG 渲染跳过（可用 SVG）：', error.message);
}
