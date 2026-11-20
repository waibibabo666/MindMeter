/**
 * 趋势折线图：把最近几次测评的同一维度连成线。
 *
 * 只画「每次都有分数」的维度；缺一次就不画，避免用插值编造数据。
 * 纯几何 + 字符串拼接，便于单测；渲染在页面里完成。
 */

const WIDTH = 720;
const HEIGHT = 260;
const PAD = { left: 42, right: 16, top: 18, bottom: 30 };

export const TREND_COLORS = [
  '#15803d',
  '#b45309',
  '#2563eb',
  '#7c3aed',
  '#0e7490',
  '#be123c',
  '#4d7c0f',
  '#a21caf',
];

/** 每个维度有固定色相，折线与图例保持一致，跨页面也能对上。 */
export const DIM_COLORS = {
  vc: '#16a34a',
  vf: '#0d9488',
  nc: '#d97706',
  ps: '#2563eb',
  ir: '#7c3aed',
  sv: '#0891b2',
  am: '#e11d48',
  ni: '#65a30d',
};

export function seriesColor(id, index) {
  return DIM_COLORS[id] || TREND_COLORS[index % TREND_COLORS.length];
}

/**
 * @param {Array<{finishedAt:string, scores:Object}>} sessions 新的在前
 * @param {string[]} dimIds 维度顺序
 * @param {{limit?:number}} options 最多展示几次
 */
export function buildTrendSeries(sessions, dimIds, options = {}) {
  const limit = options.limit || 5;
  const window = (sessions || []).slice(0, limit).reverse();
  const usable = (dimIds || []).filter((id) =>
    window.every((session) => {
      const score = session && session.scores ? session.scores[id] : null;
      return typeof score === 'number';
    }),
  );
  return {
    labels: window.map((session) => session.finishedAt),
    dims: usable,
    series: usable.map((id) => ({
      id,
      values: window.map((session) => session.scores[id]),
    })),
    count: window.length,
  };
}

function x(index, total) {
  const inner = WIDTH - PAD.left - PAD.right;
  if (total <= 1) return PAD.left + inner / 2;
  return PAD.left + (inner * index) / (total - 1);
}

function y(score) {
  const inner = HEIGHT - PAD.top - PAD.bottom;
  const clamped = Math.min(100, Math.max(0, Number(score) || 0));
  return PAD.top + inner - (clamped / 100) * inner;
}

function shortDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** 生成折线图 SVG 字符串（不含用户输入，只有数字与固定文案）。 */
export function trendChartMarkup(view) {
  const { labels, series } = view;
  const grids = [0, 25, 50, 75, 100]
    .map((value) => {
      const gy = y(value);
      return `<line x1="${PAD.left}" y1="${gy}" x2="${WIDTH - PAD.right}" y2="${gy}" class="trend-grid" />
        <text x="${PAD.left - 8}" y="${gy + 4}" class="trend-tick" text-anchor="end">${value}</text>`;
    })
    .join('');

  const xLabels = labels
    .map(
      (iso, index) =>
        `<text x="${x(index, labels.length)}" y="${HEIGHT - 8}" class="trend-tick" text-anchor="middle">${shortDate(iso)}</text>`,
    )
    .join('');

  const lines = series
    .map((item, itemIndex) => {
      const color = seriesColor(item.id, itemIndex);
      const path = item.values
        .map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index, labels.length)} ${y(value)}`)
        .join(' ');
      const dots = item.values
        .map(
          (value, index) =>
            `<circle cx="${x(index, labels.length)}" cy="${y(value)}" r="3.5" fill="#fff" stroke="${color}" stroke-width="2" class="trend-dot"><title>${shortDate(labels[index])}：${value}</title></circle>`,
        )
        .join('');
      return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" class="trend-line" style="animation-delay:${0.1 + itemIndex * 0.12}s" />${dots}`;
    })
    .join('');

  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" role="img" aria-label="各维度分数走势">
    ${grids}${xLabels}${lines}
  </svg>`;
}

export const TREND_CHART_SIZE = { width: WIDTH, height: HEIGHT };
