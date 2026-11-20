import { el, button, titled } from '../ui.js';
import { DIMS } from '../data.js';
import { readSessions } from '../storage.js';
import { scoreSession } from '../scoring/index.js';
import { MIRROR_ART } from '../icons.js';
import { DIM_COLORS } from '../charts/trend.js';

const TIER_LABEL = { quick: '快测', standard: '标准', deep: '深度' };

/* 人工测试反馈 2：说明性文字不常驻页面，只留板块名与按钮名，解释收进悬浮浮框（键盘可聚焦）。
   同一句产品口径在多个页面重复的，正文只留在「说明」页，这里给一句最短的。 */
const TIP_RECENT =
  '按完成时间倒序记录这个账号的测评，这里只放最近一次；分数只描述这次任务表现，不设总分，也不与人群比较。';
const TIP_DIMS =
  '八个维度取自 CHC 能力分类里能短时测查的部分。没测到的维度显示「未测」，不按 0 计，也不参与任何平均或趋势。';

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
      titled('h2', '最近一次测评', TIP_RECENT),
      el('p', { class: 'muted', text: '还没有记录：先选一个档位开始。' }),
    ]);
  }

  const chips = measured.map((dim) =>
    el('span', { class: 'score-chip' }, [dim.name, el('b', { text: String(scores[dim.id]) })]),
  );

  return el('div', { class: 'card' }, [
    el('div', { class: 'row' }, [
      titled('h2', '最近一次测评', TIP_RECENT),
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
    titled('h2', '八个维度', TIP_DIMS),
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
