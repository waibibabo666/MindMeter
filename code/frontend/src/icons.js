/**
 * 内联 SVG 图标与品牌图形（心智镜母题）。
 *
 * 全部静态字符串、零外部依赖、离线可用；描边风格统一：
 * 24×24 viewBox / stroke 1.8 / currentColor / 圆角端点。
 */

const wrap = (inner, size = 17) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const ICONS = {
  activity: wrap('<path d="M22 12h-4l-3 8-4-16-3 8H2"/>'),
  chart: wrap(
    '<path d="M3 3v18h18"/><path d="M7 16v-4"/><path d="M12 16V6"/><path d="M17 16v-7"/>',
  ),
  gamepad: wrap(
    '<path d="M6.5 7h11a4.5 4.5 0 0 1 4.4 3.7l.8 4.6a3.4 3.4 0 0 1-3.4 4L17 16.5H7L4.7 19.3a3.4 3.4 0 0 1-3.4-4l.8-4.6A4.5 4.5 0 0 1 6.5 7z"/><path d="M7.5 10.5h2.6m-1.3-1.3v2.6"/><circle cx="15.4" cy="10.2" r=".9" fill="currentColor" stroke="none"/><circle cx="17.4" cy="12.4" r=".9" fill="currentColor" stroke="none"/>',
  ),
  chat: wrap(
    '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-5.2a8.4 8.4 0 0 1-.8-3.8 8.4 8.4 0 0 1 8.4-9h.5a8.4 8.4 0 0 1 8 8z"/>',
  ),
  bookmark: wrap('<path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
  trending: wrap('<path d="M22 7l-8.5 8.5-4-4L2 19"/><path d="M16 7h6v6"/>'),
  book: wrap(
    '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  ),
  sliders: wrap(
    '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  ),
  file: wrap(
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
  ),
  download: wrap(
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  ),
  trash: wrap(
    '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  ),
  sparkle: wrap('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>', 14),
};

export function iconSvg(name) {
  return ICONS[name] || '';
}

/** 首页装饰：镜子母题大图（菱形 + 镜像倒影 + 旋转虚线环）。 */
export const MIRROR_ART = `<svg viewBox="0 0 200 200" fill="none" aria-hidden="true">
  <defs>
    <linearGradient id="mmFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#15803d" stop-opacity=".30"/>
      <stop offset="1" stop-color="#15803d" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <circle cx="100" cy="86" r="78" stroke="#15803d" stroke-opacity=".16"/>
  <circle class="art-ring" cx="100" cy="86" r="66" stroke="#15803d" stroke-opacity=".3" stroke-dasharray="3 9" style="transform-origin:100px 86px"/>
  <path d="M100 34 L48 86 L100 138 Z" fill="#15803d" fill-opacity=".22"/>
  <path d="M100 34 L152 86 L100 138 Z" fill="#22c55e" fill-opacity=".10" stroke="#15803d" stroke-opacity=".45" stroke-width="1.6"/>
  <line x1="100" y1="28" x2="100" y2="144" stroke="#15803d" stroke-opacity=".3" stroke-width="1.2" stroke-dasharray="2 4"/>
  <line x1="46" y1="158" x2="154" y2="158" stroke="#15803d" stroke-opacity=".28" stroke-width="1.4"/>
  <path d="M64 158 L136 158 L122 190 L78 190 Z" fill="url(#mmFade)"/>
  <path d="M156 40v10m-5-5h10" stroke="#22c55e" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M42 52v7m-3.5-3.5h7" stroke="#22c55e" stroke-opacity=".4" stroke-width="1.4" stroke-linecap="round"/>
  <circle cx="160" cy="120" r="2.4" fill="#22c55e" fill-opacity=".5"/>
</svg>`;

/** 空状态小图：同一母题的 64px 版本。 */
export const MIRROR_SMALL = `<svg viewBox="0 0 64 64" width="52" height="52" fill="none" aria-hidden="true">
  <circle cx="32" cy="26" r="21" stroke="#15803d" stroke-opacity=".25" stroke-dasharray="2.5 5"/>
  <path d="M32 10 L17 26 L32 42 Z" fill="#15803d" fill-opacity=".2"/>
  <path d="M32 10 L47 26 L32 42 Z" fill="#22c55e" fill-opacity=".08" stroke="#15803d" stroke-opacity=".5" stroke-width="1.3"/>
  <line x1="16" y1="50" x2="48" y2="50" stroke="#15803d" stroke-opacity=".3" stroke-width="1.3"/>
  <path d="M24 50 L40 50 L36 60 L28 60 Z" fill="#15803d" fill-opacity=".12"/>
</svg>`;

/** 顶栏品牌标记：镜面菱形（左实右虚）+ 缓慢旋转的虚线环。 */
export const BRAND_MARK = `<svg class="brand-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true">
  <circle cx="32" cy="32" r="27" stroke="currentColor" stroke-width="2.6" opacity=".4"/>
  <circle class="mark-ring" cx="32" cy="32" r="27" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2.5 7" opacity=".65"/>
  <path d="M32 14 L14 32 L32 50 Z" fill="currentColor" fill-opacity=".3"/>
  <path d="M32 14 L50 32 L32 50 Z" fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-opacity=".6" stroke-width="1.6"/>
  <line x1="32" y1="11" x2="32" y2="53" stroke="currentColor" stroke-opacity=".35" stroke-width="1.2" stroke-dasharray="2 3"/>
</svg>`;
