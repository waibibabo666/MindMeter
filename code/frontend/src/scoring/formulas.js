/**
 * 四个维度的计分公式（scoring-v3.1）。
 *
 * 统一约定：
 *   - 输入是任务上报的 metrics（原始指标），不读全局状态；
 *   - 返回 0–100 的整数，或 null（未测 / 数据不足）；
 *   - 任何公式都不返回总分，也不互相组合。
 */

import { CONFIG } from './config.js';
import { clamp01, filterRts, median, zInv } from './stats.js';

/**
 * 统一取整：先加 1e-9 再四舍五入。
 *
 * 原因：加权分会出现“手算正好是 x.5、浮点算出 x.4999999”的情况，
 * 例如 0.7×0.75 + 0.3×0.6 = 0.705 → 70.5，浮点得到 70.49999...，
 * 直接 Math.round 会得到 70，与人手算的 71 不一致。
 * 加一个远小于最小可分辨差（0.01）的 epsilon，把“真 .5”稳定地向上取整。
 */
const int100 = (x) => Math.round(100 * x + 1e-9);

/** 固定题量任务的完成率检查：答得太少直接判未完成。 */
function tooFew(total, expected) {
  return !Number.isFinite(total) || total < expected * CONFIG.minCompletion;
}

/** 言语理解 vc = round(100 × correct / total) */
export function scoreVc(metrics) {
  if (!metrics) return null;
  const { total, correct } = metrics;
  if (tooFew(total, CONFIG.vc.items)) return null;
  if (!Number.isFinite(correct) || correct < 0) return null;
  return int100(clamp01(correct / total));
}

/**
 * 知觉速度 ps：45 秒内的正确匹配数，8 个 → 0 分，24 个 → 100 分。
 * 限时任务没有“完成率”，不做 tooFew 检查。
 */
export function scorePs(metrics) {
  if (!metrics) return null;
  const { correct } = metrics;
  if (!Number.isFinite(correct)) return null;
  const { low, high } = CONFIG.ps;
  return int100(clamp01((correct - low) / (high - low)));
}

/**
 * 供报告展示用的中位反应时：与计分使用完全相同的剔除规则，
 * 避免“显示的中位数”和“参与计分的中位数”不一致。
 */
export function svMedianRt(metrics) {
  if (!metrics || !Array.isArray(metrics.correctRts)) return null;
  const rt = median(filterRts(metrics.correctRts, CONFIG.sv.minRt));
  return rt === null ? null : Math.round(rt);
}

/**
 * 空间视觉化 sv = 100 × (0.7 × 正确率 + 0.3 × 反应时得分)
 * 反应时只统计正确试次，剔除 <200ms 与 >3×中位数的异常值。
 */
export function scoreSv(metrics) {
  if (!metrics) return null;
  const { total, correct, correctRts } = metrics;
  if (tooFew(total, CONFIG.sv.items)) return null;
  if (!Number.isFinite(correct) || correct < CONFIG.sv.minCorrect) return null;

  const rts = filterRts(Array.isArray(correctRts) ? correctRts : [], CONFIG.sv.minRt);
  const rt = median(rts);
  if (rt === null) return null;

  const { rtBest, rtWorst, wAcc, wRt } = CONFIG.sv;
  const accScore = clamp01(correct / total);
  const rtScore = clamp01((rtWorst - rt) / (rtWorst - rtBest));
  return int100(clamp01(wAcc * accScore + wRt * rtScore));
}

/**
 * 联想记忆 am：信号检测论
 *   H = (hits + 0.5) / (targets + 1)
 *   F = (falseAlarms + 0.5) / (foils + 1)
 *   d' = z(H) − z(F)
 *   am = round(100 × clamp01((d' + 1) / 5))   // d' = −1 → 0，d' = 4 → 100
 *
 * targets / foils 优先从 answers 里数（再认题数量可能因去重而少于配置值），
 * 数不出来时退回 config 的默认值。
 */
export function scoreAm(metrics, answers) {
  if (!metrics) return null;
  const { hits, falseAlarms } = metrics;
  if (!Number.isFinite(hits) || !Number.isFinite(falseAlarms)) return null;

  let { targets, foils } = CONFIG.am;
  if (Array.isArray(answers) && answers.length > 0) {
    const oldCount = answers.filter((a) => a && a.isOld).length;
    const newCount = answers.filter((a) => a && !a.isOld).length;
    if (oldCount > 0) targets = oldCount;
    if (newCount > 0) foils = newCount;
  }

  const H = (hits + 0.5) / (targets + 1);
  const F = (falseAlarms + 0.5) / (foils + 1);
  const dPrime = zInv(H) - zInv(F);
  return int100(clamp01((dPrime + 1) / 5));
}

/** 言语流畅性 vf = round(100 × clamp01((validCount − 10) / 20)) */
export function scoreVf(metrics) {
  if (!metrics) return null;
  const { validCount } = metrics;
  if (!Number.isFinite(validCount) || validCount < 0) return null;
  const { floor, span } = CONFIG.vf;
  return int100(clamp01((validCount - floor) / span));
}

/** 数字运算 nc = round(100 × correct / total) */
export function scoreNc(metrics) {
  if (!metrics) return null;
  const { total, correct } = metrics;
  if (tooFew(total, CONFIG.nc.items)) return null;
  if (!Number.isFinite(correct) || correct < 0) return null;
  return int100(clamp01(correct / total));
}

/** 归纳推理 ir = round(100 × correct / total) */
export function scoreIr(metrics) {
  if (!metrics) return null;
  const { total, correct } = metrics;
  if (tooFew(total, CONFIG.ir.items)) return null;
  if (!Number.isFinite(correct) || correct < 0) return null;
  return int100(clamp01(correct / total));
}

/** 自然探索 ni = round(100 × correct / total) */
export function scoreNi(metrics) {
  if (!metrics) return null;
  const { total, correct } = metrics;
  if (tooFew(total, CONFIG.ni.items)) return null;
  if (!Number.isFinite(correct) || correct < 0) return null;
  return int100(clamp01(correct / total));
}
