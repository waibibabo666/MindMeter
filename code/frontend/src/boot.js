/**
 * Start the renderer: figure out who this browser is, then preload the small
 * account dataset into the cache.
 *
 * Anonymous visitors get NO data prefetch — the login page is the only thing
 * they can reach (app.js enforces the gate), and a 401 storm on four parallel
 * requests would only produce noise.
 */

import { api, loadBoot } from './api.js';
import { cache, defaultMemory, defaultSettings, defaultState, flushWrites } from './cache.js';
import { loadSession, session } from './auth.js';

export async function bootstrap() {
  await loadBoot();
  await loadSession();
  if (!session.authenticated) {
    return { state: null, sessions: 0, authenticated: false };
  }
  const [state, sessions, memory, settings] = await Promise.all([
    api.get('/state'),
    api.get('/assessments'),
    api.get('/memory'),
    api.get('/settings/ai').catch(() => defaultSettings()),
  ]);
  cache.state = Object.assign(cache.state, state, { scores: state.scores || null });
  cache.sessions = Array.isArray(sessions.sessions) ? sessions.sessions : [];
  cache.memory = Object.assign(cache.memory, memory);
  cache.settings = Object.assign(defaultSettings(), settings);
  return { state: cache.state, sessions: cache.sessions.length, authenticated: true };
}

/** Drop everything the previous account owned from the in-memory cache. */
export function resetCache() {
  cache.state = defaultState();
  cache.sessions = [];
  cache.memory = defaultMemory();
  cache.settings = defaultSettings();
}

export function installFlushHook() {
  globalThis.addEventListener('beforeunload', () => {
    if (session.authenticated) flushWrites();
  });
}

export { session };
