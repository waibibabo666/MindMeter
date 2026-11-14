/**
 * Local API client.
 *
 * The renderer never receives or stores the LLM key. It only holds the
 * per-launch local API token in memory.
 */

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status || null;
  }
}

let boot = { apiBase: '/api/v1', token: '' };

export function configure(next) {
  boot = Object.assign({}, boot, next || {});
}

export function getBootConfig() {
  return { ...boot };
}

function bridgeReady() {
  if (globalThis.__MM_BOOT__) return Promise.resolve(globalThis.__MM_BOOT__);
  if (globalThis.pywebview && globalThis.pywebview.api && globalThis.pywebview.api.get_boot) {
    return globalThis.pywebview.api.get_boot();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      globalThis.removeEventListener('pywebviewready', onReady);
      reject(new ApiError('bridge_unavailable', '本地桌面桥未就绪'));
    }, 8000);
    const onReady = async () => {
      clearTimeout(timer);
      try {
        resolve(await globalThis.pywebview.api.get_boot());
      } catch (error) {
        reject(error);
      }
    };
    globalThis.addEventListener('pywebviewready', onReady, { once: true });
  });
}

export async function loadBoot() {
  const value = await bridgeReady();
  configure(value);
  return getBootConfig();
}

async function readPayload(response) {
  try {
    return await response.json();
  } catch (error) {
    // A non-JSON body is still an HTTP error; the status decides below.
    return null;
  }
}

function assertOk(response, payload) {
  if (response.ok) return;
  throw new ApiError(
    (payload && (payload.error || payload.detail)) || `http_${response.status}`,
    (payload && (payload.message || payload.error)) || `本地服务返回 ${response.status}`,
    response.status,
  );
}

function normalizeError(error) {
  if (error && error.name === 'AbortError') {
    return new ApiError('timeout', '本地服务请求超时');
  }
  if (error instanceof ApiError) return error;
  return new ApiError('network', '本地服务不可达');
}

async function request(path, options = {}) {
  const { method = 'GET', body, timeoutMs = 30000 } = options;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const headers = { 'X-MM-Token': boot.token };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(`${boot.apiBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    });
    const payload = await readPayload(response);
    assertOk(response, payload);
    return payload;
  } catch (error) {
    throw normalizeError(error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  del: (path, options) => request(path, { ...options, method: 'DELETE' }),
  request,
};
