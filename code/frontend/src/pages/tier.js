import { el, button } from '../ui.js';
import { DIMS, TIERS } from '../data.js';

export function renderTier(root, ctx) {
  const cards = TIERS.map((tier) => {
    const names = tier.tasks.map((id) => DIMS.find((d) => d.id === id).name).join(' · ');
    const disabled = !tier.available;
    return el(
      'div',
      {
        class: `tier-card${disabled ? ' disabled' : ''}`,
        role: disabled ? 'presentation' : 'button',
        tabindex: disabled ? null : '0',
        'aria-disabled': disabled ? 'true' : null,
        onclick: disabled ? null : () => ctx.pickTier(tier.id),
        onkeydown: disabled
          ? null
          : (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                ctx.pickTier(tier.id);
              }
            },
      },
      [
        el('div', { class: 'tier-head' }, [
          el('span', { class: 'tier-name', text: tier.name }),
          el('span', { class: 'tier-time', text: `≈ ${tier.minutes} 分钟` }),
        ]),
        el('p', { class: 'muted', text: names }),
        el('p', {
          class: 'tiny',
          text: disabled
            ? `本任务只交付标准档（${tier.note}）`
            : `${tier.tasks.length} 项 · 逐项完成`,
        }),
      ],
    );
  });

  root.appendChild(
    el('section', { class: 'page', 'aria-labelledby': 'tier-title' }, [
      el('h1', { id: 'tier-title', class: 'page-title', text: '选择深度' }),
      el('p', {
        class: 'lead',
        text: '三档都测同样的 8 个维度，区别只在题量与限时；不设总分，只看各维度。',
      }),
      el('div', { class: 'tier-list' }, cards),
      el('p', {
        class: 'tiny',
        text: '题量越多，分数旁边的 ±区间越窄。快测约 6 分钟，标准约 12 分钟，精细约 18 分钟。',
      }),
      button('返回首页', () => ctx.go('/'), { variant: 'ghost' }),
    ]),
  );
}
