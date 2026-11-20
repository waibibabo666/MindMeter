/**
 * 「今天的状态」页（合并页 B）：每次测评前都要填的两项。
 *
 * 睡眠与疲劳会明显影响速度类/记忆类表现，属于**临场状态**：只留在本次会话内存，
 * 不进账号档案（人工测试反馈：不该和"只填一次"的年龄/同意混在同一页反复问）。
 * 这里同时给出这一档会测什么、大约多久，让用户在开始前就知道自己要花多少时间。
 */
import { el, button, hint, titled } from '../ui.js';
import { segmented } from '../controls.js';
import { SLEEP_OPTIONS, readProfile, saveProfile, stateWarning } from '../profile.js';
import { DIMS, TIERS } from '../data.js';

/* 反馈 2：解释收进浮框；睡眠/疲劳的有效性警告（stateWarning）必须留在页面上。 */
const TIP_STATE =
  '这两项每次都重新填：它们不改变分数，只改变我们对这份结果可信度的判断，也不会写进账号档案。';
const TIP_SLEEP = '睡眠不足会明显拉低速度类与记忆类表现。';
const TIP_PLAN =
  '题目按固定顺序呈现，逐项完成；中途可以退出，进度保存在本账号。同一份卷子短期内重复做会有练习效应，间隔不足 7 天的复测会在报告里标出来。';

const FATIGUE_OPTIONS = [
  { value: 1, label: '1', hint: '很精神' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5', hint: '很累' },
];

function select(options, value, id) {
  const node = el('select', { class: 'input', id });
  node.appendChild(el('option', { value: '', text: '请选择' }));
  for (const option of options) {
    const item = el('option', { value: option.value, text: option.label });
    if (option.value === value) item.selected = true;
    node.appendChild(item);
  }
  return node;
}

export function renderPrep(root, ctx) {
  const profile = readProfile();
  const state = ctx.state;
  const tier = TIERS.find((item) => item.id === (state.tier || 'standard')) || TIERS[1];
  const names = tier.tasks.map((id) => DIMS.find((dim) => dim.id === id)?.name || id);

  const sleep = select(SLEEP_OPTIONS, profile.sleep, 'prep-sleep');
  const fatigue = segmented({
    name: 'prep-fatigue',
    options: FATIGUE_OPTIONS,
    value: profile.fatigue,
    ariaLabel: '当前疲劳程度，1 很精神，5 很累',
  });
  const fatigueNote = el('p', {
    class: 'field-hint',
    text: fatigueHint(profile.fatigue),
  });
  const warn = el('p', { class: 'notice', text: '' });
  const error = el('p', { class: 'status', role: 'status', text: '' });

  sleep.addEventListener('change', refresh);
  fatigue.node.addEventListener('change', refresh);

  function refresh() {
    fatigueNote.textContent = fatigueHint(fatigue.value);
    const text = stateWarning({ sleep: sleep.value, fatigue: fatigue.value });
    warn.hidden = !text;
    warn.textContent = text;
  }

  function submit() {
    if (!sleep.value) {
      error.className = 'status bad';
      error.textContent = '请选择昨晚睡眠时长';
      sleep.focus();
      return;
    }
    if (fatigue.value === null) {
      error.className = 'status bad';
      error.textContent = '请给当前的疲劳程度打个分';
      return;
    }
    saveProfile({ sleep: sleep.value, fatigue: fatigue.value });
    ctx.startAssessment();
  }

  error.className = 'status';
  refresh();

  root.appendChild(
    el('section', { class: 'page page-narrow', 'aria-labelledby': 'prep-title' }, [
      el('p', { class: 'kicker', text: '每次都问 · 只影响这一次的解读' }),
      el('h1', { id: 'prep-title', class: 'page-title', text: '今天的状态' }),
      el('div', { class: 'card form' }, [
        titled('h2', '临场状态', TIP_STATE),
        el('label', { class: 'field' }, [
          el('span', { class: 'field-label' }, ['昨晚睡眠时长', hint(TIP_SLEEP)]),
          sleep,
        ]),
        el('div', { class: 'field' }, [
          el('span', { class: 'field-label', text: '当前疲劳程度' }),
          fatigue.node,
          fatigueNote,
        ]),
        warn,
      ]),
      el('div', { class: 'card' }, [
        titled('h2', `本次将测：${tier.name}档`, TIP_PLAN),
        el('p', { class: 'muted', text: `${tier.tasks.length} 项 · 约 ${tier.minutes} 分钟` }),
        el('p', { class: 'tiny', text: names.join(' · ') }),
      ]),
      error,
      el('div', { class: 'row' }, [
        button('开始测评', submit, { variant: 'primary' }),
        button('返回选档位', () => ctx.go('/tier'), { variant: 'ghost' }),
      ]),
    ]),
  );
  sleep.focus();
}

function fatigueHint(value) {
  if (value === null || value === undefined) return '1 很精神，5 很累';
  return `当前疲劳：${value} / 5（1 很精神，5 很累）`;
}
