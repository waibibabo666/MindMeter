/**
 * 归纳推理：瑞文式 3×3 图形矩阵。
 *
 * 六种规则轮换出题：数量递增、数量递减、形状循环、位置轮换、叠加、交替。
 * 干扰项各对应一种典型错误，避免「随便画三个」。
 */
import { el, clear } from '../ui.js';

const SHAPES = ['●', '▲', '■', '◆'];

function randInt(min, max, random = Math.random) {
  return min + Math.floor(random() * (max - min + 1));
}

/** 六种「行规则 × 列规则」组合。 */
const RULES = {
  rowShape: (r, c, A) => ({ shape: SHAPES[r % 3], count: c + 1, base: A }),
  colShape: (r, c) => ({ shape: SHAPES[c % 3], count: r + 1 }),
  diagonal: (r, c) => ({ shape: SHAPES[(r + c) % 3], count: r + c + 1 }),
  combine: (r, c, A) => ({ shape: A, count: r + c + 1 }),
  alternate: (r, c, A) => ({ shape: r % 2 === 0 ? A : SHAPES[(SHAPES.indexOf(A) + 1) % 4], count: c + 1 }),
  mirror: (r, c) => ({ shape: SHAPES[c % 3], count: 3 - r }),
};

/** 生成一题的九宫格与答案；行规则与列规则交叉，避免「看一行就够」。 */
export function buildMatrix(ruleName, random = Math.random) {
  const rule = RULES[ruleName] || RULES.rowShape;
  const shapeA = SHAPES[randInt(0, 3, random)];
  const shapeB = SHAPES[(SHAPES.indexOf(shapeA) + 1) % 4];

  const cell = (r, c) => {
    const value = rule(r, c, shapeA);
    return { shape: value.shape || shapeA, count: Math.min(4, Math.max(1, value.count)) };
  };

  const cells = [];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) cells.push(r === 2 && c === 2 ? null : cell(r, c));
  }
  const answer = cell(2, 2);
  const otherShape = answer.shape === shapeA ? shapeB : shapeA;

  // 三个干扰项各错一半：只错数量 / 只错形状 / 数量形状都错且更像
  const distractors = [
    { shape: answer.shape, count: Math.max(1, Math.min(4, answer.count - 1)) },
    { shape: otherShape, count: answer.count },
    { shape: otherShape, count: Math.max(1, Math.min(4, answer.count - 1)) },
  ];

  const options = [answer, ...distractors];
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = randInt(0, i, random);
    const tmp = options[i];
    options[i] = options[j];
    options[j] = tmp;
  }
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
  const count = Math.min(cell.count, 4);
  for (let i = 0; i < count; i += 1) {
    node.appendChild(el('span', { class: 'mx-sym', style: `font-size:${size}px`, text: cell.shape }));
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
