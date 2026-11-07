#!/usr/bin/env node
/**
 * L-05 Agent 基础模块测试（无浏览器、无依赖）。
 *
 * 覆盖：
 *   - classify：五类意图的边界（解释 / 澄清 / 无关 / 越界 / 危机）
 *   - validate：空、超长、禁用词、数字溯源、引用缺失
 *   - 引用里的编号不被当成幻觉数字
 */

'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.resolve(__dirname, '..', 'code', 'frontend', 'src', 'agent');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

async function load() {
  const classify = await import(pathToFileURL(path.join(SRC, 'classify.js')).href);
  const validate = await import(pathToFileURL(path.join(SRC, 'validate.js')).href);
  return { classify, validate };
}

async function main() {
  const { classify, validate } = await load();
  const { INTENT, classify: run, fixedReply } = classify;
  const { validateText, extractNumbers } = validate;

  /* ---------- 意图分类 ---------- */

  test('解释类：维度 + 为什么', () => {
    const r = run('为什么我的联想记忆只有 49？');
    assert(r.intent === INTENT.EXPLAIN, `expected explain, got ${r.intent}`);
    assert(r.matched.includes('联想记忆'), 'should match dimension word');
  });

  test('解释类：怎么练', () => {
    const r = run('言语理解怎么提高');
    assert(r.intent === INTENT.EXPLAIN, `expected explain, got ${r.intent}`);
  });

  test('澄清类：指代不明', () => {
    const r = run('这个怎么说？');
    assert(r.intent === INTENT.CLARIFY, `expected clarify, got ${r.intent}`);
    assert(typeof fixedReply(r.intent) === 'string', 'fixed reply missing');
  });

  test('澄清类：空输入', () => {
    const r = run('   ');
    assert(r.intent === INTENT.CLARIFY, 'empty should be clarify');
  });

  test('无关类：完全不相关的话题', () => {
    const r = run('今天天气怎么样');
    assert(r.intent === INTENT.UNRELATED, `expected unrelated, got ${r.intent}`);
  });

  test('越界类：问病名', () => {
    const r = run('我是不是有抑郁症？');
    assert(r.intent === INTENT.BOUNDARY, `expected boundary, got ${r.intent}`);
    assert(fixedReply(INTENT.BOUNDARY).includes('医生'), 'boundary reply should guide to doctor');
  });

  test('越界类：问吃药', () => {
    const r = run('需要吃药吗');
    assert(r.intent === INTENT.BOUNDARY, `expected boundary, got ${r.intent}`);
  });

  test('危机类：优先于其他关键词', () => {
    const r = run('我分数很低，不想活了');
    assert(r.intent === INTENT.CRISIS, `expected crisis, got ${r.intent}`);
    assert(fixedReply(INTENT.CRISIS).includes('120'), 'crisis reply should give hotline');
  });

  /* ---------- 输出校验 ---------- */

  test('校验：正常回答通过', () => {
    const r = validateText({
      text: '这次联想记忆认对 8 对、误认 3 个，建议按场景分组记。',
      allowedNumbers: [8, 3],
      requireCitation: false,
    });
    assert(r.ok, `expected ok, got ${JSON.stringify(r.issues)}`);
  });

  test('校验：空回答不通过', () => {
    const r = validateText({ text: '   ' });
    assert(!r.ok, 'empty should fail');
    assert(r.issues[0].code === 'empty', 'issue code should be empty');
  });

  test('校验：超长不通过', () => {
    const r = validateText({ text: '好'.repeat(201) });
    assert(!r.ok && r.issues.some((i) => i.code === 'too_long'), 'should flag too_long');
  });

  test('校验：禁用词不通过', () => {
    const r = validateText({ text: '你的表现属于异常，建议治疗。' });
    assert(!r.ok, 'banned word should fail');
    const codes = r.issues.map((i) => i.code);
    assert(codes.includes('banned_word'), 'should flag banned_word');
  });

  test('校验：幻觉数字不通过', () => {
    const r = validateText({ text: '你的分数是 88 分。', allowedNumbers: [62] });
    assert(!r.ok, 'unsourced number should fail');
    assert(
      r.issues.some((i) => i.code === 'unsourced_number'),
      'should flag unsourced_number',
    );
  });

  test('校验：引用里的编号不算幻觉数字', () => {
    const r = validateText({
      text: '按场景分组练习。\n引用：知识库 KB-MM-017 · 联想记忆',
      allowedNumbers: [],
      requireCitation: true,
    });
    assert(r.ok, `KB-017 should be ignored, got ${JSON.stringify(r.issues)}`);
  });

  test('校验：要求引用但缺失', () => {
    const r = validateText({
      text: '建议每天练 10 分钟。',
      allowedNumbers: [10],
      requireCitation: true,
    });
    assert(!r.ok, 'missing citation should fail');
    assert(
      r.issues.some((i) => i.code === 'missing_citation'),
      'should flag missing_citation',
    );
  });

  test('提取数字：带单位', () => {
    const nums = extractNumbers('正确 11 / 15，用时 45 秒，误认 3 个。');
    const values = new Set(nums.map((n) => n.value));
    assert(values.has(11) && values.has(45) && values.has(3), 'should extract 11/45/3');
  });

  let passed = 0;
  // 有意串行：用例共享注入的假实现，并发会互相干扰。
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
  console.log(`\n${passed}/${tests.length} agent checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
