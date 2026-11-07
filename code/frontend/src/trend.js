/**
 * 趋势：只比较两次测评都测过的维度（共同维度），并给出 7 天内的练习效应提示。
 * 纯函数，便于单测。
 */

export const REPEAT_MIN_DAYS = 7;

export function scoredDims(session) {
  const scores = (session && session.scores) || {};
  return Object.keys(scores).filter((id) => typeof scores[id] === 'number');
}

export function commonDims(prev, next) {
  const a = new Set(scoredDims(prev));
  return scoredDims(next).filter((id) => a.has(id));
}

export function daysBetween(prevAt, nextAt) {
  const a = new Date(prevAt).getTime();
  const b = new Date(nextAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor(Math.abs(b - a) / (24 * 60 * 60 * 1000));
}

/**
 * @returns {{rows: Array<{id:string, prev:number, next:number, delta:number}>,
 *            onlyPrev: string[], onlyNext: string[], days: number|null}}
 */
export function buildTrend(prev, next, dimNames = {}) {
  const ids = commonDims(prev, next);
  const prevScores = (prev && prev.scores) || {};
  const nextScores = (next && next.scores) || {};

  const rows = ids.map((id) => ({
    id,
    name: dimNames[id] || id,
    prev: prevScores[id],
    next: nextScores[id],
    delta: nextScores[id] - prevScores[id],
  }));

  const prevAll = scoredDims(prev);
  const nextAll = scoredDims(next);

  return {
    rows,
    onlyPrev: prevAll.filter((id) => !ids.includes(id)),
    onlyNext: nextAll.filter((id) => !ids.includes(id)),
    days: daysBetween(prev && prev.finishedAt, next && next.finishedAt),
  };
}

/** 7 天内复测：提示练习效应，但不禁止。 */
export function repeatHint(days) {
  if (typeof days !== 'number') return null;
  if (days < REPEAT_MIN_DAYS) {
    return `距上次仅 ${days} 天，练习效应可能影响结果；建议间隔 7 天以上再比较趋势。`;
  }
  return null;
}
