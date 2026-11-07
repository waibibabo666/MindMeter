/**
 * 本地计分（L-02）：scoring-v3 的 8 个维度公式。
 *
 * 口径说明（重要）：
 *   - `full`  —— 与 docs/algorithm/algorithm.md 完全一致：言语理解 15 题、
 *                知觉速度以 60 次匹配为满分基准、空间 20 题、记忆 12 目标 + 12 干扰；
 *   - `short` —— 本壳当前的实际题量（言语 6、空间 8、记忆 8+8），
 *                分母按实际题数缩放，否则满分只有 40 分。
 *
 * M1 用 short；M2 接后端后由服务端用 full。两者共用同一套公式与边界规则，
 * 只是分母不同，切换只需传第二个参数。
 *
 * 规则（来自算法文档）：
 *   - 结果截断到 0–100 的整数，不人为压到 5–98；
 *   - 缺失/未测返回 null，绝不补 0；
 *   - 空间视觉化正确试次不足一半 → null；
 *   - 联想记忆用 d′，命中与虚报都做 +0.5 / +1 校正。
 */

export const SCORING_VERSION = 'local-provisional-v2';

export const FORM = Object.freeze({ FULL: 'full', SHORT: 'short' });

export const CONFIG = Object.freeze({
  full: {
    vc: 15,
    vf: { floor: 10, span: 20 },
    nc: 20,
    ps: { base: 20, span: 40 },
    ir: 15,
    sv: { items: 20, minCorrect: 10, rtFloor: 5000, rtSpan: 3000, accWeight: 0.7, rtWeight: 0.3 },
    am: { targets: 12, foils: 12 },
    ni: 20,
  },
  short: {
    vc: 6,
    vf: { floor: 10, span: 20 },
    nc: 20,
    ps: { ratio: true },
    ir: 15,
    sv: { items: 8, minCorrect: 4, rtFloor: 5000, rtSpan: 3000, accWeight: 0.7, rtWeight: 0.3 },
    am: { targets: 8, foils: 8 },
    ni: 20,
  },
});

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const toScore = (ratio) => Math.round(100 * clamp01(ratio));

/** 标准正态分位数，Acklam 近似。 */
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

function resolveTotal(metrics, form, dim) {
  if (form === FORM.FULL) return CONFIG.full[dim];
  return typeof metrics.total === 'number' ? metrics.total : CONFIG.short[dim];
}

export function scoreVc(metrics, form = FORM.SHORT) {
  if (!metrics || typeof metrics.correct !== 'number') return null;
  const denominator = resolveTotal(metrics, form, 'vc');
  if (!denominator) return null;
  return toScore(metrics.correct / denominator);
}

export function scoreVf(metrics, form = FORM.SHORT) {
  if (!metrics || typeof metrics.validCount !== 'number') return null;
  const { floor, span } = CONFIG[form].vf;
  return toScore((metrics.validCount - floor) / span);
}

export function scoreNc(metrics, form = FORM.SHORT) {
  if (!metrics || typeof metrics.correct !== 'number') return null;
  const denominator = resolveTotal(metrics, form, 'nc');
  if (!denominator) return null;
  return toScore(metrics.correct / denominator);
}

export function scorePs(metrics, form = FORM.SHORT) {
  if (!metrics || typeof metrics.correct !== 'number') return null;
  if (form === FORM.FULL) {
    const { base, span } = CONFIG.full.ps;
    return toScore((metrics.correct - base) / span);
  }
  const trials = metrics.trials || 0;
  if (!trials) return null;
  return toScore(metrics.correct / trials);
}

export function scoreIr(metrics, form = FORM.SHORT) {
  if (!metrics || typeof metrics.correct !== 'number') return null;
  const denominator = resolveTotal(metrics, form, 'ir');
  if (!denominator) return null;
  return toScore(metrics.correct / denominator);
}

export function scoreSv(metrics, form = FORM.SHORT) {
  if (!metrics || !metrics.total) return null;
  const cfg = CONFIG[form].sv;
  const minCorrect =
    form === FORM.FULL ? cfg.minCorrect : Math.max(1, Math.ceil(metrics.total / 2));
  if (metrics.correct < minCorrect) return null;

  const accuracy = clamp01(metrics.correct / metrics.total);
  const rt = typeof metrics.medianRtMs === 'number' ? metrics.medianRtMs : metrics.meanRtMs;
  if (typeof rt !== 'number') return toScore(accuracy);

  const rtScore = clamp01((cfg.rtFloor - rt) / cfg.rtSpan);
  return toScore(cfg.accWeight * accuracy + cfg.rtWeight * rtScore);
}

export function scoreAm(metrics, form = FORM.SHORT) {
  if (!metrics || typeof metrics.hits !== 'number') return null;
  const cfg = CONFIG[form].am;
  const targets =
    typeof metrics.targets === 'number' ? metrics.targets : metrics.hits + (metrics.misses || 0);
  const foils =
    typeof metrics.foils === 'number'
      ? metrics.foils
      : typeof metrics.trials === 'number'
        ? Math.max(0, metrics.trials - targets)
        : cfg.foils;
  if (!targets || !foils) return null;

  const hitRate = (metrics.hits + 0.5) / (targets + 1);
  const faRate = ((metrics.falseAlarms || 0) + 0.5) / (foils + 1);
  const dPrime = zscore(hitRate) - zscore(faRate);
  return toScore((dPrime + 1) / 5);
}

export function scoreNi(metrics, form = FORM.SHORT) {
  if (!metrics || typeof metrics.correct !== 'number') return null;
  const denominator = resolveTotal(metrics, form, 'ni');
  if (!denominator) return null;
  return toScore(metrics.correct / denominator);
}

export const SCORERS = Object.freeze({
  vc: scoreVc,
  vf: scoreVf,
  nc: scoreNc,
  ps: scorePs,
  ir: scoreIr,
  sv: scoreSv,
  am: scoreAm,
  ni: scoreNi,
});

export const DIM_IDS = Object.freeze(Object.keys(SCORERS));

/**
 * @param {{[dimId: string]: {metrics?: object}}} results
 * @param {'full'|'short'} form
 * @returns {{version: string, form: string, scores: {[dimId: string]: number|null}}}
 */
export function scoreSession(results, form = FORM.SHORT) {
  const scores = {};
  for (const [id, scorer] of Object.entries(SCORERS)) {
    const payload = results && results[id];
    scores[id] = payload && payload.metrics ? scorer(payload.metrics, form) : null;
  }
  return { version: SCORING_VERSION, form, scores };
}
