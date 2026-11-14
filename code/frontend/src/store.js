/**
 * App-shell state: in-memory cache + debounced writes to the local API.
 * Pages keep using the same synchronous readState/update API.
 */

import { api } from './api.js';
import { STATE_VERSION, cache, defaultState, enqueue } from './cache.js';

export { STATE_VERSION, defaultState };

export const STORAGE_KEY = 'mindmeter.app.shell.v1';

export function readState() {
  return cache.state;
}

export function writeState(next) {
  cache.state = Object.assign(defaultState(), next);
  const snapshot = JSON.parse(JSON.stringify(cache.state));
  enqueue(() => api.put('/state', snapshot));
  return true;
}

export function update(mutator) {
  const next = Object.assign({}, readState());
  mutator(next);
  writeState(next);
  return readState();
}

export function resetState() {
  const fresh = defaultState();
  cache.state = fresh;
  enqueue(() => api.put('/state', fresh));
  return fresh;
}

export function __setStorageForTests() {
  // Kept as a no-op for older tests; state is now API-backed.
}
