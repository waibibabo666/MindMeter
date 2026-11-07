/**
 * OpenAI 兼容接口的最小客户端（BYOK）。
 *
 * 设计约束（L-04）：
 *   - Key 只进 Authorization 头，永不进 URL / 查询参数；
 *   - 所有外部失败都收敛成有限错误码，由上层决定降级；
 *   - 错误信息里不得出现 Key 原文；
 *   - 超时用 AbortController，避免请求悬挂。
 */

export const DEFAULT_TIMEOUT_MS = 20000;

export class LlmError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = typeof status === 'number' ? status : null;
  }
}

export function isConfigured(settings) {
  if (!settings) return false;
  return Boolean(settings.endpoint && settings.model && settings.apiKey);
}

/** 把用户填的基址补成 /chat/completions；已是完整地址则原样保留。 */
export function normalizeEndpoint(endpoint) {
  const value = String(endpoint || '').trim();
  if (!value) return '';
  const trimmed = value.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

export function buildRequest(settings, messages, options = {}) {
  const url = normalizeEndpoint(settings.endpoint);
  const body = {
    model: settings.model,
    messages,
    temperature: typeof options.temperature === 'number' ? options.temperature : 0.2,
    max_tokens: typeof options.maxTokens === 'number' ? options.maxTokens : 600,
    stream: false,
  };
  return {
    url,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    },
  };
}

/**
 * 调用模型。成功返回 { text, model }；失败一律抛 LlmError。
 */
export async function callLlm(options = {}) {
  const { settings, messages, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl } = options;

  if (!isConfigured(settings)) {
    throw new LlmError('not_configured', '未配置 endpoint / model / key');
  }

  const doFetch = fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch : null);
  if (!doFetch) {
    throw new LlmError('unsupported', '当前环境不支持 fetch');
  }

  const { url, init } = buildRequest(settings, messages, options);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;

  try {
    if (controller) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
      init.signal = controller.signal;
    }

    let response;
    try {
      response = await doFetch(url, init);
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new LlmError('timeout', `请求超过 ${timeoutMs}ms 未返回`);
      }
      // 浏览器不会把 CORS 细节暴露给脚本，只能给出可操作的统一提示。
      throw new LlmError('network_cors', '网络请求失败：可能是 CORS 未放行或网络不可达');
    }

    if (response.status === 401 || response.status === 403) {
      throw new LlmError('auth', '鉴权失败：Key 无效或没有该模型权限', response.status);
    }
    if (response.status === 429) {
      throw new LlmError('rate_limit', '触发限流：请稍后再试', response.status);
    }
    if (!response.ok) {
      throw new LlmError('http', `服务返回 ${response.status}`, response.status);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new LlmError('bad_response', '响应不是合法 JSON');
    }

    const content =
      data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : null;
    if (typeof content !== 'string' || !content.trim()) {
      throw new LlmError('bad_response', '响应缺少 choices[0].message.content');
    }

    return { text: content.trim(), model: data.model || settings.model };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 把 Key 变成 sk-…c3f9 形式，用于界面回显与日志占位。 */
export function maskKey(key) {
  const value = String(key || '');
  if (value.length <= 8) return value ? '已保存' : '';
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

/** 兜底：万一上游错误信息里带了 Key，也要抹掉。 */
export function redact(text, key) {
  const value = String(key || '');
  if (!value || value.length < 8) return String(text || '');
  return String(text || '')
    .split(value)
    .join('[redacted]');
}
