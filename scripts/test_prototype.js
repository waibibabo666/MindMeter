#!/usr/bin/env node
/**
 * Smoke tests for the L1 UI prototype (docs/software/prototype/index.html).
 *
 * The L1 prototype is a UI reference, not the L2 app. These tests keep its
 * flow from rotting while L2 is being built:
 *   - JS syntax
 *   - DOM ids / inline handlers
 *   - standard 4-task flow -> 8-axis report, no total
 *   - deep 8-task flow without ASR -> 7/8, "未测"
 *   - quick tier guard when ASR is unavailable
 *   - clear-all data
 *
 * Usage: node scripts/test_prototype.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'docs', 'software', 'prototype', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
if (!scriptMatch) {
  console.error('FAIL: no <script> block in', HTML_PATH);
  process.exit(1);
}
const script = scriptMatch[1];

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function createElement(id) {
  return {
    id,
    style: {},
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
    innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    onclick: null,
    querySelector() { return { textContent: '' }; },
  };
}

function createApp({ asr = false } = {}) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement(id));
      return elements.get(id);
    },
    querySelectorAll() { return []; },
  };

  class FakeSpeechRecognition {
    start() {}
    stop() {}
  }

  const window = {
    scrollTo() {},
    SpeechRecognition: asr ? FakeSpeechRecognition : undefined,
    webkitSpeechRecognition: asr ? FakeSpeechRecognition : undefined,
  };

  const storage = {
    data: new Map(),
    getItem(key) { return this.data.has(key) ? this.data.get(key) : null; },
    setItem(key, value) { this.data.set(key, String(value)); },
    removeItem(key) { this.data.delete(key); },
    clear() { this.data.clear(); },
  };

  const factory = new Function(
    'document',
    'window',
    'localStorage',
    'confirm',
    script + `
return {
  renderModes, pickMode, startAssessment, completeDemoTask, openHistory,
  clearAll, buildFacts, getState: () => state
};`
  );

  const api = factory(document, window, storage, () => true);
  return { api, document, elements, storage };
}

function completeTier(app, tier) {
  const { api, document } = app;
  api.renderModes();
  api.pickMode(tier);
  document.getElementById('c-age').checked = true;
  document.getElementById('c-priv').checked = true;
  api.startAssessment();

  const count = { quick: 2, standard: 4, deep: 8 }[tier];
  for (let i = 0; i < count; i += 1) api.completeDemoTask();
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('script compiles', () => {
  new vm.Script(script, { filename: HTML_PATH });
});

test('dom ids and inline handlers exist', () => {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const duplicateIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  assert(duplicateIds.length === 0, `duplicate ids: ${duplicateIds.join(', ')}`);

  const refs = [...script.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  const missingRefs = [...new Set(refs.filter((id) => !ids.includes(id)))];
  assert(missingRefs.length === 0, `$() refs missing from HTML: ${missingRefs.join(', ')}`);

  const handlers = [...html.matchAll(/onclick="([A-Za-z_$][A-Za-z0-9_$]*)/g)]
    .map((m) => m[1])
    .filter((name) => name !== '$');
  const defs = new Set([...script.matchAll(/function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)].map((m) => m[1]));
  const missingHandlers = [...new Set(handlers.filter((name) => !defs.has(name)))];
  assert(missingHandlers.length === 0, `inline handlers not defined: ${missingHandlers.join(', ')}`);
});

test('standard tier: 4 tasks -> report without total', () => {
  const app = createApp({ asr: false });
  completeTier(app, 'standard');
  const title = app.document.getElementById('r-title').textContent;
  const summary = app.document.getElementById('r-summary').textContent;
  const cards = app.document.getElementById('r-cards').innerHTML;
  assert(title.includes('标准档'), `unexpected title: ${title}`);
  assert(summary.includes('4 / 8'), `unexpected summary: ${summary}`);
  assert(!cards.includes('总分'), 'report must not show 总分');

  const sessions = JSON.parse(app.storage.getItem('mindmeter.sessions.v1') || '[]');
  assert(sessions.length === 1, `expected 1 session, got ${sessions.length}`);
  assert(sessions[0].scoringVersion === 'scoring-v3', 'session should carry scoringVersion');

  app.api.openHistory();
  assert(app.document.getElementById('h-list').innerHTML.length > 0, 'history should render');
});

test('deep tier without ASR: 8 tasks -> 7/8 and 未测', () => {
  const app = createApp({ asr: false });
  completeTier(app, 'deep');
  const summary = app.document.getElementById('r-summary').textContent;
  const cards = app.document.getElementById('r-cards').innerHTML;
  assert(summary.includes('7 / 8'), `unexpected summary: ${summary}`);
  assert(cards.includes('未测'), 'missing ASR dimension should show 未测');
});

test('quick tier is disabled without ASR', () => {
  const app = createApp({ asr: false });
  app.api.renderModes();
  const modeHtml = app.document.getElementById('mode-list').innerHTML;
  assert(modeHtml.includes('当前浏览器不支持 ASR'), 'quick card should explain ASR requirement');

  app.api.pickMode('quick');
  assert(app.api.getState().mode == null, 'quick must not start without ASR');

  app.api.pickMode('standard');
  assert(app.api.getState().mode === 'standard', 'standard should be available');
});

test('quick tier is available with ASR', () => {
  const app = createApp({ asr: true });
  app.api.renderModes();
  app.api.pickMode('quick');
  assert(app.api.getState().mode === 'quick', 'quick should be available with ASR');
});

test('clear-all removes sessions and settings', () => {
  const app = createApp({ asr: false });
  completeTier(app, 'standard');
  app.api.clearAll();
  assert(app.storage.getItem('mindmeter.sessions.v1') == null, 'sessions should be cleared');
  assert(app.storage.getItem('mindmeter.settings.v1') == null, 'settings should be cleared');
  assert(app.storage.getItem('mindmeter.draft.v1') == null, 'draft should be cleared');
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`[PASS] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    console.error(`       ${error.message}`);
    process.exitCode = 1;
  }
}

console.log(`\n${passed}/${tests.length} prototype checks passed`);
