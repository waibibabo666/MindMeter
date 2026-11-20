/**
 * 记忆翻牌（联想记忆 am）。
 * 8 组图案背面朝上，每次翻两张，相同则保留，不同则盖回。
 */
import { el, clear, now } from '../ui.js';

const PAIRS = 8;
const SYMBOLS = ['◆', '●', '▲', '■', '★', '✦', '❖', '◈'];

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

/** 16 张牌：8 个图案各两张，打乱。 */
export function buildDeck(random = Math.random) {
  const deck = [];
  for (const symbol of SYMBOLS) {
    deck.push({ symbol, key: `${symbol}-a` });
    deck.push({ symbol, key: `${symbol}-b` });
  }
  return shuffle(deck, random);
}

/** 理论最优是每对 2 步（共 16 步）；步数越多分越低。 */
export function scoreFlip(moves) {
  const safe = Math.max(PAIRS * 2, Number(moves) || 0);
  return Math.max(0, Math.min(100, Math.round((PAIRS * 2 * 100) / safe)));
}

export const flip = {
  id: 'flip',
  dim: 'am',
  title: '记忆翻牌',
  desc: '8 组图案两两配对，每次翻两张；步数越少分越高。',
  mount(root, ctx) {
    const deck = buildDeck();
    let firstIndex = -1;
    let matched = 0;
    let moves = 0;
    let locked = false;
    let closed = false;
    const startedAt = now();
    const solved = new Set();

    const status = el('p', { class: 'game-status', text: '翻两张试试' });
    const grid = el('div', { class: 'game-grid flip' });
    const nodes = deck.map((card, index) =>
      el('button', { class: 'fcard', type: 'button', text: '?', 'data-index': String(index) }),
    );
    for (const node of nodes) grid.appendChild(node);
    root.appendChild(status);
    root.appendChild(grid);

    const finish = () => {
      if (closed) return;
      closed = true;
      ctx.finish(scoreFlip(moves), { moves, ms: Math.round(now() - startedAt) });
    };

    const hide = (index) => {
      const node = nodes[index];
      if (!node) return;
      node.textContent = '?';
      node.classList.remove('open');
    };

    const settle = (index) => {
      const a = deck[firstIndex];
      const b = deck[index];
      if (a.symbol === b.symbol) {
        solved.add(firstIndex);
        solved.add(index);
        nodes[firstIndex].classList.add('matched');
        nodes[index].classList.add('matched');
        matched += 1;
        firstIndex = -1;
        locked = false;
        status.textContent = `已配对 ${matched} / ${PAIRS} · 步数 ${moves}`;
        if (matched === PAIRS) finish();
        return;
      }
      status.textContent = `不匹配，记一下位置 · 步数 ${moves}`;
      globalThis.setTimeout(() => {
        hide(firstIndex);
        hide(index);
        firstIndex = -1;
        locked = false;
      }, 620);
    };

    for (const node of nodes) {
      node.addEventListener('click', () => {
        if (closed || locked) return;
        const index = Number(node.dataset.index);
        if (solved.has(index) || index === firstIndex) return;
        node.textContent = deck[index].symbol;
        node.classList.add('open');
        if (firstIndex === -1) {
          firstIndex = index;
          return;
        }
        moves += 1;
        locked = true;
        settle(index);
      });
    }

    return () => {
      closed = true;
      clear(grid);
    };
  },
};
