/**
 * 空间视觉化：3×3 图案旋转四选一。
 * 只记录正确数与反应时；旋转用纯函数实现，可在 Node 侧单测。
 */
import { SV_PATTERNS } from '../data.js';
import { el, button, clear, now } from '../ui.js';
import { mulberry32, shuffle } from '../random.js';

const SIZE = 3;

function rotateOnce(grid) {
  const out = new Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      out[c * SIZE + (SIZE - 1 - r)] = grid[r * SIZE + c];
    }
  }
  return out;
}

export function rotate(grid, degrees) {
  const quarter = (((Math.round(degrees / 90) % 4) + 4) % 4);
  let out = grid.slice();
  for (let i = 0; i < quarter; i += 1) out = rotateOnce(out);
  return out;
}

export function mirror(grid) {
  const out = new Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      out[r * SIZE + (SIZE - 1 - c)] = grid[r * SIZE + c];
    }
  }
  return out;
}

const same = (a, b) => a.every((v, i) => v === b[i]);

export function buildItem(base, random) {
  const correct = rotate(base, 90);
  const seen = new Set([correct.join('')]);
  const distractors = [];

  // 先试所有旋转与镜像；对称图案会退化，因此还需要兜底变体。
  const candidates = shuffle([
    rotate(base, 0),
    rotate(base, 180),
    rotate(base, 270),
    mirror(base),
    mirror(rotate(base, 180)),
  ], random);

  for (const candidate of candidates) {
    if (distractors.length === 3) break;
    const key = candidate.join('');
    if (seen.has(key)) continue;
    seen.add(key);
    distractors.push(candidate);
  }

  // 兜底：翻转正确图案的某个单元格，保证四个选项互不相同。
  let cursor = 0;
  while (distractors.length < 3) {
    const variant = correct.slice();
    variant[cursor % variant.length] = variant[cursor % variant.length] ? 0 : 1;
    cursor += 1;
    const key = variant.join('');
    if (seen.has(key)) continue;
    seen.add(key);
    distractors.push(variant);
  }

  const options = shuffle([correct, ...distractors], random);
  return {
    base: base.slice(),
    options,
    answer: options.findIndex((grid) => same(grid, correct)),
  };
}

export function buildItems(seed = 20261107) {
  const random = mulberry32(seed);
  return SV_PATTERNS.map((base) => buildItem(base, random));
}

export function summarizeSv(answers) {
  const total = answers.length;
  const correct = answers.filter(Boolean).length;
  return { total, correct, accuracy: total === 0 ? null : Number((correct / total).toFixed(3)) };
}

function patternNode(grid, label) {
  const cells = grid.map((on) => el('span', { class: on ? 'cell on' : 'cell' }));
  return el('div', { class: 'grid3', role: 'img', 'aria-label': label }, cells);
}

export const svTask = {
  id: 'sv',
  mount(root, ctx) {
    const items = (ctx.draft && ctx.draft.items) || buildItems();
    const saved = ctx.draft || {};
    const answers = Array.isArray(saved.answers) ? saved.answers.slice() : [];
    let index = typeof saved.index === 'number' ? saved.index : answers.length;
    let shownAt = now();
    let cleanupKeys = () => {};

    const finish = () => {
      ctx.finish({ taskId: 'sv', metrics: summarizeSv(answers), answers });
    };

    const choose = (choice) => {
      const item = items[index];
      if (!item) return;
      answers[index] = choice === item.answer;
      index += 1;
      ctx.saveDraft({ index, answers, items });
      if (index >= items.length) {
        finish();
        return;
      }
      draw();
    };

    const draw = () => {
      const item = items[index];
      shownAt = now();

      const options = item.options.map((grid, i) => button(
        '',
        () => choose(i),
        { variant: 'option grid-option', ariaLabel: `选项 ${i + 1}` },
      ));
      options.forEach((node, i) => {
        node.appendChild(patternNode(item.options[i], `选项 ${i + 1}`));
        node.appendChild(el('span', { class: 'opt-index', text: String(i + 1) }));
      });

      clear(root);
      root.appendChild(el('div', { class: 'task-head' }, [
        el('span', { class: 'kicker', text: `第 ${index + 1} / ${items.length} 题` }),
        el('span', { class: 'muted', text: '按键 1–4 也可作答' }),
      ]));
      root.appendChild(el('h2', { class: 'task-question', text: '把上面的图案顺时针旋转 90°，是下面哪一个？' }));
      root.appendChild(el('div', { class: 'sv-base' }, [patternNode(item.base, '原始图案')]));
      root.appendChild(el('div', { class: 'options options-grid', role: 'group', 'aria-label': '选项' }, options));

      cleanupKeys();
      const onKey = (event) => {
        const n = Number(event.key);
        if (n >= 1 && n <= 4) {
          event.preventDefault();
          choose(n - 1);
        }
      };
      document.addEventListener('keydown', onKey);
      cleanupKeys = () => document.removeEventListener('keydown', onKey);
      options[0].focus({ preventScroll: true });
    };

    void shownAt;
    draw();
    return () => cleanupKeys();
  },
};
