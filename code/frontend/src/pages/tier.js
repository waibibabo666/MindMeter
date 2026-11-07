import { el, button } from '../ui.js';
import { DIMS, TIERS } from '../data.js';

export function renderTier(root, ctx) {
  const cards = TIERS.map((tier) => {
    const names = tier.tasks.map((id) => DIMS.find((d) => d.id === id).name).join(' · ');
    const disabled = !tier.available;
    return el('div', {
      class: `tier-card${disabled ? ' disabled' : ''}`,
      role: disabled ? 'presentation' : 'button',
      tabindex: disabled ? null : '0',
      'aria-disabled': disabled ? 'true' : null,
      onclick: disabled ? null : () => ctx.pickTier(tier.id),
      onkeydown: disabled ? null : (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          ctx.pickTier(tier.id);
        }
      },
    }, [
      el('div', { class: 'tier-head' }, [
        el('span', { class: 'tier-name', text: tier.name }),
        el('span', { class: 'tier-time', text: `≈ ${tier.minutes} 分钟` }),
      ]),
      el('p', { class: 'muted', text: names }),
      el('p', { class: 'tiny', text: disabled ? `本任务只交付标准档（${tier.note}）` : `${tier.tasks.length} 项 · 逐项完成` }),
    ]);
  });

  root.appendChild(el('section', { class: 'page', 'aria-labelledby': 'tier-title' }, [
    el('h1', { id: 'tier-title', class: 'page-title', text: '选择深度' }),
    el('p', { class: 'lead', text: '三档的维度不同，所以不设总分；跨档只比较共同维度。' }),
    el('div', { class: 'tier-list' }, cards),
    el('p', { class: 'tiny', text: 'L-01 只实现标准档的 4 项；快测与深度在后续任务里补齐。' }),
    button('返回首页', () => ctx.go('/'), { variant: 'ghost' }),
  ]));
}
