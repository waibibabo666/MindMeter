#!/usr/bin/env node
/**
 * L-03 本地存储层测试（无浏览器、无依赖）。
 *
 * 覆盖：
 *   - schemaVersion / 四类 key
 *   - sessions 读写与上限
 *   - draft 24h 过期
 *   - memory 最近 20 条
 *   - 导出不含 LLM Key
 *   - 损坏 JSON / 版本不匹配回退
 *   - clearAllData
 *   - localStorage 不可用时的内存降级
 */

'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const SRC = path.resolve(__dirname, '..', 'code', 'frontend', 'src');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

function fakeStorage() {
  const data = new Map();
  return {
    data,
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

async function main() {
  const storage = await import(pathToFileURL(path.join(SRC, 'storage.js')).href);

  const reset = () => {
    const fake = fakeStorage();
    storage.__setStorageForTests(fake);
    return fake;
  };

  test('四类 key + schemaVersion + settings 读写', () => {
    const fake = reset();
    for (const name of ['app', 'sessions', 'draft', 'settings', 'memory']) {
      assert(typeof storage.KEYS[name] === 'string', `missing key ${name}`);
    }
    assert(storage.SCHEMA_VERSION === 1, 'schemaVersion must be 1');

    const ok = storage.writeSettings({
      endpoint: 'https://api.example.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-test-secret',
      enabled: true,
    });
    assert(ok === true, 'writeSettings failed');
    const settings = storage.readSettings();
    assert(settings.endpoint === 'https://api.example.com/v1', 'endpoint lost');
    assert(settings.model === 'deepseek-chat', 'model lost');
    assert(settings.enabled === true, 'enabled lost');
    assert(settings.schemaVersion === 1, 'schemaVersion not persisted');

    const raw = JSON.parse(fake.getItem(storage.KEYS.settings));
    assert(raw.schemaVersion === 1, 'raw settings missing schemaVersion');
    storage.clearSettings();
    assert(fake.getItem(storage.KEYS.settings) === null, 'clearSettings failed');
  });

  test('sessions 写入、排序、上限与清除', () => {
    const fake = reset();
    assert(storage.readSessions().sessions.length === 0, 'default sessions not empty');
    storage.addSession({ id: 's1', tier: 'standard', results: {} });
    storage.addSession({ id: 's2', tier: 'standard', results: { vc: {} } });
    const sessions = storage.readSessions().sessions;
    assert(sessions.length === 2, 'sessions count wrong');
    assert(sessions[0].id === 's2', 'newest session should be first');
    assert(storage.readSessions().schemaVersion === 1, 'sessions schemaVersion missing');

    for (let i = 0; i < storage.MAX_SESSIONS + 5; i += 1) {
      storage.addSession({ id: `bulk-${i}` });
    }
    assert(
      storage.readSessions().sessions.length === storage.MAX_SESSIONS,
      'sessions max not enforced',
    );
    storage.clearSessions();
    assert(fake.getItem(storage.KEYS.sessions) === null, 'clearSessions failed');
  });

  test('draft 保存、读取、24h 过期', () => {
    const fake = reset();
    assert(storage.readDraft() === null, 'default draft should be null');
    storage.saveDraft({ tier: 'standard', order: ['vc'], cursor: 1, results: {} });
    const draft = storage.readDraft();
    assert(draft && draft.tier === 'standard', 'draft roundtrip failed');
    assert(typeof draft.updatedAt === 'number', 'draft updatedAt missing');

    const expired = Object.assign({}, draft, {
      schemaVersion: 1,
      updatedAt: Date.now() - storage.DRAFT_TTL_MS - 1,
    });
    fake.setItem(storage.KEYS.draft, JSON.stringify(expired));
    assert(storage.readDraft() === null, 'expired draft should be null');
    assert(fake.getItem(storage.KEYS.draft) === null, 'expired draft should be removed');
  });

  test('memory 最近 20 条 + profile/summaries/advice', () => {
    reset();
    storage.writeMemory({ profile: { note: 'x' }, summaries: ['s1'], advice: ['a1'] });
    for (let i = 0; i < 25; i += 1) storage.addMessage({ role: 'user', text: `m${i}` });
    const memory = storage.readMemory();
    assert(memory.messages.length === storage.MAX_MESSAGES, 'messages cap not enforced');
    assert(memory.messages[0].text === 'm5', 'oldest messages not dropped');
    assert(memory.messages[19].text === 'm24', 'newest message lost');
    assert(memory.profile.note === 'x', 'profile lost');
    assert(memory.summaries.length === 1, 'summaries lost');
    assert(memory.advice.length === 1, 'advice lost');
    storage.clearMemory();
    assert(storage.readMemory().messages.length === 0, 'clearMemory failed');
  });

  test('exportData 不含 LLM Key', () => {
    const fake = reset();
    storage.writeSettings({
      endpoint: 'https://api.example.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-must-not-export',
      enabled: true,
    });
    storage.addSession({ id: 's1', tier: 'standard' });
    storage.saveDraft({ tier: 'standard', order: ['vc'] });
    storage.addMessage({ role: 'assistant', text: 'hi' });
    fake.setItem(storage.KEYS.app, JSON.stringify({ version: 1, route: '/task/vc' }));

    const data = storage.exportData();
    const text = JSON.stringify(data);
    assert(text.indexOf('sk-must-not-export') === -1, 'apiKey leaked in export');
    assert(!Object.prototype.hasOwnProperty.call(data.settings, 'apiKey'), 'apiKey field exists');
    assert(data.settings.endpoint === 'https://api.example.com/v1', 'safe settings missing');
    assert(data.sessions.length === 1, 'sessions missing in export');
    assert(data.draft && data.draft.tier === 'standard', 'draft missing in export');
    assert(data.app && data.app.route === '/task/vc', 'app snapshot missing in export');
    assert(data.schemaVersion === 1, 'export schemaVersion missing');
  });

  test('损坏 JSON / 版本不匹配回退默认值', () => {
    const fake = reset();
    fake.setItem(storage.KEYS.sessions, '{not json');
    assert(storage.readSessions().sessions.length === 0, 'corrupt sessions not fallback');
    assert(fake.getItem(storage.KEYS.sessions) === null, 'corrupt sessions not removed');

    fake.setItem(storage.KEYS.settings, JSON.stringify({ schemaVersion: 999, endpoint: 'x' }));
    assert(storage.readSettings().endpoint === '', 'version mismatch not fallback');
    assert(fake.getItem(storage.KEYS.settings) === null, 'version mismatch not removed');
  });

  test('clearAllData 清除全部 key', () => {
    const fake = reset();
    storage.writeSettings({ apiKey: 'sk-x' });
    storage.addSession({ id: 's1' });
    storage.saveDraft({ tier: 'standard' });
    storage.addMessage({ role: 'user', text: 'hi' });
    fake.setItem(storage.KEYS.app, JSON.stringify({ version: 1, route: '/' }));

    storage.clearAllData();
    for (const key of storage.ALL_KEYS) {
      assert(fake.getItem(key) === null, `key not cleared: ${key}`);
    }
    assert(storage.readSettings().apiKey === '', 'settings not reset after clear');
    assert(storage.readSessions().sessions.length === 0, 'sessions not reset after clear');
  });

  test('localStorage 不可用时内存降级', () => {
    storage.__setStorageForTests(null);
    assert(
      storage.writeSettings({ endpoint: 'memory://' }) === true,
      'memory fallback write failed',
    );
    assert(storage.readSettings().endpoint === 'memory://', 'memory fallback read failed');
    storage.clearAllData();
    assert(storage.readSettings().endpoint === '', 'memory fallback clear failed');
  });

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
  console.log(`\n${passed}/${tests.length} storage checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
