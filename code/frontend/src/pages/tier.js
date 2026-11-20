/**
 * 选择深度（档位）页。
 *
 * 人工测试反馈 2：档位差别、区间宽窄这类解释不常驻页面——解释收进板块标题与
 * 每张档位卡上的悬浮浮框（键盘可聚焦，读屏有 aria-label）。
 *
 * 人工测试反馈 3 第 3 条（测试图 05）：原来三张卡片下面**逐字重复同一串 8 个维度名**，
 * 三档完全一样，等于零信息。现在卡片上只放能区分档位的具体数字（总题量 + 三档取值
 * 互不相同的那些维度的题量/限时），数字全部从 src/scoring/levels.js 的 LEVEL_SPEC 算，
 * 不手写常量。"三档同维度、只差题量与限时"这句口径只在页面标题的浮框里出现一次；
 * 8 个维度的名字改到「今天的状态」页列一遍（那里本来就要交代本次将测什么）。
 */
import { el, button, hint, titled } from '../ui.js';
import { DIMS, STANDARD_ORDER, TIERS } from '../data.js';
import { LEVELS, specFor } from '../scoring/levels.js';

const TIP_TIER =
  '三档测的是同样的 8 个维度，区别只在题量与限时；不设总分，只看各维度。题量越多，分数旁边的 ± 区间越窄。';

/** 每档的定性差别：只写卡片上那些数字表达不了的部分，数字不在这里重复。 */
const TIER_QUALITATIVE = {
  quick: '题量最少、限时最短，分数旁边的 ± 区间最宽；适合先看个大概。',
  standard: '题量与限时都取中间，第一次测建议从这一档开始。',
  deep: '题量最多、两个限时维度拉得最长，区间最窄；连续做更费神，建议状态好时再选。',
};

const DIM_SHORT = new Map(DIMS.map((dim) => [dim.id, dim.short]));

/** 一个维度在某档的规格：限时维度是秒数，其余是题数。 */
function specValue(level, id) {
  const spec = specFor(level, id) || {};
  if (typeof spec.seconds === 'number') return { unit: '秒', value: spec.seconds };
  if (typeof spec.items === 'number') return { unit: '题', value: spec.items };
  return null;
}

/** 三档取值互不相同的维度：只有这些数字能区分档位，卡片就只列这些。 */
function differentiatingDims() {
  return STANDARD_ORDER.filter((id) => {
    const seen = LEVELS.map((level) => {
      const spec = specValue(level, id);
      return spec ? `${spec.value}${spec.unit}` : '';
    });
    return new Set(seen).size === seen.length;
  });
}

/** 这一档的总题量（限时维度没有题数，不计进来）。 */
function totalItems(level) {
  return STANDARD_ORDER.reduce((sum, id) => {
    const spec = specValue(level, id);
    return spec && spec.unit === '题' ? sum + spec.value : sum;
  }, 0);
}

/**
 * 卡片上的差异行。导出是为了让 scripts/test_units.js 能直接断言
 * "三档的数字互不相同、且确实来自 LEVEL_SPEC"，而不是断言一句写死的文案。
 * @param {{id: string, level: string}} tier
 * @returns {string[]}
 */
export function tierMetrics(tier) {
  const chips = [`共 ${totalItems(tier.level)} 题`];
  for (const id of differentiatingDims()) {
    const spec = specValue(tier.level, id);
    if (!spec) continue;
    chips.push(`${DIM_SHORT.get(id) || id} ${spec.value} ${spec.unit}`);
  }
  return chips;
}

function tierTip(tier) {
  return TIER_QUALITATIVE[tier.id] || '逐项完成，中途可以退出，进度保存在本账号。';
}

function tierCard(tier, ctx) {
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
      el(
        'div',
        { class: 'tier-spec' },
        tierMetrics(tier).map((text) => el('span', { class: 'tier-metric', text })),
      ),
    ],
  );
}

export function renderTier(root, ctx) {
  root.appendChild(
    el('section', { class: 'page', 'aria-labelledby': 'tier-title' }, [
      titled('h1', '选择深度', TIP_TIER, {
        attrs: { id: 'tier-title', class: 'page-title' },
      }),
      el(
        'div',
        { class: 'tier-list' },
        TIERS.map((tier) => tierCard(tier, ctx)),
      ),
      button('返回首页', () => ctx.go('/'), { variant: 'ghost' }),
    ]),
  );
}
