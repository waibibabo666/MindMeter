/**
 * 「与上次相比」区块：原来独立的 #/trend 趋势页，现在并进报告页。
 *
 * 为什么合并（用户测试反馈 3）：
 *   旧页要求至少两次记录，用户测完第一次跑去看趋势，看到的是「还差一次测评」
 *   的空态，像功能坏了；而「八维结果」和「和上次比」本来就是一件事。
 *   现在 #/trend 由 router.js 重定向到 #/report（见 router.js 的 LEGACY_REDIRECTS），
 *   本模块只导出报告页要用的模型与区块，不再是一个页面。
 *
 * 口径不变：只比共同维度；未测不按 0 计；只说变了多少，不说进步退步；
 * 间隔不足 7 天提示练习效应；没有三次记录不谈「趋势」这个词。
 */
import { el, button, hint } from '../ui.js';
import { DIMS } from '../data.js';
import { readSessions } from '../storage.js';
import { buildTrend, repeatHint, scoredDims, REPEAT_MIN_DAYS } from '../trend.js';
import { buildTrendSeries, trendChartMarkup, seriesColor } from '../charts/trend.js';
import { setPendingQuestion } from '../chat.js';

const TREND_QUESTION = '帮我解释这两次测评的变化';
/** 少于三次记录只给两次之间的差值，不画走势线，也不使用「趋势」措辞。 */
const TREND_MIN_POINTS = 3;

const DIM_NAME = Object.fromEntries(DIMS.map((d) => [d.id, d.name]));

function fmtDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function deltaText(delta) {
  if (delta === 0) return '持平';
  return `${delta > 0 ? '+' : ''}${delta}`;
}

function deltaClass(delta) {
  if (delta === 0) return 'delta flat';
  return delta > 0 ? 'delta up' : 'delta down';
}

function scoresOf(session) {
  return (session && session.scores) || {};
}

/** 按 DIMS 顺序列出这个 session 真正有分数的维度。 */
function scoredRows(session) {
  const scored = new Set(scoredDims(session));
  const scores = scoresOf(session);
  return DIMS.filter((dim) => scored.has(dim.id)).map((dim) => ({
    id: dim.id,
    name: DIM_NAME[dim.id] || dim.name,
    score: scores[dim.id],
  }));
}

/**
 * 「与上次相比」的数据模型。纯函数、不碰 DOM，可被 scripts/test_report_trend.js 直接调用。
 *
 * kind：
 *   'none'     —— 没有任何带分数的记录（报告页此时走「还没有结果」，本区块不出现）；
 *   'baseline' —— 只有一次记录，或两次没有共同维度：把本次分数立为基线，
 *                 明确写「下次复测起这里会显示变化」，不摆空表、不说「还没有数据」；
 *   'compare'  —— 两次及以上且有共同维度：沿用 src/trend.js 的 buildTrend。
 *
 * @param {Array<{finishedAt?: string, scores?: Object}>} sessions 新的在前
 */
export function buildCompareModel(sessions) {
  const list = (Array.isArray(sessions) ? sessions : []).filter(
    (item) => item && typeof item === 'object',
  );
  const current = list[0] || null;
  const rows = current ? scoredRows(current) : [];
  if (rows.length === 0) return { kind: 'none', current, rows: [], previous: null };

  const previous = list[1] || null;
  if (!previous) return { kind: 'baseline', current, previous: null, rows };

  try {
    const trend = buildTrend(previous, current, DIM_NAME);
    if (trend.rows.length > 0) {
      return {
        kind: 'compare',
        current,
        previous,
        rows: trend.rows,
        trend,
        days: trend.days,
        hint: repeatHint(trend.days),
      };
    }
  } catch {
    // 脏记录（scores / finishedAt 结构异常）不该拖垮报告页：一起退回基线形态。
  }
  return { kind: 'baseline', current, previous, rows, reason: 'no-common-dims' };
}

/** 单边测过的维度：不算差值，单独列出来，别让它们凭空消失。 */
function skippedLines(trend, previous, current) {
  const prevScores = scoresOf(previous);
  const nextScores = scoresOf(current);
  const lines = [
    ...trend.onlyPrev.map(
      (id) => `${DIM_NAME[id] || id}：上次测过（${prevScores[id]}），本次这一档没有测`,
    ),
    ...trend.onlyNext.map(
      (id) => `${DIM_NAME[id] || id}：本次新测（${nextScores[id]}），上次没有这项`,
    ),
  ];
  if (lines.length > 0) {
    return [
      el('p', { class: 'tiny', text: '只有一边测过的维度不算差值，单独列在这里：' }),
      el(
        'ul',
        { class: 'plain-list' },
        lines.map((text) => el('li', { text })),
      ),
    ];
  }
  return [
    el('p', {
      class: 'tiny',
      text: '两次测过的维度完全重合，全部参与差值计算；未测维度不按 0 计。',
    }),
  ];
}

function deltaTable(rows) {
  return el('table', { class: 'report-table trend-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: '维度' }),
        el('th', { scope: 'col', text: '上次' }),
        el('th', { scope: 'col', text: '本次' }),
        el('th', { scope: 'col', text: '变化' }),
      ]),
    ]),
    el(
      'tbody',
      {},
      rows.map((row) =>
        el('tr', {}, [
          el('th', { scope: 'row', text: row.name }),
          el('td', { text: String(row.prev) }),
          el('td', { text: String(row.next) }),
          el('td', { class: deltaClass(row.delta), text: deltaText(row.delta) }),
        ]),
      ),
    ),
  ]);
}

function askAgent(ctx) {
  setPendingQuestion(TREND_QUESTION);
  ctx.go('/chat');
}

function compareCard(ctx, model) {
  // repeatNote 是「间隔不足 7 天」的练习效应警告：必须常驻，不能收进浮框。
  const { trend, previous, current, hint: repeatNote } = model;
  const daysText = typeof trend.days === 'number' ? ` · 间隔 ${trend.days} 天` : '';
  const rangeText = `${fmtDate(previous.finishedAt)} → ${fmtDate(current.finishedAt)}${daysText}`;
  const children = [
    el('h2', { class: 'card-title', text: '与上次相比' }),
    el('p', { class: 'muted', text: rangeText }),
    repeatNote ? el('div', { class: 'notice', role: 'status' }, [repeatNote]) : null,
    deltaTable(model.rows),
    ...skippedLines(trend, previous, current),
    el('p', { class: 'tiny' }, [
      '这里只说变了多少，不说进步或退步：变化不等于训练效果。',
      hint(
        '不设总分，也没有「总分涨了多少」这种读法；差值只比两次都测过的维度，未测维度不按 0 计。',
        { edge: true },
      ),
    ]),
  ];
  if (Array.isArray(model.sessions) && model.sessions.length < TREND_MIN_POINTS) {
    children.push(
      el('p', {
        class: 'tiny',
        text: `现在只有 ${model.sessions.length} 次记录：够算两次之间的差值，还不足以谈「趋势」；三次以上这里会出现各维度走势。`,
      }),
    );
  }
  children.push(
    el('div', { class: 'row' }, [
      button('让 Agent 解释这两次的变化', () => askAgent(ctx), { variant: 'ghost' }),
    ]),
  );
  return el('div', { class: 'card compare-card', id: 'report-compare' }, children);
}

function baselineTable(rows) {
  return el('table', { class: 'report-table baseline-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: '维度' }),
        el('th', { scope: 'col', text: '本次（基线）' }),
      ]),
    ]),
    el(
      'tbody',
      {},
      rows.map((row) =>
        el('tr', {}, [
          el('th', { scope: 'row', text: row.name }),
          el('td', { text: String(row.score) }),
        ]),
      ),
    ),
  ]);
}

function baselineCard(model) {
  const head =
    model.reason === 'no-common-dims'
      ? '这两次没有都测过的维度，暂时算不出差值'
      : '这是这个账号的第一次记录';
  return el('div', { class: 'card compare-card', id: 'report-compare' }, [
    el('h2', { class: 'card-title', text: '与上次相比' }),
    el('p', {
      class: 'muted',
      text: `${head}。下面把本次各维度分数立为基线（记录时间 ${fmtDate(model.current.finishedAt)}）。`,
    }),
    baselineTable(model.rows),
    el('p', {
      class: 'tiny',
      text: '下次复测起，这里会显示每个维度相对本次的变化，仍然只比两次都测过的维度。',
    }),
    el('p', {
      class: 'tiny',
      text: `建议间隔 ${REPEAT_MIN_DAYS} 天以上再复测，减少同一份卷子重做的练习效应。`,
    }),
  ]);
}

/** 走势折线：三次及以上、且每次都测到的维度才连线；画不出来就整块不出现。 */
function seriesCard(sessions) {
  if (!Array.isArray(sessions) || sessions.length < TREND_MIN_POINTS) return null;
  const view = buildTrendSeries(
    sessions,
    DIMS.map((dim) => dim.id),
  );
  if (view.dims.length === 0) return null;

  const legend = el(
    'div',
    { class: 'trend-legend' },
    view.dims.map((id, index) =>
      el('span', { class: 'trend-legend-item' }, [
        el('i', { style: `background:${seriesColor(id, index)}` }),
        DIM_NAME[id] || id,
      ]),
    ),
  );
  return el('div', { class: 'card trend-card' }, [
    el('h2', { class: 'card-title', text: '各维度走势' }),
    el('div', { class: 'trend-chart', html: trendChartMarkup(view) }),
    legend,
    el('p', {
      class: 'tiny',
      text: `最近 ${view.count} 次记录；只连每次都测到的维度，缺一次就不画，不做插值。`,
    }),
  ]);
}

/** 报告页的对比序列：本次在前，后面接账号里更早的记录。 */
function compareSequence(ctx, scored, assessmentId) {
  let saved = [];
  try {
    saved = readSessions().sessions || [];
  } catch (error) {
    // 记录读不出来时按「只有本次」处理，别让报告页的对比区块整块消失。
    if (typeof ctx.log === 'function')
      ctx.log('error', 'compare read failed', error && error.message);
  }
  const current = {
    // 用报告页正在显示的那份分数，而不是库里可能缺字段的原始记录：
    // 否则上面表格写着 62、下面差值按空算，用户看到的就是自相矛盾。
    id: assessmentId || (saved[0] && saved[0].id) || 'current',
    finishedAt: (saved[0] && saved[0].finishedAt) || new Date().toISOString(),
    scores: (scored && scored.scores) || {},
  };
  return [current, ...saved.slice(1)];
}

/**
 * 报告页要的「与上次相比」节点；算不出来也不能影响八维结果，最差就是这块不出现。
 */
export function compareBlock(ctx, scored, assessmentId) {
  try {
    const sessions = compareSequence(ctx, scored, assessmentId);
    return compareSection(ctx, buildCompareModel(sessions), sessions);
  } catch (error) {
    if (typeof ctx.log === 'function')
      ctx.log('error', 'compare section failed', error && error.message);
    return [];
  }
}

/**
 * 报告页的「与上次相比」区块。返回节点数组（可能为空），由报告页插进八维表格之后。
 *
 * @param {object} ctx 页面上下文（只用 ctx.go 跳对话）
 * @param {object} model buildCompareModel 的返回值
 * @param {Array} sessions 新的在前；够三次才会出现走势折线
 */
export function compareSection(ctx, model, sessions) {
  if (!model || model.kind === 'none') return [];
  if (model.kind === 'baseline') return [baselineCard(model)];
  const withSessions = Object.assign({}, model, { sessions });
  const nodes = [compareCard(ctx, withSessions)];
  const chart = seriesCard(sessions);
  if (chart) nodes.push(chart);
  return nodes;
}
