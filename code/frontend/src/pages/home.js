import { el, button } from '../ui.js';
import { DIMS, LIMITS } from '../data.js';
import { readSessions } from '../storage.js';

const TIER_LABEL = { quick: '快测', standard: '标准', deep: '深度' };

function fmtDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/** 最近一次测评摘要卡：有记录给分数 chips，没有给空态引导。 */
function recentCard(ctx) {
  const last = (readSessions().sessions || [])[0];
  if (!last || !last.scores) {
    return el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', text: '最近一次测评' }),
      el('p', { class: 'muted', text: '还没有记录。完成一次标准测评后，这里会显示各维度分数。' }),
    ]);
  }

  const chips = DIMS.filter((dim) => typeof last.scores[dim.id] === 'number').map((dim) =>
    el('span', { class: 'score-chip' }, [dim.name, el('b', { text: String(last.scores[dim.id]) })]),
  );

  return el('div', { class: 'card' }, [
    el('div', { class: 'row' }, [
      el('h2', { class: 'card-title', text: '最近一次测评' }),
      el('span', {
        class: 'tiny',
        text: `${fmtDate(last.finishedAt)} · ${TIER_LABEL[last.mode] || '标准'}档`,
      }),
    ]),
    el('div', { class: 'score-chips' }, chips),
    el('div', { class: 'row' }, [
      button('查看完整报告', () => ctx.go('/report'), { variant: 'ghost' }),
    ]),
  ]);
}

export function renderHome(root, ctx) {
  const state = ctx.state;
  const done = Object.keys(state.results || {}).length;
  const total = (state.order || []).length;
  const inProgress = Boolean(state.tier) && done < total;

  root.appendChild(
    el('section', { class: 'page', 'aria-labelledby': 'home-title' }, [
      el('div', { class: 'card main-entry' }, [
        el('h1', { id: 'home-title', class: 'hero' }, [
          '玩一局，看清你的',
          el('em', { text: '能力结构' }),
        ]),
        el('p', {
          class: 'lead',
          text: '13 分钟 · 4 项标准测评。分维度参考，不设总分，不和任何人比。',
        }),
        el('div', { class: 'row' }, [
          button(
            inProgress ? `继续上次测评（${done}/${total}）` : '选择档位',
            () => ctx.go(inProgress ? `/task/${nextTask(state)}` : '/tier'),
            { variant: 'primary' },
          ),
        ]),
        inProgress
          ? el('p', { class: 'tiny', text: '草稿 24 小时内有效，从上次中断的任务继续。' })
          : null,
      ]),

      recentCard(ctx),

      el('p', { class: 'tiny', text: '数据只存本机数据库 · 可随时清除 · 非临床诊断 · 18+' }),
      el('p', { class: 'disclaimer', text: LIMITS[3] }),
    ]),
  );
}

function nextTask(state) {
  const order = state.order || [];
  const done = state.results || {};
  const next = order.find((id) => !done[id]);
  return next || order[order.length - 1] || 'vc';
}
