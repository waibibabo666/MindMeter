/**
 * 限时口算（数字运算 nc）。
 * 60 秒连续作答，四选一；答对进下一题，答错也进下一题（不中断节奏）。
 */
import { el, clear, now } from '../ui.js';

const LIMIT_MS = 60000;
const POINTS_PER_CORRECT = 4;

function shuffle(list, random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** 干扰项与答案互不相同且非负。 */
export function buildOptions(answer, random = Math.random) {
  const set = new Set([answer]);
  let guard = 0;
  while (set.size < 4 && guard < 200) {
    guard += 1;
    const delta = (Math.floor(random() * 9) + 1) * (random() < 0.5 ? -1 : 1);
    const value = answer + delta;
    if (value >= 0 && value !== answer) set.add(value);
  }
  return shuffle([...set], random);
}

/** 生成一道题：加法 / 减法 / 一位数乘法。 */
export function makeQuestion(random = Math.random) {
  const kind = Math.floor(random() * 3);
  let a;
  let b;
  let text;
  let answer;
  if (kind === 0) {
    a = 10 + Math.floor(random() * 90);
    b = 10 + Math.floor(random() * 90);
    text = `${a} + ${b}`;
    answer = a + b;
  } else if (kind === 1) {
    a = 20 + Math.floor(random() * 80);
    b = 1 + Math.floor(random() * (a - 1));
    text = `${a} − ${b}`;
    answer = a - b;
  } else {
    a = 2 + Math.floor(random() * 8);
    b = 2 + Math.floor(random() * 8);
    text = `${a} × ${b}`;
    answer = a * b;
  }
  return { text, answer, options: buildOptions(answer, random) };
}

/** 答对一题 4 分，25 题封顶。 */
export function scoreMath(correct) {
  return Math.max(0, Math.min(100, Math.round(Number(correct) || 0) * POINTS_PER_CORRECT));
}

export const quickmath = {
  id: 'quickmath',
  dim: 'nc',
  title: '限时口算',
  desc: '60 秒内连续作答两位数加减与一位数乘法，答对越多分越高。',
  mount(root, ctx) {
    let correct = 0;
    let answered = 0;
    let closed = false;
    const startedAt = now();

    const status = el('p', { class: 'game-status' });
    const question = el('div', { class: 'game-question' });
    const options = el('div', { class: 'game-options' });
    root.appendChild(status);
    root.appendChild(question);
    root.appendChild(options);

    const finish = () => {
      if (closed) return;
      closed = true;
      globalThis.clearInterval(timer);
      ctx.finish(scoreMath(correct), { correct, answered, ms: Math.round(now() - startedAt) });
    };

    const nextRound = () => {
      const item = makeQuestion();
      question.textContent = `${item.text} = ?`;
      clear(options);
      for (const value of item.options) {
        const node = el('button', {
          class: 'btn game-option',
          type: 'button',
          text: String(value),
        });
        node.addEventListener('click', () => {
          if (closed) return;
          answered += 1;
          if (value === item.answer) correct += 1;
          nextRound();
        });
        options.appendChild(node);
      }
      status.textContent = `答对 ${correct} · 已答 ${answered}`;
    };

    const timer = globalThis.setInterval(() => {
      const left = Math.max(0, LIMIT_MS - (now() - startedAt));
      if (closed) return;
      if (left <= 0) {
        finish();
        return;
      }
      status.textContent = `答对 ${correct} · 已答 ${answered} · 剩余 ${(left / 1000).toFixed(0)}s`;
    }, 200);

    nextRound();

    return () => {
      closed = true;
      globalThis.clearInterval(timer);
      clear(root);
    };
  },
};
