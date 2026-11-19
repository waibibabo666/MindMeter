/**
 * App-shell state: in-memory cache + debounced writes to the account's rows.
 * Pages keep using the same synchronous readState/update API.
 *
 * Anonymous visitors only ever change the local cache: a route write without a
 * session is a guaranteed 401, and a 401 on every navigation would pollute the
 * console and the login screen with error toasts.
 */

import { api } from './api.js';
import { session } from './auth.js';
import { STATE_VERSION, cache, defaultState, enqueue } from './cache.js';

export { STATE_VERSION, defaultState };

export const STORAGE_KEY = 'mindmeter.app.shell.v1';

export function readState() {
  return cache.state;
}

function syncState(snapshot) {
  if (!session.authenticated) return false;
  enqueue(() => api.put('/state', snapshot));
  return true;
}

export function writeState(next) {
  cache.state = Object.assign(defaultState(), next);
  return syncState(JSON.parse(JSON.stringify(cache.state)));
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
  syncState(JSON.parse(JSON.stringify(fresh)));
  return fresh;
}

export function __setStorageForTests() {
  // Kept as a no-op for older tests; state is now API-backed.
}
