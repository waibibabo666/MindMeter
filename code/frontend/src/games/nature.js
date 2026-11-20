/**
 * 自然知识游戏：分类投放 + 生态链排序。
 *
 * 都用「点击选中 → 点击目标」代替拖拽：触屏和鼠标都更稳，也不引入拖动耗时。
 */
import { el, clear } from '../ui.js';
import { mulberry32 } from '../random.js';

const CARDS = [
  { emoji: '🐬', name: '海豚', group: 'animal' },
  { emoji: '🐜', name: '蚂蚁', group: 'animal' },
  { emoji: '🌻', name: '向日葵', group: 'plant' },
  { emoji: '🌿', name: '苔藓', group: 'plant' },
  { emoji: '🍄', name: '香菇', group: 'fungus' },
  { emoji: '🦠', name: '酵母菌', group: 'fungus' },
];

const GROUPS = [
  { id: 'animal', label: '动物' },
  { id: 'plant', label: '植物' },
  { id: 'fungus', label: '真菌' },
];

const rand = mulberry32(Date.now() & 0x7fffffff);

function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export function scoreDrag(correct, total) {
  const safe = Math.max(0, Math.min(total, correct));
  return Math.round((safe / total) * 100);
}

export const speciesDrag = {
  id: 'species',
  dim: 'ni',
  title: '分类投放',
  desc: '把生物卡片放进去动物、植物、真菌三个筐里。',
  mount(root, ctx) {
    const cards = shuffle(CARDS).map((card) => ({ ...card, placed: false }));
    let selected = -1;
    let correct = 0;
    let closed = false;

    const status = el('p', { class: 'game-status', text: '先点一张卡片，再点筐' });
    const pool = el('div', { class: 'drag-pool' });
    const bins = el('div', { class: 'drag-bins' });
    root.appendChild(status);
    root.appendChild(pool);
    root.appendChild(bins);

    const cardNodes = cards.map((card, index) => {
      const node = el('button', { class: 'drag-card', type: 'button' }, [
        el('span', { class: 'drag-emoji', text: card.emoji }),
        el('span', { class: 'drag-name', text: card.name }),
      ]);
      node.addEventListener('click', () => {
        if (closed || card.placed) return;
        selected = index;
        for (const item of cardNodes) item.classList.remove('sel');
        node.classList.add('sel');
        status.textContent = `已选「${card.name}」，点一个筐`;
      });
      pool.appendChild(node);
    });

    for (const group of GROUPS) {
      const bin = el('button', { class: 'drag-bin', type: 'button' }, [
        el('span', { class: 'drag-bin-label', text: group.label }),
      ]);
      bin.addEventListener('click', () => {
        if (closed || selected === -1) return;
        const card = cards[selected];
        if (card.placed) return;
        if (card.group === group.id) {
          card.placed = true;
          cardNodes[selected].classList.add('done');
          cardNodes[selected].disabled = true;
          cardNodes[selected].classList.remove('sel');
          bin.appendChild(el('span', { class: 'drag-emoji small', text: card.emoji }));
          correct += 1;
          selected = -1;
          status.textContent = `已放对 ${correct} / ${cards.length}`;
          if (correct === cards.length) {
            closed = true;
            ctx.finish(scoreDrag(correct, cards.length), { correct, total: cards.length });
          }
          return;
        }
        cardNodes[selected].classList.add('miss');
        globalThis.setTimeout(() => cardNodes[selected].classList.remove('miss'), 200);
        status.textContent = '放错了，再想想';
      });
      bins.appendChild(bin);
    }

    return () => {
      closed = true;
      clear(root);
    };
  },
};

const CHAINS = [
  ['草', '兔', '鹰'],
  ['浮游植物', '小鱼', '大鱼', '鲨鱼'],
  ['树叶', '毛毛虫', '麻雀', '鹰'],
];

export function scoreChain(correct, total) {
  return Math.round((Math.max(0, Math.min(total, correct)) / total) * 100);
}

export const foodChainOrder = {
  id: 'foodChain',
  dim: 'ni',
  title: '生态链排序',
  desc: '按「谁吃谁」的顺序把生物排成一条食物链。',
  mount(root, ctx) {
    const chain = CHAINS[Math.floor(rand() * CHAINS.length)];
    const order = shuffle(chain);
    const picked = [];
    let closed = false;

    const status = el('p', { class: 'game-status', text: '从「被吃的一方」开始，依次点击' });
    const chosen = el('div', { class: 'chain-row' });
    const pool = el('div', { class: 'chain-pool' });
    root.appendChild(status);
    root.appendChild(chosen);
    root.appendChild(pool);

    const finish = () => {
      let right = 0;
      for (let i = 0; i < chain.length; i += 1) {
        if (picked[i] === chain[i]) right += 1;
      }
      closed = true;
      ctx.finish(scoreChain(right, chain.length), { correct: right, total: chain.length });
    };

    order.forEach((name) => {
      const node = el('button', { class: 'chain-chip', type: 'button', text: name });
      node.addEventListener('click', () => {
        if (closed || node.disabled) return;
        picked.push(name);
        node.disabled = true;
        node.classList.add('used');
        chosen.appendChild(el('span', { class: 'chain-chip on', text: name }));
        if (picked.length === chain.length) finish();
      });
      pool.appendChild(node);
    });

    return () => {
      closed = true;
      clear(pool);
      clear(root);
    };
  },
};
