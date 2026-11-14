/**
 * 静态 App 壳（L-01）入口。
 *
 * 路由：#/ → #/tier → #/consent → #/task/<id> → #/report → #/trend
 * 状态由 boot 预取到内存缓存，写回本地 FastAPI；刷新/返回不丢进度。
 */
import { createRouter } from './router.js';
import { createShell } from './shell.js';
import { animateNumbers } from './motion.js';
import { attachClickSounds } from './sound.js';
import { readState, update, resetState } from './store.js';
import { addSession, clearAllData, exportData } from './storage.js';
import { bootstrap, installFlushHook } from './boot.js';
import { scoreSession, SCORING_VERSION } from './scoring/index.js';
import { log } from './log.js';
import { STANDARD_ORDER, TIERS } from './data.js';
import { button, clear, el } from './ui.js';
import { renderHome } from './pages/home.js';
import { renderTier } from './pages/tier.js';
import { renderConsent } from './pages/consent.js';
import { renderIntake } from './pages/intake.js';
import { renderTask } from './pages/task.js';
import { renderReport } from './pages/report.js';
import { renderSettings } from './pages/settings.js';
import { renderTrend } from './pages/trend.js';
import { renderMemory } from './pages/memory.js';
import { renderChat } from './pages/chat.js';
import { renderGames } from './pages/games.js';
import { renderGame } from './pages/game.js';

/**
 * 渲染兜底：某个页面抛错时用一段内联内容替换整页，避免白屏。
 * 只给一句人话和两个出口，不暴露堆栈。
 */
function showRenderError(error) {
  log('error', 'render failed', error && error.message);
  clear(root);
  root.appendChild(
    el('section', { class: 'page' }, [
      el('h1', { class: 'page-title', text: '页面没能正常显示' }),
      el('p', {
        class: 'lead',
        text: '可能是本地数据异常。可以先返回首页重试；如果反复出现，请在设置里清除本地数据。',
      }),
      el('div', { class: 'row' }, [
        button(
          '返回首页',
          () => {
            globalThis.location.hash = '#/';
          },
          { variant: 'primary' },
        ),
        button('重试', () => globalThis.location.reload()),
      ]),
    ]),
  );
}

const PAGES = {
  '/': renderHome,
  '/tier': renderTier,
  '/consent': renderConsent,
  '/intake': renderIntake,
  '/task': renderTask,
  '/report': renderReport,
  '/settings': renderSettings,
  '/trend': renderTrend,
  '/memory': renderMemory,
  '/chat': renderChat,
  '/games': renderGames,
  '/game': renderGame,
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

/** 计分失败不能阻断交卷：分数留空，原始作答照常保存。 */
function safeScores(results, level) {
  try {
    return scoreSession(results, level).scores;
  } catch (error) {
    log('error', 'scoring failed', error && error.message);
    return null;
  }
}

async function finishTask(taskId, payload) {
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

  log('info', '完成一项', taskId, next ? `下一项 ${next}` : '全部完成，结算中');

  if (next) {
    router.go(`/task/${next}`);
    return;
  }

  const localScores = safeScores(state.results, state.level || 'standard');
  try {
    const saved = await addSession({
      id: `s_${Date.now().toString(36)}`,
      mode: state.tier || 'standard',
      finishedAt: new Date().toISOString(),
      dims: state.order.slice(),
      results: state.results,
      scoringVersion: SCORING_VERSION,
    });
    // 前端按档位题量本地计分；后端算式尚未支持分档，故以本地结果为准。
    setState(() => ({
      scores: localScores || (saved && saved.scores),
      assessmentId: saved && saved.id,
    }));
  } catch (error) {
    log('error', '保存测评失败', error && error.message);
    toast('保存失败：结果只保留在当前页面，请重启后重测');
    setState(() => ({ scores: localScores, assessmentId: null }));
  }
  router.go('/report');
}

const ctx = {
  get state() {
    return readState();
  },
  go: (path, options) => router.go(path, options),
  toast,
  log,
  pickTier: (tier) => {
    setState(() => ({ tier }));
    router.go('/intake');
  },
  startAssessment: () => {
    const current = readState();
    const tierId = current.tier || 'standard';
    const tier = TIERS.find((item) => item.id === tierId) || TIERS[1];
    const order = tier.tasks.slice();
    log('info', '开始测评', tier.level, order.join('→'));
    setState(() => ({
      tier: tier.id,
      level: tier.level,
      consented: true,
      consentedAge: true,
      startedAt: Date.now(),
      order,
      cursor: 0,
      results: {},
      drafts: {},
      scores: null,
      assessmentId: null,
      route: `/task/${order[0]}`,
    }));
    router.go(`/task/${order[0]}`);
  },
  patchDraft: (taskId, draft) => {
    setState((state) => ({
      drafts: Object.assign({}, state.drafts, { [taskId]: draft }),
    }));
  },
  finishTask,
  exportData: async () => {
    try {
      const data = await exportData();
      log(
        'info',
        '导出本地数据',
        `sessions=${Array.isArray(data.sessions) ? data.sessions.length : 0}`,
      );
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
    } catch (error) {
      log('error', 'export failed', error && error.message);
      toast('导出失败：本地服务不可用或下载被拦截');
    }
  },
  clearAll: async () => {
    if (!window.confirm('清除本机保存的测评进度与结果？此操作不可恢复。')) return;
    log('info', '清除本地数据');
    try {
      await clearAllData();
      resetState();
      toast('已清除本地数据');
      router.go('/');
    } catch (error) {
      log('error', 'clear failed', error && error.message);
      toast('清除失败：请刷新页面后重试');
    }
  },
  clearDraft: (taskId) => {
    setState((state) => {
      const drafts = Object.assign({}, state.drafts);
      delete drafts[taskId];
      return { drafts };
    });
  },
};

const router = createRouter((route) => {
  log('info', '路由', route.full);
  dispose();
  dispose = () => {};
  clear(root);

  setState(() => ({ route: route.full }));
  shell.updateShell(route);
  shell.renderRail();

  const handler = PAGES[route.path] || renderHome;
  let result = () => {};
  try {
    result = handler(root, ctx, route.param);
  } catch (error) {
    showRenderError(error);
  }
  dispose = typeof result === 'function' ? result : () => {};

  const heading = root.querySelector('h1');
  if (heading) heading.setAttribute('tabindex', '-1');
  root.focus({ preventScroll: true });
  animateNumbers(root);
});

const shell = createShell({ ctx, router });

function showBootError(error) {
  log('error', 'boot failed', error && error.message);
  clear(root);
  root.appendChild(
    el('section', { class: 'page' }, [
      el('h1', { class: 'page-title', text: '本地服务没有启动' }),
      el('p', {
        class: 'lead',
        text: 'MindMeter 的本地数据库或解读服务没有就绪。请关闭窗口后重新打开；如果反复出现，请查看启动日志。',
      }),
      el('div', { class: 'row' }, [
        button(
          '重试',
          () => {
            globalThis.location.reload();
          },
          { variant: 'primary' },
        ),
      ]),
    ]),
  );
}

/* 全局兜底：未捕获的异常与 Promise 拒绝都不该让页面白屏。 */
window.addEventListener('error', (event) => {
  log('error', 'window.error', event.message || '');
  toast('页面出现异常，已切到安全状态；如无法操作请刷新');
});

window.addEventListener('unhandledrejection', (event) => {
  log('error', 'unhandledrejection', event.reason && event.reason.message);
  toast('有一次请求没有完成，可稍后重试');
});

async function startApp() {
  await bootstrap();
  installFlushHook();
  if (!window.location.hash) {
    const saved = readState().route;
    if (saved && saved !== '/') {
      window.history.replaceState(null, '', `#${saved}`);
    }
  }
  log('info', '应用启动', globalThis.location ? globalThis.location.pathname : '/');
  attachClickSounds();
  router.start();
}

startApp().catch(showBootError);
