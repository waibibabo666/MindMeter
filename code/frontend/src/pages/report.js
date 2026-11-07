import { el, button } from '../ui.js';
import { DIMS, LIMITS, TASK_META } from '../data.js';

const STATUS = {
  vc: (m) => `正确 ${m.correct} / ${m.total}`,
  ps: (m) => `完成 ${m.trials} 题 · 正确 ${m.correct} · 错误 ${m.wrong}`,
  sv: (m) => `正确 ${m.correct} / ${m.total}`,
  am: (m) => `命中 ${m.hits} · 虚报 ${m.falseAlarms}`,
};

const DETAIL = {
  vc: (m) => `正确率 ${fmtPct(m.accuracy)} · 平均反应时 ${fmtMs(m.meanRtMs)}`,
  ps: (m) => `${m.seconds} 秒内 · 平均反应时 ${fmtMs(m.meanRtMs)}`,
  sv: (m) => `正确率 ${fmtPct(m.accuracy)}`,
  am: (m) => `正确率 ${fmtPct(m.accuracy)} · 漏报 ${m.misses}`,
};

function fmtPct(value) {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';
}

function fmtMs(value) {
  return typeof value === 'number' ? `${value} ms` : '—';
}

export function renderReport(root, ctx) {
  const results = ctx.state.results || {};
  const measured = Object.keys(results);

  const rows = DIMS.map((dim) => {
    const payload = results[dim.id];
    const has = Boolean(payload && payload.metrics);
    return el('tr', { class: has ? '' : 'untested' }, [
      el('th', { scope: 'row', text: dim.name }),
      el('td', { text: has ? STATUS[dim.id](payload.metrics) : '未测' }),
      el('td', { class: 'muted', text: has ? DETAIL[dim.id](payload.metrics) : '本档未包含' }),
    ]);
  });

  const body = measured.length === 0
    ? [
      el('div', { class: 'card' }, [
        el('h2', { class: 'card-title', text: '还没有结果' }),
        el('p', { class: 'muted', text: '完成一次标准测评后，这里会显示 4 项的原始指标。' }),
        button('开始测评', () => ctx.go('/tier'), { variant: 'primary' }),
      ]),
    ]
    : [
      el('p', { class: 'lead', text: `已完成 ${measured.length} / ${DIMS.length} 项。以下只是原始指标，不是分数。` }),
      el('table', { class: 'report-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { scope: 'col', text: '维度' }),
          el('th', { scope: 'col', text: '原始指标' }),
          el('th', { scope: 'col', text: '补充' }),
        ])]),
        el('tbody', {}, rows),
      ]),
      el('div', { class: 'card' }, [
        el('h2', { class: 'card-title', text: '为什么没有分数' }),
        el('p', { class: 'muted', text: '分数由服务端 scoring-v3 计算，前端不参与计分（L-02 之后接入）。本页只负责结构与原始指标展示。' }),
      ]),
      el('div', { class: 'row' }, [
        button('再测一次', () => ctx.go('/tier'), { variant: 'primary' }),
        button('返回首页', () => ctx.go('/'), { variant: 'ghost' }),
      ]),
    ];

  root.appendChild(el('section', { class: 'page', 'aria-labelledby': 'report-title' }, [
    el('p', { class: 'kicker', text: '你的结果' }),
    el('h1', { id: 'report-title', class: 'page-title', text: '本次测评' }),
    ...body,
    el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', text: '局限' }),
      el('ul', { class: 'plain-list' }, LIMITS.map((text) => el('li', { text }))),
    ]),
    el('p', { class: 'disclaimer', text: LIMITS[3] }),
  ]));
}
