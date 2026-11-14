/**
 * In-memory read cache. Pages stay synchronous; writes are queued to the
 * local API by the repository modules.
 */

export const STATE_VERSION = 1;
export const SCHEMA_VERSION = 1;
export const MAX_MESSAGES = 20;
export const MAX_SESSIONS = 50;

export function defaultState() {
  return {
    version: STATE_VERSION,
    route: '/',
    tier: null,
    consented: false,
    consentedAge: false,
    startedAt: null,
    order: [],
    cursor: 0,
    results: {},
    drafts: {},
    scores: null,
    assessmentId: null,
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

export function defaultSettings() {
  return {
    schemaVersion: SCHEMA_VERSION,
    endpoint: '',
    model: '',
    enabled: false,
    hasKey: false,
    keyHint: '',
  };
}

export const cache = {
  state: defaultState(),
  sessions: [],
  memory: defaultMemory(),
  settings: defaultSettings(),
};

let writeChain = Promise.resolve();

/** Serialize repository writes so a fast click sequence cannot reorder them. */
export function enqueue(task) {
  writeChain = writeChain.then(task, task);
  return writeChain.catch(() => undefined);
}

export function flushWrites() {
  return writeChain.catch(() => undefined);
}
