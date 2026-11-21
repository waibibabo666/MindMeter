/** 游戏中心列表：按 8 个维度分组，每维度 3 个游戏。 */
import { el, hint, clear } from '../ui.js';
import { DIMS } from '../data.js';
import { GAMES, gamesOfDim } from '../games/registry.js';
import { readGames } from '../games/store.js';

/* 反馈 2：产品口径收进浮框，卡片上的游戏名与玩法说明是内容本身，留在页面上。 */
const TIP_GAMES =
  '自由练习、即时反馈，随时可退出；最佳成绩记在你的账号里，不计入测评报告，也不改变维度分数。详见「说明 · 数据与隐私」。';

function badge(item, record) {
  if (!item.ready) return el('span', { class: 'game-badge', text: '即将开放' });
  // 反馈 3 · 模式 1：没有记录时 24 张卡都贴同一枚「未玩过」，零区分度。
  // 现在"没有徽章"就表示没玩过，徽章位只留给有信息量的两种状态。
  if (!record || typeof record.best !== 'number') return null;
  return el('span', { class: 'game-badge ok', text: `最佳 ${record.best}` });
}

function card(item, record, ctx) {
  const node = el(
    'div',
    { class: 'game-card', dataset: { game: item.id, ready: String(item.ready) } },
    [
      el('div', { class: 'game-card-head' }, [
        el('span', { class: 'game-name', text: item.title }),
        badge(item, record),
      ]),
      el('p', { class: 'game-desc', text: item.desc }),
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

function view(records, ctx) {
  const ready = GAMES.filter((item) => item.ready).length;
  const total = GAMES.length;
  const note =
    ready === total
      ? `共 ${total} 个游戏，全部可玩。`
      : `已开放 ${ready} 个，其余标注「即将开放」。`;

  return el('section', { class: 'page', 'aria-labelledby': 'games-title' }, [
    el('h1', { id: 'games-title', class: 'page-title', text: '游戏中心' }),
    el('p', { class: 'tiny' }, [note, hint(TIP_GAMES)]),
    ...DIMS.map((dim) => dimSection(dim, records, ctx)),
  ]);
}

export function renderGames(root, ctx) {
  let disposed = false;
  const paint = (records) => {
    if (disposed) return;
    clear(root);
    root.appendChild(view(records, ctx));
  };

  // 先用空记录渲染骨架（徽章位本来就是"没有就不显示"），拿到账号记录后再补。
  paint({});
  readGames().then((data) => paint(data.records));

  return () => {
    disposed = true;
  };
}
