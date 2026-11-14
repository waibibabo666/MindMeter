import { el, button } from '../ui.js';
import { DIMS } from '../data.js';
import { readSessions } from '../storage.js';
import { scoreSession } from '../scoring/index.js';
import { MIRROR_ART } from '../icons.js';
import { DIM_COLORS } from '../charts/trend.js';

const TIER_LABEL = { quick: '快测', standard: '标准', deep: '深度' };

function fmtDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/** 会话分数：新流程存 scores，老数据用 results 现算。 */
function sessionScores(session) {
  if (session.scores) return session.scores;
  try {
    return scoreSession(session.results || {}).scores;
  } catch {
    return {};
  }
}

/** 最近一次测评摘要卡：有记录给分数 chips，没有给空态引导。 */
function recentCard(ctx) {
  const last = (readSessions().sessions || [])[0];
  const scores = last ? sessionScores(last) : {};
  const measured = DIMS.filter((dim) => typeof scores[dim.id] === 'number');

  if (measured.length === 0) {
    return el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', text: '最近一次测评' }),
      el('p', { class: 'muted', text: '还没有记录。完成一次测评后，这里会显示各维度分数。' }),
    ]);
  }

  const chips = measured.map((dim) =>
    el('span', { class: 'score-chip' }, [dim.name, el('b', { text: String(scores[dim.id]) })]),
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

/** 八维总览：每个维度一行，带维度色与本次状态。 */
function dimsCard() {
  const last = (readSessions().sessions || [])[0];
  const scores = last ? sessionScores(last) : {};

  const cells = DIMS.map((dim) =>
    el('div', { class: 'dim-cell' }, [
      el('span', {
        class: 'dim-dot',
        style: `background:${DIM_COLORS[dim.id] || 'var(--accent)'}`,
      }),
      el('div', { class: 'dim-body' }, [
        el('p', { class: 'dim-name', text: dim.name }),
        el('p', { class: 'tiny', text: dim.desc }),
      ]),
      typeof scores[dim.id] === 'number'
        ? el('span', { class: 'dim-score', text: String(scores[dim.id]) })
        : el('span', { class: 'dim-badge', text: '未测' }),
    ]),
  );

  return el('div', { class: 'card' }, [
    el('h2', { class: 'card-title', text: '八个维度' }),
    el('div', { class: 'dim-grid' }, cells),
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
          el('em', { text: '心智认知' }),
        ]),
        el('div', { class: 'row' }, [
          button(
            inProgress ? `继续上次测评（${done}/${total}）` : '选择档位',
            () => ctx.go(inProgress ? `/task/${nextTask(state)}` : '/tier'),
            { variant: 'primary' },
          ),
        ]),
        el('div', { class: 'hero-art', html: MIRROR_ART }),
      ]),

      recentCard(ctx),
      dimsCard(),
    ]),
  );
}

function nextTask(state) {
  const order = state.order || [];
  const done = state.results || {};
  const next = order.find((id) => !done[id]);
  return next || order[order.length - 1] || 'vc';
}
