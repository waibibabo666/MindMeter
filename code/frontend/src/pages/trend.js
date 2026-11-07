import { el, button } from '../ui.js';
import { DIMS, LIMITS } from '../data.js';
import { readSessions } from '../storage.js';
import { buildTrend, repeatHint, REPEAT_MIN_DAYS } from '../trend.js';

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

function emptyTrend(ctx, count) {
  return el('section', { class: 'page', 'aria-labelledby': 'trend-title' }, [
    el('h1', { id: 'trend-title', class: 'page-title', text: '趋势' }),
    el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', text: '还差一次测评' }),
      el('p', {
        class: 'muted',
        text:
          count === 0
            ? '本机还没有完成的测评记录。完成一次标准测评后，这里会保留结果用于对比。'
            : '只有一次记录，无法比较。再完成一次标准测评即可看到共同维度的变化。',
      }),
      el('p', {
        class: 'tiny',
        text: `建议间隔 ${REPEAT_MIN_DAYS} 天以上再测，减少练习效应。`,
      }),
      button('去测评', () => ctx.go('/tier'), { variant: 'primary' }),
      button('返回', () => ctx.go('/report'), { variant: 'ghost' }),
    ]),
  ]);
}

function trendRows(trend) {
  return trend.rows.map((row) =>
    el('tr', {}, [
      el('th', { scope: 'row', text: row.name }),
      el('td', { text: String(row.prev) }),
      el('td', { text: String(row.next) }),
      el('td', { class: deltaClass(row.delta), text: deltaText(row.delta) }),
    ]),
  );
}

function trendTable(trend, rows) {
  if (trend.rows.length === 0) {
    return el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', text: '没有可比较的维度' }),
      el('p', { class: 'muted', text: '两次测评没有共同测过的维度，无法计算变化。' }),
    ]);
  }
  return el('table', { class: 'report-table trend-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: '维度' }),
        el('th', { scope: 'col', text: '上次' }),
        el('th', { scope: 'col', text: '本次' }),
        el('th', { scope: 'col', text: '变化' }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
}

function skippedNames(trend) {
  return [...new Set([...trend.onlyPrev, ...trend.onlyNext])].map((id) => DIM_NAME[id] || id);
}

function trendNotes(skipped) {
  return el('div', { class: 'card' }, [
    el('h2', { class: 'card-title', text: '怎么读这张表' }),
    el('ul', { class: 'plain-list' }, [
      el('li', { text: '只比较两次都测过的维度；有一边未测的维度不参与对比。' }),
      el('li', {
        text: skipped.length
          ? `本次未参与对比：${skipped.join('、')}。`
          : '本次所有已测维度都参与了对比。',
      }),
      el('li', { text: '变化不等于训练效果：睡眠、情绪、设备、练习效应都会影响单次结果。' }),
      el('li', { text: '不设总分，所以也不存在“总分涨了多少”这种读法。' }),
    ]),
  ]);
}

export function renderTrend(root, ctx) {
  const sessions = readSessions().sessions || [];
  if (sessions.length < 2) {
    root.appendChild(emptyTrend(ctx, sessions.length));
    return;
  }

  const next = sessions[0];
  const prev = sessions[1];
  const trend = buildTrend(prev, next, DIM_NAME);
  const rows = trendRows(trend);
  const hint = repeatHint(trend.days);

  root.appendChild(
    el('section', { class: 'page', 'aria-labelledby': 'trend-title' }, [
      el('p', { class: 'kicker', text: '两次对比' }),
      el('h1', { id: 'trend-title', class: 'page-title', text: '趋势' }),
      el('p', {
        class: 'lead',
        text: `${fmtDate(prev.finishedAt)} → ${fmtDate(next.finishedAt)}${typeof trend.days === 'number' ? ` · 间隔 ${trend.days} 天` : ''}`,
      }),
      hint ? el('div', { class: 'notice', role: 'status' }, [hint]) : null,
      trendTable(trend, rows),
      trendNotes(skippedNames(trend)),
      el('div', { class: 'row' }, [
        button('再测一次', () => ctx.go('/tier'), { variant: 'primary' }),
        button('看本次报告', () => ctx.go('/report'), { variant: 'ghost' }),
      ]),
      el('p', { class: 'disclaimer', text: LIMITS[3] }),
    ]),
  );
}
