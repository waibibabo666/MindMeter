/**
 * 言语理解：6 道四选一。
 * 只采集原始指标（正确数、每题反应时），不做任何计分。
 */
import { VC_ITEMS } from '../data.js';
import { sliceItems } from '../scoring/levels.js';
import { el, button, clear, now } from '../ui.js';

export function summarizeVc(answers) {
  const total = answers.length;
  const correct = answers.filter((a) => a && a.correct).length;
  return {
    total,
    correct,
    accuracy: total === 0 ? null : Number((correct / total).toFixed(3)),
    meanRtMs:
      total === 0 ? null : Math.round(answers.reduce((sum, a) => sum + (a.rtMs || 0), 0) / total),
  };
}

export const vcTask = {
  id: 'vc',
  mount(root, ctx) {
    const items = sliceItems(VC_ITEMS, (ctx.spec && ctx.spec.items) || items.length);
    const saved = ctx.draft || {};
    const answers = Array.isArray(saved.answers) ? saved.answers.slice() : [];
    let index = typeof saved.index === 'number' ? saved.index : answers.length;
    let shownAt = now();
    let cleanupKeys = () => {};

    const commitDraft = () => {
      ctx.saveDraft({ index, answers });
    };

    const finish = () => {
      ctx.finish({ taskId: 'vc', metrics: summarizeVc(answers), answers });
    };

    const choose = (choice) => {
      const item = items[index];
      if (!item) return;
      answers[index] = {
        choice,
        correct: choice === item.answer,
        rtMs: Math.round(now() - shownAt),
      };
      index += 1;
      commitDraft();
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
          el('span', { class: 'muted', text: '按键 1–4 也可作答' }),
        ]),
      );
      root.appendChild(el('h2', { class: 'task-question', text: item.q }));
      root.appendChild(
        el('div', { class: 'options', role: 'group', 'aria-label': '选项' }, options),
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
