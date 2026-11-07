/**
 * scoring-v3.1 的阈值与版本。
 *
 * 与 algorithm.md 的差异说明（L-02）：
 *   文档 v4.0 的分母按 15/20/24 题、60 秒设计，但 M1 实际实现的是
 *   vc 6 题、sv 8 题、am 12 组 + 16 题、ps 45 秒。
 *   若照抄文档公式，vc 全对只能得 40 分。因此本版按实际题量重定分母与锚点，
 *   并把阈值单独放这里，便于以后校准（只改这里，不改公式代码）。
 */

export const SCORING_VERSION = 'scoring-v3.1';

/** 八个维度，顺序与 data.js 的 DIMS 一致。 */
export const DIMENSION_IDS = ['vc', 'vf', 'nc', 'ps', 'ir', 'sv', 'am', 'ni'];

export const CONFIG = {
  /** 固定题量类任务：完成率低于该比例视为未完成，记 null。 */
  minCompletion: 0.8,

  vc: {
    items: 6,
  },

  /** 言语流畅性：10 个有效词 → 0 分，30 个 → 100 分。 */
  vf: {
    floor: 10,
    span: 20,
  },

  /** 数字运算：固定 20 题。 */
  nc: {
    items: 20,
  },

  ps: {
    /** 45 秒内：8 个正确匹配 → 0 分，24 个 → 100 分。 */
    low: 8,
    high: 24,
  },

  /** 归纳推理：固定 15 题。 */
  ir: {
    items: 15,
  },

  sv: {
    items: 8,
    /** 反应时锚点：1500ms → 满分 1，4000ms → 0 分。 */
    rtBest: 1500,
    rtWorst: 4000,
    /** 正确试次少于该值不给分（8 题的一半）。 */
    minCorrect: 4,
    /** 反应时低于该值视为预判/误触，剔除。 */
    minRt: 200,
    wAcc: 0.7,
    wRt: 0.3,
  },

  /** 自然探索：固定 20 题。 */
  ni: {
    items: 20,
  },

  am: {
    /** 12 组词对中抽 8 组做旧题，另配 8 组错配做新题。 */
    targets: 8,
    foils: 8,
  },
};
