#!/usr/bin/env node
/**
 * L-05 对话逻辑测试（chat.js 纯函数，无 DOM）。
 *
 * 覆盖：
 *   - buildFacts：合并 scores 与 metrics，数字进白名单
 *   - toHistory：截断、role 规整、坏输入容错
 *   - makeMessage：id/at/role 与附加字段
 */

'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.resolve(__dirname, '..', 'code', 'frontend', 'src');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

async function main() {
  const chat = await import(pathToFileURL(path.join(SRC, 'chat.js')).href);
  const { buildFacts, toHistory, makeMessage, memoryContext, adviceFromReply } = chat;
  const { collectNumbers } = await import(pathToFileURL(path.join(SRC, 'agent', 'run.js')).href);

  test('buildFacts：合并分数与原始指标', () => {
    const facts = buildFacts({
      scores: { vc: 62, am: 49 },
      results: {
        vc: { metrics: { correct: 11, total: 15 } },
        am: { metrics: { hits: 8, falseAlarms: 3 } },
      },
    });
    assert(facts.vc.score === 62, 'vc score should be merged');
    assert(facts.vc.correct === 11, 'vc metrics should be kept');
    assert(facts.am.falseAlarms === 3, 'am metrics should be kept');
  });

  test('buildFacts：分数和指标数字都进白名单', () => {
    const facts = buildFacts({
      scores: { vc: 62 },
      results: { vc: { metrics: { correct: 11, total: 15 } } },
    });
    const allowed = new Set(collectNumbers(facts));
    assert(allowed.has(62) && allowed.has(11) && allowed.has(15), 'numbers should be whitelisted');
  });

  test('buildFacts：坏输入不抛错', () => {
    assert(Object.keys(buildFacts(null)).length === 0, 'null session -> {}');
    assert(Object.keys(buildFacts({})).length === 0, 'empty session -> {}');
    const facts = buildFacts({ results: { vc: { metrics: null }, ps: 3 } });
    assert(Object.keys(facts).length === 0, 'bad payloads should be skipped');
  });

  test('toHistory：截断到 limit 并规整 role', () => {
    const messages = [];
    for (let index = 0; index < 10; index += 1) {
      messages.push({ role: index % 2 === 0 ? 'user' : 'assistant', content: `m${index}` });
    }
    const history = toHistory(messages, 6);
    assert(history.length === 6, `expected 6, got ${history.length}`);
    assert(history[0].content === 'm4', 'should keep the most recent');
    assert(
      history.every((item) => item.role === 'user' || item.role === 'assistant'),
      'roles',
    );
  });

  test('toHistory：非 user/assistant 的 role 归为 user', () => {
    const history = toHistory([{ role: 'system', content: 'x' }]);
    assert(history[0].role === 'user', 'unknown role should fall back to user');
  });

  test('toHistory：坏输入不抛错', () => {
    assert(toHistory(null).length === 0, 'null -> []');
    assert(toHistory('oops').length === 0, 'string -> []');
  });

  test('makeMessage：字段齐全且 id 唯一', () => {
    const a = makeMessage('user', '为什么联想记忆低？');
    const b = makeMessage('assistant', '模板回答', { source: 'template', citations: ['kb-x'] });
    assert(a.role === 'user' && a.content === '为什么联想记忆低？', 'basic fields');
    assert(typeof a.id === 'string' && a.id !== b.id, 'ids should be unique');
    assert(typeof a.at === 'number', 'timestamp expected');
    assert(b.source === 'template' && b.citations[0] === 'kb-x', 'meta should be kept');
  });

  test('makeMessage：未知 role 归为 user', () => {
    assert(makeMessage('tool', 'x').role === 'user', 'unknown role -> user');
  });

  test('memoryContext：未确认画像不进上下文', () => {
    const usable = (profile) => Boolean(profile?.confirmed);
    const ctx = memoryContext(
      { profile: { goal: '备考', confirmed: false }, summaries: [], advice: [] },
      usable,
    );
    assert(ctx.profile === null, 'unconfirmed profile must not enter prompt');
  });

  test('memoryContext：确认画像 + 最近摘要 + 建议截断', () => {
    const usable = (profile) => Boolean(profile?.confirmed);
    const advice = [];
    for (let index = 0; index < 8; index += 1) advice.push({ id: `kb-plan-${index}` });
    const ctx = memoryContext(
      {
        profile: { goal: '备考', confirmed: true },
        summaries: [{ text: '第一条' }, { text: '最近一条' }],
        advice,
      },
      usable,
    );
    assert(ctx.profile.goal === '备考', 'confirmed profile should pass through');
    assert(ctx.summaryText === '最近一条', 'latest summary only');
    assert(ctx.advice.length === 5, `advice capped at 5, got ${ctx.advice.length}`);
  });

  test('memoryContext：坏输入不抛错', () => {
    const ctx = memoryContext(null);
    assert(ctx.profile === null && ctx.summaryText === null, 'null memory -> empty context');
    assert(ctx.advice.length === 0, 'advice should default to []');
  });

  test('adviceFromReply：只认 llm 来源的 plan 类引用', () => {
    const llmReply = {
      source: 'llm',
      sources: [
        { id: 'kb-plan-am-01', title: '场景分组' },
        { id: 'kb-dim-am-01', title: '测什么' },
      ],
    };
    const picked = adviceFromReply(llmReply);
    assert(picked.length === 1 && picked[0].id === 'kb-plan-am-01', 'only kb-plan recorded');

    assert(
      adviceFromReply({ source: 'template', sources: [{ id: 'kb-plan-am-01' }] }).length === 0,
      'template reply should not record advice',
    );
    assert(adviceFromReply(null).length === 0, 'null reply -> []');
  });

  let passed = 0;
  // 有意串行：与其他测试脚本保持一致的输出顺序。
  for (const { name, fn } of tests) {
    try {
      await fn(); // NOSONAR: 串行是有意为之
      passed += 1;
      console.log(`[PASS] ${name}`);
    } catch (error) {
      console.error(`[FAIL] ${name}`);
      console.error(`       ${error.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} chat checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
