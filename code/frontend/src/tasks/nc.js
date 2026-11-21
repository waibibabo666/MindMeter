/**
 * 数字运算：限时连答。
 *
 * 关卡越深，运算步数越多：1–3 关两步，4–6 关三步，7 关以后四步。
 * 每关 15 秒，答对进下一关；超时记为未通过，直接进下一关。
 * 作答用输入框，没有选项——避免四选一的排除法。
 */
import { el, clear } from '../ui.js';

const PER_LEVEL_MS = 15000;
const ADDITIVE = ['+', '-'];
const MULTIPLICATIVE = ['×', '÷'];

function randInt(min, max, random = Math.random) {
  return min + Math.floor(random() * (max - min + 1));
}

/** 对当前值施加一步运算；除不尽或减成负数时返回 null。 */
function applyOp(value, op, random) {
  if (op === '×') {
    const operand = randInt(2, 6, random);
    return { value: value * operand, op, operand };
  }
  if (op === '÷') {
    const divisors = [];
    for (let d = 2; d <= 9; d += 1) {
      if (value % d === 0) divisors.push(d);
    }
    if (divisors.length === 0) return null;
    const operand = divisors[Math.floor(random() * divisors.length)];
    return { value: value / operand, op, operand };
  }
  const operand = randInt(2, 9, random);
  if (op === '-' && value - operand < 0) return null;
  return { value: op === '-' ? value - operand : value + operand, op, operand };
}

/** 生成一串「从左到右」计算的整数算式。 */
export function buildChain(steps, random = Math.random) {
  let value = randInt(3, 12, random);
  const parts = [String(value)];
  // 同一道题只用同一优先级的运算符，避免「左到右」与「先乘除」冲突
  const ops = random() < 0.5 ? ADDITIVE : MULTIPLICATIVE;
  for (let i = 0; i < steps; i += 1) {
    const op = ops[Math.floor(random() * ops.length)];
    // 退化时也要留在同一优先级里，且数值必须跟着运算符算，不能「写 × 却加 2」
    const additive = ops.includes('+');
    const result =
      applyOp(value, op, random) ||
      (additive
        ? { value: value + 2, op: '+', operand: 2 }
        : { value: value * 2, op: '×', operand: 2 });
    value = result.value;
    parts.push(result.op, String(result.operand));
  }
  return { text: parts.join(' '), answer: value };
}

/** 第 n 关的运算步数。 */
export function stepsForLevel(level) {
  if (level <= 3) return 2;
  if (level <= 6) return 3;
  return 4;
}

export function buildLevel(level, random = Math.random) {
  return buildChain(stepsForLevel(level), random);
}

export const ncTask = {
  id: 'nc',
  mount(root, ctx) {
    const totalLevels = (ctx.spec && ctx.spec.items) || 10;
    let level = 1;
    let correct = 0;
    let closed = false;
    let timer = 0;

    const status = el('p', { class: 'game-status', text: '' });
    const question = el('div', { class: 'nc-question' });
    const input = el('input', {
      class: 'input nc-input',
      type: 'text',
      inputmode: 'numeric',
      'aria-label': '运算结果',
      placeholder: '输入结果后回车',
    });
    const bar = el('div', { class: 'bar' }, [el('i', { style: 'width:100%' })]);
    root.appendChild(status);
    root.appendChild(bar);
    root.appendChild(question);
    root.appendChild(input);

    let current = null;
    let deadline = 0;

    const finish = () => {
      if (closed) return;
      closed = true;
      globalThis.clearInterval(timer);
      ctx.finish(null, { total: totalLevels, correct });
    };

    const next = () => {
      if (closed) return;
      if (level > totalLevels) {
        finish();
        return;
      }
      current = buildLevel(level);
      deadline = Date.now() + PER_LEVEL_MS;
      status.textContent = `第 ${level} / ${totalLevels} 关`;
      question.textContent = `${current.text} = ?`;
      input.value = '';
      input.focus();
    };

    const submit = () => {
      if (closed || !current) return;
      const value = Number(input.value.trim());
      if (!Number.isFinite(value) || input.value.trim() === '') return;
      if (value === current.answer) correct += 1;
      level += 1;
      next();
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });

    timer = globalThis.setInterval(() => {
      if (closed) return;
      const left = Math.max(0, deadline - Date.now());
      bar.firstChild.style.width = `${(left / PER_LEVEL_MS) * 100}%`;
      if (left <= 0) {
        level += 1;
        next();
      }
    }, 100);

    next();

    return () => {
      closed = true;
      globalThis.clearInterval(timer);
      clear(root);
    };
  },
};
