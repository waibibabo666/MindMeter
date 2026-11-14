import { el, button } from '../ui.js';
import { LIMITS } from '../data.js';

export function renderConsent(root, ctx) {
  const gate = { age: ctx.state.consentedAge === true, privacy: ctx.state.consented === true };

  const start = button('开始测评', () => ctx.startAssessment(), { variant: 'primary' });
  start.disabled = !(gate.age && gate.privacy);

  const sync = () => {
    start.disabled = !(gate.age && gate.privacy);
  };

  const check = (key, label) =>
    el('label', { class: 'check' }, [
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

  root.appendChild(
    el('section', { class: 'page', 'aria-labelledby': 'consent-title' }, [
      el('h1', { id: 'consent-title', class: 'page-title', text: '开始之前' }),
      el('p', { class: 'lead', text: `标准档 · 4 项 · 约 13 分钟` }),
      el('div', { class: 'consent' }, [
        el('p', { text: '数据仅保存在本机数据库，可随时清除，清除后不可恢复。' }),
        el('p', { text: '本产品不是医疗器械，不提供诊断、治疗或医疗建议；报告不构成临床结论。' }),
        el('p', { text: '不设总分、没有常模、不做百分位，不与人群比较。' }),
      ]),
      check('age', '我已满 18 岁'),
      check('privacy', '我理解本产品非诊断用途，且数据只存本机'),
      start,
      button('换个档位', () => ctx.go('/tier'), { variant: 'ghost' }),
      el('p', { class: 'disclaimer', text: LIMITS[3] }),
    ]),
  );
}
