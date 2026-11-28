/**
 * 归纳推理：瑞文式 3×3 图形矩阵。
 *
 * 六种规则轮换出题：数量递增、数量递减、形状循环、位置轮换、叠加、交替。
 * 干扰项各对应一种典型错误，避免「随便画三个」。
 */
import { el, clear } from '../ui.js';

const SHAPES = ['●', '▲', '■', '◆'];

// 单格最多 5 个符号：diagonal / combine 的右下角正好是 5。
// 原来钳到 4 会把「应为 5」的答案画成 4，与左邻上邻撞车。
const MAX_COUNT = 5;

function randInt(min, max, random = Math.random) {
  return min + Math.floor(random() * (max - min + 1));
}

/** 六种「行规则 × 列规则」组合。 */
const RULES = {
  rowShape: (r, c, A) => ({ shape: SHAPES[r % 3], count: c + 1, base: A }),
  colShape: (r, c) => ({ shape: SHAPES[c % 3], count: r + 1 }),
  diagonal: (r, c) => ({ shape: SHAPES[(r + c) % 3], count: r + c + 1 }),
  combine: (r, c, A) => ({ shape: A, count: r + c + 1 }),
  alternate: (r, c, A) => ({
    shape: r % 2 === 0 ? A : SHAPES[(SHAPES.indexOf(A) + 1) % 4],
    count: c + 1,
  }),
  mirror: (r, c) => ({ shape: SHAPES[c % 3], count: 3 - r }),
};

/** 生成四个互不相同的选项：正确答案 + 三个干扰项。 */
function buildOptions(answer, shapes, random) {
  // 干扰项要**四个互不相同**：先给"只错数量/只错形状/两样都错"，
  // 数量为 1 时 ±1 会被夹回 1（旧实现因此和正确答案撞车，出现两个正确项），
  // 所以候选按"难度优先"排好后去重，不够再从"题干出现过的形状 × 数量"里补。
  // 形状限定在题干出现过的集合，避免干扰项用了根本没出现过的图形（一眼排除）。
  const clampCount = (value) => Math.min(MAX_COUNT, Math.max(1, value));
  const cellKey = (value) => `${value.shape}:${value.count}`;
  const pool = shapes.length ? shapes : [answer.shape];
  const otherShape = pool.find((shape) => shape !== answer.shape) || answer.shape;
  const ordered = [
    { shape: answer.shape, count: clampCount(answer.count + 1) },
    { shape: answer.shape, count: clampCount(answer.count - 1) },
    { shape: otherShape, count: answer.count },
    { shape: otherShape, count: clampCount(answer.count + 1) },
    { shape: otherShape, count: clampCount(answer.count - 1) },
  ];
  for (const shape of pool) {
    for (let count = 1; count <= MAX_COUNT; count += 1) ordered.push({ shape, count });
  }
  const options = [answer];
  for (const candidate of ordered) {
    if (options.length === 4) break;
    const value = { shape: candidate.shape, count: clampCount(candidate.count) };
    if (cellKey(value) === cellKey(answer)) continue;
    if (options.some((item) => cellKey(item) === cellKey(value))) continue;
    options.push(value);
  }
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = randInt(0, i, random);
    const tmp = options[i];
    options[i] = options[j];
    options[j] = tmp;
  }
  return options;
}

/** 生成一题的九宫格与答案；行规则与列规则交叉，避免「看一行就够」。 */
export function buildMatrix(ruleName, random = Math.random) {
  const rule = RULES[ruleName] || RULES.rowShape;
  const shapeA = SHAPES[randInt(0, 3, random)];

  const cell = (r, c) => {
    const value = rule(r, c, shapeA);
    return { shape: value.shape || shapeA, count: Math.min(MAX_COUNT, Math.max(1, value.count)) };
  };

  const cells = [];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) cells.push(r === 2 && c === 2 ? null : cell(r, c));
  }
  const answer = cell(2, 2);
  const gridShapes = [...new Set(cells.filter(Boolean).map((cell) => cell.shape))];
  const options = buildOptions(answer, gridShapes, random);
  return { cells, options, answer: options.indexOf(answer), rule: ruleName };
}

const ORDER = ['rowShape', 'colShape', 'diagonal', 'combine', 'alternate', 'mirror'];

export function buildQuestions(count, random = Math.random) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(buildMatrix(ORDER[i % ORDER.length], random));
  }
  return out;
}

function cellNode(cell, size = 12) {
  const node = el('div', { class: 'mx-cell' });
  if (!cell) {
    node.appendChild(el('span', { class: 'mx-q', text: '?' }));
    return node;
  }
  const count = Math.min(cell.count, MAX_COUNT);
  for (let i = 0; i < count; i += 1) {
    node.appendChild(
      el('span', { class: 'mx-sym', style: `font-size:${size}px`, text: cell.shape }),
    );
  }
  return node;
}

export function matrixNode(question, size = 12) {
  const grid = el('div', { class: 'mx-grid' });
  for (const cell of question.cells) grid.appendChild(cellNode(cell, size));
  return grid;
}

export const irTask = {
  id: 'ir',
  mount(root, ctx) {
    const count = (ctx.spec && ctx.spec.items) || 8;
    const questions = buildQuestions(count);
    let index = 0;
    let correct = 0;
    let closed = false;

    const status = el('p', { class: 'game-status', text: '' });
    const host = el('div', { class: 'ir-host' });
    root.appendChild(status);
    root.appendChild(host);

    const finish = () => {
      if (closed) return;
      closed = true;
      ctx.finish(null, { total: questions.length, correct });
    };

    const pick = (choice) => {
      const item = questions[index];
      if (!item || closed) return;
      if (choice === item.answer) correct += 1;
      index += 1;
      draw();
    };

    const draw = () => {
      const item = questions[index];
      if (!item) {
        finish();
        return;
      }
      clear(host);
      status.textContent = `第 ${index + 1} / ${questions.length} 题 · 选出右下角缺的那一格`;
      host.appendChild(matrixNode(item, 13));

      const options = el('div', { class: 'mx-options' });
      item.options.forEach((opt, i) => {
        const node = el('button', { class: 'mx-option', type: 'button' }, [cellNode(opt, 11)]);
        node.addEventListener('click', () => pick(i));
        options.appendChild(node);
      });
      host.appendChild(options);
    };

    draw();
    return () => {
      closed = true;
      clear(host);
    };
  },
};
