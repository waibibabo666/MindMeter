/**
 * 空间视觉化的三种题型与流程。
 *
 *   旋转题：3×3 图案转 90°，四选一
 *   折纸题：对折后打孔，展开后几个洞
 *   展开图：正方体展开结构题，附可拖动的灰色参考模型
 *
 * 展开图题的参考模型转动次数会记录，答对时按转动多少给权重：
 *   0 次 1.0 / 1–2 次 0.85 / ≥3 次 0.7。答错一律 0。
 */
import { el, button, clear } from '../ui.js';
import { mulberry32 } from '../random.js';
import { buildNetCubeQuestion, renderNetQuestion } from './svNet.js';

const SIZE = 3;
const CELLS = SIZE * SIZE;
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

export function rotate90(grid) {
  const out = new Array(CELLS).fill(0);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      out[x * SIZE + (SIZE - 1 - y)] = grid[y * SIZE + x];
    }
  }
  return out;
}

export function mirrorGrid(grid) {
  const out = new Array(CELLS).fill(0);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      out[y * SIZE + (SIZE - 1 - x)] = grid[y * SIZE + x];
    }
  }
  return out;
}

function randomPattern() {
  const grid = new Array(CELLS).fill(0);
  let on = 0;
  const want = 3 + Math.floor(rand() * 3);
  while (on < want) {
    const at = Math.floor(rand() * CELLS);
    if (grid[at]) continue;
    grid[at] = 1;
    on += 1;
  }
  return grid;
}

const same = (a, b) => a.every((v, i) => v === b[i]);

export function buildRotate() {
  const base = randomPattern();
  const correct = rotate90(base);
  const pool = [rotate90(correct), rotate90(rotate90(correct)), mirrorGrid(base)];
  const options = [correct];
  for (const candidate of pool) {
    if (options.some((grid) => same(grid, candidate))) continue;
    options.push(candidate);
    if (options.length === 4) break;
  }
  while (options.length < 4) options.push(randomPattern());
  const list = shuffle(options);
  return {
    kind: 'rotate',
    base,
    options: list,
    answer: list.findIndex((grid) => same(grid, correct)),
  };
}

const FOLD_BANK = [
  { q: '正方形纸对折一次，在折边处剪一个洞，展开后有几个洞？', options: ['1 个', '2 个', '3 个', '4 个'], answer: 1 },
  { q: '正方形纸沿中线对折两次（两个方向），在折角处剪一刀，展开后有几个洞？', options: ['1 个', '2 个', '4 个', '8 个'], answer: 2 },
  { q: '正方形纸对折两次后打一个洞，展开后洞的个数是？', options: ['2 个', '3 个', '4 个', '6 个'], answer: 2 },
  { q: '纸对折一次后沿折线内侧剪去一个小三角，展开后形状是？', options: ['一个更大的三角', '两个对称的三角', '一个菱形', '一个圆'], answer: 1 },
  { q: '不折叠，直接剪去一个角，展开后有几个缺口？', options: ['0 个', '1 个', '2 个', '4 个'], answer: 1 },
  { q: '正方形纸对折三次后打一个洞，展开后最可能有几个洞？', options: ['2 个', '4 个', '8 个', '16 个'], answer: 2 },
];

export function buildFold() {
  const item = FOLD_BANK[Math.floor(rand() * FOLD_BANK.length)];
  return { kind: 'fold', q: item.q, options: item.options, answer: item.answer };
}




function gridNode(grid, size) {
  const node = el('div', { class: 'grid9' });
  for (const cell of grid) {
    node.appendChild(
      el('span', { class: `grid9-cell${cell ? ' on' : ''}`, style: `width:${size}px;height:${size}px` }),
    );
  }
  return node;
}

function weightFor(kind, turns) {
  if (kind !== 'net') return 1;
  if (turns === 0) return 1;
  if (turns <= 2) return 0.85;
  return 0.7;
}

export function mountSv(root, ctx) {
  const count = (ctx.spec && ctx.spec.items) || 8;
  const plan = [];
  for (let i = 0; i < count; i += 1) {
    const mod = i % 3;
    if (mod === 0) plan.push(buildRotate());
    else if (mod === 1) plan.push(buildFold());
    else plan.push(buildNetCubeQuestion());
  }

  let index = 0;
  let correct = 0;
  let weighted = 0;
  let total = 0;
  let rotations = 0;
  let netView = null;
  let closed = false;

  const status = el('p', { class: 'game-status' });
  const host = el('div', { class: 'sv-host' });
  root.appendChild(status);
  root.appendChild(host);

  const finish = () => {
    if (closed) return;
    closed = true;
    ctx.finish(null, { total, correct, weighted, rotations });
  };

  const pick = (choice) => {
    const item = plan[index];
    if (!item || closed) return;
    total += 1;
    rotations = netView ? netView.getTurns() : 0;
    if (choice === item.answer) {
      correct += 1;
      weighted += weightFor(item.kind, rotations);
    }
    index += 1;
    draw();
  };

  const draw = () => {
    const item = plan[index];
    if (!item) {
      finish();
      return;
    }
    rotations = 0;
    clear(host);
    status.textContent = `第 ${index + 1} / ${plan.length} 题`;

    if (item.kind === 'rotate') {
      host.appendChild(el('p', { class: 'tiny', text: '把左边的图案顺时针旋转 90°，选出结果' }));
      host.appendChild(el('div', { class: 'rotate-row' }, [gridNode(item.base, 26)]));
      const options = el('div', { class: 'grid9-options' });
      item.options.forEach((grid, i) => {
        const node = el('button', { class: 'grid9-option', type: 'button' }, [gridNode(grid, 18)]);
        node.addEventListener('click', () => pick(i));
        options.appendChild(node);
      });
      host.appendChild(options);
      return;
    }

    if (item.kind === 'net') {
      const view = renderNetQuestion(item, pick);
      netView = view;
      host.appendChild(view.node);
      return;
    }
    host.appendChild(el('h2', { class: 'task-question', text: item.q }));
    const options = el('div', { class: 'options' });
    item.options.forEach((text, i) => {
      options.appendChild(button(text, () => pick(i), { variant: 'option' }));
    });
    host.appendChild(options);
  };

  draw();
  return () => {
    closed = true;
    clear(host);
  };
}
