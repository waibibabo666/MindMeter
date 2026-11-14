/**
 * 单局游戏页：说明 → 进行中 → 结算。
 * 结算不跳报告，就地显示成绩与本机最佳，避免误解为测评结果。
 */
import { el, button, clear } from '../ui.js';
import { findGame } from '../games/registry.js';
import { readGames, recordGame } from '../games/store.js';

function bestOf(gameId) {
  const record = readGames().records[gameId];
  return record && typeof record.best === 'number' ? record.best : null;
}

function introView(root, item, best, onStart) {
  root.appendChild(
    el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', text: item.title }),
      el('p', { class: 'muted', text: item.desc }),
      el('p', { class: 'tiny', text: best === null ? '还没有记录' : `本机最佳：${best} 分` }),
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
  const bestLine = isBest ? `刷新了本机最佳（原 ${prevBest}）` : `本机最佳 ${best} 分`;

  root.appendChild(
    el('div', { class: 'card game-result' }, [
      el('h2', { class: 'card-title', text: isBest ? '新纪录！' : '这一局结束' }),
      el('p', { class: 'game-score', text: `${score} 分` }),
      el('p', { class: 'muted', text: bestLine }),
      lines.length ? el('p', { class: 'tiny', text: lines.join(' · ') }) : null,
      el('p', { class: 'tiny', text: '游戏成绩只在游戏中心保留，不计入测评报告。' }),
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

  const showResult = (score, detail) => {
    dispose();
    dispose = () => {};
    clear(stage);
    recordGame(item.id, score);
    resultView(stage, item, score, detail, bestOf(item.id), start);
  };

  const start = () => {
    clear(stage);
    const gameCtx = {
      toast: ctx.toast,
      finish: (score, detail) => showResult(score, detail),
    };
    dispose = item.game.mount(stage, gameCtx) || (() => {});
  };

  root.appendChild(
    el('section', { class: 'page', 'aria-labelledby': 'game-title' }, [
      el('h1', { id: 'game-title', class: 'page-title', text: item.title }),
      stage,
    ]),
  );

  introView(stage, item, bestOf(item.id), start);

  return () => {
    dispose();
    dispose = () => {};
  };
}
