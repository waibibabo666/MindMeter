/**
 * 8 轴雷达：未测维度不画 0，只画已测的点并标注「未测」。
 * 纯几何计算，便于单测；渲染在页面里完成。
 */

export const RADAR_SIZE = 320;
const CENTER = RADAR_SIZE / 2;
const RADIUS = RADAR_SIZE / 2 - 42;

export function axisAngle(index, total) {
  // 从正上方开始，顺时针排列。
  return -Math.PI / 2 + (index * 2 * Math.PI) / total;
}

export function pointFor(index, total, ratio) {
  const angle = axisAngle(index, total);
  const radius = RADIUS * Math.min(1, Math.max(0, ratio));
  return {
    x: Number((CENTER + radius * Math.cos(angle)).toFixed(2)),
    y: Number((CENTER + radius * Math.sin(angle)).toFixed(2)),
  };
}

/**
 * @param {Array<{id:string, name:string}>} dims 8 个维度，顺序固定
 * @param {{[id:string]: number|null}} scores 未测为 null
 */
export function buildRadar(dims, scores) {
  const axes = dims.map((dim, index) => {
    const outer = pointFor(index, dims.length, 1);
    const score = scores[dim.id];
    const measured = typeof score === 'number';
    const ratio = measured ? score / 100 : null;
    const point = measured ? pointFor(index, dims.length, ratio) : null;
    return {
      id: dim.id,
      name: dim.name,
      index,
      measured,
      score: measured ? score : null,
      ratio,
      outer,
      point,
      label: pointFor(index, dims.length, 1.16),
    };
  });

  const measuredAxes = axes.filter((axis) => axis.measured);
  const polygon =
    measuredAxes.length >= 3
      ? measuredAxes.map((axis) => `${axis.point.x},${axis.point.y}`).join(' ')
      : '';

  return {
    size: RADAR_SIZE,
    center: { x: CENTER, y: CENTER },
    radius: RADIUS,
    axes,
    polygon,
    measuredCount: measuredAxes.length,
    total: dims.length,
  };
}

/** 生成雷达图 SVG 字符串；只含数字与固定文案，不拼接用户输入。 */
export function radarMarkup(radar) {
  const { size, center, axes, polygon } = radar;
  const rings = [0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const points = axes
        .map((_, index) => {
          const p = pointFor(index, axes.length, ratio);
          return `${p.x},${p.y}`;
        })
        .join(' ');
      return `<polygon points="${points}" class="radar-ring" />`;
    })
    .join('');

  const spokes = axes
    .map(
      (axis) =>
        `<line x1="${center.x}" y1="${center.y}" x2="${axis.outer.x}" y2="${axis.outer.y}" class="radar-spoke" />`,
    )
    .join('');

  const dots = axes
    .filter((axis) => axis.measured)
    .map(
      (axis) =>
        `<circle cx="${axis.point.x}" cy="${axis.point.y}" r="4" class="radar-dot"><title>${axis.name}：${axis.score}</title></circle>`,
    )
    .join('');

  const labels = axes
    .map((axis) => {
      const value = axis.measured ? String(axis.score) : '未测';
      const cls = axis.measured ? 'radar-label' : 'radar-label muted';
      return `<text x="${axis.label.x}" y="${axis.label.y}" class="${cls}" text-anchor="middle">
        <tspan x="${axis.label.x}" dy="0">${axis.name}</tspan>
        <tspan x="${axis.label.x}" dy="14" class="radar-value">${value}</tspan>
      </text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${size} ${size}" width="100%" role="img" aria-label="八维雷达图">
    ${rings}${spokes}
    ${polygon ? `<polygon points="${polygon}" class="radar-area" />` : ''}
    ${dots}${labels}
  </svg>`;
}

/** 按进度（0–1）算出各已测轴当前的点，拼成 polygon 的 points 字符串。 */
function pointsAt(radar, measured, progress) {
  const eased = 1 - Math.pow(1 - progress, 3);
  return measured
    .map((axis) => {
      const point = pointFor(axis.index, radar.axes.length, (axis.ratio || 0) * eased);
      return `${point.x},${point.y}`;
    })
    .join(' ');
}

/** 取出可绘制多边形的元素；结构不全时返回 null。 */
function areaOf(svg, radar) {
  if (!svg) return null;
  if (!radar || !radar.polygon) return null;
  return svg.querySelector('.radar-area');
}

/**
 * 让雷达图「长出来」：多边形从中心按各轴比例扩张到目标形状。
 * 返回取消函数；减少动态效果时直接落到最终形状。
 */
export function animateRadar(svg, radar, options = {}) {
  const area = areaOf(svg, radar);
  if (!area) return () => {};

  const measured = radar.axes.filter((axis) => axis.measured);
  const reduce = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  if (reduce || typeof globalThis.requestAnimationFrame !== 'function') {
    area.setAttribute('points', radar.polygon);
    return () => {};
  }

  const duration = options.duration || 720;
  const startAt = globalThis.performance.now();
  let frame = 0;

  const draw = (now) => {
    const progress = Math.min(1, (now - startAt) / duration);
    area.setAttribute('points', pointsAt(radar, measured, progress));
    if (progress < 1) {
      frame = globalThis.requestAnimationFrame(draw);
    } else {
      area.setAttribute('points', radar.polygon);
    }
  };

  frame = globalThis.requestAnimationFrame(draw);
  return () => globalThis.cancelAnimationFrame(frame);
}
