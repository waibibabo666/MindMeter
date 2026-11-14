/**
 * 言语理解：分层随机组卷 + 题型交错。
 *
 * 组卷：按 VC_PAPER_PLAN 从各层抽固定数量，再按 VC_ORDER_PATTERN 交错排列，
 *       避免连续多道同型题让人进入「自动模式」。
 * 计分：交给 scoring/formulas.js 的 scoreVc（含猜测校正）。
 */
import { VC_BANK, VC_ORDER_PATTERN, VC_PAPER_PLAN } from './vcBank.js';
import { el, button, clear, now } from '../ui.js';

const LAYER_LABEL = { vocab: '词汇', text: '篇章', relation: '类比' };

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

/** 让近义题与反义题交替，减少连续同向带来的模式化。 */
function alternateDir(list) {
  const syn = list.filter((item) => item.dir === 'syn');
  const ant = list.filter((item) => item.dir === 'ant');
  const out = [];
  let turn = 0;
  while (syn.length || ant.length) {
    const pool = turn % 2 === 0 ? syn : ant;
    const other = turn % 2 === 0 ? ant : syn;
    if (pool.length) out.push(pool.shift());
    else if (other.length) out.push(other.shift());
    turn += 1;
  }
  return out;
}

/** 按档位组卷；题库不足时按可用数量截断。 */
export function buildVcPaper(level = 'standard', random = Math.random) {
  const plan = VC_PAPER_PLAN[level] || VC_PAPER_PLAN.standard;
  const pattern = VC_ORDER_PATTERN[level] || VC_ORDER_PATTERN.standard;

  const vocab = [];
  for (const band of [1, 2, 3]) {
    const want = (plan.vocab && plan.vocab[band]) || 0;
    if (want <= 0) continue;
    const pool = VC_BANK.filter((item) => item.layer === 'vocab' && item.band === band);
    vocab.push(...shuffle(pool, random).slice(0, want));
  }
  const batchOfBand = [];
  for (let i = 1; i <= 3; i += 1) {
    batchOfBand.push(
      ...alternateDir(vocab.filter((item) => item.band === i)).sort(() =>
        random() < 0.5 ? -1 : 1,
      ),
    );
  }

  const queues = {
    vocab: batchOfBand,
    text: shuffle(
      VC_BANK.filter((item) => item.layer === 'text'),
      random,
    ).slice(0, plan.text || 0),
    relation: shuffle(
      VC_BANK.filter((item) => item.layer === 'relation'),
      random,
    ).slice(0, plan.relation || 0),
  };

  const paper = [];
  for (const layer of pattern) {
    const queue = queues[layer];
    if (!queue || queue.length === 0) continue;
    paper.push(queue.shift());
  }
  // 节奏表没覆盖到的题目补在末尾，避免丢题
  for (const layer of ['vocab', 'text', 'relation']) {
    paper.push(...queues[layer]);
  }
  return paper;
}

export function summarizeVc(answers) {
  const total = answers.length;
  const correct = answers.filter((a) => a && a.correct).length;
  return {
    total,
    correct,
    accuracy: total === 0 ? null : Number((correct / total).toFixed(3)),
    meanRtMs:
      total === 0 ? null : Math.round(answers.reduce((sum, a) => sum + (a.rtMs || 0), 0) / total),
    itemIds: answers.map((a) => (a && a.id) || '').filter(Boolean),
  };
}

function segments(total, current) {
  const bar = el('div', {
    class: 'segbar',
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': String(total),
    'aria-valuenow': String(current),
  });
  for (let i = 0; i < total; i += 1) {
    bar.appendChild(el('i', { class: i < current ? 'on' : '' }));
  }
  return bar;
}

export const vcTask = {
  id: 'vc',
  mount(root, ctx) {
    const saved = ctx.draft || {};
    const items =
      Array.isArray(saved.items) && saved.items.length ? saved.items : buildVcPaper(ctx.level);

    const answers = Array.isArray(saved.answers) ? saved.answers.slice() : [];
    let index = typeof saved.index === 'number' ? saved.index : answers.length;
    let shownAt = now();
    let cleanupKeys = () => {};

    const finish = () => {
      ctx.finish({ taskId: 'vc', metrics: summarizeVc(answers), answers });
    };

    const choose = (choice) => {
      const item = items[index];
      if (!item) return;
      answers[index] = {
        id: item.id,
        layer: item.layer,
        band: item.band,
        dir: item.dir,
        choice,
        correct: choice === item.answer,
        rtMs: Math.round(now() - shownAt),
      };
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

      const options = item.options.map((text, i) =>
        button(`${i + 1}. ${text}`, () => choose(i), { variant: 'option' }),
      );

      clear(root);
      root.appendChild(
        el('div', { class: 'task-head' }, [
          el('span', { class: 'kicker', text: `第 ${index + 1} / ${items.length} 题` }),
          el('span', { class: 'tag', text: LAYER_LABEL[item.layer] || '题目' }),
          el('span', { class: 'muted', text: '按键 1–4 也可作答' }),
        ]),
      );
      root.appendChild(segments(items.length, index));
      root.appendChild(
        el('div', { class: 'q-fade' }, [
          el('h2', { class: 'task-question', text: item.q }),
          el('div', { class: 'options', role: 'group', 'aria-label': '选项' }, options),
        ]),
      );

      cleanupKeys();
      const onKey = (event) => {
        const n = Number(event.key);
        if (n >= 1 && n <= item.options.length) {
          event.preventDefault();
          choose(n - 1);
        }
      };
      document.addEventListener('keydown', onKey);
      cleanupKeys = () => document.removeEventListener('keydown', onKey);
      options[0].focus({ preventScroll: true });
    };

    draw();
    return () => cleanupKeys();
  },
};
