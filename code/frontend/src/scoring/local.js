/**
 * 本地参考分（L-08 临时代管）。
 *
 * 正式分数由 L-02 的 `scoring-v3` 产生；这里只把当前壳的 4 项原始指标
 * 折算成 0–100 的整数，用来出雷达图和趋势。差异点：
 *   - 题目数量比 scoring-v3 的设计短（言语理解 6 题而非 15 题），
 *     因此按“实际题量”缩放，而不是按算法文档里的固定分母；
 *   - 没有常模、没有百分位，分数只代表本次任务表现。
 *
 * 一旦 L-02 合入，把 `scoreSession` 换成它的实现即可，页面无需改动。
 */

export const SCORING_VERSION = 'local-provisional-v1';

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function percent(numerator, denominator) {
  if (!denominator || denominator <= 0) return null;
  return Math.round(100 * clamp01(numerator / denominator));
}

/** 标准正态分位数，Acklam 近似；用于联想记忆的 d'。 */
export function zscore(p) {
  const value = Math.min(1 - 1e-9, Math.max(1e-9, p));
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  const high = 1 - low;

  if (value < low) {
    const q = Math.sqrt(-2 * Math.log(value));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (value > high) {
    const q = Math.sqrt(-2 * Math.log(1 - value));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = value - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

export function scoreVc(metrics) {
  return metrics ? percent(metrics.correct, metrics.total) : null;
}

/** 45 秒窗口内的匹配正确率；题量随人而异，按实际完成的题数缩放。 */
export function scorePs(metrics) {
  return metrics ? percent(metrics.correct, metrics.trials) : null;
}

export function scoreSv(metrics) {
  if (!metrics || !metrics.total) return null;
  const accuracy = clamp01(metrics.correct / metrics.total);
  const rt = typeof metrics.medianRtMs === 'number' ? metrics.medianRtMs : metrics.meanRtMs;
  if (typeof rt !== 'number') {
    // 没有反应时数据时只看正确率，不做 0.7/0.3 加权。
    return Math.round(100 * accuracy);
  }
  const rtScore = clamp01((5000 - rt) / 3000);
  return Math.round(100 * (0.7 * accuracy + 0.3 * rtScore));
}

export function scoreAm(metrics) {
  if (!metrics || !metrics.trials) return null;
  const foils =
    typeof metrics.foils === 'number'
      ? metrics.foils
      : Math.max(0, metrics.trials - (metrics.targets || metrics.hits + metrics.misses));
  const targets =
    typeof metrics.targets === 'number' ? metrics.targets : metrics.hits + metrics.misses;
  if (!targets || !foils) return null;
  const hitRate = (metrics.hits + 0.5) / (targets + 1);
  const faRate = (metrics.falseAlarms + 0.5) / (foils + 1);
  const dPrime = zscore(hitRate) - zscore(faRate);
  return Math.round(100 * clamp01((dPrime + 1) / 5));
}

const SCORERS = { vc: scoreVc, ps: scorePs, sv: scoreSv, am: scoreAm };

/**
 * @param {{[dimId: string]: {metrics?: object}}} results 形如 {vc: {taskId, metrics}}
 * @returns {{version: string, scores: {[dimId: string]: number|null}}}
 */
export function scoreSession(results) {
  const scores = {};
  for (const [id, scorer] of Object.entries(SCORERS)) {
    const payload = results && results[id];
    scores[id] = payload && payload.metrics ? scorer(payload.metrics) : null;
  }
  return { version: SCORING_VERSION, scores };
}
