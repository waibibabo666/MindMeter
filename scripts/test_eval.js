#!/usr/bin/env node
/**
 * P-07 Agent 评测执行器（无依赖、无需真实模型）。
 *
 * 做法：把 30 条用例跑在真实的 answer() 上，但用依赖注入替换
 *   - retrieve：按用例返回固定知识块或空
 *   - call：返回合规文本 / 抛超时 / 返回含禁用词 / 返回不可溯源数字
 * 这样能确定性地验证「意图路由、固定话术、四种兜底、校验拦截」，
 * 而不依赖网络与 Key。真实模型的质量打分另行人工完成，见 eval-rubric.md。
 *
 * 用法：node scripts/test_eval.js
 */
'use strict';

const path = require('path');
const url = require('url');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'code', 'frontend', 'src');
const href = (p) => url.pathToFileURL(p).href;

const OK_TEXT =
  '这项反映的是本次任务中的表现，属于参考分，不足以说明能力高低。' +
  '影响它的因素包括作答时的状态与题目抽样。' +
  '引用：kb-dim-sv-01 · 空间视觉化测什么';
const BANNED_TEXT = '这项的参考分偏低，可能与注意力状态有关，也不排除诊断意义。引用：kb-dim-sv-01';
const NUMBER_TEXT = '你的参考分是 88 分，高于平均水平。引用：kb-dim-sv-01';

const KEEP_CHUNK = {
  id: 'kb-dim-sv-01',
  title: '空间视觉化测什么',
  text: '空间视觉化指在头脑中生成、保持并操作视觉图像的能力。',
};

const REPLY_BY_MODEL = { ok: OK_TEXT, banned: BANNED_TEXT, number: NUMBER_TEXT };

/** 未配置模型时设置项缺少 endpoint/model/key，链路会走 not_configured。 */
function settingsFor(mode) {
  if (mode === 'none') return { enabled: false };
  return { enabled: true, endpoint: 'https://example.test/v1', model: 'stub', apiKey: 'test-key' };
}

/** 构造模型桩：ok/banned/number 返回对应文本，timeout 抛超时错误。 */
function makeCall(mode, counter) {
  return async () => {
    counter.calls += 1;
    if (mode === 'timeout') {
      const error = new Error('timeout');
      error.code = 'timeout';
      throw error;
    }
    return { text: REPLY_BY_MODEL[mode] || OK_TEXT };
  };
}

function buildDeps(item, counter) {
  return {
    retrieve: async () => (item.setup.chunks === 'kb' ? [KEEP_CHUNK] : []),
    call: makeCall(item.setup.model, counter),
  };
}

async function runCase(agent, item) {
  const counter = { calls: 0 };
  const options = {
    question: item.question,
    facts: item.facts || {},
    settings: settingsFor(item.setup.model),
    deps: buildDeps(item, counter),
  };
  try {
    const result = await agent.answer(options);
    return { result, calls: counter.calls };
  } catch (error) {
    return { result: null, calls: counter.calls, error };
  }
}

/* ---------- 断言：每条只做一件事，便于定位 ---------- */

function checkIntent(exp, result) {
  return result.intent === exp.intent ? [] : [`intent 期望 ${exp.intent}，实际 ${result.intent}`];
}

function checkSource(exp, result) {
  if (!exp.source || result.source === exp.source) return [];
  return [`source 期望 ${exp.source}，实际 ${result.source}`];
}

function checkCode(exp, result) {
  if (!exp.code) return [];
  const exact = result.code === exp.code;
  const prefix = exp.code.endsWith(':') && String(result.code).startsWith(exp.code);
  return exact || prefix ? [] : [`code 期望 ${exp.code}，实际 ${result.code}`];
}

function checkCodeContains(exp, result) {
  if (!exp.codeContains || String(result.code).includes(exp.codeContains)) return [];
  return [`code 应包含「${exp.codeContains}」，实际 ${result.code}`];
}

function checkContains(exp, result) {
  return (exp.contains || [])
    .filter((needle) => !String(result.text).includes(needle))
    .map((needle) => `正文缺少「${needle}」：${result.text}`);
}

function checkCitations(exp, result) {
  const has = Array.isArray(result.citations) && result.citations.length > 0;
  return exp.hasCitations && !has ? ['期望有引用，实际没有'] : [];
}

function checkModelNotCalled(exp, calls) {
  if (exp.modelCalled !== false || calls === 0) return [];
  return [`不应调用模型，实际调用 ${calls} 次`];
}

function compareExpect(exp, result, calls) {
  return [
    ...checkIntent(exp, result),
    ...checkSource(exp, result),
    ...checkCode(exp, result),
    ...checkCodeContains(exp, result),
    ...checkContains(exp, result),
    ...checkCitations(exp, result),
    ...checkModelNotCalled(exp, calls),
  ];
}

/* ---------- 结构检查 ---------- */

function checkStructure(cases) {
  const problems = [];
  if (cases.length !== 30) problems.push(`用例数应为 30，实际 ${cases.length}`);

  const ids = new Set(cases.map((c) => c.id));
  if (ids.size !== cases.length) problems.push('用例 id 有重复');

  for (const item of cases) {
    for (const key of ['id', 'group', 'setup', 'expect']) {
      if (!(key in item)) problems.push(`${item.id} 缺字段 ${key}`);
    }
    if (!item.expect || !item.expect.intent) problems.push(`${item.id} 缺 expect.intent`);
  }
  return problems;
}

function countGroups(cases) {
  const out = {};
  for (const item of cases) out[item.group] = (out[item.group] || 0) + 1;
  return out;
}

/* ---------- 主流程 ---------- */

async function runAll(agent, cases) {
  const failures = [];
  for (const item of cases) {
    const outcome = await runCase(agent, item);
    if (outcome.error) {
      failures.push(`${item.id} 抛异常：${outcome.error.message}`);
      continue;
    }
    const problems = compareExpect(item.expect, outcome.result, outcome.calls);
    if (problems.length) {
      failures.push(`${item.id}（${item.question || '空输入'}）：${problems.join('；')}`);
    }
  }
  return failures;
}

function report(cases, failures, structural) {
  const total = cases.length;
  const passed = total - failures.length;

  console.log('分组统计：');
  for (const [group, count] of Object.entries(countGroups(cases))) {
    console.log(`  ${group.padEnd(18)} ${count} 条`);
  }
  console.log('');

  if (structural.length) {
    console.error('[FAIL] 结构检查');
    structural.forEach((message) => console.error(`       ${message}`));
    process.exitCode = 1;
  } else {
    console.log('[PASS] 结构检查：30 条、id 唯一、字段齐全、expect.intent 齐备');
  }

  if (failures.length) {
    console.error(`[FAIL] 行为检查：${passed}/${total} 条通过`);
    failures.forEach((message) => console.error(`       ${message}`));
    process.exitCode = 1;
  } else {
    console.log(`[PASS] 行为检查：${total}/${total} 条符合预期`);
  }

  console.log(`\n${passed}/${total} eval cases passed`);
  console.log(
    '提示：本脚本只验证可判定的行为分支；「准确/有依据/有用/无越界」需接真实模型后人工打分。',
  );
}

async function main() {
  const agent = await import(href(path.join(SRC, 'agent', 'run.js')));
  const cases = JSON.parse(
    fs.readFileSync(path.join(SRC, 'eval', 'agent-cases.json'), 'utf8'),
  ).cases;

  const failures = await runAll(agent, cases);
  report(cases, failures, checkStructure(cases));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
