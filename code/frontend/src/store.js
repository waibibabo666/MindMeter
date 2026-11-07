/**
 * 本地状态：刷新/返回不丢进度的唯一来源。
 *
 * 设计要点：
 *   - 单一 key，带 version，结构不兼容时回退到默认值而不是抛错；
 *   - localStorage 不可用（隐私模式/配额满）时降级为内存对象，页面仍可用；
 *   - 不存敏感信息：这里只有测评进度与原始指标。
 */

import { KEYS } from './storage.js';

export const STORAGE_KEY = KEYS.app;
export const STATE_VERSION = 1;

/**
 * 内存日志：项目禁止前端写 console（防止 Key 意外落日志），改为环形缓冲。
 * 排查时在控制台执行 `__MM_LOG__` 查看最近 200 条；不产生任何自动输出。
 */
const log = (level, ...args) => {
  const buffer = (globalThis.__MM_LOG__ ||= []);
  buffer.push({ at: Date.now(), level, args });
  if (buffer.length > 200) buffer.shift();
};

export function defaultState() {
  return {
    version: STATE_VERSION,
    route: '/',
    tier: null,
    consented: false,
    startedAt: null,
    order: [],
    cursor: 0,
    results: {},
    drafts: {},
  };
}

let injectedStorage = null;
let memory = null;
let resolvedStorage;

function detectStorage() {
  try {
    const store = globalThis.localStorage;
    if (!store) return null;
    const probe = '__mm_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch (error) {
    // localStorage 不可用（隐私模式/配额满）时降级，留下原因便于排查
    log('warn', '状态持久化不可用，已降级到内存', error);
    return null;
  }
}

function storage() {
  if (injectedStorage) return injectedStorage;
  if (resolvedStorage === undefined) resolvedStorage = detectStorage();
  return resolvedStorage;
}

export function readState() {
  if (memory) return memory;

  const store = storage();
  if (!store) {
    memory = defaultState();
    return memory;
  }

  try {
    const raw = store.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    memory =
      parsed && parsed.version === STATE_VERSION
        ? Object.assign(defaultState(), parsed)
        : defaultState();
    return memory;
  } catch (error) {
    // localStorage 不可用（隐私模式/配额满）时降级，留下原因便于排查
    log('warn', '状态持久化不可用，已降级到内存', error);
    memory = defaultState();
    return memory;
  }
}

export function writeState(next) {
  memory = next;
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch (error) {
    // localStorage 不可用（隐私模式/配额满）时降级，留下原因便于排查
    log('warn', '状态持久化不可用，已降级到内存', error);
    return false;
  }
}

/** 以函数方式更新状态，避免调用方到处写 read/write。 */
export function update(mutator) {
  const next = Object.assign({}, readState());
  mutator(next);
  writeState(next);
  return readState();
}

export function resetState() {
  const fresh = defaultState();
  writeState(fresh);
  return fresh;
}

/** 测试用：注入假存储并丢弃内存缓存，模拟一次新的页面加载。 */
export function __setStorageForTests(fake) {
  injectedStorage = fake;
  memory = null;
  resolvedStorage = undefined;
}
