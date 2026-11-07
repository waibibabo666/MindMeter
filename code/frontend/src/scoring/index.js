/**
 * 本地计分入口（scoring-v3.1）。
 *
 * 输入：store 里的 results，形如
 *   { vc: { metrics, answers }, ps: { metrics }, sv: { metrics, answers, rts }, am: { ... } }
 * 输出：
 *   {
 *     version: 'scoring-v3.1',
 *     dimensions: { vc, vf, nc, ps, ir, sv, am, ni },   // 未测为 null
 *     measured: ['vc','ps',...],
 *     missing:  ['vf','nc',...]
 *   }
 *
 * 注意：返回值里没有 total / mean / 综合分。这不是遗漏——
 *       M1 明确不设总分，结构上就不给这个字段。
 */

import { CONFIG, DIMENSION_IDS, SCORING_VERSION } from './config.js';
import { scoreAm, scorePs, scoreSv, scoreVc, svMedianRt } from './formulas.js';

export { CONFIG, DIMENSION_IDS, SCORING_VERSION };
export { scoreAm, scorePs, scoreSv, scoreVc, svMedianRt };

/** 从 results 里安全取某任务的结果对象。 */
function pick(results, id) {
  return (results && results[id]) || null;
}

/**
 * 计算一次测评的八维分数。
 * @param {object} results store 中的 results
 * @returns {{version:string, dimensions:object, measured:string[], missing:string[]}}
 */
export function scoreSession(results) {
  const dimensions = {};
  for (const id of DIMENSION_IDS) dimensions[id] = null;

  const vc = pick(results, 'vc');
  const ps = pick(results, 'ps');
  const sv = pick(results, 'sv');
  const am = pick(results, 'am');

  dimensions.vc = vc ? scoreVc(vc.metrics) : null;
  dimensions.ps = ps ? scorePs(ps.metrics) : null;
  dimensions.sv = sv ? scoreSv(sv.metrics) : null;
  dimensions.am = am ? scoreAm(am.metrics, am.answers) : null;

  const measured = DIMENSION_IDS.filter((id) => dimensions[id] !== null);
  const missing = DIMENSION_IDS.filter((id) => dimensions[id] === null);

  // 上游 report.js 约定读 `scores`；`dimensions` 作为等价别名保留，便于阅读与测试。
  const scores = dimensions;
  return { version: SCORING_VERSION, scores, dimensions, measured, missing };
}
