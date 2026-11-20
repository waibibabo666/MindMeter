/**
 * 「第一次见面」页（合并页 A）：年龄 + 最高学历 + 知情同意，一次填完，存进账号。
 *
 * 人工测试反馈：原来分成"开始之前（年龄）→ 知情同意（再勾一次）"两页，问了两遍，
 * 而且"只填一次"的状态存在浏览器 localStorage，换设备/无痕窗口就重新问。
 * 现在：这一页只在**账号里缺资料或同意条款升版**时出现，保存后由 app.js 的路由闸门
 * 自动放行到「今天的状态」页；睡眠/疲劳那种每次都不一样的东西不放这里。
 */
import { el, button, hint, titled } from '../ui.js';
import { stepper } from '../controls.js';
import { CONSENT_VERSION, EDU_OPTIONS, readProfile, saveProfile } from '../profile.js';
import { TIERS } from '../data.js';

/**
 * 表单次要提示收进浮框（反馈 2），但知情同意三句必须主动可见（A1 / F-08）：
 * 那三条与两个勾选项下面单独渲染，不套 hint、不靠 hover。
 */
const TIP_BASE =
  '这两项不参与计分，只用来给同龄段参考、判断这次结果可不可信；保存后存在你的账号里，换设备登录不会再问。';
const TIP_AGE = '用于「同龄参考」，不影响任何分数。';
const TIP_EDU = '影响言语与推理类的解读口径，仅作参考。';

function field(labelText, control, tip) {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field-label' }, [labelText, tip ? hint(tip) : null]),
    control,
  ]);
}

function select(options, value) {
  const node = el('select', { class: 'input', id: 'intake-edu' });
  node.appendChild(el('option', { value: '', text: '请选择' }));
  for (const option of options) {
    const item = el('option', { value: option.value, text: option.label });
    if (option.value === value) item.selected = true;
    node.appendChild(item);
  }
  return node;
}

const CONSENT_LINES = [
  '数据只保存在你的账号下，可随时导出或清除，清除后不可恢复。',
  '本产品不是医疗器械，不提供诊断、治疗或医疗建议；报告不构成临床结论。',
  '不设总分、没有常模、不做百分位，不与人群比较；分数只描述你这次的任务表现。',
];

export function renderIntake(root, ctx) {
  const profile = readProfile();
  const state = ctx.state;
  const tier = TIERS.find((item) => item.id === (state.tier || 'standard')) || TIERS[1];

  const gate = { age: state.consentedAge === true, privacy: state.consented === true };
  const age = stepper({
    id: 'intake-age',
    value: profile.age ?? '',
    min: 10,
    max: 100,
    step: 1,
    placeholder: '例如 22',
    ariaLabel: '年龄',
  });
  const edu = select(EDU_OPTIONS, profile.edu);
  const error = el('p', { class: 'status', role: 'status', text: '' });

  const start = button('保存并开始', () => submit(), { variant: 'primary' });
  start.disabled = !(gate.age && gate.privacy);

  function sync() {
    start.disabled = !(gate.age && gate.privacy);
  }

  function check(key, label) {
    return el('label', { class: 'check' }, [
      el('input', {
        type: 'checkbox',
        checked: gate[key] ? 'checked' : null,
        onchange: (event) => {
          gate[key] = event.target.checked;
          sync();
        },
      }),
      el('span', { text: label }),
    ]);
  }

  function submit() {
    const years = age.value;
    if (years === null) {
      error.className = 'status bad';
      error.textContent = '请填写 10–100 之间的年龄';
      age.input.focus();
      return;
    }
    if (!edu.value) {
      error.className = 'status bad';
      error.textContent = '请选择最高学历';
      edu.focus();
      return;
    }
    if (!(gate.age && gate.privacy)) {
      error.className = 'status bad';
      error.textContent = '请先勾选下面两项确认';
      return;
    }
    saveProfile({ age: years, edu: edu.value, consentVersion: CONSENT_VERSION });
    if (ctx.setConsent) ctx.setConsent({ consented: gate.privacy, consentedAge: gate.age });
    ctx.go('/prep');
  }

  root.appendChild(
    el('section', { class: 'page page-narrow', 'aria-labelledby': 'intake-title' }, [
      el('p', { class: 'kicker', text: '只填一次 · 存在你的账号里' }),
      el('h1', { id: 'intake-title', class: 'page-title', text: '先认识你一下' }),
      el('div', { class: 'card form' }, [
        titled('h2', '基本资料', TIP_BASE),
        field('年龄', age.node, TIP_AGE),
        field('最高学历', edu, TIP_EDU),
      ]),
      el('div', { class: 'card' }, [
        el('h2', { class: 'card-title', text: '开始前的三句话' }),
        el(
          'div',
          { class: 'consent' },
          CONSENT_LINES.map((text) => el('p', { text })),
        ),
        check('age', '我已满 18 岁'),
        check('privacy', '我理解以上边界，并同意在我的账号下保存这些数据'),
      ]),
      error,
      el('div', { class: 'row' }, [
        start,
        button('换个档位', () => ctx.go('/tier'), { variant: 'ghost' }),
      ]),
      el('p', { class: 'tiny' }, [
        `${tier.name}档 · ${tier.tasks.length} 项 · 约 ${tier.minutes} 分钟`,
        hint('下一步只问今天的状态（睡眠与疲劳）：它们只影响这一次的解读，不写进账号档案。', {
          edge: true,
        }),
      ]),
    ]),
  );
  age.input.focus();
}
