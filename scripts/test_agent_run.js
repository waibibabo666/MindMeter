#!/usr/bin/env node
/**
 * L-05 Agent 主流程测试：用依赖注入，不真的调模型。
 *
 * 覆盖：
 *   - 非解释意图直接返回固定话术
 *   - 未配置密钥时回退模板
 *   - 正常回答带引用
 *   - 输出含禁用词时回退
 *   - 模型报错时回退
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

async function main() {
  const { answer } = await import(pathToFileURL(path.join(SRC, 'run.js')).href);

  const facts = { am: { hits: 8, total: 12, falseAlarms: 3 } };
  const template = () => '模板：本次联想记忆命中 8、虚报 3。';
  const retrieve = async () => [
    { id: 'kb-plan-am-01', title: '联想记忆 · 场景分组', text: '按场景分组。' },
  ];
  const settings = {
    enabled: true,
    endpoint: 'https://x/v1',
    model: 'm',
    apiKey: 'sk-test-123456',
  };

  test('危机问题不调模型', async () => {
    let called = false;
    const result = await answer({
      question: '我分数很低，不想活了',
      facts,
      settings,
      deps: {
        call: async () => {
          called = true;
          return { text: '' };
        },
        template,
        retrieve,
      },
    });
    assert(result.intent === 'crisis', `intent should be crisis, got ${result.intent}`);
    assert(result.source === 'template', 'crisis should not use llm');
    assert(called === false, 'model must not be called for crisis');
    assert(result.citations.length === 0, 'crisis should not cite knowledge');
  });

  test('检索为空时明说不知道，不调模型', async () => {
    let called = false;
    const result = await answer({
      question: '像量子力学这种内容应该怎么练才能提高',
      facts,
      settings,
      deps: {
        call: async () => {
          called = true;
          return { text: '随便答' };
        },
        template,
        retrieve: async () => [],
      },
    });
    assert(result.code === 'no_knowledge', `code should be no_knowledge, got ${result.code}`);
    assert(result.source === 'template', 'no_knowledge should not use llm');
    assert(called === false, 'model must not be called without knowledge');
    assert(result.text.includes('不猜'), 'reply should say it does not guess');
  });

  test('未配置密钥回退模板，但保留引用', async () => {
    const result = await answer({
      question: '联想记忆怎么练',
      facts,
      settings: { enabled: false },
      deps: { template, retrieve },
    });
    assert(result.source === 'template', 'should fall back to template');
    assert(result.code === 'not_configured', `code should be not_configured, got ${result.code}`);
    assert(result.citations.includes('kb-plan-am-01'), 'citations should be kept');
  });

  test('正常回答：采用模型文本并带引用', async () => {
    const result = await answer({
      question: '联想记忆怎么练',
      facts,
      settings,
      deps: {
        template,
        retrieve,
        call: async () => ({
          text: '这次命中 8 对、虚报 3 个。\n引用：kb-plan-am-01 · 场景分组法',
        }),
      },
    });
    assert(result.source === 'llm', `expected llm, got ${result.source} (${result.code})`);
    assert(result.text.includes('引用'), 'text should keep citation');
    assert(result.citations.includes('kb-plan-am-01'), 'citations expected');
  });

  test('模型输出含禁用词时回退', async () => {
    const result = await answer({
      question: '联想记忆怎么练',
      facts,
      settings,
      deps: {
        template,
        retrieve,
        call: async () => ({ text: '你的表现异常，建议治疗。' }),
      },
    });
    assert(result.source === 'template', 'banned word should trigger fallback');
    assert(result.code.startsWith('invalid:'), `code should be invalid:*, got ${result.code}`);
  });

  test('模型报错时回退', async () => {
    const result = await answer({
      question: '联想记忆怎么练',
      facts,
      settings,
      deps: {
        template,
        retrieve,
        call: async () => {
          const error = new Error('boom');
          error.code = 'timeout';
          throw error;
        },
      },
    });
    assert(result.source === 'template', 'error should fall back');
    assert(result.code === 'timeout', `code should be timeout, got ${result.code}`);
  });

  test('llm 结果带 sources（供建议记录使用）', async () => {
    const result = await answer({
      question: '联想记忆怎么练',
      facts,
      settings,
      deps: {
        template,
        retrieve,
        call: async () => ({ text: '按场景分组练习。\n引用：kb-plan-am-01 · 场景分组' }),
      },
    });
    assert(result.source === 'llm', 'expected llm path');
    assert(
      result.sources.length === 1 && result.sources[0].id === 'kb-plan-am-01',
      'sources should carry id+title',
    );
    assert(result.sources[0].title === '联想记忆 · 场景分组', 'title should pass through');
  });

  test('记忆上下文进入 prompt；未确认画像不进入', async () => {
    let captured = null;
    const deps = {
      template,
      retrieve,
      call: async (options) => {
        captured = options.messages;
        return { text: '按场景分组练习。\n引用：kb-plan-am-01 · 场景分组' };
      },
    };

    await answer({
      question: '联想记忆怎么练',
      facts,
      settings,
      memory: {
        profile: { goal: '备考', preference: '晚上', constraint: '15 分钟内' },
        summaryText: '标准 · 最低项联想记忆 49',
        advice: [{ id: 'kb-plan-am-02', done: false }],
      },
      deps,
    });
    const prompt = captured.map((m) => m.content).join('\n');
    assert(prompt.includes('用户背景'), 'memory block should enter prompt');
    assert(prompt.includes('用户画像（已确认）'), 'confirmed profile should enter prompt');
    assert(prompt.includes('备考'), 'goal should enter prompt');
    assert(prompt.includes('kb-plan-am-02'), 'shown advice should enter prompt');
    assert(prompt.includes('不作为数字来源'), 'memory numbers must be firewalled');

    await answer({
      question: '联想记忆怎么练',
      facts,
      settings,
      memory: { profile: null, summaryText: null, advice: [] },
      deps,
    });
    const prompt2 = captured.map((m) => m.content).join('\n');
    assert(!prompt2.includes('用户背景'), 'empty memory should add no block');
  });

  test('真实检索适配器：审核后 30 条进索引，评测 query 可命中', async () => {
    const adapter = await import(pathToFileURL(path.join(SRC, 'retrieve.js')).href);
    assert(adapter.reviewedCount() === 30, `expected 30 reviewed, got ${adapter.reviewedCount()}`);
    const hits = await adapter.retrieve({ query: '为什么没有总分' });
    assert(hits.length > 0, 'should retrieve something');
    assert(
      hits.slice(0, 3).some((hit) => hit.id === 'kb-score-02'),
      'kb-score-02 should be in top3 (queries.json #1)',
    );
  });

  test('真实检索适配器：未审条目仍被门槛挡住', async () => {
    const adapter = await import(pathToFileURL(path.join(SRC, 'retrieve.js')).href);
    const draftChunk = {
      id: 'kb-plan-zz-01',
      category: 'plan',
      dims: [],
      title: '未审条目',
      text: '这条还没有经过人工核验，不应该出现在任何检索结果里。',
      tags: ['未审'],
      review: { status: 'draft', by: '', date: '' },
    };
    const hits = await adapter.retrieve({ query: '未审条目', chunks: [draftChunk] });
    assert(hits.length === 0, 'draft chunks must not be retrievable');
  });

  test('真实检索适配器：reviewed 条目可检索且形状正确', async () => {
    const adapter = await import(pathToFileURL(path.join(SRC, 'retrieve.js')).href);
    const reviewedChunk = {
      id: 'kb-plan-am-99',
      category: 'plan',
      dims: ['am'],
      title: '联想记忆 · 测试条目',
      text: '把词对按生活场景分组记忆，先组内复述再整体复述，间隔一天再来一遍。',
      tags: ['联想记忆', '分组'],
      review: { status: 'reviewed', by: 'tester', date: '2026-11-07' },
    };
    const hits = await adapter.retrieve({ query: '联想记忆怎么分组', chunks: [reviewedChunk] });
    assert(hits.length === 1, `expected 1 hit, got ${hits.length}`);
    const hit = hits[0];
    assert(hit.id === 'kb-plan-am-99' && hit.title && hit.text, 'shape: id/title/text');
    assert(typeof hit.score === 'number' && hit.score > 0, 'BM25 score expected');
  });

  let passed = 0;
  // 有意串行：用例共享注入的假实现，并发会互相干扰，输出顺序也不好读。
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
  console.log(`\n${passed}/${tests.length} agent run checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
