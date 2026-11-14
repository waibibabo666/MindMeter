/**
 * 空间视觉化：3×3 图案旋转四选一。
 * 只记录正确数与反应时；旋转用纯函数实现，可在 Node 侧单测。
 */
import { SV_PATTERNS } from '../data.js';
import { mountSv } from './svMount.js';
import { mulberry32, shuffle } from '../random.js';

const SIZE = 3;

function rotateOnce(grid) {
  const out = new Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      out[c * SIZE + (SIZE - 1 - r)] = grid[r * SIZE + c];
    }
  }
  return out;
}

export function rotate(grid, degrees) {
  const quarter = ((Math.round(degrees / 90) % 4) + 4) % 4;
  let out = grid.slice();
  for (let i = 0; i < quarter; i += 1) out = rotateOnce(out);
  return out;
}

export function mirror(grid) {
  const out = new Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      out[r * SIZE + (SIZE - 1 - c)] = grid[r * SIZE + c];
    }
  }
  return out;
}

const same = (a, b) => a.every((v, i) => v === b[i]);

export function buildItem(base, random) {
  const correct = rotate(base, 90);
  const seen = new Set([correct.join('')]);
  const distractors = [];

  // 先试所有旋转与镜像；对称图案会退化，因此还需要兜底变体。
  const candidates = shuffle(
    [
      rotate(base, 0),
      rotate(base, 180),
      rotate(base, 270),
      mirror(base),
      mirror(rotate(base, 180)),
    ],
    random,
  );

  for (const candidate of candidates) {
    if (distractors.length === 3) break;
    const key = candidate.join('');
    if (seen.has(key)) continue;
    seen.add(key);
    distractors.push(candidate);
  }

  // 兜底：翻转正确图案的某个单元格，保证四个选项互不相同。
  let cursor = 0;
  while (distractors.length < 3) {
    const variant = correct.slice();
    variant[cursor % variant.length] = variant[cursor % variant.length] ? 0 : 1;
    cursor += 1;
    const key = variant.join('');
    if (seen.has(key)) continue;
    seen.add(key);
    distractors.push(variant);
  }

  const options = shuffle([correct, ...distractors], random);
  return {
    base: base.slice(),
    options,
    answer: options.findIndex((grid) => same(grid, correct)),
  };
}

export function buildItems(seed = 20261107) {
  const random = mulberry32(seed);
  return SV_PATTERNS.map((base) => buildItem(base, random));
}

/**
 * @param {boolean[]} answers 每题是否答对
 * @param {number[]} rts     每题反应时（毫秒），与 answers 同下标
 * 额外返回 correctRts，供 scoring 计算 sv 的反应时得分（L-02）。
 */
export function summarizeSv(answers, rts = []) {
  const total = answers.length;
  const correct = answers.filter(Boolean).length;
  const correctRts = answers
    .map((ok, i) => (ok ? rts[i] : null))
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  return {
    total,
    correct,
    accuracy: total === 0 ? null : Number((correct / total).toFixed(3)),
    correctRts,
  };
}


export const svTask = {
  id: 'sv',
  mount(root, ctx) {
    return mountSv(root, ctx);
  },
};
