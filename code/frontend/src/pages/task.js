import { el, clear } from '../ui.js';
import { STANDARD_ORDER, TASK_META } from '../data.js';
import { vcTask } from '../tasks/vc.js';
import { psTask } from '../tasks/ps.js';
import { svTask } from '../tasks/sv.js';
import { amTask } from '../tasks/am.js';

const RUNNERS = { vc: vcTask, ps: psTask, sv: svTask, am: amTask };

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

  const host = el('div', { class: 'task-host' });
  const section = el('section', { class: 'page task-page', 'aria-labelledby': 'task-title' }, [
    el('div', { class: 'hud' }, [
      el('span', { class: 'kicker', text: `第 ${position} / ${order.length} 项` }),
      el('span', { class: 'muted', text: meta.name }),
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
    el('p', { class: 'tiny', text: '本页只采集原始指标；计时与进度已存本机，刷新可继续。' }),
  ]);
  root.appendChild(section);

  const draft = (state.drafts && state.drafts[taskId]) || null;
  let current = draft ? Object.assign({}, draft) : null;
  let cleanup = () => {};

  const taskCtx = {
    draft,
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
  cleanup = runner.mount(host, taskCtx) || (() => {});
  section.dataset.taskId = taskId;

  return () => {
    cleanup();
    clear(host);
  };
}
