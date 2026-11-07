#!/usr/bin/env node
/**
 * 错误处理检查（L-01 增强）。
 *
 * 覆盖：
 *   - 错误分类：LLM / 存储 / 计分 / 未知
 *   - 错误文案：已知码返回专属文案，未知码回退通用
 *   - 渲染兜底：正常返回、异常走 fallback、上报回调被调用
 *   - 静态约定：app.js 注册全局兜底、路由经 safeRender、不再引用临时计分模块
 *
 * 用法：node scripts/test_errors.js
 */
'use strict';

const path = require('path');
const url = require('url');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'code', 'frontend', 'src');
const href = (p) => url.pathToFileURL(p).href;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label}：期望 ${expected}，实际 ${actual}`);
};
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

function readSrc(rel) {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

async function main() {
  const errors = await import(href(path.join(SRC, 'errors.js')));
  const { ERROR_CODES, classifyError, describeError, reportError, safeRender } = errors;

  // ---------- 分类 ----------

  test('分类：LLM 的四种错误码', () => {
    eq(classifyError({ code: 'timeout' }), ERROR_CODES.LLM_TIMEOUT, 'timeout');
    eq(classifyError({ code: 'network' }), ERROR_CODES.LLM_NETWORK, 'network');
    eq(classifyError({ code: 'auth' }), ERROR_CODES.LLM_AUTH, 'auth');
    eq(classifyError({ code: 'http_429' }), ERROR_CODES.LLM_HTTP, 'http_429');
  });

  test('分类：存储配额与不可用', () => {
    eq(classifyError({ name: 'QuotaExceededError' }), ERROR_CODES.STORAGE_QUOTA, 'name 判定');
    eq(classifyError({ message: 'quota exceeded' }), ERROR_CODES.STORAGE_QUOTA, 'message 判定');
    eq(
      classifyError({ message: 'localStorage is denied' }),
      ERROR_CODES.STORAGE_UNAVAILABLE,
      'storage denied',
    );
  });

  test('分类：计分失败与未知异常', () => {
    eq(classifyError({ code: 'scoring' }), ERROR_CODES.SCORING_FAILED, 'scoring');
    eq(classifyError({}), ERROR_CODES.UNKNOWN, '空对象');
    eq(classifyError(null), ERROR_CODES.UNKNOWN, 'null');
    eq(classifyError('随便一个字符串'), ERROR_CODES.UNKNOWN, '字符串');
  });

  // ---------- 文案 ----------

  test('文案：每个错误码都有标题与建议，且不含技术细节', () => {
    for (const code of Object.values(ERROR_CODES)) {
      const { title, hint } = describeError(code);
      assert(title && title.length >= 4, `${code} 缺标题`);
      assert(hint && hint.length >= 10, `${code} 缺建议`);
      assert(!/Error|undefined|null|\[object/.test(title + hint), `${code} 暴露了技术细节`);
    }
  });

  test('文案：未知码回退到通用文案', () => {
    const fallback = describeError('not_a_real_code');
    eq(fallback.title, describeError(ERROR_CODES.UNKNOWN).title, '回退标题');
  });

  // ---------- 上报 ----------

  test('上报：写入 sink 并返回错误码', () => {
    const calls = [];
    const sink = { warn: (...args) => calls.push(args) };
    const code = reportError({ code: 'timeout', message: '超时了' }, 'test', sink);
    eq(code, ERROR_CODES.LLM_TIMEOUT, '返回码');
    eq(calls.length, 1, '调用次数');
    assert(String(calls[0][0]).includes('test'), '日志应带上下文');
  });

  test('上报：sink 缺失时不抛异常', () => {
    reportError({ code: 'timeout' }, 'ctx', null);
  });

  // ---------- 渲染兜底 ----------

  test('兜底：渲染正常时原样返回', () => {
    let fallbackCalled = false;
    const result = safeRender(() => 'ok', {
      root: {},
      ctx: {},
      fallback: () => {
        fallbackCalled = true;
        return 'fallback';
      },
    });
    eq(result, 'ok', '返回值');
    assert(!fallbackCalled, '不应走兜底');
  });

  test('兜底：渲染抛错时走 fallback 并上报', () => {
    const seen = [];
    const result = safeRender(
      () => {
        throw new Error('boom');
      },
      {
        root: {},
        ctx: {},
        fallback: (root, ctx, error) => `caught:${error.message}`,
        onError: (error) => seen.push(error.message),
      },
    );
    eq(result, 'caught:boom', 'fallback 返回值');
    eq(seen.length, 1, 'onError 调用次数');
  });

  test('兜底：没有 fallback 时不抛错', () => {
    const result = safeRender(
      () => {
        throw new Error('boom');
      },
      { root: {}, ctx: {} },
    );
    eq(result, undefined, '返回值');
  });

  // ---------- 静态约定 ----------

  test('静态：app.js 注册了全局兜底', () => {
    const app = readSrc('app.js');
    assert(app.includes("addEventListener('error'"), '缺少 window error 监听');
    assert(app.includes("addEventListener('unhandledrejection'"), '缺少 unhandledrejection 监听');
  });

  test('静态：路由渲染经过 safeRender，并有错误页', () => {
    const app = readSrc('app.js');
    assert(app.includes('safeRender('), '路由未使用 safeRender');
    assert(app.includes('renderErrorPage'), '未挂载错误页');
    assert(fs.existsSync(path.join(SRC, 'pages', 'error.js')), '缺少 pages/error.js');
  });

  test('静态：计分统一走 scoring/index.js，不再引用 local.js', () => {
    const app = readSrc('app.js');
    const report = readSrc('pages/report.js');
    assert(app.includes("from './scoring/index.js'"), 'app.js 未使用统一计分');
    assert(report.includes("from '../scoring/index.js'"), 'report.js 未使用统一计分');
    assert(!app.includes('scoring/local.js'), 'app.js 仍在引用临时计分模块');
  });

  test('静态：计分失败不阻断交卷', () => {
    const app = readSrc('app.js');
    assert(app.includes('safeScores'), 'finishTask 未包计分兜底');
    assert(!app.includes('scoreSession(state.results).scores'), '仍有一处裸调用');
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
  console.log(`\n${passed}/${tests.length} error handling checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
