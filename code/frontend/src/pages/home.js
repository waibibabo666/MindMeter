import { el, button } from '../ui.js';
import { DIMS, TIERS, LIMITS } from '../data.js';

export function renderHome(root, ctx) {
  const state = ctx.state;
  const done = Object.keys(state.results || {}).length;
  const total = (state.order || []).length;
  const inProgress = Boolean(state.tier) && done < total;

  root.appendChild(el('section', { class: 'page', 'aria-labelledby': 'home-title' }, [
    el('p', { class: 'kicker', text: '能力测评 · 静态壳' }),
    el('h1', { id: 'home-title', class: 'hero' }, [
      '玩一局，看清你的',
      el('em', { text: '能力结构' }),
    ]),
    el('p', { class: 'lead', text: '4 项标准测评 · 约 13 分钟。不设总分，没有常模，只给你自己的画像。' }),

    el('div', { class: 'card main-entry' }, [
      el('h2', { class: 'card-title', text: inProgress ? '继续上次的测评' : '开始测评' }),
      el('p', { class: 'muted', text: inProgress ? `已完成 ${done} / ${total} 项` : '标准档：言语理解、知觉速度、空间视觉化、联想记忆' }),
      button(inProgress ? '继续' : '选择档位', () => ctx.go(inProgress ? '/task/' + nextTask(state) : '/tier'), { variant: 'primary' }),
    ]),

    el('div', { class: 'row' }, [
      button('查看报告', () => ctx.go('/report'), { variant: 'ghost' }),
      button('趋势', () => ctx.go('/trend'), { variant: 'ghost' }),
      button('导出数据', () => ctx.exportData(), { variant: 'ghost' }),
      button('设置', () => ctx.go('/settings'), { variant: 'ghost' }),
      button('清除本地数据', () => ctx.clearAll(), { variant: 'ghost' }),
    ]),

    el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', text: '本次包含' }),
      el('ul', { class: 'plain-list' }, TIERS.find((t) => t.id === 'standard').tasks.map((id) => {
        const dim = DIMS.find((d) => d.id === id);
        return el('li', { text: `${dim.name} · ${dim.short}` });
      })),
    ]),

    el('p', { class: 'tiny', text: '数据只存本机 · 可随时清除 · 非临床诊断 · 18+' }),
    el('p', { class: 'disclaimer', text: LIMITS[3] }),
  ]));
}

function nextTask(state) {
  const order = state.order || [];
  const done = state.results || {};
  const next = order.find((id) => !done[id]);
  return next || order[order.length - 1] || 'vc';
}
