/**
 * 桌面工作台外壳（顶栏 chip / 左侧栏 / 右侧上下文栏）。
 *
 * 从 app.js 拆出，保持入口文件在复杂度门禁（300 行）以内。
 * 只操作外壳节点，不碰 #app 内的页面渲染。
 */
import { readState } from './store.js';
import { STANDARD_ORDER } from './data.js';
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

  // 退出应用：桌面壳里通过 pywebview 的 js_api 关窗口；浏览器里只给提示。
  const quitAppNode = document.getElementById('quit-app');
  if (quitAppNode) {
    quitAppNode.addEventListener('click', () => {
      const bridge = window.pywebview && window.pywebview.api;
      if (bridge && typeof bridge.quit_app === 'function') {
        bridge.quit_app();
        return;
      }
      ctx.toast('直接关闭窗口即可退出');
    });
  }

  function updateShell(route) {
    const group = NAV_GROUP[route.path] || '';
    document.body.classList.toggle('focus', route.path === '/task');
    if (quitNode) quitNode.hidden = route.path !== '/task';

    if (sidebar) {
      for (const item of sidebar.querySelectorAll('.navitem')) {
        item.classList.toggle('on', item.dataset.nav === group);
      }
    }
    if (chipNode) {
      const next = route.path === '/task' ? taskChipText(route) : (PAGE_LABEL[route.path] ?? '');
      if (chipNode.textContent !== next) {
        chipNode.textContent = next;
        flashChip(chipNode);
      }
    }
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

  /** 右侧上下文栏：快捷操作 + 数据说明（测评专注模式下由 CSS 隐藏）。 */
  function renderRail() {
    if (!railNode) return;
    clear(railNode);
    railNode.appendChild(
      el('div', { class: 'card' }, [
        railHead(),
        el('div', { class: 'rail-actions' }, [
          railButton('查看报告', 'file', () => router.go('/report')),
          railButton('趋势', 'trending', () => router.go('/trend')),
          railButton('记忆', 'bookmark', () => router.go('/memory')),
          railButton('导出数据', 'download', () => ctx.exportData()),
          railButton('清除本地数据', 'trash', () => ctx.clearAll(), 'danger'),
        ]),
      ]),
    );
    railNode.appendChild(
      el('p', {
        class: 'rail-note tiny',
        text: '本机运行 · 不上传 · 导出不含 Key · 非临床诊断',
      }),
    );
  }

  return { updateShell, renderRail };
}
