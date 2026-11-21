/**
 * 单局游戏页：说明 → 进行中 → 结算。
 * 结算不跳报告，就地显示成绩与账号最佳，避免误解为测评结果。
 */
import { el, button, clear, hint, titled } from '../ui.js';
import { findGame } from '../games/registry.js';
import { readGames, recordGame } from '../games/store.js';

/* 反馈 2：玩法说明与成绩是内容，留在页面上；「按账号存、不进报告」的口径收进浮框。 */
const TIP_BEST =
  '最佳成绩存在你的账号里，换设备登录同一账号仍能看到；游戏只是练习，不计入测评报告，也不改变维度分数。';

function pickBest(records, gameId) {
  const record = records[gameId];
  return record && typeof record.best === 'number' ? record.best : null;
}

function introView(root, item, best, onStart) {
  root.appendChild(
    el('div', { class: 'card' }, [
      // 页面 h1 已经是游戏名，卡片标题再写一遍是同义反复（反馈 3 · 模式 2）：
      // 这里只留玩法说明与账号最佳。
      el('p', { class: 'muted', text: item.desc }),
      el('p', { class: 'tiny' }, [
        best === null ? '还没有记录' : `账号最佳：${best} 分`,
        hint(TIP_BEST),
      ]),
      el('div', { class: 'row' }, [
        button('开始', onStart, { variant: 'primary' }),
        button('返回游戏中心', () => globalThis.location.assign('#/games'), { variant: 'ghost' }),
      ]),
    ]),
  );
}

function resultView(root, item, score, detail, best, onAgain) {
  const isBest = best === null || score >= best;
  const lines = Object.entries(detail || {})
    .filter(([key]) => key !== 'ms')
    .map(([key, value]) => `${key}：${value}`);
  const prevBest = best === null ? '无' : String(best);
  // 「不计入测评报告」是防止误解成测评结果的口径，留在可见文字里；为什么按账号存，放浮框。
  const bestLine =
    (isBest ? `刷新了账号最佳（原 ${prevBest}）` : `账号最佳 ${best} 分`) + ' · 不计入测评报告';

  root.appendChild(
    el('div', { class: 'card game-result' }, [
      titled('h2', isBest ? '新纪录！' : '这一局结束', TIP_BEST),
      el('p', { class: 'game-score', text: `${score} 分` }),
      el('p', { class: 'muted', text: bestLine }),
      lines.length ? el('p', { class: 'tiny', text: lines.join(' · ') }) : null,
      el('div', { class: 'row' }, [
        button('再来一局', onAgain, { variant: 'primary' }),
        button('返回游戏中心', () => globalThis.location.assign('#/games'), { variant: 'ghost' }),
      ]),
    ]),
  );
}

export function renderGame(root, ctx, gameId) {
  const item = findGame(gameId);
  if (!item || !item.ready) {
    ctx.go('/games', { replace: true });
    return () => {};
  }

  const stage = el('div', { class: 'game-stage' });
  let dispose = () => {};
  let records = {};
  let disposed = false;
  let started = false;

  const bestOf = () => pickBest(records, item.id);

  const start = () => {
    if (disposed) return;
    started = true;
    clear(stage);
    const gameCtx = {
      toast: ctx.toast,
      finish: (score, detail) => showResult(score, detail),
    };
    dispose = item.game.mount(stage, gameCtx) || (() => {});
  };

  const showResult = (score, detail) => {
    dispose();
    dispose = () => {};
    clear(stage);
    // 先按本地已知的最佳结算，再用后端返回值校正（最高分只升不降）。
    resultView(stage, item, score, detail, bestOf(), start);
    void recordGame(item.id, score).then((data) => {
      if (disposed) return;
      records = data.records;
    });
  };

  root.appendChild(
    el('section', { class: 'page', 'aria-labelledby': 'game-title' }, [
      el('h1', { id: 'game-title', class: 'page-title', text: item.title }),
      stage,
    ]),
  );

  introView(stage, item, bestOf(), start);

  readGames().then((data) => {
    if (disposed) return;
    records = data.records;
    // 只在还没开始这一局时刷新说明页，避免打断正在进行或已结算的画面。
    if (!started) {
      clear(stage);
      introView(stage, item, bestOf(), start);
    }
  });

  return () => {
    disposed = true;
    dispose();
    dispose = () => {};
  };
}
