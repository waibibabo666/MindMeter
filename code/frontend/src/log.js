/**
 * 统一诊断日志。
 *
 * 约束：
 *   - 只写内存环形缓冲，不写 console（避免 Key 被浏览器日志采集）；
 *   - 最多保留 200 条；刷新页面后清空；
 *   - 入库前脱敏：apiKey / Authorization / Bearer / sk-* / token；
 *   - 设置页可导出 JSON、清除日志；导出内容同样经过脱敏。
 */

export const MAX_LOGS = 200;
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

const SECRET_KEY = /^(api[-_]?key|authorization|password|token|secret|key)$/i;
const SECRET_VALUE =
  /\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{8,})\b/g;

function redactString(value) {
  return String(value).replace(SECRET_VALUE, '[redacted]').slice(0, 500);
}

function safeError(value) {
  return {
    name: redactString(value.name || 'Error'),
    message: redactString(value.message || ''),
    code: value.code ? redactString(value.code) : undefined,
    status: typeof value.status === 'number' ? value.status : undefined,
  };
}

function safeObject(value, depth, seen) {
  if (depth >= 3) return '[object]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitize(item, depth + 1, seen));
  }
  if (value instanceof Error) return safeError(value);

  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : sanitize(item, depth + 1, seen);
  }
  return out;
}

export function sanitize(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  return safeObject(value, depth, seen);
}

function buffer() {
  if (!Array.isArray(globalThis.__MM_LOG__)) globalThis.__MM_LOG__ = [];
  return globalThis.__MM_LOG__;
}

export function log(level, event, ...args) {
  const safeLevel = LOG_LEVELS.includes(level) ? level : 'info';
  const entry = {
    at: new Date().toISOString(),
    level: safeLevel,
    event: redactString(event || ''),
    args: args.slice(0, 5).map((value) => sanitize(value)),
  };
  const list = buffer();
  list.push(entry);
  if (list.length > MAX_LOGS) list.splice(0, list.length - MAX_LOGS);
  return entry;
}

export function getLogs() {
  return buffer().slice();
}

export function clearLogs() {
  globalThis.__MM_LOG__ = [];
}

export function exportLogs() {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    count: buffer().length,
    logs: getLogs(),
  };
}
