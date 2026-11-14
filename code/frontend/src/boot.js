/**
 * Start the renderer: acquire the per-launch token from pywebview (or the
 * E2E injection), then preload the small local dataset into the cache.
 */

import { api, loadBoot } from './api.js';
import { cache, defaultSettings, flushWrites } from './cache.js';

export async function bootstrap() {
  await loadBoot();
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
  return { state: cache.state, sessions: cache.sessions.length };
}

export function installFlushHook() {
  globalThis.addEventListener('beforeunload', () => {
    flushWrites();
  });
}
