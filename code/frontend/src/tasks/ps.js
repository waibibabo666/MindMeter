/**
 * 知觉速度：45 秒符号匹配。
 * 记录正确数、错误数、平均反应时；不计分。
 */
import { PS_SYMBOLS } from '../data.js';
import { el, button, clear, now, ticker } from '../ui.js';
import { mulberry32, shuffle, pick } from '../random.js';

const DURATION = 45;
const GROUP = 3;

function shift(chars) {
  return [chars[1], chars[2], chars[0]].join('');
}

export function makeTrial(random) {
  // 目标至少要有两个不同符号，否则干扰项容易退化。
  let target = '';
  do {
    target = Array.from({ length: GROUP }, () => pick(PS_SYMBOLS, random)).join('');
  } while (new Set(target).size < 2);

  const options = new Set([target]);
  let guard = 0;
  while (options.size < 4 && guard < 60) {
    guard += 1;
    const chars = target.split('');
    const at = Math.floor(random() * GROUP);
    const alternatives = PS_SYMBOLS.filter((symbol) => symbol !== chars[at]);
    chars[at] = pick(alternatives, random);
    options.add(chars.join(''));
  }

  const list = shuffle([...options], random);
  return { target, options: list, answer: list.indexOf(target) };
}

/** 生成若干互不相同的题，保证每题只有一个正确答案。 */
export function buildTrials(seed = 20261107, count = 24) {
  const random = mulberry32(seed);
  const trials = [];
  const seen = new Set();
  for (let i = 0; i < count; i += 1) {
    let trial = makeTrial(random);
    let guard = 0;
    while (seen.has(trial.options.join('|')) && guard < 20) {
      trial = makeTrial(random);
      guard += 1;
    }
    seen.add(trial.options.join('|'));
    trials.push(trial);
  }
  return trials;
}

export function summarizePs(trials) {
  const done = trials.length;
  const correct = trials.filter((t) => t.correct).length;
  const rts = trials.map((t) => t.rtMs).filter((v) => typeof v === 'number');
  return {
    trials: done,
    correct,
    wrong: done - correct,
    meanRtMs: rts.length === 0 ? null : Math.round(rts.reduce((a, b) => a + b, 0) / rts.length),
    seconds: DURATION,
  };
}

export const psTask = {
  id: 'ps',
  mount(root, ctx) {
    const trials = buildTrials();
    const done = (ctx.draft && Array.isArray(ctx.draft.trials)) ? ctx.draft.trials.slice() : [];
    let index = done.length % trials.length;
    let shownAt = now();
    let finished = false;

    const timerNode = el('span', { class: 'timer', text: `剩余 ${DURATION} 秒` });
    const board = el('div', { class: 'ps-board' });
    const progress = el('span', { class: 'muted', text: '已完成 0 题' });

    let cleanupKeys = () => {};
    let stopTimer = () => {};

    const finish = () => {
      if (finished) return;
      finished = true;
      stopTimer();
      cleanupKeys();
      ctx.finish({ taskId: 'ps', metrics: summarizePs(done), answers: done });
    };

    const choose = (choice) => {
      if (finished) return;
      const trial = trials[index];
      if (!trial) return;
      done.push({ correct: choice === trial.answer, rtMs: Math.round(now() - shownAt) });
      index = (index + 1) % trials.length;
      ctx.saveDraft({ trials: done });
      draw();
    };

    const draw = () => {
      const trial = trials[index];
      shownAt = now();
      progress.textContent = `已完成 ${done.length} 题`;

      const options = trial.options.map((text, i) => button(
        text,
        () => choose(i),
        { variant: 'option symbol', ariaLabel: `选项 ${i + 1}：${text}` },
      ));

      clear(board);
      board.appendChild(el('div', { class: 'ps-target', 'aria-label': `目标：${trial.target}` }, [
        el('span', { class: 'ps-target-label', text: '目标' }),
        el('span', { class: 'ps-target-value', text: trial.target }),
      ]));
      board.appendChild(el('div', { class: 'options options-grid', role: 'group', 'aria-label': '选项' }, options));

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
    };

    clear(root);
    root.appendChild(el('div', { class: 'task-head' }, [timerNode, progress]));
    root.appendChild(board);

    stopTimer = ticker(DURATION, (left) => {
      timerNode.textContent = `剩余 ${left} 秒`;
    }, finish);

    draw();
    return () => {
      finished = true;
      stopTimer();
      cleanupKeys();
    };
  },
};
