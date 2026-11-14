/**
 * 三档参数表。
 *
 * 同一维度在三档里用**同一个测量工具**，只改题量/时长，
 * 这样跨档分数方向可比，差别只在精度。
 */

/** 每档每维的题量（限时维度是秒数）。 */
export const LEVEL_SPEC = {
  quick: {
    vc: { items: 4 },
    ps: { seconds: 20 },
    sv: { items: 6 },
    am: { pairs: 6, items: 8, studySeconds: 12 },
    nc: { items: 4 },
    ir: { items: 4 },
    ni: { items: 6 },
    vf: { seconds: 30 },
  },
  standard: {
    vc: { items: 6 },
    ps: { seconds: 45 },
    sv: { items: 8 },
    am: { pairs: 12, items: 16, studySeconds: 20 },
    nc: { items: 8 },
    ir: { items: 8 },
    ni: { items: 8 },
    vf: { seconds: 60 },
  },
  deep: {
    vc: { items: 6 },
    ps: { seconds: 90 },
    sv: { items: 12 },
    am: { pairs: 12, items: 16, studySeconds: 20 },
    nc: { items: 8 },
    ir: { items: 8 },
    ni: { items: 8 },
    vf: { seconds: 90 },
  },
};

export const LEVELS = ['quick', 'standard', 'deep'];

export function specFor(level, dim) {
  const table = LEVEL_SPEC[level] || LEVEL_SPEC.standard;
  return table[dim] || LEVEL_SPEC.standard[dim];
}

/** 题库不够时按上限截断，返回实际题量。 */
export function sliceItems(list, n) {
  const limit = Math.min(Number(n) || list.length, list.length);
  return list.slice(0, limit);
}

/**
 * 二项标准误 → 95% 置信区间半宽（分）。
 * 用于报告里表达「这个分数有多准」。
 */
export function ciHalfWidth(score, n, guessRate = 0) {
  if (!Number.isFinite(score) || n <= 0) return null;
  // 加一平滑：全对或全错时也给出区间，避免出现 ±0 的假精确
  const p = (Math.max(0, Math.min(1, score / 100)) * n + 1) / (n + 2);
  const se = Math.sqrt((p * (1 - p)) / (n + 2));
  const scale = guessRate > 0 ? 1 / (1 - guessRate) : 1;
  return Math.round(1.96 * se * 100 * scale);
}

/** 限时维度的经验区间（秒数越短越宽）。 */
const TIMED_CI = {
  ps: { 20: 49, 45: 33, 90: 23 },
  vf: { 30: 56, 60: 40, 90: 33 },
};

export function timedCi(dim, seconds) {
  const table = TIMED_CI[dim];
  if (!table) return null;
  const key = Object.keys(table)
    .map(Number)
    .sort((a, b) => Math.abs(a - seconds) - Math.abs(b - seconds))[0];
  return table[key] ?? null;
}
