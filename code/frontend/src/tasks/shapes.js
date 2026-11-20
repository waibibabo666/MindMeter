/**
 * 处理速度用的矢量图形。
 *
 * 为什么不用 emoji：同一 emoji 在 Windows / macOS / Android 上字形不同，
 * 难度会随设备变化。内联 SVG 在任何设备上渲染完全一致。
 */

export const COLORS = {
  red: '#d92d20',
  orange: '#ef6820',
  yellow: '#f79009',
  green: '#12b76a',
  blue: '#1570ef',
  purple: '#7a5af8',
};

export const COLOR_LABEL = {
  red: '红色',
  orange: '橙色',
  yellow: '黄色',
  green: '绿色',
  blue: '蓝色',
  purple: '紫色',
};

export const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'star', 'hexagon'];

const PATHS = {
  circle: '<circle cx="50" cy="50" r="38" />',
  square: '<rect x="14" y="14" width="72" height="72" rx="6" />',
  triangle: '<polygon points="50,12 88,86 12,86" />',
  diamond: '<polygon points="50,10 90,50 50,90 10,50" />',
  star: '<polygon points="50,8 61,38 93,38 67,57 77,88 50,69 23,88 33,57 7,38 39,38" />',
  hexagon: '<polygon points="26,12 74,12 96,50 74,88 26,88 4,50" />',
};

/** 生成一个符号的 SVG 字符串。 */
export function shapeSvg(shape, color, size = 30) {
  const fill = COLORS[color] || COLORS.blue;
  return (
    `<svg class="shp" width="${size}" height="${size}" viewBox="0 0 100 100" ` +
    `fill="${fill}" aria-hidden="true">${PATHS[shape] || PATHS.circle}</svg>`
  );
}

/** 生成一个符号节点。 */
export function shapeNode(shape, color, size = 30) {
  return elSpan(shapeSvg(shape, color, size), shape, color);
}

function elSpan(svg, shape, color) {
  const span = document.createElement('span');
  span.className = 'shp-wrap';
  span.innerHTML = svg;
  span.setAttribute('data-shape', shape);
  span.setAttribute('data-color', color);
  return span;
}

/** 抽不重复的 n 个「形状+颜色」组合；颜色优先用前四个高区分度的。 */
export function pickCombos(n, random = Math.random) {
  const pool = [];
  const colors = ['red', 'blue', 'green', 'yellow', 'orange', 'purple'];
  for (const shape of SHAPES) {
    for (const color of colors) pool.push({ shape, color });
  }
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  const usedShape = new Set();
  const out = [];
  for (const combo of shuffled) {
    if (out.length >= n) break;
    if (usedShape.has(combo.shape)) continue;
    usedShape.add(combo.shape);
    out.push(combo);
  }
  while (out.length < n) out.push(shuffled[out.length]);
  return out;
}
