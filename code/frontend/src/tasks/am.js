/**
 * 联想记忆：先学 12 组词对，再做 16 题配对再认。
 * 记录命中、漏报、虚报、正确拒绝；不计分。
 */
import { AM_PAIRS } from '../data.js';
import { mountPal } from './amPal.js';
import { mulberry32, shuffle } from '../random.js';


/** 构造再认题：8 组原配（旧）+ 8 组错配（新）。 */
export function buildRecognition(seed = 20261107) {
  const random = mulberry32(seed);
  const originSet = new Set(AM_PAIRS.map(([l, r]) => `${l}|${r}`));
  const order = shuffle(
    AM_PAIRS.map((_, i) => i),
    random,
  );
  const oldIndexes = order.slice(0, 8);

  const olds = oldIndexes.map((i) => ({
    left: AM_PAIRS[i][0],
    right: AM_PAIRS[i][1],
    isOld: true,
  }));

  // 错配：用第 k 个词的左词 + 第 k+1 个词的右词，保证不是原配。
  const foils = oldIndexes
    .map((i, k) => {
      const j = oldIndexes[(k + 1) % oldIndexes.length];
      return { left: AM_PAIRS[i][0], right: AM_PAIRS[j][1], isOld: false };
    })
    .filter((pair) => !originSet.has(`${pair.left}|${pair.right}`));

  return shuffle([...olds, ...foils], random);
}

export function summarizeAm(trials) {
  const hits = trials.filter((t) => t.isOld && t.answer).length;
  const misses = trials.filter((t) => t.isOld && !t.answer).length;
  const falseAlarms = trials.filter((t) => !t.isOld && t.answer).length;
  const correctRejections = trials.filter((t) => !t.isOld && !t.answer).length;
  return {
    trials: trials.length,
    hits,
    misses,
    falseAlarms,
    correctRejections,
    accuracy:
      trials.length === 0 ? null : Number(((hits + correctRejections) / trials.length).toFixed(3)),
  };
}





export const amTask = {
  id: 'am',
  mount(root, ctx) {
    return mountPal(root, ctx);
  },
};
