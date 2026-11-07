import { el, button } from '../ui.js';
import { DIMS, LIMITS } from '../data.js';
import { scoreSession, SCORING_VERSION } from '../scoring/local.js';
import { buildRadar, radarMarkup } from '../charts/radar.js';

export function renderReport(root, ctx) {
  const results = ctx.state.results || {};
  const measured = Object.keys(results);
  const scored = scoreSession(results);
  const radar = buildRadar(DIMS, scored.scores);

  const rows = DIMS.map((dim) => {
    const score = scored.scores[dim.id];
    const has = typeof score === 'number';
    const payload = results[dim.id];
    return el('tr', { class: has ? '' : 'untested' }, [
      el('th', { scope: 'row', text: dim.name }),
      el('td', { class: 'score-cell', text: has ? String(score) : '未测' }),
      el('td', { class: 'muted', text: has ? describe(dim.id, payload && payload.metrics) : '本档未包含' }),
    ]);
  });

  const body = measured.length === 0
    ? [
      el('div', { class: 'card' }, [
        el('h2', { class: 'card-title', text: '还没有结果' }),
        el('p', { class: 'muted', text: '完成一次标准测评后，这里会显示 4 项分数与 4 项未测。' }),
        button('开始测评', () => ctx.go('/tier'), { variant: 'primary' }),
      ]),
    ]
    : [
      el('p', {
        class: 'lead',
        text: `8 个维度中测了 ${radar.measuredCount} 个，其余 ${radar.total - radar.measuredCount} 个显示「未测」。不设总分，也不做百分位。`,
      }),
      el('div', { class: 'card radar-card' }, [
        el('div', { class: 'radar', html: radarMarkup(radar) }),
        el('p', { class: 'tiny center', text: '雷达只连已测维度；未测维度留空，不按 0 计。' }),
      ]),
      el('table', { class: 'report-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: '维度' }),
            el('th', { scope: 'col', text: '分数' }),
            el('th', { scope: 'col', text: '原始指标' }),
          ]),
        ]),
        el('tbody', {}, rows),
      ]),
      el('div', { class: 'card' }, [
        el('h2', { class: 'card-title', text: '分数怎么来的' }),
        el('p', {
          class: 'muted',
          text: `当前分数由本机按 ${SCORING_VERSION} 折算（0–100），题量按本壳的实际题数缩放；正式分数将由 scoring-v3 在服务端产生。`,
        }),
        el('p', { class: 'tiny', text: '分数只代表本次任务表现，非常模、非百分位，不能读成“超过多少人”。' }),
      ]),
      el('div', { class: 'row' }, [
        button('查看趋势', () => ctx.go('/trend'), { variant: 'primary' }),
        button('再测一次', () => ctx.go('/tier'), { variant: 'ghost' }),
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

function describe(id, metrics) {
  if (!metrics) return '—';
  if (id === 'vc') return `正确 ${metrics.correct}/${metrics.total}`;
  if (id === 'ps') return `${metrics.seconds} 秒内 ${metrics.trials} 题，正确 ${metrics.correct}`;
  if (id === 'sv') return `正确 ${metrics.correct}/${metrics.total}`;
  if (id === 'am') return `命中 ${metrics.hits}，虚报 ${metrics.falseAlarms}`;
  return '—';
}
