#!/usr/bin/env node
/**
 * L-07 本地记忆测试（无浏览器、无依赖）。
 *
 * 覆盖：
 *   - 摘要只记录最低项与建议数量，无分数时不写
 *   - 画像必须确认后才可用
 *   - 建议记录去重、可标记完成
 *   - 按类型删除、汇总视角
 *   - 消息保留最近 20 条
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

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
  };
}

async function main() {
  const storage = await import(pathToFileURL(path.join(SRC, 'storage.js')).href);
  const memory = await import(pathToFileURL(path.join(SRC, 'memory.js')).href);

  storage.__setStorageForTests(fakeStorage());

  test('摘要：记录最低项与建议数量', () => {
    const summary = memory.buildSummary(
      { tier: 'standard', scores: { vc: 62, ps: 71, sv: 58, am: 49 }, finishedAt: 1000 },
      ['KB-MM-017', 'KB-MM-021'],
    );
    assert(summary !== null, 'summary should exist');
    assert(summary.lowest.id === 'am', `lowest should be am, got ${summary.lowest.id}`);
    assert(summary.lowest.value === 49, 'lowest value should be 49');
    assert(summary.text.includes('联想记忆'), 'text should name the dimension');
    assert(summary.text.includes('2 条建议'), `text should count advice, got ${summary.text}`);
    assert(summary.adviceIds.length === 2, 'advice ids should be kept');
  });

  test('摘要：没有分数时不生成', () => {
    assert(memory.buildSummary({ tier: 'standard', scores: {} }) === null, 'empty scores -> null');
    assert(memory.buildSummary({}) === null, 'missing scores -> null');
  });

  test('摘要：最多保留 3 条建议', () => {
    const summary = memory.buildSummary({ scores: { vc: 10 } }, ['a', 'b', 'c', 'd']);
    assert(summary.adviceIds.length === 3, 'advice ids capped at 3');
  });

  test('画像：确认前不可用', () => {
    memory.dismissProfile();
    assert(memory.memoryOverview().profileUsable === false, 'should be unusable before confirm');
  });

  test('画像：确认后可用且持久化', () => {
    const saved = memory.confirmProfile({ goal: '备考', preference: '晚上', constraint: '' });
    assert(saved !== null && saved.confirmed === true, 'confirm should return saved profile');
    const view = memory.memoryOverview();
    assert(view.profileUsable === true, 'profile should be usable after confirm');
    assert(view.profile.goal === '备考', 'goal should persist');
  });

  test('画像：全空不写入', () => {
    memory.dismissProfile();
    assert(
      memory.confirmProfile({ goal: '  ', preference: '' }) === null,
      'blank profile should be rejected',
    );
  });

  test('建议：同 ID 只保留一条', () => {
    memory.clearAllMemory();
    memory.recordAdvice({ id: 'KB-MM-017', title: '场景分组法' });
    memory.recordAdvice({ id: 'KB-MM-017', title: '场景分组法' });
    assert(memory.memoryOverview().advice.length === 1, 'duplicate advice should be merged');
  });

  test('建议：可标记完成', () => {
    memory.setAdviceDone('KB-MM-017', true);
    const item = memory.memoryOverview().advice.find((entry) => entry.id === 'KB-MM-017');
    assert(item.done === true, 'advice should be marked done');
  });

  test('删除：按类型移除单条摘要', () => {
    memory.clearAllMemory();
    const summary = memory.saveSummary({ scores: { vc: 10 } });
    assert(summary !== null, 'summary should be saved');
    assert(memory.memoryOverview().summaries.length === 1, 'one summary expected');
    memory.removeMemory('summary', summary.id);
    assert(memory.memoryOverview().summaries.length === 0, 'summary should be removed');
  });

  test('删除：按类型移除单条建议', () => {
    memory.clearAllMemory();
    memory.recordAdvice({ id: 'kb-plan-01', title: '分散练习' });
    memory.recordAdvice({ id: 'kb-plan-02', title: '转介通道' });
    assert(memory.memoryOverview().advice.length === 2, 'two advice expected');
    memory.removeMemory('advice', 'kb-plan-01');
    const rest = memory.memoryOverview().advice;
    assert(rest.length === 1 && rest[0].id === 'kb-plan-02', 'only kb-plan-01 should be removed');
  });

  test('删除：按类型移除单条消息，其余保持顺序', () => {
    memory.clearAllMemory();
    storage.addMessage({ id: 'm1', role: 'user', content: '为什么联想记忆低' });
    storage.addMessage({ id: 'm2', role: 'assistant', content: '模板回答' });
    storage.addMessage({ id: 'm3', role: 'user', content: '怎么练' });
    memory.removeMemory('message', 'm2');
    const messages = memory.memoryOverview().messages;
    assert(messages.length === 2, `expected 2 messages, got ${messages.length}`);
    assert(messages[0].id === 'm1' && messages[1].id === 'm3', 'order should be preserved');
  });

  test('消息：只保留最近 20 条', () => {
    memory.clearAllMemory();
    for (let index = 0; index < 25; index += 1) {
      storage.addMessage({ id: `m${index}`, role: 'user', content: `第 ${index} 条` });
    }
    const messages = memory.memoryOverview().messages;
    assert(messages.length === storage.MAX_MESSAGES, `expected 20, got ${messages.length}`);
    assert(messages[0].id === 'm5', 'oldest messages should be dropped');
  });

  test('汇总：用量统计', () => {
    memory.clearAllMemory();
    memory.saveSummary({ scores: { am: 3 } });
    memory.recordAdvice({ id: 'KB-X' });
    const view = memory.memoryOverview();
    assert(view.usage.used === 2, `used should be 2, got ${view.usage.used}`);
    assert(view.usage.maxMessages === 20, 'max messages should be 20');
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
  console.log(`\n${passed}/${tests.length} memory checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
