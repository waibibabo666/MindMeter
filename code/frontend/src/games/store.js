/**
 * 游戏记录（按账号存后端）。
 *
 * 游戏是练习，不参与测评：不进报告、不进趋势、不进导出。
 * 之所以从 localStorage 挪到后端：同一台电脑换账号登录时，
 * 浏览器本地记录会让两个人互相看到对方的最佳成绩。
 */
import { api } from '../api.js';

const EMPTY = { records: {} };

function normalize(data) {
  if (!data || typeof data !== 'object' || !data.records || typeof data.records !== 'object') {
    return EMPTY;
  }
  return { records: data.records };
}

/** 读本账号的全部游戏记录；网络失败时返回空记录，页面照常渲染。 */
export async function readGames() {
  try {
    return normalize(await api.get('/games'));
  } catch {
    return EMPTY;
  }
}

/** 记一局：最高分只升不降，局数照常累加。返回更新后的记录。 */
export async function recordGame(gameId, score, dim) {
  const value = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  try {
    const data = await api.post(`/games/${encodeURIComponent(gameId)}`, { score: value, dim });
    return normalize(data);
  } catch {
    return EMPTY;
  }
}

/** 清空本账号的游戏记录（测评数据不受影响）。 */
export async function clearGames() {
  try {
    await api.del('/games');
    return true;
  } catch {
    return false;
  }
}
