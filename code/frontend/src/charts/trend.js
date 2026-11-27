/**
 * 走势小图：每个维度一张，x 轴按真实时间排列，带「你自己的波动范围」。
 *
 * 为什么不再是七条线挤一张图：
 *   * 次数等距会把「隔 1 天」和「隔 6 天」画成同样的速度，x 轴必须按真实时间；
 *   * 七条线互相遮挡，看不出每个维度自己的起伏；
 *   * 只有分数没有参照，用户没法判断「这次变化算不算正常起伏」。
 *     参照物取用户自己此前的记录（平均 ± 一个标准差），不用人群常模。
 *
 * 缺一次的维度不插值：线只连真实测过的点。纯几何 + 字符串拼接，便于单测。
 */

const WIDTH = 320;
const HEIGHT = 132;
const PAD = { left: 30, right: 14, top: 14, bottom: 24 };
/** 日期标签之间至少隔这么多像素，否则隔一个省一个，避免挤成一团。 */
const MIN_LABEL_GAP = 46;
/** y 轴至少展示这么宽的分数范围：几分的起伏不该被放大成陡坡。 */
const MIN_Y_SPAN = 30;

/** 个人波动范围至少需要这么多个「更早的点」才有意义（更少时标准差没有信息量）。 */
export const MIN_PRIOR_POINTS = 3;
/** 波动带半宽的下限：分数是整数折算出来的，几分以内的差别本来就是噪声。 */
export const BAND_MIN_HALF_WIDTH = 3;

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

function timeOf(session) {
  const t = new Date(session && session.finishedAt).getTime();
  return Number.isFinite(t) ? t : null;
}

/** 取最近 limit 次测评，按时间从早到晚；时间读不出来的记录没法放到轴上，直接略过。 */
export function recentWindow(sessions, limit = 10) {
  return (Array.isArray(sessions) ? sessions : [])
    .slice(0, limit)
    .filter((session) => session && timeOf(session) !== null)
    .sort((a, b) => timeOf(a) - timeOf(b));
}

/** 所有小图共用的时间范围，保证同一天在每张图里落在同一个横向位置。 */
export function timeDomain(windowSessions) {
  const times = windowSessions.map(timeOf).filter((t) => t !== null);
  if (times.length === 0) return { t0: 0, t1: 0 };
  return { t0: Math.min(...times), t1: Math.max(...times) };
}

/** 某个维度在窗口里真实测过的点（没测的那次不出现，也不插值）。 */
export function pointsOfDim(windowSessions, dimId) {
  return windowSessions
    .filter((session) => typeof (session.scores || {})[dimId] === 'number')
    .map((session) => ({
      t: timeOf(session),
      iso: session.finishedAt,
      value: session.scores[dimId],
    }));
}

function clampScore(value) {
  return Math.min(100, Math.max(0, value));
}

/**
 * 一个维度的读数：最新值、与上次的差、个人波动带与「这次落在哪」。
 *
 * 波动带只用**此前**的点算（平均 ± max(标准差, 3 分)）：
 * 要回答的是「这次和你平时比怎么样」，最新这次不能参与定义「平时」。
 * 更早的点少于 3 个时不画带、不下判断，只说还差几次。
 */
export function dimSummary(points) {
  const n = points.length;
  const latest = n > 0 ? points[n - 1].value : null;
  const previous = n > 1 ? points[n - 2].value : null;
  const delta = latest !== null && previous !== null ? latest - previous : null;
  const prior = points.slice(0, -1).map((point) => point.value);
  if (prior.length < MIN_PRIOR_POINTS) {
    return {
      n,
      latest,
      previous,
      delta,
      band: null,
      status: 'building',
      need: MIN_PRIOR_POINTS - prior.length,
    };
  }
  const mean = prior.reduce((sum, value) => sum + value, 0) / prior.length;
  const variance = prior.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (prior.length - 1);
  const half = Math.max(Math.sqrt(variance), BAND_MIN_HALF_WIDTH);
  const band = {
    mean: Math.round(mean),
    low: Math.round(clampScore(mean - half)),
    high: Math.round(clampScore(mean + half)),
  };
  let status = 'within';
  if (latest > band.high) status = 'above';
  else if (latest < band.low) status = 'below';
  return { n, latest, previous, delta, band, status, need: 0 };
}

function escapeText(value) {
  return String(value).replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function shortDate(t) {
  const date = new Date(t);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function shortDateTime(t) {
  const date = new Date(t);
  return `${shortDate(t)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 日历日（本地时区）去重：同一天测两次，横轴上只出现一个日期标签。 */
function dayKey(t) {
  const date = new Date(t);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function makeScale(domain, values, band) {
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const span = domain.t1 - domain.t0;
  const xOf = (t) =>
    span > 0 ? PAD.left + (innerW * (t - domain.t0)) / span : PAD.left + innerW / 2;

  const all = band ? [...values, band.low, band.high] : values;
  let low = Math.min(...all);
  let high = Math.max(...all);
  if (high - low < MIN_Y_SPAN) {
    const mid = (high + low) / 2;
    low = mid - MIN_Y_SPAN / 2;
    high = mid + MIN_Y_SPAN / 2;
  }
  const margin = (high - low) * 0.12;
  low = clampScore(low - margin);
  high = clampScore(high + margin);
  const yOf = (score) =>
    PAD.top + innerH - ((clampScore(score) - low) / (high - low || 1)) * innerH;
  return { xOf, yOf, low, high };
}

/** 横轴日期标签：每个日历日一个，挤不下就隔一个省一个，首尾优先保留。 */
function dayLabels(windowSessions, xOf) {
  const seen = new Set();
  const days = [];
  for (const session of windowSessions) {
    const t = timeOf(session);
    const key = dayKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    days.push({ t, x: xOf(t) });
  }
  const kept = [];
  for (const day of days) {
    if (kept.length === 0 || day.x - kept[kept.length - 1].x >= MIN_LABEL_GAP) kept.push(day);
  }
  const last = days[days.length - 1];
  if (last && kept[kept.length - 1] !== last) {
    // 最后一天一定要有标签；和前一个太近就让位给最后一天。
    if (kept.length > 1 && last.x - kept[kept.length - 1].x < MIN_LABEL_GAP) kept.pop();
    kept.push(last);
  }
  return kept;
}

/**
 * 单个维度的小图 SVG（只含数字与固定文案，用户输入不进来）。
 *
 * @param {{id:string, name:string, color:string, points:Array, summary:object,
 *          domain:{t0:number,t1:number}, windowSessions:Array}} view
 */
export function miniChartMarkup(view) {
  const { points, summary, domain, windowSessions, color } = view;
  const { xOf, yOf, low, high } = makeScale(
    domain,
    points.map((point) => point.value),
    summary.band,
  );

  const ticks = [low, (low + high) / 2, high]
    .map((value) => {
      const gy = yOf(value);
      return `<line x1="${PAD.left}" y1="${gy}" x2="${WIDTH - PAD.right}" y2="${gy}" class="trend-grid" />
        <text x="${PAD.left - 6}" y="${gy + 4}" class="trend-tick" text-anchor="end">${Math.round(value)}</text>`;
    })
    .join('');

  const band = summary.band
    ? `<rect x="${PAD.left}" y="${yOf(summary.band.high)}" width="${WIDTH - PAD.left - PAD.right}" height="${Math.max(
        2,
        yOf(summary.band.low) - yOf(summary.band.high),
      )}" class="trend-band"><title>你平时的范围 ${summary.band.low}–${summary.band.high}</title></rect>`
    : '';

  const xLabels = dayLabels(windowSessions, xOf)
    .map(
      (day) =>
        `<text x="${day.x}" y="${HEIGHT - 6}" class="trend-tick" text-anchor="middle">${shortDate(day.t)}</text>`,
    )
    .join('');

  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${xOf(point.t)} ${yOf(point.value)}`)
    .join(' ');
  const dots = points
    .map((point, index) => {
      const isLast = index === points.length - 1;
      return `<circle cx="${xOf(point.t)}" cy="${yOf(point.value)}" r="${isLast ? 5 : 3.5}" fill="${
        isLast ? color : '#fff'
      }" stroke="${color}" stroke-width="2" class="trend-dot"><title>${shortDateTime(point.t)}：${point.value}</title></circle>`;
    })
    .join('');

  const lastPoint = points[points.length - 1];
  const lx = xOf(lastPoint.t);
  const ly = yOf(lastPoint.value);
  // 数值标在最新点上方；贴近顶部时放到下方，靠右时右对齐，避免被裁掉。
  const labelY = ly - 9 < PAD.top ? ly + 17 : ly - 9;
  const value = `<text x="${lx > WIDTH - 40 ? lx + 6 : lx}" y="${labelY}" class="trend-value" text-anchor="${
    lx > WIDTH - 40 ? 'end' : 'middle'
  }">${lastPoint.value}</text>`;

  const label = escapeText(`${view.name}走势：最近 ${points.length} 次，最新 ${lastPoint.value}`);
  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" role="img" aria-label="${label}">
    ${ticks}${band}${xLabels}<path d="${path}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" class="trend-line" />${dots}${value}
  </svg>`;
}
