#!/usr/bin/env node
/**
 * 诊断日志模块测试（无浏览器）。
 *
 * 覆盖：级别、环形上限、脱敏、循环引用、导出、清除。
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

async function main() {
  const logger = await import(pathToFileURL(path.join(SRC, 'log.js')).href);

  test('级别与环形上限：只保留最近 200 条', () => {
    logger.clearLogs();
    for (let i = 0; i < 205; i += 1) logger.log('info', `e${i}`);
    const logs = logger.getLogs();
    assert(logs.length === logger.MAX_LOGS, `应为 200 条，实际 ${logs.length}`);
    assert(logs[0].event === 'e5', '最旧条目不对');
    assert(logs[199].event === 'e204', '最新条目不对');
    assert(logs[0].level === 'info', '级别丢失');
    assert(!Number.isNaN(Date.parse(logs[0].at)), 'at 不是有效时间');
    logger.log('bogus', 'fallback');
    assert(logger.getLogs().at(-1).level === 'info', '未知级别应回退 info');
  });

  test('脱敏：apiKey / Authorization / Bearer / sk-*', () => {
    logger.clearLogs();
    const githubToken = ['gh', 'p_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('');
    logger.log('error', '调用失败', {
      apiKey: 'sk-secret-12345678',
      headers: { Authorization: 'Bearer abcdefghijklmnop' },
      note: '响应里出现了 sk-abcdefghijkl',
      token: githubToken,
    });
    const text = JSON.stringify(logger.getLogs());
    assert(!text.includes('sk-secret-12345678'), 'apiKey 未脱敏');
    assert(!text.includes('abcdefghijklmnop'), 'Bearer 未脱敏');
    assert(!text.includes('sk-abcdefghijkl'), '字符串里的 sk-* 未脱敏');
    assert(!text.includes(githubToken), 'GitHub token 未脱敏');
    assert(text.includes('[redacted]'), '缺少脱敏标记');
  });

  test('循环引用、Error 与超长字段不抛错', () => {
    logger.clearLogs();
    const circular = { name: 'loop' };
    circular.self = circular;
    const error = Object.assign(new Error('boom'), { code: 'E_BOOM', status: 500 });
    error.apiKey = 'sk-should-not-appear';
    logger.log('warn', '异常', circular, error, 'x'.repeat(900));

    const entry = logger.getLogs().at(-1);
    const text = JSON.stringify(entry);
    assert(text.includes('[circular]'), '循环引用未标记');
    assert(text.includes('E_BOOM'), 'Error code 丢失');
    assert(!text.includes('sk-should-not-appear'), 'Error 上的 apiKey 未脱敏');
    assert(entry.args[2].length === 500, '超长字符串应截断到 500');
  });

  test('exportLogs 结构正确且不含敏感值', () => {
    logger.clearLogs();
    logger.log('info', '导出测试', { apiKey: 'sk-export-secret' });
    const data = logger.exportLogs();
    assert(data.schemaVersion === 1, 'schemaVersion 缺失');
    assert(typeof data.exportedAt === 'string', 'exportedAt 缺失');
    assert(data.count === 1 && data.logs.length === 1, 'count/logs 不一致');
    assert(!JSON.stringify(data).includes('sk-export-secret'), '导出泄露 apiKey');
  });

  test('clearLogs 清空缓冲', () => {
    logger.log('info', 'before clear');
    logger.clearLogs();
    assert(logger.getLogs().length === 0, 'clearLogs 未清空');
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
  console.log(`\n${passed}/${tests.length} log checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
