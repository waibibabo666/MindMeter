/**
 * Same-origin API client for the hosted web app.
 *
 * Auth is an HttpOnly, SameSite=Lax session cookie owned by the server, so
 * JavaScript holds no credential at all: `credentials: 'same-origin'` carries
 * it, and a 401 on any non-auth endpoint means the session expired — we
 * broadcast that once and app.js routes back to the login page.
 *
 * There is deliberately no bearer/launch token here, no injected boot object
 * and no desktop-shell path: the desktop build was retired (docs/adr/0003), and
 * `scripts/test_app_shell.js` fails the build if any of them comes back.
 */

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status || null;
  }
}

export const UNAUTHENTICATED = 'mm:unauthenticated';

let boot = { apiBase: '/api/v1' };

export function configure(next) {
  boot = Object.assign({}, boot, next || {});
  if (!boot.apiBase) boot.apiBase = '/api/v1';
}

export function getBootConfig() {
  return { ...boot };
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
    (payload && (payload.message || payload.detail)) || `站点服务返回 ${response.status}`,
    response.status,
  );
}

function normalizeError(error) {
  if (error && error.name === 'AbortError') {
    return new ApiError('timeout', '请求超时，请稍后重试');
  }
  if (error instanceof ApiError) return error;
  return new ApiError('network', '无法连接到站点');
}

function announce401(path) {
  if (path.startsWith('/auth/')) return;
  if (typeof globalThis.dispatchEvent === 'function' && globalThis.CustomEvent) {
    globalThis.dispatchEvent(new globalThis.CustomEvent(UNAUTHENTICATED, { detail: { path } }));
    return;
  }
  const target = globalThis.document;
  if (target && target.dispatchEvent) {
    target.dispatchEvent(new Event(UNAUTHENTICATED));
  }
}

async function request(path, options = {}) {
  const { method = 'GET', body, timeoutMs = 30000 } = options;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(`${boot.apiBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: controller ? controller.signal : undefined,
    });
    if (response.status === 401) announce401(path);
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
  post: (path, body, options) =>
    request(path, { ...options, method: 'POST', body: body === undefined ? {} : body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  del: (path, body, options) => request(path, { ...options, method: 'DELETE', body }),
  request,
};
