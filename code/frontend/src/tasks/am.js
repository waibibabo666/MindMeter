/**
 * 联想记忆：图案—位置配对（PAL）。
 *
 * 先看六个图案依次出现在哪个方格，再按提示把图案点回原来的位置；
 * 指标只有「一次点对组数 / 目标组数 / 重试次数」，六选一按 1/6 校正。
 */
import { mountPal } from './amPal.js';

export const amTask = {
  id: 'am',
  mount(root, ctx) {
    return mountPal(root, ctx);
  },
};
