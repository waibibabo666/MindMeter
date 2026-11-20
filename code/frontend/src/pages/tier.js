/**
 * 选择深度（档位）页。
 *
 * 人工测试反馈 2：档位差别、区间宽窄这类解释不常驻页面——只留档位名、时长与维度名，
 * 解释收进板块标题与每张档位卡上的悬浮浮框（键盘可聚焦，读屏有 aria-label）。
 */
import { el, button, hint, titled } from '../ui.js';
import { DIMS, TIERS } from '../data.js';

const TIP_TIER =
  '三档测的是同样的 8 个维度，区别只在题量与限时；不设总分，只看各维度。题量越多，分数旁边的 ± 区间越窄。';

function tierTip(tier) {
  const base = `${tier.name}档：${tier.tasks.length} 项，约 ${tier.minutes} 分钟`;
  return tier.note ? `${base}；${tier.note}。` : `${base}；逐项完成。`;
}

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
          hint(tierTip(tier), { edge: true }),
        ]),
        el('p', { class: 'muted', text: names }),
      ],
    );
  });

  root.appendChild(
    el('section', { class: 'page', 'aria-labelledby': 'tier-title' }, [
      titled('h1', '选择深度', TIP_TIER, {
        attrs: { id: 'tier-title', class: 'page-title' },
      }),
      el('div', { class: 'tier-list' }, cards),
      button('返回首页', () => ctx.go('/'), { variant: 'ghost' }),
    ]),
  );
}
