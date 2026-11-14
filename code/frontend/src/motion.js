/**
 * 轻量动效工具：数字滚动、微交互。
 *
 * 所有效果尊重 prefers-reduced-motion；出问题也不能影响页面渲染本身。
 */

function reducedMotion() {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

/** 纯数字（可带 +/− 号）才做滚动，其余文案原样保留。 */
function parseCountdown(text) {
  const match = /^([+−-]?)(\d{1,3})$/.exec(text.trim());
  if (!match) return null;
  return { sign: match[1], value: Number(match[2]) };
}

function countOne(node, raw, sign, end) {
  const duration = 620;
  const startAt = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - startAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    node.textContent = `${sign}${Math.round(end * eased)}`;
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      node.textContent = raw;
    }
  };
  requestAnimationFrame(tick);
}

/**
 * 报告分数、首页最近测评、趋势差值做 0 → 目标值滚动。
 * 动画结束一定落回原文案，避免影响断言与截图。
 */
export function animateNumbers(root) {
  if (!root || reducedMotion()) return;
  const targets = root.querySelectorAll('.score-cell, .score-chip b, .delta');
  for (const node of targets) {
    const raw = node.textContent;
    const parsed = parseCountdown(raw);
    if (!parsed || parsed.value === 0) continue;
    countOne(node, raw, parsed.sign, parsed.value);
  }
}

/** 顶栏状态 chip 更新时闪一下。 */
export function flashChip(node) {
  if (!node || reducedMotion()) return;
  node.classList.remove('flash');
  // 强制重排，让动画可以重复触发。
  node.getBoundingClientRect();
  node.classList.add('flash');
}
