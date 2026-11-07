/**
 * 计分用到的纯数学工具，无副作用、可单独单测。
 */

/** 截断到 [0, 1]；非有限值按 0 处理，避免 NaN 传进分数。 */
export function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** 中位数；空数组返回 null（不返回 0，避免把“没有数据”算成最低分）。 */
export function median(values) {
  const list = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (list.length === 0) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 === 1 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

/** 剔除 <minRt 与 >3×中位数的异常反应时（algorithm.md 第五节）。 */
export function filterRts(values, minRt = 200) {
  const list = values.filter((v) => Number.isFinite(v) && v >= minRt);
  if (list.length === 0) return [];
  const m = median(list);
  if (m === null) return [];
  return list.filter((v) => v <= 3 * m);
}

/**
 * 标准正态分布的分位数 z(p)（Acklam 近似，相对误差 < 1.15e-9）。
 * 用于 d' = z(H) - z(F)。
 */
export function zInv(p) {
  let q = p;
  if (!Number.isFinite(q)) return 0;
  if (q <= 0) q = 1e-6;
  if (q >= 1) q = 1 - 1e-6;

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  if (q < 0.02425) {
    const r = Math.sqrt(-2 * Math.log(q));
    return (
      (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) /
      ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1)
    );
  }
  if (q > 1 - 0.02425) {
    const r = Math.sqrt(-2 * Math.log(1 - q));
    return (
      -(((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) /
      ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1)
    );
  }
  const r = q - 0.5;
  const s = r * r;
  return (
    ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r) /
    (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1)
  );
}
