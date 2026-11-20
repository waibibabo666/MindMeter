/**
 * 猜数字（归纳推理 ir）。
 * 系统生成 4 位不重复数字，每次猜测返回 nAnB，次数越少分越高。
 */
import { el, clear, now } from '../ui.js';

const LENGTH = 4;
const WORST_ATTEMPTS = 14;
const BEST_ATTEMPTS = 8;

/** 生成 4 个互不重复的数字。 */
export function makeSecret(random = Math.random) {
  const pool = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const picked = [];
  while (picked.length < LENGTH) {
    const index = Math.floor(random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked.join('');
}

/** A = 数字与位置都对；B = 数字对但位置不对。 */
export function judge(secret, guess) {
  let a = 0;
  let b = 0;
  for (let i = 0; i < LENGTH; i += 1) {
    if (guess[i] === secret[i]) {
      a += 1;
    } else if (secret.includes(guess[i])) {
      b += 1;
    }
  }
  return { a, b };
}

/** 8 次内猜中得满分，14 次及以上得 0 分。 */
export function scoreGuess(attempts) {
  const safe = Math.max(1, Math.round(Number(attempts) || 1));
  const span = WORST_ATTEMPTS - BEST_ATTEMPTS;
  const ratio = Math.max(0, Math.min(1, (WORST_ATTEMPTS - safe) / span));
  return Math.round(ratio * 100);
}

/** 输入合法性：4 位数字且互不重复。 */
export function isValidGuess(text) {
  const value = String(text || '').trim();
  if (!new RegExp(`^\\d{${LENGTH}}$`).test(value)) return false;
  return new Set(value).size === LENGTH;
}

export const guess = {
  id: 'guess',
  dim: 'ir',
  title: '猜数字',
  desc: '4 位不重复数字，每次猜完告诉你几个 A（位置对）几个 B（数字对位置错）。',
  mount(root, ctx) {
    const secret = makeSecret();
    let attempts = 0;
    let closed = false;
    const startedAt = now();

    const status = el('p', { class: 'game-status', text: '输入 4 位不重复数字' });
    const history = el('div', { class: 'game-history' });
    const input = el('input', {
      class: 'game-input',
      type: 'text',
      inputmode: 'numeric',
      maxlength: String(LENGTH),
      placeholder: '例如 1234',
      'aria-label': '输入 4 位数字',
    });
    const submit = el('button', { class: 'btn primary', type: 'button', text: '提交' });
    const giveUp = el('button', { class: 'btn ghost', type: 'button', text: '放弃并看答案' });
    const row = el('div', { class: 'row' }, [input, submit, giveUp]);
    root.appendChild(status);
    root.appendChild(row);
    root.appendChild(history);

    const finish = () => {
      if (closed) return;
      closed = true;
      ctx.finish(scoreGuess(attempts), { attempts, secret, ms: Math.round(now() - startedAt) });
    };

    const commit = () => {
      if (closed) return;
      const value = input.value;
      if (!isValidGuess(value)) {
        status.textContent = '要 4 位数字，且不能重复';
        return;
      }
      attempts += 1;
      const { a, b } = judge(secret, value);
      history.appendChild(
        el('p', { class: 'game-history-item', text: `第 ${attempts} 次：${value} → ${a}A${b}B` }),
      );
      input.value = '';
      if (a === LENGTH) {
        finish();
        return;
      }
      status.textContent = `第 ${attempts} 次 · ${a}A${b}B`;
    };

    submit.addEventListener('click', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') commit();
    });
    giveUp.addEventListener('click', () => {
      if (closed) return;
      attempts = WORST_ATTEMPTS;
      status.textContent = `答案是 ${secret}`;
      finish();
    });

    input.focus();

    return () => {
      closed = true;
      clear(root);
    };
  },
};
