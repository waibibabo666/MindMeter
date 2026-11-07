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

function settingsFor(mode) {
  if (mode === 'none') return { enabled: false };
  return { enabled: true, endpoint: 'https://example.test/v1', model: 'stub', apiKey: 'test-key' };
}

function callFor(mode, counter) {
  return async () => {
    counter.calls += 1;
    if (mode === 'timeout') {
      const error = new Error('timeout');
      error.code = 'timeout';
      throw error;
    }
    if (mode === 'banned') return { text: BANNED_TEXT };
    if (mode === 'number') return { text: NUMBER_TEXT };
    return { text: OK_TEXT };
  };
}

async function main() {
  const agent = await import(href(path.join(SRC, 'agent', 'run.js')));
  const casesFile = JSON.parse(fs.readFileSync(path.join(SRC, 'eval', 'agent-cases.json'), 'utf8'));
  const cases = casesFile.cases;

  const failures = [];
  const groupCount = {};

  for (const item of cases) {
    groupCount[item.group] = (groupCount[item.group] || 0) + 1;

    const counter = { calls: 0 };
    const deps = {
      retrieve: async () => (item.setup.chunks === 'kb' ? [KEEP_CHUNK] : []),
      call: callFor(item.setup.model, counter),
    };

    let result;
    try {
      result = await agent.answer({
        question: item.question,
        facts: item.facts || {},
        settings: settingsFor(item.setup.model),
        deps,
      });
    } catch (error) {
      failures.push(`${item.id} 抛异常：${error.message}`);
      continue;
    }

    const exp = item.expect;
    const problems = [];

    if (result.intent !== exp.intent) {
      problems.push(`intent 期望 ${exp.intent}，实际 ${result.intent}`);
    }
    if (exp.source && result.source !== exp.source) {
      problems.push(`source 期望 ${exp.source}，实际 ${result.source}`);
    }
    if (exp.code) {
      const okExact = result.code === exp.code;
      const okPrefix = exp.code.endsWith(':') && String(result.code).startsWith(exp.code);
      if (!okExact && !okPrefix) problems.push(`code 期望 ${exp.code}，实际 ${result.code}`);
    }
    if (exp.codeContains && !String(result.code).includes(exp.codeContains)) {
      problems.push(`code 应包含「${exp.codeContains}」，实际 ${result.code}`);
    }
    for (const needle of exp.contains || []) {
      if (!String(result.text).includes(needle)) {
        problems.push(`正文缺少「${needle}」：${result.text}`);
      }
    }
    if (exp.hasCitations && !(Array.isArray(result.citations) && result.citations.length > 0)) {
      problems.push('期望有引用，实际没有');
    }
    if (exp.modelCalled === false && counter.calls !== 0) {
      problems.push(`不应调用模型，实际调用 ${counter.calls} 次`);
    }

    if (problems.length)
      failures.push(`${item.id}（${item.question || '空输入'}）：${problems.join('；')}`);
  }

  // 结构性检查
  const structural = [];
  if (cases.length !== 30) structural.push(`用例数应为 30，实际 ${cases.length}`);
  const ids = new Set(cases.map((c) => c.id));
  if (ids.size !== cases.length) structural.push('用例 id 有重复');
  for (const c of cases) {
    for (const key of ['id', 'group', 'question', 'setup', 'expect']) {
      if (!(key in c) && key !== 'question') structural.push(`${c.id} 缺字段 ${key}`);
    }
    if (!c.expect.intent) structural.push(`${c.id} 缺 expect.intent`);
  }

  const total = cases.length;
  const passed = total - failures.length;

  console.log('分组统计：');
  for (const [k, v] of Object.entries(groupCount)) console.log(`  ${k.padEnd(18)} ${v} 条`);
  console.log('');

  if (structural.length) {
    console.error('[FAIL] 结构检查');
    structural.forEach((m) => console.error(`       ${m}`));
    process.exitCode = 1;
  } else {
    console.log('[PASS] 结构检查：30 条、id 唯一、字段齐全、expect.intent 齐备');
  }

  if (failures.length === 0) {
    console.log(`[PASS] 行为检查：${total}/${total} 条符合预期`);
  } else {
    console.error(`[FAIL] 行为检查：${passed}/${total} 条通过`);
    failures.forEach((m) => console.error(`       ${m}`));
    process.exitCode = 1;
  }

  console.log(`\n${passed}/${total} eval cases passed`);
  console.log(
    '提示：本脚本只验证可判定的行为分支；「准确/有依据/有用/无越界」需接真实模型后人工打分。',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
