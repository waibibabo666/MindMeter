#!/usr/bin/env node
/**
 * L-06 本地知识库检查（无依赖、无浏览器）。
 *
 * 覆盖：
 *   - 30 条齐全、id 唯一、分类配比符合 P-06 计划
 *   - 字段契约：必填、枚举、id 格式、标题/正文长度、标签数量、来源四要素
 *   - 禁用词扫描（含按 id 白名单）
 *   - 未审内容不进索引
 *   - 20 条查询的 hit@3 ≥ 80%
 *   - 检索性能
 *
 * 用法：node scripts/test_kb.js
 */
'use strict';

const path = require('path');
const url = require('url');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const KB_DIR = path.join(ROOT, 'code', 'frontend', 'src', 'kb');
const href = (p) => url.pathToFileURL(p).href;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const eq = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label}：期望 ${expected}，实际 ${actual}`);
};

/** 计划中的分类配比（P-06 第五节）。 */
const CATEGORY_PLAN = { dim: 12, task: 4, score: 5, factor: 3, limit: 4, plan: 2 };

/**
 * 全局禁用词：出现即判失败。
 * 「一定」只禁止"一定是/一定能/一定会"这类断言，不波及"按一定角度"的普通用法。
 */
const BANNED = ['确诊', '治疗', '治愈', '智商', '脑龄', '证明你', '证明您'];
const BANNED_PATTERNS = [/一定是/, /一定能/, /一定会/, /必然/];

/** 允许在指定 chunk 里出现的词（用于解释"为什么没有"的条目）。 */
const ALLOW = {
  'kb-score-03': ['百分位', '常模'],
  'kb-limit-01': ['诊断'],
  'kb-plan-02': ['诊断'],
};

/** 把否定式先剔除，避免"不提供诊断"被误杀。 */
function stripNegation(text) {
  return text.replace(/不提供诊断|不是诊断|非诊断|不做诊断|替代专业评估/g, '');
}

async function main() {
  const { CHUNKS, INDEXABLE } = await import(href(path.join(KB_DIR, 'chunks.js')));
  const kb = await import(href(path.join(KB_DIR, 'search.js')));
  const queries = JSON.parse(fs.readFileSync(path.join(KB_DIR, 'queries.json'), 'utf8'));

  const byId = new Map(CHUNKS.map((c) => [c.id, c]));

  // ---------- 结构与配比 ----------

  test('30 条齐全且 id 唯一', () => {
    eq(CHUNKS.length, 30, 'chunk 总数');
    eq(byId.size, 30, '唯一 id 数');
  });

  test('分类配比符合 P-06 计划', () => {
    const count = {};
    for (const c of CHUNKS) count[c.category] = (count[c.category] || 0) + 1;
    for (const [k, v] of Object.entries(CATEGORY_PLAN)) {
      eq(count[k], v, `${k} 条数`);
    }
  });

  test('维度覆盖：4 个维度各有 3 条 dim 条目', () => {
    const dims = ['vc', 'ps', 'sv', 'am'];
    for (const d of dims) {
      const n = CHUNKS.filter((c) => c.category === 'dim' && c.dims.includes(d)).length;
      eq(n, 3, `${d} 的 dim 条数`);
    }
  });

  // ---------- 字段契约 ----------

  test('字段齐全且 id 格式正确', () => {
    const required = [
      'id',
      'category',
      'dims',
      'title',
      'text',
      'source',
      'version',
      'risk',
      'review',
      'tags',
      'param',
    ];
    const idRe = /^kb-(dim|task|score|factor|limit|plan)(-[a-z]{2,5})?-\d{2}$/;
    for (const c of CHUNKS) {
      for (const key of required) assert(key in c, `${c.id} 缺字段 ${key}`);
      assert(idRe.test(c.id), `${c.id} id 格式不符`);
      assert(Object.keys(c).length === required.length, `${c.id} 有多余字段`);
    }
  });

  test('枚举值合法', () => {
    for (const c of CHUNKS) {
      assert(
        ['dim', 'task', 'score', 'factor', 'limit', 'plan'].includes(c.category),
        `${c.id} category`,
      );
      assert(['low', 'medium', 'high'].includes(c.risk), `${c.id} risk`);
      assert(['draft', 'reviewed', 'rejected'].includes(c.review.status), `${c.id} review.status`);
      for (const d of c.dims) assert(['vc', 'ps', 'sv', 'am'].includes(d), `${c.id} dims`);
      assert(/^\d+\.\d+$/.test(c.version), `${c.id} version`);
    }
  });

  test('标题 ≤20 字、正文 120–220 字、标签 2–5 个', () => {
    for (const c of CHUNKS) {
      assert(c.title.length >= 2 && c.title.length <= 20, `${c.id} 标题 ${c.title.length} 字`);
      assert(c.text.length >= 120 && c.text.length <= 220, `${c.id} 正文 ${c.text.length} 字`);
      assert(c.tags.length >= 2 && c.tags.length <= 5, `${c.id} 标签 ${c.tags.length} 个`);
    }
  });

  test('来源四要素齐全，org 类必须有 url', () => {
    for (const c of CHUNKS) {
      const s = c.source;
      assert(['textbook', 'paper', 'org', 'product'].includes(s.kind), `${c.id} source.kind`);
      for (const key of ['title', 'author', 'locator']) {
        assert(typeof s[key] === 'string' && s[key].length >= 2, `${c.id} source.${key}`);
      }
      assert(s.year !== undefined && s.year !== null, `${c.id} source.year`);
      if (s.kind === 'org') assert(/^https?:\/\//.test(s.url || ''), `${c.id} org 类缺 url`);
    }
  });

  // ---------- 内容安全 ----------

  test('禁用词扫描（按 id 白名单）', () => {
    for (const c of CHUNKS) {
      const allow = ALLOW[c.id] || [];
      const haystack = stripNegation(`${c.title} ${c.text} ${(c.tags || []).join(' ')}`);
      for (const word of BANNED) {
        assert(!haystack.includes(word), `${c.id} 出现禁用词「${word}」`);
      }
      for (const pattern of BANNED_PATTERNS) {
        assert(!pattern.test(haystack), `${c.id} 出现禁用表述「${pattern.source}」`);
      }
      for (const word of ['百分位', '常模', '诊断']) {
        if (haystack.includes(word)) {
          assert(allow.includes(word), `${c.id} 出现受限词「${word}」但未获白名单`);
        }
      }
    }
  });

  test('正文不含裸分数锚点（防止与 config 漂移）', () => {
    for (const c of CHUNKS) {
      const hit = c.text.match(/\d+\s*(个|分|%)\s*(对应|即|=)/);
      assert(!hit, `${c.id} 出现疑似分数锚点：${hit && hit[0]}`);
    }
  });

  // ---------- 索引策略 ----------

  test('未审内容不进入索引', () => {
    eq(INDEXABLE.length, 0, '当前应有 0 条已审条目');
    const { index, reviewedCount } = kb.createIndex(CHUNKS);
    eq(reviewedCount, 0, 'createIndex 的已审数');
    eq(index.docs.length, 0, '索引文档数');
  });

  test('审后条目可被检索到', () => {
    const sample = CHUNKS.slice(0, 3).map((c) => ({
      ...c,
      review: { status: 'reviewed', by: 'test', date: '2026-11-07' },
    }));
    const { index } = kb.createIndex(sample);
    eq(index.docs.length, 3, '索引文档数');
    const hits = kb.search(index, sample[0].title, 1);
    assert(hits.length === 1, '标题查询应有 1 条命中');
    eq(hits[0].id, sample[0].id, '命中 id');
  });

  // ---------- 检索评测 ----------

  test('20 条查询 hit@3 ≥ 80%', () => {
    const reviewed = CHUNKS.map((c) => ({
      ...c,
      review: { status: 'reviewed', by: 'test', date: '2026-11-07' },
    }));
    const { index } = kb.createIndex(reviewed);

    const misses = [];
    for (const item of queries.queries) {
      const hits = kb.search(index, item.q, 3).map((h) => h.id);
      const ok = item.expect.some((id) => hits.includes(id));
      if (!ok)
        misses.push(`${item.q} → 期望 ${item.expect.join('/')}，实际 ${hits.join('/') || '空'}`);
    }
    const total = queries.queries.length;
    const hitRate = (total - misses.length) / total;
    assert(total === 20, `查询条数 ${total}`);
    assert(
      hitRate >= 0.8,
      `hit@3 = ${(hitRate * 100).toFixed(0)}%（${total - misses.length}/${total}），未达 80%\n       ` +
        misses.join('\n       '),
    );
    console.log(
      `       （hit@3 = ${(hitRate * 100).toFixed(0)}%，${total - misses.length}/${total}）`,
    );
  });

  test('检索性能：100 次查询 < 100ms', () => {
    const reviewed = CHUNKS.map((c) => ({
      ...c,
      review: { status: 'reviewed', by: 'test', date: '2026-11-07' },
    }));
    const { index } = kb.createIndex(reviewed);
    const start = Date.now();
    for (let i = 0; i < 100; i += 1) kb.search(index, queries.queries[i % 20].q, 3);
    const cost = Date.now() - start;
    assert(cost < 100, `100 次检索耗时 ${cost}ms`);
    console.log(`       （100 次检索耗时 ${cost}ms）`);
  });

  // ---------- 运行 ----------

  let passed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`[PASS] ${name}`);
    } catch (error) {
      console.error(`[FAIL] ${name}`);
      console.error(`       ${error.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} KB checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
