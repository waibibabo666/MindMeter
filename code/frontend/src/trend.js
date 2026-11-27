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

/**
 * 间隔较短时的提示：照常展示变化，只提醒「练习效应可能参与其中」，不劝用户等。
 * 7 天是练习效应基本散去的保守线，不是比较的门槛；同一天内复测另说一句。
 */
export function repeatHint(days) {
  if (typeof days !== 'number') return null;
  if (days === 0) {
    return '两次都在同一天，疲劳与热身会混进差值，更像状态波动；练习效应也可能参与其中。';
  }
  if (days < REPEAT_MIN_DAYS) {
    return `距上次 ${days} 天，变化可以先看；练习效应可能参与其中，多测几次再看是否稳定。`;
  }
  return null;
}
