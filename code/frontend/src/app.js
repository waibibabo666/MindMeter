/**
 * Web App 壳（L-01 + 账号）入口。
 *
 * 路由：#/login #/register（未登录） → #/ → #/tier →（首次）#/intake → #/prep
 * → #/task/<id> → #/report（八维结果 + 「与上次相比」）。状态由 boot 预取到内存
 * 缓存，写回同源的 FastAPI；刷新/返回不丢进度，换设备登录后仍是同一份数据。
 *
 * 旧的 #/trend 不再是一页：router.js 的 LEGACY_REDIRECTS 把它重定向到 #/report。
 */
import { createRouter, redirectRoute } from './router.js';
import { createShell } from './shell.js';
import { animateNumbers } from './motion.js';
import { attachClickSounds } from './sound.js';
import { readState, update, resetState } from './store.js';
import { addSession, clearAllData, exportData } from './storage.js';
import { UNAUTHENTICATED } from './api.js';
import { AUTH_PATHS, logout as signOutApi, session } from './auth.js';
import { bootstrap, installFlushHook, resetCache } from './boot.js';
import { needsIntake, readProfile, resetSessionProfile } from './profile.js';
import { scoreSession, SCORING_VERSION } from './scoring/index.js';
import { log } from './log.js';
import { STANDARD_ORDER, TIERS } from './data.js';
import { button, clear, el } from './ui.js';
import { renderHome } from './pages/home.js';
import { renderLogin, renderRegister } from './pages/auth.js';
import { renderTier } from './pages/tier.js';
import { renderIntake } from './pages/intake.js';
import { renderPrep } from './pages/prep.js';
import { renderTask } from './pages/task.js';
import { renderReport } from './pages/report.js';
import { renderSettings } from './pages/settings.js';
import { renderMemory } from './pages/memory.js';
import { renderChat } from './pages/chat.js';
import { renderGames } from './pages/games.js';
import { renderAbout } from './pages/about.js';
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
        text: '可能是账号数据异常。可以先返回首页重试；如果反复出现，请在设置里清除本账号数据。',
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
  '/login': renderLogin,
  '/register': renderRegister,
  '/tier': renderTier,
  '/intake': renderIntake,
  '/prep': renderPrep,
  '/task': renderTask,
  '/report': renderReport,
  '/settings': renderSettings,
  '/memory': renderMemory,
  '/chat': renderChat,
  '/games': renderGames,
  '/about': renderAbout,
  '/game': renderGame,
};
// 注意：没有 '/trend'。趋势已并入报告页，旧路径由 redirectRoute 改写（router.js）。

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
  const prep = {};
  const prepProfile = readProfile();
  // 睡眠在表单里是档位字符串（lt5 / 5to6 / 6to7 / 7plus），落库前映射成代表小时数。
  const SLEEP_HOURS = { lt5: 4, '5to6': 5, '6to7': 6, '7plus': 7 };
  if (SLEEP_HOURS[prepProfile.sleep]) prep.sleep = SLEEP_HOURS[prepProfile.sleep];
  if (Number.isFinite(Number(prepProfile.fatigue))) prep.fatigue = Number(prepProfile.fatigue);
  try {
    const saved = await addSession({
      id: `s_${Date.now().toString(36)}`,
      mode: state.tier || 'standard',
      finishedAt: new Date().toISOString(),
      dims: state.order.slice(),
      results: state.results,
      prep,
      scoringVersion: SCORING_VERSION,
    });
    // 前端按档位题量本地计分；后端算式尚未支持分档，故以本地结果为准。
    setState(() => ({
      scores: localScores || (saved && saved.scores),
      assessmentId: saved && saved.id,
    }));
  } catch (error) {
    log('error', '保存测评失败', error && error.message);
    toast('保存失败：结果只保留在当前页面，请检查网络后重试');
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
    // 资料齐了就别再问第二遍：直接进「今天的状态」页。
    router.go(needsIntake() ? '/intake' : '/prep');
  },
  /** 知情同意只在这一处落库（年龄/学历那页），不在开始测评时偷偷置真。 */
  setConsent: ({ consented, consentedAge }) => {
    setState(() => ({ consented: Boolean(consented), consentedAge: Boolean(consentedAge) }));
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
        '导出数据',
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
      toast('已导出数据（不含模型密钥）');
    } catch (error) {
      log('error', 'export failed', error && error.message);
      toast('导出失败：站点服务不可用或下载被拦截');
    }
  },
  clearAll: async () => {
    if (!window.confirm('清除本账号保存的测评进度与结果？此操作不可恢复。')) return;
    log('info', '清除账号数据');
    try {
      await clearAllData();
      resetState();
      toast('已清除本账号数据');
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
  /** 登录/注册成功：拉取该账号的数据，再进入产品。 */
  onAuthenticated: async (user) => {
    log('info', '登录成功', user && user.username ? user.username : '');
    await bootstrap();
    toast(`已登录：${(user && user.username) || ''}`);
    router.go('/');
  },
  /** 退出登录：清掉内存里属于上一个账号的一切，再回到登录页。 */
  signOut: async () => {
    try {
      await signOutApi();
    } catch (error) {
      log('warn', 'logout failed', error && error.message);
    }
    resetCache();
    resetState();
    resetSessionProfile();
    toast('已退出登录');
    router.go('/login', { replace: true });
  },
};

const router = createRouter((route) => {
  const target = gateRoute(route);
  if (target.full !== route.full) {
    router.go(target.full, { replace: true });
    return;
  }

  log('info', '路由', target.full);
  dispose();
  dispose = () => {};
  clear(root);

  setState(() => ({ route: target.full }));
  shell.updateShell(target);
  shell.renderRail();

  const handler = PAGES[target.path] || renderHome;
  let result = () => {};
  try {
    result = handler(root, ctx, target.param);
  } catch (error) {
    showRenderError(error);
  }
  dispose = typeof result === 'function' ? result : () => {};

  const heading = root.querySelector('h1');
  if (heading) heading.setAttribute('tabindex', '-1');
  root.focus({ preventScroll: true });
  animateNumbers(root);
});

/**
 * Auth gate: anonymous visitors only get the two account pages; a signed-in
 * user never sees the login screen again.
 */
function gateRoute(route) {
  // 旧路径先改写（#/trend → #/report）：router.js 已经在 dispatch 里改过一次，
  // 这里再兜一层，保证直接调用闸门的调用方也不会渲染一个并不存在的趋势页。
  const current = redirectRoute(route);
  const authPage = AUTH_PATHS.includes(current.path);
  if (!session.authenticated && !authPage) return { path: '/login', param: null, full: '/login' };
  if (session.authenticated && authPage) return { path: '/', param: null, full: '/' };
  // 测评前置两页：资料没填全不许直接进「今天的状态」，填全了就不拦手动回看。
  if (current.path === '/prep' && needsIntake())
    return { path: '/intake', param: null, full: '/intake' };
  return current;
}

globalThis.addEventListener(UNAUTHENTICATED, () => {
  if (!session.authenticated) return;
  session.authenticated = false;
  resetCache();
  toast('登录状态已失效，请重新登录');
  router.go('/login', { replace: true });
});

const shell = createShell({ ctx, router });

function showBootError(error) {
  log('error', 'boot failed', error && error.message);
  clear(root);
  root.appendChild(
    el('section', { class: 'page' }, [
      el('h1', { class: 'page-title', text: '站点服务没有响应' }),
      el('p', {
        class: 'lead',
        text: 'MindMeter 的后端或数据库没有就绪（免费实例冷启动约需 1 分钟）。请稍后刷新；如果反复出现，请查看服务端日志。',
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
  const boot = await bootstrap();
  installFlushHook();
  if (!boot.authenticated) {
    // Anonymous: the gate owns the screen. Never restore a stale account route.
    window.history.replaceState(null, '', '#/login');
  } else if (!window.location.hash || AUTH_PATHS.includes(window.location.hash.slice(1))) {
    const saved = readState().route;
    if (saved && saved !== '/' && !AUTH_PATHS.includes(saved)) {
      window.history.replaceState(null, '', `#${saved}`);
    }
  }
  log('info', '应用启动', globalThis.location ? globalThis.location.pathname : '/');
  attachClickSounds();
  router.start();
}

startApp().catch(showBootError);
