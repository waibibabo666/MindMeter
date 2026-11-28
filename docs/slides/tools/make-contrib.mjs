#!/usr/bin/env node
/**
 * 生成团队提交分布图（SVG + PNG），用于汇报幻灯片。
 *
 * 数据来源：git log 的提交邮箱（按邮箱归并同一成员的不同 git 用户名）。
 * 输出：docs/slides/images/team-contributions.svg / .png
 *
 * 用法：node docs/slides/tools/make-contrib.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const OUT_DIR = path.join(ROOT, 'docs', 'slides', 'images');

// 邮箱 → 展示名（同一成员可能配置过多个 git 用户名）
const PEOPLE = [
  { email: '18723182303@163.com', name: 'waibibabo666', color: '#15803d' },
  { email: '2579952270@qq.com', name: '1213lz', color: '#22c55e' },
  { email: '2680218282@qq.com', name: 'XLR268', color: '#4f46e5' },
  { email: '2707894699@qq.com', name: 'SONG-bot418', color: '#b45309' },
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function mondayOf(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  const day = (date.getUTCDay() + 6) % 7; // 周一 = 0
  return new Date(date.getTime() - day * 24 * 60 * 60 * 1000);
}

// 用 execFileSync 避免 Windows cmd 把 format 里的 | 当成管道
const log = execFileSync('git', ['log', '--pretty=format:%ae|%ad', '--date=short'], {
  cwd: ROOT,
  encoding: 'utf8',
});
const rows = log
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [email, date] = line.split('|');
    return { email, date };
  });

const memberByEmail = new Map(PEOPLE.map((person) => [person.email, person]));
const allDates = rows.map((row) => row.date).sort();
const firstDate = allDates[0];
const lastDate = allDates.at(-1);
const first = mondayOf(firstDate);
const last = mondayOf(lastDate);

const weeks = [];
for (let cursor = first.getTime(); cursor <= last.getTime(); cursor += WEEK_MS) {
  weeks.push({
    start: new Date(cursor),
    counts: Object.fromEntries(PEOPLE.map((person) => [person.email, 0])),
  });
}
const weekIndex = new Map(weeks.map((week, index) => [week.start.getTime(), index]));

for (const row of rows) {
  const member = memberByEmail.get(row.email);
  if (!member) continue;
  const index = weekIndex.get(mondayOf(row.date).getTime());
  if (index === undefined) continue;
  weeks[index].counts[member.email] += 1;
}

const totals = Object.fromEntries(
  PEOPLE.map((person) => [
    person.email,
    weeks.reduce((sum, week) => sum + week.counts[person.email], 0),
  ]),
);
const grandTotal = Object.values(totals).reduce((sum, n) => sum + n, 0);
const maxWeek = Math.max(...weeks.map((week) => PEOPLE.reduce((sum, p) => sum + week.counts[p.email], 0)));

// ---------- 画布 ----------
const W = 1600;
const H = 720;
const PAD = { left: 96, right: 64, top: 152, bottom: 124 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;
const maxY = Math.max(5, Math.ceil(maxWeek / 5) * 5);
const slot = plotW / weeks.length;
const barW = Math.min(96, slot * 0.52);

const fmtDate = (date) => `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
const fmtFull = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

const parts = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Microsoft YaHei','Segoe UI',Arial,sans-serif">`);
parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);

// 标题
parts.push(`<text x="${PAD.left}" y="64" font-size="36" font-weight="700" fill="#1f2328">团队提交分布</text>`);
parts.push(`<text x="${PAD.left}" y="102" font-size="17" fill="#6b7280">${firstDate} – ${lastDate} · 共 ${grandTotal} 次提交 · 按提交邮箱归并</text>`);

// 图例
let legendX = PAD.left;
for (const person of PEOPLE) {
  parts.push(`<circle cx="${legendX + 7}" cy="130" r="7" fill="${person.color}"/>`);
  parts.push(`<text x="${legendX + 22}" y="136" font-size="16" fill="#1f2328">${person.name} · ${totals[person.email]}</text>`);
  legendX += 250;
}

// 网格与 y 轴
const ticks = 5;
for (let i = 0; i <= ticks; i += 1) {
  const value = (maxY / ticks) * i;
  const y = PAD.top + plotH - (value / maxY) * plotH;
  parts.push(`<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="${i === 0 ? '#cbd5e1' : '#eef2f6'}" stroke-width="${i === 0 ? 1.5 : 1}"/>`);
  if (i % 1 === 0) {
    parts.push(`<text x="${PAD.left - 16}" y="${y + 6}" font-size="15" fill="#9aa1aa" text-anchor="end">${Math.round(value)}</text>`);
  }
}

// 柱状（堆叠）
weeks.forEach((week, index) => {
  const x = PAD.left + index * slot + (slot - barW) / 2;
  let y = PAD.top + plotH;
  for (const person of PEOPLE) {
    const count = week.counts[person.email];
    if (!count) continue;
    const h = (count / maxY) * plotH;
    y -= h;
    parts.push(`<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${person.color}" rx="3"/>`);
  }
  const total = PEOPLE.reduce((sum, p) => sum + week.counts[p.email], 0);
  if (total > 0) {
    parts.push(`<text x="${x + barW / 2}" y="${y - 12}" font-size="16" font-weight="650" fill="#334155" text-anchor="middle">${total}</text>`);
  }
  parts.push(`<text x="${x + barW / 2}" y="${PAD.top + plotH + 34}" font-size="16" fill="#475569" text-anchor="middle">${fmtDate(week.start)}</text>`);
});

// 底部说明（按要求不放在图里，来源写在幻灯片讲稿中）
parts.push('</svg>');

fs.mkdirSync(OUT_DIR, { recursive: true });
const svgPath = path.join(OUT_DIR, 'team-contributions.svg');
fs.writeFileSync(svgPath, parts.join('\n'), 'utf8');
console.log(`SVG 已生成：${path.relative(ROOT, svgPath)}（${weeks.length} 周，${grandTotal} 次提交）`);

// ---------- PNG ----------
try {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const svg = fs.readFileSync(svgPath, 'utf8');
  await page.setContent(`<style>html,body{margin:0;padding:0;background:#fff}svg{display:block}</style>${svg}`);
  const pngPath = path.join(OUT_DIR, 'team-contributions.png');
  await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: W, height: H } });
  await browser.close();
  console.log(`PNG 已生成：${path.relative(ROOT, pngPath)}`);
} catch (error) {
  console.error('PNG 渲染跳过（可用 SVG）：', error.message);
}
