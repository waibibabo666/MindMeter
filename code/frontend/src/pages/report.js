import { el, button } from '../ui.js';
import { explain } from '../llm/degrade.js';
import { readSettings } from '../storage.js';
import { DIMS, LIMITS } from '../data.js';
import { scoreSession, SCORING_VERSION } from '../scoring/index.js';
import { buildRadar, radarMarkup } from '../charts/radar.js';

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

function describe(id, metrics) {
  if (!metrics || !STATUS[id] || !DETAIL[id]) return '—';
  return `${STATUS[id](metrics)} · ${DETAIL[id](metrics)}`;
}

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
      el('td', {
        class: 'muted',
        text: has ? describe(dim.id, payload && payload.metrics) : '本档未包含',
      }),
    ]);
  });

  const body =
    measured.length === 0
      ? [
          el('div', { class: 'card' }, [
            el('h2', { class: 'card-title', text: '还没有结果' }),
            el('p', {
              class: 'muted',
              text: '完成一次标准测评后，这里会显示 4 项分数与 4 项未测。',
            }),
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
          renderAiCard(ctx, metricsOf(results)),
          el('div', { class: 'card' }, [
            el('h2', { class: 'card-title', text: '分数怎么来的' }),
            el('p', {
              class: 'muted',
              text: `当前分数由本机按 ${SCORING_VERSION} 临时折算（0–100），题量按本壳实际题数缩放；正式分数以 scoring-v3 统一口径为准。`,
            }),
            el('p', {
              class: 'tiny',
              text: '分数只代表本次任务表现，非常模、非百分位，不能读成“超过多少人”。',
            }),
          ]),
          el('div', { class: 'row' }, [
            button('查看趋势', () => ctx.go('/trend'), { variant: 'primary' }),
            button('再测一次', () => ctx.go('/tier'), { variant: 'ghost' }),
          ]),
        ];

  root.appendChild(
    el('section', { class: 'page', 'aria-labelledby': 'report-title' }, [
      el('p', { class: 'kicker', text: '你的结果' }),
      el('h1', { id: 'report-title', class: 'page-title', text: '本次测评' }),
      ...body,
      el('div', { class: 'card' }, [
        el('h2', { class: 'card-title', text: '局限' }),
        el(
          'ul',
          { class: 'plain-list' },
          LIMITS.map((text) => el('li', { text })),
        ),
      ]),
      el('p', { class: 'disclaimer', text: LIMITS[3] }),
    ]),
  );
}

function metricsOf(results) {
  const out = {};
  for (const [id, payload] of Object.entries(results || {})) {
    if (payload && payload.metrics) out[id] = payload.metrics;
  }
  return out;
}

/** AI 解读卡片：模型可用则用模型，任何异常都落回模板（L-04）。 */
function renderAiCard(ctx, metrics) {
  const badge = el('span', { class: 'pill', text: '未生成' });
  const reason = el('p', {
    class: 'tiny',
    text: '默认用模板解读；在设置里配置自己的模型服务后可切换。',
  });
  const output = el('p', { class: 'ai-text', text: '' });

  const run = button(
    '生成解读',
    async () => {
      run.disabled = true;
      badge.textContent = '生成中';
      reason.textContent = '';
      const result = await explain({ metrics, settings: readSettings() });
      output.textContent = result.text;
      badge.textContent = result.source === 'llm' ? 'LLM' : '模板';
      badge.className = `pill ${result.source === 'llm' ? 'hi' : 'mid'}`;
      reason.textContent =
        result.source === 'llm' ? '由你配置的模型生成，内容仅供参考。' : result.reason;
      run.disabled = false;
      run.textContent = '重新生成';
    },
    { variant: 'ghost' },
  );

  return el('div', { class: 'card' }, [
    el('h2', { class: 'card-title' }, ['AI 解读 ', badge]),
    reason,
    output,
    el('div', { class: 'row' }, [
      run,
      button('去设置', () => ctx.go('/settings'), { variant: 'ghost' }),
    ]),
  ]);
}
