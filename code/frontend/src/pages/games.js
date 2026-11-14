/** 游戏中心列表：按 8 个维度分组，每维度 3 个游戏。 */
import { el } from '../ui.js';
import { DIMS } from '../data.js';
import { GAMES, gamesOfDim } from '../games/registry.js';
import { readGames } from '../games/store.js';

function badge(item, record) {
  if (!item.ready) return el('span', { class: 'game-badge', text: '即将开放' });
  if (!record || typeof record.best !== 'number') {
    return el('span', { class: 'game-badge ok', text: '未玩过' });
  }
  return el('span', { class: 'game-badge ok', text: `最佳 ${record.best}` });
}

function card(item, record, ctx) {
  const node = el(
    'div',
    { class: `game-card${item.ready ? '' : ' disabled'}`, dataset: { dim: item.dim } },
    [
      el('div', { class: 'game-card-head' }, [
        el('span', { class: 'game-card-title', text: item.title }),
        badge(item, record),
      ]),
      el('p', { class: 'tiny', text: item.desc }),
    ],
  );

  if (item.ready) {
    const open = () => ctx.go(`/game/${item.id}`);
    node.setAttribute('role', 'button');
    node.tabIndex = 0;
    node.addEventListener('click', open);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  }
  return node;
}

function dimSection(dim, records, ctx) {
  const cards = gamesOfDim(dim.id).map((item) => card(item, records[item.id], ctx));
  return el('section', { class: 'game-dim', dataset: { dim: dim.id } }, [
    el('h2', { class: 'game-dim-title', text: dim.name }),
    el('div', { class: 'game-cards' }, cards),
  ]);
}

export function renderGames(root, ctx) {
  const { records } = readGames();
  const ready = GAMES.filter((item) => item.ready).length;

  const total = GAMES.length;
  const note =
    ready === total
      ? `共 ${total} 个游戏，全部可玩。`
      : `已开放 ${ready} 个，其余标注「即将开放」。`;

  root.appendChild(
    el('section', { class: 'page', 'aria-labelledby': 'games-title' }, [
      el('h1', { id: 'games-title', class: 'page-title', text: '游戏中心' }),
      el('p', {
        class: 'lead',
        text: '自由练习、即时反馈，随时可退出。成绩只记本机最佳，不计入测评报告，也不改变维度分数。',
      }),
      el('p', { class: 'tiny', text: note }),
      ...DIMS.map((dim) => dimSection(dim, records, ctx)),
    ]),
  );
}
