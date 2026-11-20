/**
 * 联想记忆：PAL 式（配对联想学习）。
 *
 * 流程：
 *   1. 六个方格依次亮出图案，每个图案固定在一个位置
 *   2. 图案消失，屏幕给出一张图案
 *   3. 点它刚才所在的方格；点错会再亮一次正确答案，重试
 *
 * 计分用「一次点对数」：六选一有 1/6 的猜中概率，按此校正。
 */
import { el, clear } from '../ui.js';
import { shapeNode } from './shapes.js';

const BOXES = 6;
const SHOW_MS = 700;
const CUE_MS = 900;
const MAX_RETRY = 2;

function shuffle(list, random = Math.random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

const COMBOS = [
  { shape: 'circle', color: 'red' },
  { shape: 'square', color: 'blue' },
  { shape: 'triangle', color: 'green' },
  { shape: 'diamond', color: 'yellow' },
  { shape: 'star', color: 'purple' },
  { shape: 'hexagon', color: 'orange' },
];

/** 生成一局：把 count 个图案分配到不同方格。 */
export function buildPalTrials(count = 4, random = Math.random) {
  const boxes = shuffle(
    Array.from({ length: BOXES }, (_, i) => i),
    random,
  ).slice(0, Math.min(count, BOXES));
  const combos = shuffle(COMBOS, random).slice(0, boxes.length);
  return boxes.map((box, i) => ({ ...combos[i], box }));
}

/** 一次点对的正确率（六选一，按 1/6 猜中基线校正）。 */
export function scorePal(firstTryCorrect, targets) {
  const total = Math.max(1, Number(targets) || 1);
  const rate = (Number(firstTryCorrect) || 0) / total;
  const guess = 1 / BOXES;
  const corrected = (rate - guess) / (1 - guess);
  return Math.max(0, Math.min(1, corrected)) * 100;
}

export function mountPal(root, ctx) {
  const count = Math.min(BOXES, (ctx.spec && ctx.spec.pairs) || 4);
  const trials = buildPalTrials(count);

  let index = 0;
  let firstTry = 0;
  let errors = 0;
  let retry = 0;
  let closed = false;
  let phase = 'study';

  const status = el('p', { class: 'game-status', text: '记住每个图案出现的位置' });
  const board = el('div', { class: 'pal-board' });
  const prompt = el('div', { class: 'pal-prompt' });
  root.appendChild(status);
  root.appendChild(board);
  root.appendChild(prompt);

  const cells = [];
  for (let i = 0; i < BOXES; i += 1) {
    const cell = el('button', { class: 'pal-cell', type: 'button', 'data-box': String(i) });
    cell.addEventListener('click', () => onCell(i));
    cells.push(cell);
    board.appendChild(cell);
  }

  const finish = () => {
    if (closed) return;
    closed = true;
    ctx.finish(null, { targets: trials.length, firstTry, errors });
  };

  const paintCell = (box, combo) => {
    clear(cells[box]);
    cells[box].appendChild(shapeNode(combo.shape, combo.color, 34));
  };

  const showStudy = () => {
    phase = 'study';
    status.textContent = '记住每个图案出现的位置';
    let step = 0;
    const tick = globalThis.setInterval(() => {
      if (closed) return;
      if (step > 0) clear(cells[trials[step - 1].box]);
      if (step >= trials.length) {
        globalThis.clearInterval(tick);
        askNext();
        return;
      }
      paintCell(trials[step].box, trials[step]);
      step += 1;
    }, SHOW_MS);
  };

  const askNext = () => {
    const trial = trials[index];
    if (!trial) {
      finish();
      return;
    }
    phase = 'test';
    retry = 0;
    clear(prompt);
    prompt.appendChild(el('span', { class: 'tiny', text: '这个图案刚才在哪个格子？' }));
    prompt.appendChild(shapeNode(trial.shape, trial.color, 40));
    status.textContent = `第 ${index + 1} / ${trials.length} 个图案`;
  };

  const onCell = (box) => {
    if (closed || phase !== 'test') return;
    const trial = trials[index];
    if (!trial) return;

    if (box === trial.box) {
      if (retry === 0) firstTry += 1;
      index += 1;
      askNext();
      return;
    }

    errors += 1;
    retry += 1;
    cells[trial.box].classList.add('hint');
    globalThis.setTimeout(() => {
      cells[trial.box].classList.remove('hint');
    }, CUE_MS);

    if (retry > MAX_RETRY) {
      // 放弃这一个，进入下一个；该题不计入一次点对
      index += 1;
      askNext();
      return;
    }
    status.textContent = `不对，正确答案闪了一下 · 再试一次（第 ${retry + 1} 次）`;
  };

  showStudy();

  return () => {
    closed = true;
    clear(root);
  };
}
