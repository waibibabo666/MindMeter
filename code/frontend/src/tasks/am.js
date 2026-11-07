/**
 * 联想记忆：先学 12 组词对，再做 16 题配对再认。
 * 记录命中、漏报、虚报、正确拒绝；不计分。
 */
import { AM_PAIRS } from '../data.js';
import { el, button, clear, now, ticker } from '../ui.js';
import { mulberry32, shuffle } from '../random.js';

const STUDY_SECONDS = 20;

/** 构造再认题：8 组原配（旧）+ 8 组错配（新）。 */
export function buildRecognition(seed = 20261107) {
  const random = mulberry32(seed);
  const originSet = new Set(AM_PAIRS.map(([l, r]) => `${l}|${r}`));
  const order = shuffle(AM_PAIRS.map((_, i) => i), random);
  const oldIndexes = order.slice(0, 8);

  const olds = oldIndexes.map((i) => ({
    left: AM_PAIRS[i][0],
    right: AM_PAIRS[i][1],
    isOld: true,
  }));

  // 错配：用第 k 个词的左词 + 第 k+1 个词的右词，保证不是原配。
  const foils = oldIndexes.map((i, k) => {
    const j = oldIndexes[(k + 1) % oldIndexes.length];
    return { left: AM_PAIRS[i][0], right: AM_PAIRS[j][1], isOld: false };
  }).filter((pair) => !originSet.has(`${pair.left}|${pair.right}`));

  return shuffle([...olds, ...foils], random);
}

export function summarizeAm(trials) {
  const hits = trials.filter((t) => t.isOld && t.answer).length;
  const misses = trials.filter((t) => t.isOld && !t.answer).length;
  const falseAlarms = trials.filter((t) => !t.isOld && t.answer).length;
  const correctRejections = trials.filter((t) => !t.isOld && !t.answer).length;
  return {
    trials: trials.length,
    hits,
    misses,
    falseAlarms,
    correctRejections,
    accuracy: trials.length === 0
      ? null
      : Number(((hits + correctRejections) / trials.length).toFixed(3)),
  };
}

export const amTask = {
  id: 'am',
  mount(root, ctx) {
    const saved = ctx.draft || {};
    const trials = saved.trials || buildRecognition();
    const answers = Array.isArray(saved.answers) ? saved.answers.slice() : [];
    let phase = saved.phase === 'test' ? 'test' : 'study';
    let index = typeof saved.index === 'number' ? saved.index : answers.length;
    let shownAt = now();
    let cleanupKeys = () => {};
    let stopTimer = () => {};

    const finish = () => {
      ctx.finish({ taskId: 'am', metrics: summarizeAm(answers), answers });
    };

    const answer = (value) => {
      const trial = trials[index];
      if (!trial) return;
      answers[index] = {
        left: trial.left,
        right: trial.right,
        isOld: trial.isOld,
        answer: Boolean(value),
        rtMs: Math.round(now() - shownAt),
      };
      index += 1;
      ctx.saveDraft({ phase: 'test', index, answers, trials });
      if (index >= trials.length) {
        finish();
        return;
      }
      drawTest();
    };

    const drawTest = () => {
      const trial = trials[index];
      shownAt = now();

      const yes = button('见过（1）', () => answer(true), { variant: 'option' });
      const no = button('没见过（2）', () => answer(false), { variant: 'option' });

      clear(root);
      root.appendChild(el('div', { class: 'task-head' }, [
        el('span', { class: 'kicker', text: `再认 ${index + 1} / ${trials.length}` }),
        el('span', { class: 'muted', text: '按键 1 / 2 也可作答' }),
      ]));
      root.appendChild(el('div', { class: 'pair-card', 'aria-label': '词对' }, [
        el('span', { class: 'pair-word', text: trial.left }),
        el('span', { class: 'pair-dash', text: '—' }),
        el('span', { class: 'pair-word', text: trial.right }),
      ]));
      root.appendChild(el('p', { class: 'muted center', text: '这组词对刚才出现过吗？' }));
      root.appendChild(el('div', { class: 'options', role: 'group', 'aria-label': '选择' }, [yes, no]));

      cleanupKeys();
      const onKey = (event) => {
        if (event.key === '1') { event.preventDefault(); answer(true); }
        if (event.key === '2') { event.preventDefault(); answer(false); }
      };
      document.addEventListener('keydown', onKey);
      cleanupKeys = () => document.removeEventListener('keydown', onKey);
      yes.focus({ preventScroll: true });
    };

    const startTest = () => {
      stopTimer();
      cleanupKeys();
      phase = 'test';
      index = answers.length;
      ctx.saveDraft({ phase: 'test', index, answers, trials });
      drawTest();
    };

    const drawStudy = () => {
      const list = AM_PAIRS.map(([left, right]) => el('li', { class: 'pair-li' }, [
        el('span', { class: 'pair-word', text: left }),
        el('span', { class: 'pair-dash', text: '—' }),
        el('span', { class: 'pair-word', text: right }),
      ]));
      const remain = el('span', { class: 'timer', text: `剩余 ${STUDY_SECONDS} 秒` });

      clear(root);
      root.appendChild(el('div', { class: 'task-head' }, [
        el('span', { class: 'kicker', text: '学习阶段' }),
        remain,
      ]));
      root.appendChild(el('h2', { class: 'task-question', text: '记住下面 12 组词对' }));
      root.appendChild(el('ul', { class: 'pair-list', 'aria-label': '词对列表' }, list));
      root.appendChild(button('我记住了，开始再认', startTest, { variant: 'primary' }));

      stopTimer = ticker(STUDY_SECONDS, (left) => {
        remain.textContent = `剩余 ${left} 秒`;
      }, startTest);
    };

    if (phase === 'test') {
      if (index >= trials.length) {
        finish();
      } else {
        drawTest();
      }
    } else {
      drawStudy();
    }

    return () => {
      stopTimer();
      cleanupKeys();
    };
  },
};
