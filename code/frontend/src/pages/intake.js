/**
 * 测评前填写：年龄、教育（只填一次）+ 睡眠、疲劳（每次都填）。
 *
 * 这些信息**不参与计分**，只用于分段参考与有效性标记。
 */
import { el, button } from '../ui.js';
import { EDU_OPTIONS, SLEEP_OPTIONS, hasBaseInfo, readProfile, saveProfile } from '../profile.js';

function field(label, hint, control) {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: label }),
    control,
    hint ? el('span', { class: 'field-hint', text: hint }) : null,
  ]);
}

function select(options, value) {
  const node = el('select', { class: 'input' });
  node.appendChild(el('option', { value: '', text: '请选择' }));
  for (const option of options) {
    const item = el('option', { value: option.value, text: option.label });
    if (option.value === value) item.selected = true;
    node.appendChild(item);
  }
  return node;
}

export function renderIntake(root, ctx) {
  const profile = readProfile();
  const needBase = !hasBaseInfo(profile);

  const ageInput = el('input', {
    class: 'input',
    type: 'number',
    min: '10',
    max: '100',
    placeholder: '例如 22',
    value: profile.age ? String(profile.age) : '',
  });
  const eduSelect = select(EDU_OPTIONS, profile.edu);
  const sleepSelect = select(SLEEP_OPTIONS, profile.sleep);
  const fatigueInput = el('input', {
    class: 'input',
    type: 'range',
    min: '1',
    max: '5',
    step: '1',
    value: String(profile.fatigue || 3),
  });
  const fatigueLabel = el('span', {
    class: 'field-hint',
    text: `当前疲劳：${profile.fatigue || 3} / 5（1 很精神，5 很累）`,
  });

  fatigueInput.addEventListener('input', () => {
    fatigueLabel.textContent = `当前疲劳：${fatigueInput.value} / 5（1 很精神，5 很累）`;
  });

  const error = el('p', { class: 'tiny', text: '' });

  const submit = () => {
    const age = Number(ageInput.value);
    if (!Number.isFinite(age) || age < 10 || age > 100) {
      error.textContent = '请填写 10–100 之间的年龄';
      return;
    }
    if (!eduSelect.value) {
      error.textContent = '请选择最高学历';
      return;
    }
    if (!sleepSelect.value) {
      error.textContent = '请选择昨晚睡眠时长';
      return;
    }
    saveProfile({
      age,
      edu: eduSelect.value,
      sleep: sleepSelect.value,
      fatigue: Number(fatigueInput.value),
    });
    ctx.go('/consent');
  };

  root.appendChild(
    el('section', { class: 'page', 'aria-labelledby': 'intake-title' }, [
      el('h1', { id: 'intake-title', class: 'page-title', text: '开始之前' }),
      el('p', {
        class: 'lead',
        text: '这几点只用来判断结果是否可信，不参与计分。年龄和教育只问一次，之后自动带出。',
      }),
      el('div', { class: 'card form' }, [
        needBase ? field('年龄', '用于同龄段参考', ageInput) : null,
        needBase ? field('最高学历', '影响言语与推理类，仅作参考', eduSelect) : null,
        field('昨晚睡眠时长', '睡眠不足会明显拉低速度类分数', sleepSelect),
        field('当前疲劳程度', '', fatigueInput),
        fatigueLabel,
        error,
        el('div', { class: 'row' }, [
          button('开始测评', submit, { variant: 'primary' }),
          button('返回', () => ctx.go('/tier'), { variant: 'ghost' }),
        ]),
      ]),
    ]),
  );
}
