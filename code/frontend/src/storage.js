/**
 * L-03 本地存储层。
 *
 * 四类业务数据各自一个 key，每条记录都带 schemaVersion：
 *   - mindmeter.sessions.v1  已完成测评（原始指标/可选分数）
 *   - mindmeter.draft.v1     进行中的测评（24h 过期）
 *   - mindmeter.settings.v1  LLM API 配置（Key 只在本机）
 *   - mindmeter.memory.v1    画像/摘要/建议/最近 20 条消息
 *
 * 设计约束：
 *   - localStorage 不可用（隐私模式/配额满）时退化为内存 Map，页面仍能走；
 *   - 损坏 JSON / 版本不匹配 → 删除该 key，回退默认值，不抛错；
 *   - exportData() 永远不会带出 LLM Key；
 *   - clearAllData() 连同 L-01 的 app shell 状态一起清掉。
 */

export const SCHEMA_VERSION = 1;
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_MESSAGES = 20;
export const MAX_SESSIONS = 50;

export const KEYS = Object.freeze({
  app: 'mindmeter.app.shell.v1',
  sessions: 'mindmeter.sessions.v1',
  draft: 'mindmeter.draft.v1',
  settings: 'mindmeter.settings.v1',
  memory: 'mindmeter.memory.v1',
});

export const ALL_KEYS = Object.freeze(Object.values(KEYS));

export function defaultSessions() {
  return { schemaVersion: SCHEMA_VERSION, sessions: [] };
}

export function defaultDraft() {
  return {
    schemaVersion: SCHEMA_VERSION,
    tier: null,
    order: [],
    cursor: 0,
    results: {},
    drafts: {},
    updatedAt: null,
  };
}

export function defaultSettings() {
  return {
    schemaVersion: SCHEMA_VERSION,
    endpoint: '',
    model: '',
    apiKey: '',
    enabled: false,
  };
}

export function defaultMemory() {
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: {},
    summaries: [],
    advice: [],
    messages: [],
  };
}

let injectedStorage = null;
let resolvedStorage;
const memoryFallback = new Map();

function detectStorage() {
  try {
    const store = globalThis.localStorage;
    if (!store) return null;
    const probe = '__mm_storage_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    // localStorage 不可用（隐私模式/配额满）时静默降级
    return null;
  }
}

function storage() {
  if (injectedStorage) return injectedStorage;
  if (resolvedStorage === undefined) resolvedStorage = detectStorage();
  return resolvedStorage;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rawRead(key) {
  const store = storage();
  if (!store) return memoryFallback.has(key) ? memoryFallback.get(key) : null;
  try {
    return store.getItem(key);
  } catch {
    // localStorage 不可用（隐私模式/配额满）时静默降级
    return null;
  }
}

function rawWrite(key, value) {
  const store = storage();
  if (!store) {
    memoryFallback.set(key, value);
    return true;
  }
  try {
    store.setItem(key, value);
    return true;
  } catch {
    // localStorage 不可用（隐私模式/配额满）时静默降级
    return false;
  }
}

function rawRemove(key) {
  memoryFallback.delete(key);
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // 清除失败时至少内存已清，不抛给调用方
  }
}

function readRecord(key, fallback) {
  const raw = rawRead(key);
  if (!raw) return clone(fallback);
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) {
      rawRemove(key);
      return clone(fallback);
    }
    return parsed;
  } catch {
    // localStorage 不可用（隐私模式/配额满）时静默降级
    rawRemove(key);
    return clone(fallback);
  }
}

function writeRecord(key, value) {
  const record = Object.assign({}, value, { schemaVersion: SCHEMA_VERSION });
  return rawWrite(key, JSON.stringify(record));
}

export function readSessions() {
  const record = readRecord(KEYS.sessions, defaultSessions());
  if (!Array.isArray(record.sessions)) return defaultSessions();
  return record;
}

export function addSession(session) {
  const record = readSessions();
  const next = {
    schemaVersion: SCHEMA_VERSION,
    sessions: [session, ...record.sessions].slice(0, MAX_SESSIONS),
  };
  return writeRecord(KEYS.sessions, next);
}

export function clearSessions() {
  rawRemove(KEYS.sessions);
}

export function readDraft() {
  const draft = readRecord(KEYS.draft, defaultDraft());
  if (!draft.updatedAt) return null;
  if (Date.now() - draft.updatedAt > DRAFT_TTL_MS) {
    rawRemove(KEYS.draft);
    return null;
  }
  return draft;
}

export function saveDraft(draft) {
  const next = Object.assign(defaultDraft(), draft, {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: Date.now(),
  });
  return writeRecord(KEYS.draft, next);
}

export function clearDraft() {
  rawRemove(KEYS.draft);
}

export function readSettings() {
  return readRecord(KEYS.settings, defaultSettings());
}

export function writeSettings(patch) {
  const current = readSettings();
  const next = Object.assign({}, current, patch, { schemaVersion: SCHEMA_VERSION });
  return writeRecord(KEYS.settings, next);
}

export function clearSettings() {
  rawRemove(KEYS.settings);
}

export function readMemory() {
  const memory = readRecord(KEYS.memory, defaultMemory());
  return Object.assign(defaultMemory(), memory, {
    profile: memory.profile && typeof memory.profile === 'object' ? memory.profile : {},
    summaries: Array.isArray(memory.summaries) ? memory.summaries : [],
    advice: Array.isArray(memory.advice) ? memory.advice : [],
    messages: Array.isArray(memory.messages) ? memory.messages : [],
  });
}

export function writeMemory(patch) {
  const current = readMemory();
  const next = Object.assign({}, current, patch, { schemaVersion: SCHEMA_VERSION });
  if (Array.isArray(next.messages)) {
    next.messages = next.messages.slice(-MAX_MESSAGES);
  }
  return writeRecord(KEYS.memory, next);
}

export function addMessage(message) {
  const memory = readMemory();
  return writeMemory({ messages: [...memory.messages, message] });
}

export function addSummary(summary) {
  const memory = readMemory();
  return writeMemory({ summaries: [...memory.summaries, summary] });
}

export function addAdvice(advice) {
  const memory = readMemory();
  return writeMemory({ advice: [...memory.advice, advice] });
}

export function clearMemory() {
  rawRemove(KEYS.memory);
}

function safeSettings(settings) {
  return {
    endpoint: settings.endpoint || '',
    model: settings.model || '',
    enabled: Boolean(settings.enabled),
  };
}

/**
 * 导出本机全部数据；Key 永不出现。
 * app 是 L-01 的进度快照，保留它便于恢复进行中的测评。
 */
export function exportData() {
  const appRaw = rawRead(KEYS.app);
  let app = null;
  if (appRaw) {
    try {
      app = JSON.parse(appRaw);
    } catch {
      // 读取失败按无数据处理，导出不因此中断
      app = null;
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sessions: readSessions().sessions,
    draft: readDraft(),
    settings: safeSettings(readSettings()),
    memory: readMemory(),
    app,
  };
}

export function clearAllData() {
  for (const key of ALL_KEYS) rawRemove(key);
  memoryFallback.clear();
}

export function __setStorageForTests(fake) {
  injectedStorage = fake;
  resolvedStorage = undefined;
  memoryFallback.clear();
}
