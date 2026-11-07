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
    .map((axis) => `<circle cx="${axis.point.x}" cy="${axis.point.y}" r="4" class="radar-dot" />`)
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
