/**
 * 空间视觉化：旋转与镜像。
 *
 * 复用测评任务的图形工具（tasks/sv.js），但作为游戏提供即时反馈与计分。
 * 题目由基础图案生成：正确项是旋转/镜像结果，干扰项取其他角度。
 */
import { buildItems, mirror, rotate } from '../tasks/sv.js';
import { createQuizGame } from './quiz.js';

const same = (a, b) => a.every((v, i) => v === b[i]);

/** 生成 8 道旋转题：题干是原图，选项是四个旋转结果。 */
export function buildRotateBank(items = buildItems()) {
  return items.slice(0, 8).map((item) => {
    const base = item.base;
    const correct = rotate(base, 90);
    const candidates = [rotate(base, 180), rotate(base, 270), mirror(base)];
    const distractors = [];
    for (const candidate of candidates) {
      if (same(candidate, correct)) continue;
      if (distractors.some((d) => same(d, candidate))) continue;
      distractors.push(candidate);
      if (distractors.length === 3) break;
    }
    const options = [correct, ...distractors].map((grid) => ({ grid }));
    return { prompt: '把上面的图案顺时针旋转 90°，是哪一张？', grid: base, options, answer: 0 };
  });
}

/** 生成 8 道镜像题：题干是原图，正确项是左右镜像。 */
export function buildMirrorBank(items = buildItems()) {
  return items.slice(0, 8).map((item) => {
    const base = item.base;
    const correct = mirror(base);
    const candidates = [rotate(base, 90), rotate(base, 180), rotate(base, 270)];
    const distractors = [];
    for (const candidate of candidates) {
      if (same(candidate, correct)) continue;
      if (distractors.some((d) => same(d, candidate))) continue;
      distractors.push(candidate);
      if (distractors.length === 3) break;
    }
    const options = [correct, ...distractors].map((grid) => ({ grid }));
    return { prompt: '把上面的图案左右翻转，是哪一张？', grid: base, options, answer: 0 };
  });
}

export const svRotate = createQuizGame({
  id: 'svRotate',
  dim: 'sv',
  title: '图案旋转',
  desc: '把三乘三图案顺时针转 90°，从四张图里选出来。',
  bank: buildRotateBank(),
  pick: 8,
});

export const svMirror = createQuizGame({
  id: 'svMirror',
  dim: 'sv',
  title: '镜像翻转',
  desc: '把图案左右翻转，从四张图里选出来。',
  bank: buildMirrorBank(),
  pick: 8,
});
