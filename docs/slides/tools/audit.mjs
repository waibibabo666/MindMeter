#!/usr/bin/env node
/**
 * 幻灯片静态审计：结构 / 编号 / 信息密度 / 截图占位 / 来源与时长。
 *
 * 用法：
 *   node slidev/tools/audit.mjs
 * 退出码：评分 < 85 或存在硬伤（缺章节、缺必填截图占位）时为 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'slides.md');
const raw = fs.readFileSync(FILE, 'utf8');

/** 参考文档要求的章节（顺序即出现顺序）。 */
const REQUIRED = [
  '1.1.1', '1.1.2', '1.1.3', '1.1.4', '1.1.5', '1.1.6',
  '1.2', '1.2.1', '1.2.2', '1.2.3',
  '2',
  '3.1', '3.2', '3.3', '3.4',
  '3.5.1', '3.5.2', '3.5.3', '3.5.4', '3.5.5', '3.5.6',
  '3.6.1', '3.6.2', '3.7.1', '3.7.2',
];

const MAX_CJK = 300;
const MAX_TABLE_ROWS = 6;

function isSep(line) {
  return /^---\s*$/.test(line);
}

/** 按 Slidev 语法切页：headmatter、每页可选 frontmatter、正文。 */
function splitSlides(text) {
  const lines = text.split('\n');
  let i = 0;
  const skipBlank = () => {
    while (i < lines.length && lines[i].trim() === '') i += 1;
  };
  skipBlank();
  if (i < lines.length && isSep(lines[i])) {
    i += 1;
    while (i < lines.length && !isSep(lines[i])) i += 1;
    i += 1;
  }
  const slides = [];
  while (i < lines.length) {
    skipBlank();
    if (i >= lines.length) break;
    if (isSep(lines[i])) {
      i += 1;
      // 分隔符之后若是「纯 YAML 行到下一个 ---」，那是本页 frontmatter，跳过。
      let j = i;
      let yamlOnly = true;
      while (j < lines.length && !isSep(lines[j])) {
        const line = lines[j].trim();
        if (line && !/^[A-Za-z][\w-]*:\s/.test(line)) yamlOnly = false;
        j += 1;
      }
      if (j < lines.length && yamlOnly) {
        i = j + 1;
      }
    }
    const start = i;
    while (i < lines.length && !isSep(lines[i])) i += 1;
    const body = lines.slice(start, i).join('\n');
    // 不在这里跳过分隔符：下一轮从分隔符开始，才能识别下一张的 frontmatter
    if (body.trim()) slides.push(body);
  }
  return slides;
}

const slides = splitSlides(raw);

function headings(body) {
  return body
    .split('\n')
    .filter((line) => /^#{1,3}\s/.test(line))
    .map((line) => line.replace(/^#{1,3}\s+/, '').trim());
}

function stripForCount(body) {
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*#{1,6}\s*/gm, '');
}

function cjkCount(text) {
  const m = text.match(/[\u4e00-\u9fff]/g);
  return m ? m.length : 0;
}

function tableRows(body) {
  const rows = body
    .split('\n')
    .filter((line) => /^\|/.test(line) && !/^\|\s*-{2,}/.test(line));
  // 减去表头行
  return Math.max(0, rows.length - (rows.length ? 1 : 0));
}

const stats = slides.map((body, index) => {
  const hs = headings(body);
  return {
    index: index + 1,
    title: hs[0] || '（无标题）',
    heads: hs,
    cjk: cjkCount(stripForCount(body)),
    tableRows: tableRows(body),
    shots: (body.match(/class="shot"/g) || []).length,
  };
});

// ---- A. 结构完整 ----
const allHeads = stats.flatMap((s) => s.heads);
const found = REQUIRED.filter((token) => {
  const escaped = token.replace(/\./g, '\\.');
  const re = new RegExp(`(?:^|[\\s/、，])${escaped}(?![.\\d])`);
  return allHeads.some((h) => re.test(h));
});
const missing = REQUIRED.filter((t) => !found.includes(t));

// ---- B. 编号一致 ----
function compareDotted(a, b) {
  if (!b) return 1;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

const orderIssues = [];
let last = '';
for (const head of allHeads) {
  const m = head.match(/^(\d+(?:\.\d+)*)/);
  if (!m) continue;
  if (/（续）|\(续\)/.test(head)) continue;
  if (compareDotted(m[1], last) < 0) {
    orderIssues.push(`编号回退：${last} → ${m[1]}`);
  }
  last = m[1];
}

// ---- C. 信息密度 ----
const dense = stats.filter((s) => s.cjk > MAX_CJK || s.tableRows > MAX_TABLE_ROWS);

// ---- D. 截图占位 ----
const requiredShots = [
  { key: 'pulse', label: '3.3 提交历史（Pulse/Contributors）' },
  { key: 'quality-scan', label: '3.6.2 质量扫描结果' },
  { key: 'code-stats', label: '3.7 代码统计' },
];
const missingShots = requiredShots.filter((s) => !raw.includes(s.key));

// ---- E. 来源与口径 ----
const sourceHits = (raw.match(/依据|来源/g) || []).length;
const boundaryHits = (raw.match(/非诊断|不提供诊断|不做诊断/g) || []).length;

// ---- F. 时长备注 ----
const noteCount = (raw.match(/<!--/g) || []).length;

// ---- 评分 ----
const scoreA = Math.round((30 * found.length) / REQUIRED.length);
const scoreB = orderIssues.length === 0 ? 15 : Math.max(0, 15 - orderIssues.length * 5);
const scoreC = Math.max(0, 20 - dense.length * 3);
const scoreD = Math.round((20 * (requiredShots.length - missingShots.length)) / requiredShots.length);
const scoreE = sourceHits >= 3 && boundaryHits >= 1 ? 10 : 5;
const scoreF = noteCount >= 15 ? 5 : 0;
const total = scoreA + scoreB + scoreC + scoreD + scoreE + scoreF;

console.log(`# 幻灯片审计：${path.relative(process.cwd(), FILE)}`);
console.log(`共 ${stats.length} 页\n`);
console.log('| 页 | 标题 | 汉字 | 表行 | 占位 |');
console.log('| --- | --- | --- | --- | --- |');
for (const s of stats) {
  const flag = s.cjk > MAX_CJK || s.tableRows > MAX_TABLE_ROWS ? ' ⚠️' : '';
  console.log(`| ${s.index} | ${s.title}${flag} | ${s.cjk} | ${s.tableRows} | ${s.shots} |`);
}

console.log('\n## 检查');
console.log(
  `A 结构完整：${found.length}/${REQUIRED.length}` + (missing.length ? `，缺 ${missing.join('、')}` : ''),
);
console.log(`B 编号一致：${orderIssues.length ? orderIssues.join('；') : '无回退/无跳号'}`);
console.log(
  `C 信息密度：${dense.length ? dense.map((s) => `P${s.index}(${s.cjk}字/${s.tableRows}行)`).join('、') : `全部 ≤ ${MAX_CJK} 字、≤ ${MAX_TABLE_ROWS} 行`}`,
);
console.log(
  `D 截图占位：${requiredShots.length - missingShots.length}/${requiredShots.length}` +
    (missingShots.length ? `，缺 ${missingShots.map((s) => s.label).join('、')}` : ''),
);
console.log(`E 来源与口径：来源 ${sourceHits} 处，边界声明 ${boundaryHits} 处`);
console.log(`F 时长备注：${noteCount} 条`);

console.log('\n## 评分');
console.log(
  `结构 ${scoreA}/30 · 编号 ${scoreB}/15 · 密度 ${scoreC}/20 · 截图 ${scoreD}/20 · 来源 ${scoreE}/10 · 时长 ${scoreF}/5`,
);
console.log(`**总分 ${total}/100** ${total >= 85 ? '✅ 通过' : '❌ 未达标（<85）'}`);

const hardFail = missing.length > 0 || missingShots.length > 0;
process.exit(total >= 85 && !hardFail ? 0 : 1);
