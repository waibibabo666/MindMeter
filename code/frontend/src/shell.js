/**
 * 桌面工作台外壳（顶栏 chip / 左侧栏 / 右侧上下文栏）。
 *
 * 从 app.js 拆出，保持入口文件在复杂度门禁（300 行）以内。
 * 只操作外壳节点，不碰 #app 内的页面渲染。
 */
import { readState } from './store.js';
import { STANDARD_ORDER } from './data.js';
import { button, clear, el } from './ui.js';
import { flashChip } from './motion.js';

const NAV_GROUP = {
  '/': '测评',
  '/tier': '测评',
  '/consent': '测评',
  '/task': '测评',
  '/report': '报告',
  '/chat': '对话',
  '/memory': '记忆',
  '/trend': '趋势',
  '/games': '游戏',
  '/game': '游戏',
  '/settings': '设置',
};

const PAGE_LABEL = {
  '/': '',
  '/tier': '选择档位',
  '/consent': '知情同意',
  '/report': '本次报告',
  '/chat': '对话',
  '/memory': '我的记忆',
  '/trend': '趋势',
  '/games': '游戏中心',
  '/game': '游戏中',
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

  if (quitNode) {
    quitNode.addEventListener('click', () => {
      router.go('/');
      ctx.toast('已退出测评，进度已保留');
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

  /** 右侧上下文栏：快捷操作 + 数据说明（测评专注模式下由 CSS 隐藏）。 */
  function renderRail() {
    if (!railNode) return;
    clear(railNode);
    railNode.appendChild(
      el('div', { class: 'card' }, [
        el('h2', { class: 'card-title', text: '快捷操作' }),
        el('div', { class: 'row' }, [
          button('查看报告', () => router.go('/report'), { variant: 'ghost' }),
          button('趋势', () => router.go('/trend'), { variant: 'ghost' }),
          button('记忆', () => router.go('/memory'), { variant: 'ghost' }),
          button('导出数据', () => ctx.exportData(), { variant: 'ghost' }),
          button('清除本地数据', () => ctx.clearAll(), { variant: 'ghost' }),
        ]),
      ]),
    );
    railNode.appendChild(
      el('div', { class: 'card' }, [
        el('h2', { class: 'card-title', text: '数据说明' }),
        el('p', {
          class: 'tiny',
          text: '本机运行：测评、对话与记忆只存这台设备的数据库，不上传；导出不含模型 Key。非临床诊断。',
        }),
      ]),
    );
  }

  return { updateShell, renderRail };
}
