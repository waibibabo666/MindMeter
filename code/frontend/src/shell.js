/**
 * Web 工作台外壳（顶栏 chip / 左侧栏 / 右侧上下文栏）。
 *
 * 从 app.js 拆出，保持入口文件在复杂度门禁（300 行）以内。
 * 只操作外壳节点，不碰 #app 内的页面渲染。
 * 未登录（auth.session.authenticated = false）时隐藏导航与快捷栏，
 * 顶栏只留一个「登录 / 注册」状态位。
 *
 * 导航里「报告」与「趋势」是同一个入口（#/report）：趋势已并入报告页，
 * 左侧栏在启动时把两个静态项收敛成一项「报告与趋势」（见 mergeTrendNav）。
 */
import { readState } from './store.js';
import { STANDARD_ORDER } from './data.js';
import { accountLabel, session } from './auth.js';
import { clear, el } from './ui.js';
import { flashChip } from './motion.js';
import { readUiPrefs, writeUiPrefs, applyUiPrefs } from './ui-prefs.js';
import { iconSvg } from './icons.js';

/** 侧栏分组名：报告与趋势共用一组，选中态才不会跳到两个项上。 */
const NAV_REPORT = '报告与趋势';

const NAV_GROUP = {
  '/': '测评',
  '/tier': '测评',
  '/intake': '测评',
  '/prep': '测评',
  '/task': '测评',
  '/report': NAV_REPORT,
  '/chat': '对话',
  '/memory': '记忆',
  // 旧入口：router.js 会先把 /trend 重定向到 /report，这里只是兜底同组。
  '/trend': NAV_REPORT,
  '/games': '游戏',
  '/game': '游戏',
  '/about': '说明',
  '/settings': '设置',
};

// 测评前置两页：用居中窄列的 setup 布局（见 styles/app.css 的 body.setup）。
const SETUP_PAGES = ['/intake', '/prep'];

const PAGE_LABEL = {
  '/': '',
  '/login': '登录',
  '/register': '注册',
  '/tier': '选择档位',
  '/intake': '第一次见面',
  '/prep': '今天的状态',
  '/report': NAV_REPORT,
  '/chat': '对话',
  '/memory': '我的记忆',
  '/trend': NAV_REPORT,
  '/games': '游戏中心',
  '/game': '游戏中',
  '/about': '说明',
  '/settings': '设置',
};

function taskChipText(route) {
  const state = readState();
  const order = state.order.length ? state.order : STANDARD_ORDER;
  const index = Math.max(0, order.indexOf(route.param));
  return `测评中 · ${index + 1} / ${order.length}`;
}

/**
 * 侧栏静态标记（index.html）里还留着「报告」「趋势」两个入口，那个文件不在本次
 * 改动范围内，所以在外壳启动时把两项收敛成一项「报告与趋势」→ #/report。
 * 幂等：静态项已经合并过、或者压根没有趋势项时，什么都不做。
 */
function labelNode(item) {
  const nodes = item.childNodes;
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const child = nodes[i];
    if (child.nodeType === 3 && child.textContent.trim()) return child;
  }
  return null;
}

function mergeTrendNav(sidebar) {
  if (!sidebar) return;
  const legacy = sidebar.querySelector('.navitem[data-nav="趋势"]');
  if (legacy) legacy.remove();

  const item =
    sidebar.querySelector('.navitem[data-nav="报告与趋势"]') ||
    sidebar.querySelector('.navitem[data-nav="报告"]');
  if (!item) return;

  item.dataset.nav = NAV_REPORT;
  item.setAttribute('href', '#/report');
  const label = labelNode(item);
  if (label && !label.textContent.includes('趋势')) label.textContent = NAV_REPORT;
}

/**
 * @param {{ctx: object, router: {go: Function}}} deps
 */
export function createShell({ ctx, router }) {
  const sidebar = document.getElementById('sidebar');
  const railNode = document.getElementById('rail');
  const chipNode = document.getElementById('chip');
  const quitNode = document.getElementById('quit-task');
  const navToggle = document.getElementById('toggle-nav');
  const railToggle = document.getElementById('toggle-rail');

  mergeTrendNav(sidebar);

  const prefs = readUiPrefs();
  applyUiPrefs(prefs);

  function syncToggles() {
    if (navToggle) navToggle.setAttribute('aria-pressed', String(prefs.navCollapsed));
    if (railToggle) railToggle.setAttribute('aria-pressed', String(prefs.railCollapsed));
  }

  if (navToggle) {
    navToggle.addEventListener('click', () => {
      prefs.navCollapsed = !prefs.navCollapsed;
      applyUiPrefs(prefs);
      writeUiPrefs(prefs);
      syncToggles();
    });
  }
  if (railToggle) {
    railToggle.addEventListener('click', () => {
      prefs.railCollapsed = !prefs.railCollapsed;
      applyUiPrefs(prefs);
      writeUiPrefs(prefs);
      syncToggles();
    });
  }
  syncToggles();

  if (quitNode) {
    quitNode.addEventListener('click', () => {
      router.go('/');
      ctx.toast('已退出测评，进度已保留');
    });
  }

  // 顶栏账号位：登录后显示「退出 · 用户名」，未登录时整块隐藏。
  const quitAppNode = document.getElementById('quit-app');
  const settingsLinkNode = document.getElementById('toplink-settings');
  if (quitAppNode) {
    quitAppNode.addEventListener('click', () => {
      if (session.authenticated && typeof ctx.signOut === 'function') {
        ctx.signOut();
        return;
      }
      router.go('/login');
    });
  }

  // 顶栏全屏开关：走浏览器全屏 API，不支持时按钮保持隐藏。
  const fullscreenNode = document.getElementById('toggle-fullscreen');
  if (fullscreenNode && document.documentElement.requestFullscreen) {
    fullscreenNode.hidden = false;
    const syncFullscreen = () => {
      const on = Boolean(document.fullscreenElement);
      fullscreenNode.setAttribute('aria-pressed', String(on));
      fullscreenNode.title = on ? '退出全屏' : '全屏显示';
      const sr = fullscreenNode.querySelector('.sr-only');
      if (sr) sr.textContent = on ? '退出全屏' : '全屏显示';
    };
    fullscreenNode.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else {
          await document.documentElement.requestFullscreen();
        }
      } catch {
        ctx.toast('这个浏览器不支持全屏');
      }
    });
    document.addEventListener('fullscreenchange', syncFullscreen);
    syncFullscreen();
  }

  /** 顶栏与布局骨架：未登录时收掉侧栏/右栏与全部导航控件。 */
  function syncChrome(route, authed) {
    const setupPage = SETUP_PAGES.includes(route.path);
    // 未登录与测评专注模式共用同一套布局：收掉侧栏与右栏，主区居中窄列。
    document.body.classList.toggle('focus', !authed || route.path === '/task');
    // 前置两页用 setup 布局：保留侧栏定位，收掉右侧快捷栏，主区居中。
    document.body.classList.toggle('setup', authed && setupPage);
    if (quitNode) quitNode.hidden = route.path !== '/task';
    if (settingsLinkNode) settingsLinkNode.hidden = !authed;
    if (navToggle) navToggle.style.display = authed ? '' : 'none';
    if (railToggle) railToggle.style.display = authed ? '' : 'none';
    if (!quitAppNode) return;
    quitAppNode.hidden = !authed;
    quitAppNode.textContent = authed ? `退出 · ${accountLabel()}` : '退出';
  }

  function syncNav(group, authed) {
    if (!sidebar) return;
    for (const item of sidebar.querySelectorAll('.navitem')) {
      item.classList.toggle('on', authed && item.dataset.nav === group);
    }
  }

  function syncChip(route) {
    if (!chipNode) return;
    const next = route.path === '/task' ? taskChipText(route) : (PAGE_LABEL[route.path] ?? '');
    if (chipNode.textContent === next) return;
    chipNode.textContent = next;
    flashChip(chipNode);
  }

  function updateShell(route) {
    const authed = Boolean(session.authenticated);
    syncChrome(route, authed);
    syncNav(NAV_GROUP[route.path] || '', authed);
    syncChip(route);
  }

  /** 右栏快捷操作：图标行式按钮，比并排五个盒子安静。 */
  function railButton(label, iconName, onClick, tone) {
    const cls = tone ? `rail-btn ${tone}` : 'rail-btn';
    const node = el('button', { class: cls, type: 'button', onclick: onClick });
    node.innerHTML = `${iconSvg(iconName)}<span>${label}</span>`;
    return node;
  }

  /** 快捷操作卡头：标题 + 折叠按钮（记住偏好，聊天页太占地方时能收起来）。 */
  function railHead() {
    const chevron = el('button', {
      class: 'rail-chevron',
      type: 'button',
      'aria-expanded': String(!prefs.railMin),
      title: prefs.railMin ? '展开快捷操作' : '收起快捷操作',
      onclick: () => {
        prefs.railMin = !prefs.railMin;
        applyUiPrefs(prefs);
        writeUiPrefs(prefs);
        renderRail();
      },
    });
    chevron.innerHTML = iconSvg('chevron');
    return el('div', { class: 'rail-head' }, [
      el('h2', { class: 'card-title', text: '快捷操作' }),
      chevron,
    ]);
  }

  /**
   * 右栏「与上次相比」：趋势已并入报告页。
   * 已经在报告页 → 直接把对比区块滚到眼前（重渲染会把滚动位置夹回顶部，所以不再导航）；
   * 其它页面 → 走旧入口 #/trend，由 router.js 重定向到 #/report：
   * 旧链接、旧收藏、这个按钮共用同一条兼容路径。
   */
  function jumpToCompare() {
    if (readState().route === '/report') {
      const card = document.getElementById('report-compare');
      if (card) card.scrollIntoView({ block: 'start' });
      return;
    }
    router.go('/trend');
  }

  /** 右侧上下文栏：快捷操作 + 数据说明（专注模式与未登录时由 CSS 隐藏）。 */
  function renderRail() {
    if (!railNode) return;
    clear(railNode);
    if (!session.authenticated) return;
    railNode.appendChild(
      el('div', { class: 'card' }, [
        railHead(),
        el('div', { class: 'rail-actions' }, [
          railButton('查看报告', 'file', () => router.go('/report')),
          railButton('与上次相比', 'trending', () => jumpToCompare()),
          railButton('记忆', 'bookmark', () => router.go('/memory')),
          railButton('导出数据', 'download', () => ctx.exportData()),
          railButton('清除账号数据', 'trash', () => ctx.clearAll(), 'danger'),
        ]),
      ]),
    );
    railNode.appendChild(
      el('p', {
        class: 'rail-note tiny',
        // 与侧栏 .sidefoot 的口径行错开：这里只写侧栏没有的两条（反馈 3 · 模式 1）。
        text: '导出不含密钥 · 换设备登录仍是同一份数据',
      }),
    );
  }

  return { updateShell, renderRail };
}
