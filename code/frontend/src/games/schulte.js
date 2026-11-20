/**
 * 舒尔特方格（知觉速度 ps）。
 * 5×5 打乱 1–25，按顺序点击，60 秒限时；点错不中断，只扣分。
 */
import { el, clear, now } from '../ui.js';

const SIZE = 5;
const TOTAL = SIZE * SIZE;
const LIMIT_MS = 60000;

/** 生成打乱的 1..25；传入随机源便于测试固定结果。 */
export function buildBoard(random = Math.random) {
  const nums = [];
  for (let i = 1; i <= TOTAL; i += 1) nums.push(i);
  for (let i = nums.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = nums[i];
    nums[i] = nums[j];
    nums[j] = tmp;
  }
  return nums;
}

/** 以完成数占比为主，错点每次扣 2 分。 */
export function scoreSchulte(completed, mistakes) {
  const safeDone = Math.max(0, Math.min(TOTAL, Number(completed) || 0));
  const safeMiss = Math.max(0, Number(mistakes) || 0);
  return Math.max(0, Math.round((safeDone / TOTAL) * 100 - safeMiss * 2));
}

function cellButton(value, onPick) {
  const node = el('button', { class: 'scell', type: 'button', text: String(value) });
  node.addEventListener('click', () => onPick(value, node));
  return node;
}

export const schulte = {
  id: 'schulte',
  dim: 'ps',
  title: '舒尔特方格',
  desc: '25 个数字打乱排列，按 1→25 的顺序依次点击。点错不中断，但会扣分。',
  mount(root, ctx) {
    const board = buildBoard();
    let next = 1;
    let mistakes = 0;
    let closed = false;
    const startedAt = now();

    const grid = el('div', { class: 'game-grid schulte' });
    const status = el('p', { class: 'game-status', text: '下一个：1' });

    const finish = () => {
      if (closed) return;
      closed = true;
      globalThis.clearInterval(timer);
      ctx.finish(scoreSchulte(next - 1, mistakes), {
        completed: next - 1,
        mistakes,
        ms: Math.round(now() - startedAt),
      });
    };

    const pick = (value, node) => {
      if (closed) return;
      if (value !== next) {
        mistakes += 1;
        node.classList.add('miss');
        globalThis.setTimeout(() => node.classList.remove('miss'), 180);
        status.textContent = `下一个：${next}（错点 ${mistakes}）`;
        return;
      }
      node.classList.add('done');
      next += 1;
      if (next > TOTAL) {
        finish();
        return;
      }
      status.textContent = `下一个：${next}`;
    };

    for (const value of board) grid.appendChild(cellButton(value, pick));
    root.appendChild(status);
    root.appendChild(grid);

    const timer = globalThis.setInterval(() => {
      const left = Math.max(0, LIMIT_MS - (now() - startedAt));
      if (closed) return;
      if (left <= 0) {
        finish();
        return;
      }
      status.textContent = `下一个：${next} · 剩余 ${(left / 1000).toFixed(1)}s`;
    }, 100);

    return () => {
      closed = true;
      globalThis.clearInterval(timer);
      clear(grid);
    };
  },
};
