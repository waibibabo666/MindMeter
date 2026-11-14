/**
 * 视觉与记忆类游戏：符号连连看、找不同、词对连线、购物清单。
 *
 * 四个游戏都需要「看」与「点」，不做纯题库；计分函数单独导出便于单测。
 */
import { el, clear } from '../ui.js';

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

/* ---------------- 符号连连看（ps） ---------------- */

const SYMBOLS = ['◆', '●', '▲', '■', '★', '✦', '❖', '◈'];

export function buildPairDeck(random = Math.random) {
  const deck = [];
  for (const symbol of SYMBOLS) {
    deck.push(symbol);
    deck.push(symbol);
  }
  const out = [];
  const pool = deck.slice();
  while (pool.length) {
    const index = Math.floor(random() * pool.length);
    out.push(pool.splice(index, 1)[0]);
  }
  return out;
}

export function scorePairs(cleared, total = SYMBOLS.length) {
  const safeTotal = Math.max(1, total);
  const safe = Math.max(0, Math.min(safeTotal, Number(cleared) || 0));
  return Math.round((safe / safeTotal) * 100);
}

export const linkLink = {
  id: 'linkLink',
  dim: 'ps',
  title: '符号连连看',
  desc: '16 格里 8 组图案，点中两个相同的即可消除，越快分越高。',
  mount(root, ctx) {
    const deck = buildPairDeck();
    const removed = new Set();
    let firstIndex = -1;
    let cleared = 0;
    let closed = false;
    const startedAt = Date.now();

    const status = el('p', { class: 'game-status', text: '点两个相同的图案' });
    const grid = el('div', { class: 'game-grid link' });
    const nodes = deck.map((symbol, index) =>
      el('button', { class: 'lcard', type: 'button', text: symbol, 'data-index': String(index) }),
    );
    for (const node of nodes) grid.appendChild(node);
    root.appendChild(status);
    root.appendChild(grid);

    const finish = () => {
      if (closed) return;
      closed = true;
      ctx.finish(scorePairs(cleared), { cleared, ms: Date.now() - startedAt });
    };

    const reset = () => {
      firstIndex = -1;
      for (const node of nodes) node.classList.remove('sel');
    };

    for (const node of nodes) {
      node.addEventListener('click', () => {
        if (closed) return;
        const index = Number(node.dataset.index);
        if (removed.has(index)) return;
        if (firstIndex === index) {
          node.classList.remove('sel');
          firstIndex = -1;
          return;
        }
        if (firstIndex === -1) {
          firstIndex = index;
          node.classList.add('sel');
          return;
        }
        if (deck[firstIndex] === deck[index]) {
          removed.add(firstIndex);
          removed.add(index);
          nodes[firstIndex].classList.add('gone');
          nodes[index].classList.add('gone');
          cleared += 1;
          reset();
          status.textContent = `已消除 ${cleared} / ${SYMBOLS.length} 组`;
          if (cleared === SYMBOLS.length) finish();
          return;
        }
        status.textContent = '不一样，再找找';
        nodes[firstIndex].classList.add('sel');
        reset();
      });
    }

    return () => {
      closed = true;
      clear(grid);
    };
  },
};

/* ---------------- 找不同（ps） ---------------- */

const EMOJIS = ['🍎', '🍌', '🍇', '🍓', '🍒', '🥝', '🍑', '🍍', '🥕', '🌽', '🍄', '🥦'];
const SPOT_SIZE = 5;
const SPOT_DIFFS = 4;

export function buildSpotBoards(random = Math.random) {
  const total = SPOT_SIZE * SPOT_SIZE;
  const base = [];
  for (let i = 0; i < total; i += 1) {
    base.push(EMOJIS[Math.floor(random() * EMOJIS.length)]);
  }
  const changed = [];
  const target = base.slice();
  while (changed.length < SPOT_DIFFS) {
    const index = Math.floor(random() * total);
    if (changed.includes(index)) continue;
    changed.push(index);
    let next = EMOJIS[Math.floor(random() * EMOJIS.length)];
    while (next === target[index]) next = EMOJIS[Math.floor(random() * EMOJIS.length)];
    target[index] = next;
  }
  return { base, target, diffs: changed.sort((a, b) => a - b) };
}

export function scoreSpot(found, mistakes, total = SPOT_DIFFS) {
  const base = (Math.max(0, Math.min(total, Number(found) || 0)) / total) * 100;
  return Math.max(0, Math.round(base - Math.max(0, Number(mistakes) || 0) * 5));
}

export const spotDiff = {
  id: 'spotDiff',
  dim: 'ps',
  title: '找不同',
  desc: '两幅图有 4 处不同，点右边的格子找出它们；点错扣分。',
  mount(root, ctx) {
    const { base, target, diffs } = buildSpotBoards();
    const found = new Set();
    let mistakes = 0;
    let closed = false;

    const status = el('p', { class: 'game-status', text: `找出 4 处不同（已找 0）` });
    const wrap = el('div', { class: 'spot-wrap' });
    const left = el('div', { class: 'game-grid spot' });
    const right = el('div', { class: 'game-grid spot' });
    for (const symbol of base) left.appendChild(el('span', { class: 'spot-cell', text: symbol }));
    target.forEach((symbol, index) => {
      const node = el('button', { class: 'spot-cell', type: 'button', text: symbol, 'data-index': String(index) });
      node.addEventListener('click', () => {
        if (closed) return;
        if (found.has(index)) return;
        if (!diffs.includes(index)) {
          mistakes += 1;
          node.classList.add('miss');
          globalThis.setTimeout(() => node.classList.remove('miss'), 200);
          status.textContent = `找出 4 处不同（已找 ${found.size}，点错 ${mistakes}）`;
          return;
        }
        found.add(index);
        node.classList.add('hit');
        status.textContent = `找出 4 处不同（已找 ${found.size}，点错 ${mistakes}）`;
        if (found.size === SPOT_DIFFS) {
          closed = true;
          ctx.finish(scoreSpot(found.size, mistakes), { found: found.size, mistakes });
        }
      });
      right.appendChild(node);
    });
    wrap.appendChild(left);
    wrap.appendChild(right);
    root.appendChild(status);
    root.appendChild(wrap);

    return () => {
      closed = true;
      clear(wrap);
    };
  },
};

/* ---------------- 词对连线（am） ---------------- */

const WORD_PAIRS = [
  ['太阳', '雨伞'],
  ['医生', '听诊器'],
  ['蜜蜂', '花朵'],
  ['钥匙', '门锁'],
  ['火车', '铁轨'],
  ['厨师', '炒锅'],
  ['钢笔', '墨水'],
  ['风筝', '细线'],
];

export function scorePairLink(correct, total = WORD_PAIRS.length) {
  return Math.round((Math.max(0, Math.min(total, Number(correct) || 0)) / total) * 100);
}

export const pairLink = {
  id: 'pairLink',
  dim: 'am',
  title: '词对连线',
  desc: '先看 8 组词对，再把左边和右边的词连起来。',
  mount(root, ctx) {
    const leftOrder = shuffle(WORD_PAIRS.map((_, i) => i));
    const rightOrder = shuffle(WORD_PAIRS.map((_, i) => i));
    let selectedLeft = null;
    let matched = 0;
    let closed = false;

    const status = el('p', { class: 'game-status', text: '先记住这 8 组词对' });
    const list = el('div', { class: 'pair-study' });
    for (const [a, b] of WORD_PAIRS) {
      list.appendChild(el('span', { class: 'pair-chip', text: `${a} — ${b}` }));
    }
    const board = el('div', { class: 'pair-board' });
    const leftCol = el('div', { class: 'pair-col' });
    const rightCol = el('div', { class: 'pair-col' });
    board.appendChild(leftCol);
    board.appendChild(rightCol);

    const startButton = el('button', { class: 'btn primary', type: 'button', text: '开始连线' });
    const study = el('div', {}, [list, el('div', { class: 'row' }, [startButton])]);
    root.appendChild(status);
    root.appendChild(study);

    const buildBoard = () => {
      clear(root);
      root.appendChild(status);
      root.appendChild(board);
      status.textContent = '点左边一个、右边一个，把词对连起来';

      const done = new Set();
      const leftNodes = leftOrder.map((pairIndex) => {
        const node = el('button', { class: 'pair-item', type: 'button', text: WORD_PAIRS[pairIndex][0] });
        node.addEventListener('click', () => {
          if (closed || done.has(pairIndex)) return;
          selectedLeft = pairIndex;
          for (const item of leftNodes) item.classList.remove('sel');
          node.classList.add('sel');
        });
        leftCol.appendChild(node);
        return node;
      });

      rightOrder.forEach((pairIndex) => {
        const node = el('button', { class: 'pair-item', type: 'button', text: WORD_PAIRS[pairIndex][1] });
        node.addEventListener('click', () => {
          if (closed || selectedLeft === null) return;
          if (done.has(pairIndex)) return;
          if (pairIndex === selectedLeft) {
            done.add(pairIndex);
            matched += 1;
            leftNodes[pairIndex].classList.add('done');
            node.classList.add('done');
            leftNodes[pairIndex].disabled = true;
            node.disabled = true;
            status.textContent = `已连对 ${matched} / ${WORD_PAIRS.length}`;
            selectedLeft = null;
            if (matched === WORD_PAIRS.length) {
              closed = true;
              ctx.finish(scorePairLink(matched), { matched });
            }
            return;
          }
          node.classList.add('miss');
          globalThis.setTimeout(() => node.classList.remove('miss'), 200);
          status.textContent = '这一对不匹配，再想想';
          selectedLeft = null;
          for (const item of leftNodes) item.classList.remove('sel');
        });
        rightCol.appendChild(node);
      });
    };

    startButton.addEventListener('click', buildBoard);

    return () => {
      closed = true;
      clear(root);
    };
  },
};

/* ---------------- 购物清单（am） ---------------- */

const SHOP_ITEMS = [
  { emoji: '🍎', name: '苹果' },
  { emoji: '🍞', name: '面包' },
  { emoji: '🥛', name: '牛奶' },
  { emoji: '🥚', name: '鸡蛋' },
  { emoji: '🍌', name: '香蕉' },
  { emoji: '🧀', name: '奶酪' },
  { emoji: '🍇', name: '葡萄' },
  { emoji: '🥕', name: '胡萝卜' },
  { emoji: '🍅', name: '番茄' },
  { emoji: '🥔', name: '土豆' },
];

const SHOP_FOILS = [
  { emoji: '🍫', name: '巧克力' },
  { emoji: '☕', name: '咖啡' },
  { emoji: '🍪', name: '饼干' },
  { emoji: '🥤', name: '汽水' },
  { emoji: '🍬', name: '糖果' },
  { emoji: '🌰', name: '栗子' },
  { emoji: '🥐', name: '牛角包' },
  { emoji: '🍯', name: '蜂蜜' },
  { emoji: '🧃', name: '果汁' },
  { emoji: '🍰', name: '蛋糕' },
];

/** 选中 10 个里对 1 个得 10 分，选错一个扣 10 分。 */
export function scoreShopping(hits, wrongs) {
  const raw = (Number(hits) || 0) * 10 - (Number(wrongs) || 0) * 10;
  return Math.max(0, Math.min(100, raw));
}

export const shoppingList = {
  id: 'shoppingList',
  dim: 'am',
  title: '购物清单',
  desc: '先看 10 样商品 8 秒，再从 20 个选项里挑出刚才见过的。',
  mount(root, ctx) {
    let closed = false;
    const status = el('p', { class: 'game-status', text: '记住这些商品，8 秒后开始挑选' });
    const list = el('div', { class: 'shop-list' });
    for (const item of SHOP_ITEMS) {
      list.appendChild(el('span', { class: 'shop-chip', text: `${item.emoji} ${item.name}` }));
    }
    root.appendChild(status);
    root.appendChild(list);

    const timer = globalThis.setTimeout(() => {
      if (closed) return;
      clear(root);
      const options = shuffle([...SHOP_ITEMS, ...SHOP_FOILS]);
      const chosen = new Set();
      const stage = el('div', { class: 'shop-pick' });
      const gridNode = el('div', { class: 'shop-grid' });
      status.textContent = '选出刚才见过的 10 样';
      const submit = el('button', { class: 'btn primary', type: 'button', text: '提交' });

      for (const item of options) {
        const node = el('button', { class: 'shop-option', type: 'button', text: `${item.emoji} ${item.name}` });
        node.addEventListener('click', () => {
          if (closed) return;
          const key = item.name;
          if (chosen.has(key)) {
            chosen.delete(key);
            node.classList.remove('sel');
          } else {
            chosen.add(key);
            node.classList.add('sel');
          }
        });
        gridNode.appendChild(node);
      }

      submit.addEventListener('click', () => {
        if (closed) return;
        const good = SHOP_ITEMS.filter((item) => chosen.has(item.name)).length;
        const wrong = chosen.size - good;
        closed = true;
        ctx.finish(scoreShopping(good, wrong), { hits: good, wrong });
      });

      stage.appendChild(gridNode);
      stage.appendChild(el('div', { class: 'row' }, [submit]));
      root.appendChild(status);
      root.appendChild(stage);
    }, 8000);

    return () => {
      closed = true;
      globalThis.clearTimeout(timer);
      clear(root);
    };
  },
};
