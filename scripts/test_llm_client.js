#!/usr/bin/env node
/**
 * L-04：BYOK 客户端与降级路径的检查（无网络、无浏览器）。
 *
 * 覆盖：
 *   - 未配置 / 401 / 5xx / 超时 / 网络或 CORS / 响应格式异常 → 有限错误码
 *   - Key 只出现在 Authorization 头，不进入 URL
 *   - 任何异常都回退模板，且模板不空
 *   - 前端源码不含 console 输出（避免把 Key 打到控制台）
 *
 * 用法：node scripts/test_llm_client.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'code', 'frontend', 'src');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

// 运行时拼一个假 Key，避免被仓库的 secret 扫描误判为真实凭据。
const FAKE_KEY = ['sk', 'test', '0123456789', 'abcdef'].join('-');

const SETTINGS = {
  enabled: true,
  endpoint: 'https://api.example.com/v1',
  model: 'demo-model',
  apiKey: FAKE_KEY,
};

const MESSAGES = [{ role: 'user', content: 'ping' }];

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function okResponse(text) {
  return jsonResponse(200, { model: 'demo-model', choices: [{ message: { content: text } }] });
}

async function expectCode(promise, code) {
  try {
    await promise;
  } catch (error) {
    assert(error && error.code === code, `期望错误码 ${code}，实际 ${error && error.code}`);
    return error;
  }
  throw new Error(`期望抛出 ${code}，但请求成功了`);
}

async function main() {
  const client = await import(pathToFileURL(path.join(SRC, 'llm', 'client.js')).href);
  const degrade = await import(pathToFileURL(path.join(SRC, 'llm', 'degrade.js')).href);
  const storage = await import(pathToFileURL(path.join(SRC, 'storage.js')).href);

  test('normalizeEndpoint 补齐 /chat/completions', () => {
    assert(
      client.normalizeEndpoint('https://api.example.com/v1') ===
        'https://api.example.com/v1/chat/completions',
      'v1 基址应补全',
    );
    assert(
      client.normalizeEndpoint('https://api.example.com/v1/chat/completions/') ===
        'https://api.example.com/v1/chat/completions',
      '完整地址应去掉尾部斜杠',
    );
    assert(client.normalizeEndpoint('') === '', '空值应返回空串');
  });

  test('Key 只在 Authorization 头，不进 URL 与 body', () => {
    const { url, init } = client.buildRequest(SETTINGS, MESSAGES);
    assert(!url.includes(SETTINGS.apiKey), 'URL 不得包含 Key');
    assert(!String(init.body).includes(SETTINGS.apiKey), 'body 不得包含 Key');
    assert(init.headers.Authorization === `Bearer ${SETTINGS.apiKey}`, 'Authorization 头缺失');
    assert(url.endsWith('/chat/completions'), 'URL 未补全');
  });

  test('未配置时直接给出 not_configured', async () => {
    await expectCode(
      client.callLlm({ settings: { endpoint: '', model: '', apiKey: '' }, messages: MESSAGES }),
      'not_configured',
    );
    assert(client.isConfigured(SETTINGS), 'isConfigured 应识别完整配置');
    assert(!client.isConfigured({ endpoint: 'x', model: '', apiKey: 'y' }), '缺一项即未配置');
  });

  test('成功路径返回文本', async () => {
    const result = await client.callLlm({
      settings: SETTINGS,
      messages: MESSAGES,
      fetchImpl: async () => okResponse('这是一段解读'),
    });
    assert(result.text === '这是一段解读', '文本解析错误');
  });

  test('401 / 403 → auth', async () => {
    await expectCode(
      client.callLlm({
        settings: SETTINGS,
        messages: MESSAGES,
        fetchImpl: async () => jsonResponse(401, {}),
      }),
      'auth',
    );
    await expectCode(
      client.callLlm({
        settings: SETTINGS,
        messages: MESSAGES,
        fetchImpl: async () => jsonResponse(403, {}),
      }),
      'auth',
    );
  });

  test('429 → rate_limit，5xx → http', async () => {
    await expectCode(
      client.callLlm({
        settings: SETTINGS,
        messages: MESSAGES,
        fetchImpl: async () => jsonResponse(429, {}),
      }),
      'rate_limit',
    );
    await expectCode(
      client.callLlm({
        settings: SETTINGS,
        messages: MESSAGES,
        fetchImpl: async () => jsonResponse(500, {}),
      }),
      'http',
    );
  });

  test('fetch 抛 TypeError → network_cors', async () => {
    const error = await expectCode(
      client.callLlm({
        settings: SETTINGS,
        messages: MESSAGES,
        fetchImpl: async () => {
          throw new TypeError('Failed to fetch');
        },
      }),
      'network_cors',
    );
    assert(/CORS/.test(error.message), '提示里应提到 CORS');
  });

  test('超时：真实 AbortController 生效', async () => {
    const hanging = (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    await expectCode(
      client.callLlm({ settings: SETTINGS, messages: MESSAGES, timeoutMs: 30, fetchImpl: hanging }),
      'timeout',
    );
  });

  test('响应不是 JSON / 缺少 content → bad_response', async () => {
    await expectCode(
      client.callLlm({
        settings: SETTINGS,
        messages: MESSAGES,
        fetchImpl: async () => ({
          status: 200,
          ok: true,
          json: async () => {
            throw new Error('bad json');
          },
        }),
      }),
      'bad_response',
    );
    await expectCode(
      client.callLlm({
        settings: SETTINGS,
        messages: MESSAGES,
        fetchImpl: async () => okResponse('   '),
      }),
      'bad_response',
    );
  });

  test('错误信息不含 Key 原文', async () => {
    const error = await expectCode(
      client.callLlm({
        settings: SETTINGS,
        messages: MESSAGES,
        fetchImpl: async () => jsonResponse(400, {}),
      }),
      'http',
    );
    assert(!error.message.includes(SETTINGS.apiKey), '错误信息泄露了 Key');
    assert(
      client.redact(`key=${SETTINGS.apiKey}`, SETTINGS.apiKey) === 'key=[redacted]',
      'redact 失效',
    );
  });

  test('maskKey 只露出首尾', () => {
    const masked = client.maskKey(SETTINGS.apiKey);
    assert(masked.startsWith('sk-'), '保留前缀');
    assert(masked.includes('…'), '应使用省略号');
    assert(!masked.includes('0123456789'), '中间不得泄露');
  });

  test('未配置 / 关闭 / 调用失败都回退模板', async () => {
    const metrics = { vc: { correct: 5, total: 6 } };

    const noConfig = await degrade.explain({ metrics, settings: {} });
    assert(noConfig.source === 'template', '未配置应走模板');
    assert(noConfig.text.includes('言语理解'), '模板应包含指标');

    const disabled = await degrade.explain({ metrics, settings: { ...SETTINGS, enabled: false } });
    assert(disabled.source === 'template', '关闭时应走模板');

    const timeout = await degrade.explain({
      metrics,
      settings: SETTINGS,
      call: async () => {
        const error = new Error('timeout');
        error.code = 'timeout';
        throw error;
      },
    });
    assert(timeout.source === 'template', '超时应走模板');
    assert(timeout.code === 'timeout', '保留错误码');
    assert(timeout.reason.includes('超时'), '给出可读原因');
    assert(timeout.text.length > 0, '模板不能为空');
  });

  test('模型可用时走 llm，空文本视为失败', async () => {
    const metrics = { vc: { correct: 5, total: 6 } };
    const ok = await degrade.explain({
      metrics,
      settings: SETTINGS,
      call: async () => ({ text: '模型给出的解读' }),
    });
    assert(ok.source === 'llm', '应走模型');
    assert(ok.text === '模型给出的解读', '文本应透传');

    const empty = await degrade.explain({
      metrics,
      settings: SETTINGS,
      call: async () => ({ text: ' ' }),
    });
    assert(empty.source === 'template', '空文本应回退模板');
  });

  test('模板解读不含诊断与总分表述', () => {
    const text = degrade.templateExplanation({ ps: { trials: 20, correct: 18, seconds: 45 } });
    for (const banned of ['诊断', '总分', '百分位', '治疗']) {
      assert(!text.includes(banned), `模板不应出现「${banned}」`);
    }
    assert(degrade.templateExplanation({}).length > 0, '空指标也要有说明');
  });

  test('设置默认关闭，Key 可写入但不进导出', () => {
    const fake = {
      data: new Map(),
      getItem(k) {
        return this.data.has(k) ? this.data.get(k) : null;
      },
      setItem(k, v) {
        this.data.set(k, String(v));
      },
      removeItem(k) {
        this.data.delete(k);
      },
    };
    storage.__setStorageForTests(fake);

    const def = storage.readSettings();
    assert(def.enabled === false, '默认应关闭');
    assert(def.apiKey === '', '默认不应有 Key');

    storage.writeSettings({
      enabled: true,
      endpoint: SETTINGS.endpoint,
      model: SETTINGS.model,
      apiKey: FAKE_KEY,
    });
    const saved = storage.readSettings();
    assert(saved.apiKey === FAKE_KEY, 'Key 应已写入本机');
    assert(saved.enabled === true, '开关应已保存');

    const exported = JSON.stringify(storage.exportData());
    assert(!exported.includes(FAKE_KEY), '导出不得包含 Key');

    storage.clearSettings();
    assert(storage.readSettings().apiKey === '', '清除后不应残留 Key');
    storage.__setStorageForTests(null);
  });

  test('前端源码不打日志', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) {
          const text = fs.readFileSync(full, 'utf8');
          if (/console\.(log|info|warn|error|debug)\s*\(/.test(text)) {
            offenders.push(path.relative(ROOT, full));
          }
        }
      }
    };
    walk(SRC);
    assert(offenders.length === 0, `这些文件有 console 输出：${offenders.join(', ')}`);
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
  console.log(`\n${passed}/${tests.length} BYOK checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
