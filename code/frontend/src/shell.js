/**
 * Web 工作台外壳（顶栏 chip / 左侧栏 / 右侧上下文栏）。
 *
 * 从 app.js 拆出，保持入口文件在复杂度门禁（300 行）以内。
 * 只操作外壳节点，不碰 #app 内的页面渲染。
 * 未登录（auth.session.authenticated = false）时隐藏导航与快捷栏，
 * 顶栏只留一个「登录 / 注册」状态位。
 */
import { readState } from './store.js';
import { STANDARD_ORDER } from './data.js';
import { accountLabel, session } from './auth.js';
import { clear, el } from './ui.js';
import { flashChip } from './motion.js';
import { readUiPrefs, writeUiPrefs, applyUiPrefs } from './ui-prefs.js';
import { iconSvg } from './icons.js';

const NAV_GROUP = {
  '/': '测评',
  '/tier': '测评',
  '/consent': '测评',
  '/intake': '测评',
  '/task': '测评',
  '/report': '报告',
  '/chat': '对话',
  '/memory': '记忆',
  '/trend': '趋势',
  '/games': '游戏',
  '/game': '游戏',
  '/about': '说明',
  '/settings': '设置',
};

const PAGE_LABEL = {
  '/': '',
  '/login': '登录',
  '/register': '注册',
  '/tier': '选择档位',
  '/consent': '知情同意',
  '/intake': '开始之前',
  '/report': '本次报告',
  '/chat': '对话',
  '/memory': '我的记忆',
  '/trend': '趋势',
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
 * @param {{ctx: object, router: {go: Function}}} deps
 */
export function createShell({ ctx, router }) {
  const sidebar = document.getElementById('sidebar');
  const railNode = document.getElementById('rail');
  const chipNode = document.getElementById('chip');
  const quitNode = document.getElementById('quit-task');
  const navToggle = document.getElementById('toggle-nav');
  const railToggle = document.getElementById('toggle-rail');

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

  /** 顶栏与布局骨架：未登录时收掉侧栏/右栏与全部导航控件。 */
  function syncChrome(route, authed) {
    // 未登录与测评专注模式共用同一套布局：收掉侧栏与右栏，主区居中窄列。
    document.body.classList.toggle('focus', !authed || route.path === '/task');
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
          railButton('趋势', 'trending', () => router.go('/trend')),
          railButton('记忆', 'bookmark', () => router.go('/memory')),
          railButton('导出数据', 'download', () => ctx.exportData()),
          railButton('清除账号数据', 'trash', () => ctx.clearAll(), 'danger'),
        ]),
      ]),
    );
    railNode.appendChild(
      el('p', {
        class: 'rail-note tiny',
        text: '站点托管 · 按账号隔离 · 导出不含密钥 · 非临床诊断',
      }),
    );
  }

  return { updateShell, renderRail };
}
