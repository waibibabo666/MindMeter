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

/** 正确率型维度共用：vc / nc / ir / ni。 */
function scoreAccuracy(metrics, expected) {
  if (!metrics) return null;
  const { total, correct } = metrics;
  if (tooFew(total, expected)) return null;
  if (!Number.isFinite(correct) || correct < 0) return null;
  return int100(clamp01(correct / total));
}

/** 言语理解 vc = round(100 × correct / total) */
export function scoreVc(metrics, expected = CONFIG.vc.items) {
  if (!metrics) return null;
  const { total, correct } = metrics;
  if (tooFew(total, expected)) return null;
  if (!Number.isFinite(correct) || correct < 0) return null;
  // 四选一猜测校正：全猜得 0 分，而不是 25 分
  const accuracy = correct / total;
  const corrected = (accuracy - 0.25) / 0.75;
  return int100(clamp01(corrected));
}

/**
 * 知觉速度 ps：45 秒内的正确匹配数，8 个 → 0 分，24 个 → 100 分。
 * 限时任务没有“完成率”，不做 tooFew 检查。
 */
export function scorePs(metrics, seconds = 45) {
  if (!metrics) return null;
  const { encCorrect, encWrong, catCorrect, catWrong } = metrics;

  // 新版：编码 + 分类，错题扣 0.5
  if (Number.isFinite(encCorrect) || Number.isFinite(catCorrect)) {
    const low = 6;
    const high = 30;
    const scale = 45 / Math.max(1, seconds);
    const netEnc = (Number(encCorrect) || 0) - 0.5 * (Number(encWrong) || 0);
    const netCat = (Number(catCorrect) || 0) - 0.5 * (Number(catWrong) || 0);
    const encScore = clamp01((netEnc * scale - low) / (high - low));
    const catScore = clamp01((netCat * scale - low) / (high - low));
    return int100(clamp01(0.7 * encScore + 0.3 * catScore));
  }

  // 旧口径：只有 correct，保留兼容
  const { correct } = metrics;
  if (!Number.isFinite(correct)) return null;
  const { low, high } = CONFIG.ps;
  const rate = seconds === 45 ? correct : correct * (45 / Math.max(1, seconds));
  return int100(clamp01((rate - low) / (high - low)));
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
export function scoreSv(metrics, expected = CONFIG.sv.items) {
  if (!metrics) return null;

  // 新版：加权正确率（展开图按转动次数给权重）
  if (Number.isFinite(metrics.weighted) && Number.isFinite(metrics.total)) {
    if (tooFew(metrics.total, expected)) return null;
    const p = metrics.weighted / metrics.total;
    return int100(clamp01((p - 0.25) / 0.75));
  }

  const { total, correct, correctRts } = metrics;
  if (tooFew(total, expected)) return null;
  if (!Number.isFinite(correct) || correct < CONFIG.sv.minCorrect) return null;

  const rts = filterRts(Array.isArray(correctRts) ? correctRts : [], CONFIG.sv.minRt);
  const rt = median(rts);
  if (rt === null) return null;

  const { rtBest, rtWorst, wAcc, wRt } = CONFIG.sv;
  const accScore = clamp01(correct / total);
  const rtScore = clamp01((rtWorst - rt) / (rtBest ? rtWorst - rtBest : 1));
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

  // PAL 口径：一次点对数 / 目标数，六选一按 1/6 校正
  if (Number.isFinite(metrics.targets) && Number.isFinite(metrics.firstTry)) {
    const rate = metrics.firstTry / Math.max(1, metrics.targets);
    const corrected = (rate - 1 / 6) / (1 - 1 / 6);
    return int100(clamp01(corrected));
  }

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
export function scoreVf(metrics, seconds = 60) {
  if (!metrics) return null;
  if (metrics.unavailable) return null;
  const { validCount } = metrics;
  if (!Number.isFinite(validCount) || validCount < 0) return null;
  const { floor, span } = CONFIG.vf;
  const rate = seconds === 60 ? validCount : validCount * (60 / Math.max(1, seconds));
  return int100(clamp01((rate - floor) / span));
}

/** 数字运算 nc = round(100 × correct / total) */
export function scoreNc(metrics, expected = CONFIG.nc.items) {
  return scoreAccuracy(metrics, expected);
}

/** 归纳推理 ir = round(100 × correct / total) */
export function scoreIr(metrics, expected = CONFIG.ir.items) {
  return scoreAccuracy(metrics, expected);
}

/** 自然知识 ni = round(100 × correct / total) */
export function scoreNi(metrics, expected = CONFIG.ni.items) {
  return scoreAccuracy(metrics, expected);
}
