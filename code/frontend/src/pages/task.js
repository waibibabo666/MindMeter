/**
 * 测评步骤页：按维度分发到「任务」或「游戏」。
 *
 * 三档共用这一套流程，区别只在 ctx.spec（题量 / 限时）。
 */
import { el, clear } from '../ui.js';
import { STANDARD_ORDER, TASK_META } from '../data.js';
import { specFor } from '../scoring/levels.js';
import { vcTask } from '../tasks/vc.js';
import { psTask } from '../tasks/ps.js';
import { svTask } from '../tasks/sv.js';
import { amTask } from '../tasks/am.js';
import { ncTask } from '../tasks/nc.js';
import { irTask } from '../tasks/ir.js';
import { vfTask } from '../tasks/vf.js';
import { species } from '../games/quizzes.js';

const TASK_RUNNERS = {
  vc: vcTask,
  ps: psTask,
  sv: svTask,
  am: amTask,
  nc: ncTask,
  ir: irTask,
  vf: vfTask,
};

/** 游戏接入测评：把游戏的 (score, detail) 换成统一的结果结构。 */
function gameRunner(game, toMetrics) {
  return {
    mount(root, ctx) {
      const gameCtx = {
        toast: ctx.toast,
        level: ctx.level,
        spec: ctx.spec,
        finish: (score, detail) => {
          ctx.finish({ metrics: toMetrics(score, detail || {}) });
        },
      };
      return game.mount(root, gameCtx) || (() => {});
    },
  };
}

const GAME_RUNNERS = {
  ni: gameRunner(species, (score, d) => ({ total: d.total, correct: d.correct })),
};

const RUNNERS = Object.assign({}, TASK_RUNNERS, GAME_RUNNERS);

export function renderTask(root, ctx, taskId) {
  const state = ctx.state;
  const order = state.order && state.order.length ? state.order : STANDARD_ORDER;
  const runner = RUNNERS[taskId];

  if (!runner || !order.includes(taskId)) {
    ctx.go('/tier', { replace: true });
    return;
  }
  if (!state.tier) {
    ctx.go('/tier', { replace: true });
    return;
  }

  const position = order.indexOf(taskId) + 1;
  const meta = TASK_META[taskId];
  const level = state.level || 'standard';
  const spec = specFor(level, taskId);
  const isGame = Boolean(GAME_RUNNERS[taskId]);

  const host = el('div', { class: 'task-host' });
  const section = el('section', { class: 'page task-page', 'aria-labelledby': 'task-title' }, [
    el('div', { class: 'hud' }, [
      el('span', { class: 'kicker', text: `第 ${position} / ${order.length} 项` }),
      el('span', { class: 'muted', text: `${meta.name} · ${levelLabel(level)}` }),
    ]),
    el(
      'div',
      {
        class: 'bar',
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': String(order.length),
        'aria-valuenow': String(position - 1),
      },
      [el('i', { style: `width:${Math.round(((position - 1) / order.length) * 100)}%` })],
    ),
    host,
    el('p', {
      class: 'tiny',
      text: isGame
        ? '本项为游戏化测量，结束后统一计分；进度已存本机。'
        : '本页只采集原始指标；计时与进度已存本机，刷新可继续。',
    }),
  ]);
  root.appendChild(section);

  const draft = (state.drafts && state.drafts[taskId]) || null;
  let current = draft ? Object.assign({}, draft) : null;
  let cleanup = () => {};

  const taskCtx = {
    draft,
    level,
    spec,
    saveDraft: (patch) => {
      current = Object.assign({}, current, patch);
      ctx.patchDraft(taskId, current);
    },
    finish: (payload) => {
      cleanup();
      ctx.finishTask(taskId, payload);
    },
    toast: ctx.toast,
  };

  const id = el('h2', { id: 'task-title', class: 'sr-only', text: meta.name });
  section.insertBefore(id, host);

  try {
    cleanup = runner.mount(host, taskCtx) || (() => {});
  } catch (error) {
    ctx.toast('这一项的进度读取失败，已重开');
    ctx.clearDraft(taskId);
    taskCtx.draft = null;
    clear(host);
    try {
      cleanup = runner.mount(host, taskCtx) || (() => {});
    } catch (retryError) {
      clear(host);
      host.appendChild(
        el('div', { class: 'card' }, [
          el('h2', { class: 'card-title', text: '这一项打不开' }),
          el('p', { class: 'muted', text: '本地保存的进度可能已损坏，可以重开这一项后再试。' }),
        ]),
      );
    }
  }
  section.dataset.taskId = taskId;

  return () => {
    cleanup();
    clear(host);
  };
}

function levelLabel(level) {
  if (level === 'quick') return '快测档';
  if (level === 'deep') return '精细档';
  return '标准档';
}
