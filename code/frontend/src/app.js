/**
 * 静态 App 壳（L-01）入口。
 *
 * 路由：#/ → #/tier → #/consent → #/task/<id> → #/report → #/trend
 * 状态全部落在 localStorage，刷新或浏览器返回都不丢进度。
 */
import { createRouter } from './router.js';
import { readState, update, resetState } from './store.js';
import { addSession, clearAllData, exportData } from './storage.js';
import { scoreSession, SCORING_VERSION } from './scoring/local.js';
import { STANDARD_ORDER } from './data.js';
import { clear } from './ui.js';
import { renderHome } from './pages/home.js';
import { renderTier } from './pages/tier.js';
import { renderConsent } from './pages/consent.js';
import { renderTask } from './pages/task.js';
import { renderReport } from './pages/report.js';
import { renderSettings } from './pages/settings.js';
import { renderTrend } from './pages/trend.js';
import { renderMemory } from './pages/memory.js';

const PAGES = {
  '/': renderHome,
  '/tier': renderTier,
  '/consent': renderConsent,
  '/task': renderTask,
  '/report': renderReport,
  '/settings': renderSettings,
  '/trend': renderTrend,
  '/memory': renderMemory,
};

const root = document.getElementById('app');
const toastNode = document.getElementById('toast');

let dispose = () => {};

function toast(message) {
  if (!toastNode) return;
  toastNode.textContent = message;
  toastNode.classList.add('show');
  window.setTimeout(() => toastNode.classList.remove('show'), 2200);
}

function setState(mutator) {
  return update((draft) => {
    Object.assign(draft, mutator(draft));
  });
}

function finishTask(taskId, payload) {
  setState((draft) => {
    const results = Object.assign({}, draft.results, { [taskId]: payload });
    const drafts = Object.assign({}, draft.drafts);
    delete drafts[taskId];
    const order = draft.order.length ? draft.order : STANDARD_ORDER;
    const index = order.indexOf(taskId);
    return {
      results,
      drafts,
      cursor: index >= 0 ? index + 1 : draft.cursor,
      order,
    };
  });

  const state = readState();
  const index = state.order.indexOf(taskId);
  const next = state.order[index + 1];

  if (!next) {
    addSession({
      id: `s_${Date.now().toString(36)}`,
      mode: state.tier || 'standard',
      finishedAt: new Date().toISOString(),
      dims: state.order.slice(),
      results: state.results,
      scores: scoreSession(state.results).scores,
      scoringVersion: SCORING_VERSION,
    });
  }

  router.go(next ? `/task/${next}` : '/report');
}

const ctx = {
  get state() {
    return readState();
  },
  go: (path, options) => router.go(path, options),
  toast,
  pickTier: (tier) => {
    setState(() => ({ tier }));
    router.go('/consent');
  },
  startAssessment: () => {
    setState(() => ({
      tier: 'standard',
      consented: true,
      consentedAge: true,
      startedAt: Date.now(),
      order: STANDARD_ORDER.slice(),
      cursor: 0,
      results: {},
      drafts: {},
      route: '/task/vc',
    }));
    router.go('/task/vc');
  },
  patchDraft: (taskId, draft) => {
    setState((state) => ({
      drafts: Object.assign({}, state.drafts, { [taskId]: draft }),
    }));
  },
  finishTask,
  exportData: () => {
    const data = exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mindmeter-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast('已导出本地数据（不含 LLM Key）');
  },
  clearAll: () => {
    if (!window.confirm('清除本机保存的测评进度与结果？此操作不可恢复。')) return;
    clearAllData();
    resetState();
    toast('已清除本地数据');
    router.go('/');
  },
};

const router = createRouter((route) => {
  dispose();
  dispose = () => {};
  clear(root);

  const state = readState();
  setState(() => ({ route: route.full }));

  const handler = PAGES[route.path] || renderHome;
  const result = handler(root, ctx, route.param);
  dispose = typeof result === 'function' ? result : () => {};

  const heading = root.querySelector('h1');
  if (heading) heading.setAttribute('tabindex', '-1');
  root.focus({ preventScroll: true });
  void state;
});

if (!window.location.hash) {
  const saved = readState().route;
  if (saved && saved !== '/') {
    window.history.replaceState(null, '', `#${saved}`);
  }
}

router.start();
