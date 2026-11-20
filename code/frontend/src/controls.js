/**
 * 两个复用控件（人工测试反馈：年龄的原生上下箭头太小、疲劳滑块两端拉不到边）。
 *
 * 共同点：触控区 ≥44px、值只从控件里出（不靠浏览器默认外观）、都能键盘操作，
 * 并且把"当前值"收敛成一个 getter，页面不需要再读 DOM。
 */

import { el } from './ui.js';

const MIN = 44;

/**
 * 数值收敛。注意 `Number('')` 是 0：空输入必须走 fallback，
 * 否则"没填"会被静默当成最小值（年龄会被写成 10 岁）。
 */
export function clampNumber(value, min, max, fallback = null) {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === '' || raw === null || raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * 数字步进器：[−] [输入框] [+]。
 * 原生 spin button 只有 ~12px，改成两个 44px 按钮 + 居中数字输入。
 */
export function stepper({
  id,
  value = null,
  min = 0,
  max = 120,
  step = 1,
  placeholder = '',
  ariaLabel = '',
}) {
  const input = el('input', {
    class: 'input stepper-input',
    id,
    type: 'number',
    inputmode: 'numeric',
    min: String(min),
    max: String(max),
    step: String(step),
    placeholder,
    value: value === null || value === undefined ? '' : String(value),
    'aria-label': ariaLabel || null,
  });

  const nudge = (delta) => {
    const current = clampNumber(input.value, min, max, delta > 0 ? min - step : max + step);
    const next = clampNumber((current ?? min) + delta, min, max, current ?? min);
    input.value = String(next);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const minus = el('button', {
    class: 'stepper-btn',
    type: 'button',
    text: '−',
    'aria-label': '减少',
    onclick: () => nudge(-step),
  });
  const plus = el('button', {
    class: 'stepper-btn',
    type: 'button',
    text: '+',
    'aria-label': '增加',
    onclick: () => nudge(step),
  });

  const node = el('div', { class: 'stepper' }, [minus, input, plus]);
  return {
    node,
    input,
    get value() {
      return clampNumber(input.value, min, max, null);
    },
    set value(next) {
      input.value = next === null || next === undefined ? '' : String(next);
    },
    min: MIN,
  };
}

/**
 * 分段单选：5 档疲劳这种"档位很少的离散值"用按钮条比 range 滑块更准，
 * 也不存在滑块 thumb 半宽导致的两端拉不到边问题。
 */
export function segmented({ name, options = [], value = null, ariaLabel = '' }) {
  let selected = options.some((item) => item.value === value) ? value : null;
  const inputs = [];

  const buttons = options.map((item) => {
    const input = el('input', {
      type: 'radio',
      class: 'seg-input',
      name,
      value: String(item.value),
      checked: selected === item.value ? 'checked' : null,
    });
    input.addEventListener('change', () => {
      if (input.checked) selected = item.value;
    });
    inputs.push(input);
    return el('label', { class: 'seg-opt' }, [
      input,
      el('span', { class: 'seg-value', text: String(item.label ?? item.value) }),
      item.hint ? el('span', { class: 'seg-hint', text: item.hint }) : null,
    ]);
  });

  const node = el(
    'div',
    { class: 'seg', role: 'radiogroup', 'aria-label': ariaLabel || name },
    buttons,
  );
  return {
    node,
    get value() {
      return selected;
    },
    set value(next) {
      selected = options.some((item) => item.value === next) ? next : null;
      inputs.forEach((input, index) => {
        input.checked = options[index].value === selected;
      });
    },
  };
}
