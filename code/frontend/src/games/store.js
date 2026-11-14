/**
 * 游戏记录的本地存储。
 *
 * 与 storage.js（走后端 API）分开：游戏是练习，不参与测评数据，
 * 只放本机 localStorage，清库/导出都不影响它。
 */

const KEY = 'mindmeter.games.v2';
const VERSION = 2;

function readRaw() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRaw(value) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readGames() {
  const record = readRaw();
  return {
    records: record && record.records && typeof record.records === 'object' ? record.records : {},
  };
}

/** 只升不降：低分不覆盖最高分，局数与最近一局照常更新。 */
export function recordGame(gameId, score) {
  const { records } = readGames();
  const prev = records[gameId] || { best: 0, plays: 0, lastScore: 0, lastAt: '' };
  const value = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  const next = {
    best: Math.max(Number(prev.best) || 0, value),
    plays: (Number(prev.plays) || 0) + 1,
    lastScore: value,
    lastAt: new Date().toISOString(),
  };
  return writeRaw({
    version: VERSION,
    records: Object.assign({}, records, { [gameId]: next }),
  });
}

export function clearGames() {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* 清不掉就算了 */
  }
}
