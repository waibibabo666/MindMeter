#!/usr/bin/env node
/**
 * 游戏中心检查（P-08 扩展）。
 *
 * 覆盖：
 *   - 登记表：8 维度 × 3 个，字段齐全
 *   - 纯逻辑：棋盘/选项/牌组/秘密数字的生成与计分
 *   - 存储：最高分只升不降；与 sessions 隔离
 *   - 静态约定：路由与页面已接线，游戏成绩不进报告
 *
 * 用法：node scripts/test_games.js
 */
'use strict';

const path = require('path');
const url = require('url');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'code', 'frontend', 'src');
const href = (p) => url.pathToFileURL(p).href;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const eq = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label}：期望 ${expected}，实际 ${actual}`);
};

/** 固定随机源，保证生成逻辑可复现。 */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

async function main() {
  const registry = await import(href(path.join(SRC, 'games', 'registry.js')));
  const schulte = await import(href(path.join(SRC, 'games', 'schulte.js')));
  const quickmath = await import(href(path.join(SRC, 'games', 'quickmath.js')));
  const flip = await import(href(path.join(SRC, 'games', 'flip.js')));
  const guess = await import(href(path.join(SRC, 'games', 'guess.js')));
  const data = await import(href(path.join(SRC, 'data.js')));
  const storage = await import(href(path.join(SRC, 'storage.js')));

  // ---------- 登记表 ----------

  test('登记表：8 个维度各 3 个游戏', () => {
    eq(registry.GAMES.length, 24, '游戏总数');
    for (const dim of data.DIMS) {
      eq(registry.gamesOfDim(dim.id).length, 3, `${dim.name} 的游戏数`);
    }
  });

  test('登记表：字段齐全，ready 与 game 一致', () => {
    for (const item of registry.GAMES) {
      for (const key of ['id', 'dim', 'title', 'desc']) {
        assert(item[key], `${item.id} 缺 ${key}`);
      }
      eq(item.ready, Boolean(item.game), `${item.id} ready 与 game 不一致`);
    }
  });

  test('登记表：按 id 查找与最佳分聚合', () => {
    assert(registry.findGame('schulte'), '应能按 id 找到');
    eq(registry.findGame('nope'), null, '未知 id');
    eq(registry.dimBest('ps', { schulte: { best: 80 } }), 80, '单游戏最佳');
    eq(
      registry.dimBest('ps', { schulte: { best: 60 }, linkLink: { best: 92 } }),
      92,
      '多游戏取最大',
    );
    eq(registry.dimBest('sv', {}), null, '没玩过应为 null');
  });

  // ---------- 舒尔特 ----------

  test('舒尔特：棋盘是 1..25 的一个排列', () => {
    const board = schulte.buildBoard(seeded(7));
    eq(board.length, 25, '格子数');
    eq(new Set(board).size, 25, '无重复');
    eq(Math.min(...board), 1, '最小值');
    eq(Math.max(...board), 25, '最大值');
  });

  test('舒尔特：计分边界', () => {
    eq(schulte.scoreSchulte(25, 0), 100, '全对');
    eq(schulte.scoreSchulte(0, 0), 0, '一个没点');
    eq(schulte.scoreSchulte(25, 5), 90, '错点扣分');
    eq(schulte.scoreSchulte(50, 0), 100, '超额完成按满分');
    eq(schulte.scoreSchulte(25, 100), 0, '扣到 0 为止');
  });

  // ---------- 口算 ----------

  test('口算：每题四个选项且包含正确答案', () => {
    const random = seeded(11);
    for (let i = 0; i < 40; i += 1) {
      const item = quickmath.makeQuestion(random);
      eq(item.options.length, 4, '选项数');
      eq(new Set(item.options).size, 4, '选项不重复');
      assert(item.options.includes(item.answer), '选项应包含答案');
      assert(
        item.options.every((v) => v >= 0),
        '选项不能为负',
      );
    }
  });

  test('口算：计分封顶 100', () => {
    eq(quickmath.scoreMath(0), 0, '0 题');
    eq(quickmath.scoreMath(25), 100, '25 题');
    eq(quickmath.scoreMath(40), 100, '超过封顶');
  });

  // ---------- 翻牌 ----------

  test('翻牌：16 张牌、8 组图案各两张', () => {
    const deck = flip.buildDeck(seeded(3));
    eq(deck.length, 16, '牌数');
    const counts = {};
    for (const card of deck) counts[card.symbol] = (counts[card.symbol] || 0) + 1;
    eq(Object.keys(counts).length, 8, '图案种类');
    assert(
      Object.values(counts).every((n) => n === 2),
      '每种图案两张',
    );
  });

  test('翻牌：步数越少分越高', () => {
    eq(flip.scoreFlip(16), 100, '理论最优');
    assert(flip.scoreFlip(24) < 100, '多走几步要扣分');
    assert(flip.scoreFlip(24) > flip.scoreFlip(40), '步数越多分越低');
    assert(flip.scoreFlip(999) >= 0, '不能为负');
  });

  // ---------- 猜数字 ----------

  test('猜数字：4 位不重复', () => {
    const secret = guess.makeSecret(seeded(5));
    eq(secret.length, 4, '长度');
    eq(new Set(secret).size, 4, '不重复');
    assert(/^\d{4}$/.test(secret), '应当全是数字');
  });

  test('猜数字：nAnB 判定', () => {
    eq(JSON.stringify(guess.judge('1234', '1234')), JSON.stringify({ a: 4, b: 0 }), '全中');
    eq(JSON.stringify(guess.judge('1234', '4321')), JSON.stringify({ a: 0, b: 4 }), '全错位');
    eq(JSON.stringify(guess.judge('1234', '1243')), JSON.stringify({ a: 2, b: 2 }), '部分命中');
    eq(JSON.stringify(guess.judge('1234', '5678')), JSON.stringify({ a: 0, b: 0 }), '全不沾边');
  });

  test('猜数字：输入合法性与计分', () => {
    assert(guess.isValidGuess('1234'), '合法');
    assert(!guess.isValidGuess('1123'), '有重复应拒绝');
    assert(!guess.isValidGuess('123'), '位数不对应拒绝');
    assert(!guess.isValidGuess('12a4'), '含字母应拒绝');
    eq(guess.scoreGuess(7), 100, '7 次');
    eq(guess.scoreGuess(10), 0, '10 次');
    assert(guess.scoreGuess(5) === 100, '更快也给满分');
  });

  // ---------- 存储 ----------

  test('存储：最高分只升不降，且与 sessions 隔离', () => {
    storage.__setStorageForTests(fakeStorage());
    storage.clearAllData();

    storage.recordGame('schulte', 80);
    eq(storage.readGames().records.schulte.best, 80, '首次记录');
    storage.recordGame('schulte', 55);
    eq(storage.readGames().records.schulte.best, 80, '低分不覆盖');
    eq(storage.readGames().records.schulte.plays, 2, '局数累加');
    eq(storage.readGames().records.schulte.lastScore, 55, '最近一局');

    storage.recordGame('schulte', 120);
    eq(storage.readGames().records.schulte.best, 100, '上限截断');

    eq(storage.readSessions().sessions.length, 0, '不应写入 sessions');
    storage.__setStorageForTests(null);
  });

  // ---------- 静态约定 ----------

  test('静态：路由与页面已接线', () => {
    const router = fs.readFileSync(path.join(SRC, 'router.js'), 'utf8');
    assert(router.includes("'/games'"), '缺少 /games 路由');
    assert(router.includes("'/game'"), '缺少 /game 路由');
    assert(router.includes("route.path === '/game'"), '/game 应要求参数');

    const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
    assert(app.includes('renderGames'), 'app.js 未注册游戏中心');
    assert(app.includes('renderGame'), 'app.js 未注册单局页');

    assert(fs.existsSync(path.join(SRC, 'pages', 'games.js')), '缺少 pages/games.js');
    assert(fs.existsSync(path.join(SRC, 'pages', 'game.js')), '缺少 pages/game.js');
  });

  test('静态：游戏成绩不写进报告数据', () => {
    const report = fs.readFileSync(path.join(SRC, 'pages', 'report.js'), 'utf8');
    assert(!report.includes('games'), '报告页不应读取游戏记录');
    const gamePage = fs.readFileSync(path.join(SRC, 'pages', 'game.js'), 'utf8');
    assert(gamePage.includes('不计入测评报告'), '结算页必须声明不计入报告');
  });

  // ---------- 运行 ----------

  let passed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`[PASS] ${name}`);
    } catch (error) {
      console.error(`[FAIL] ${name}`);
      console.error(`       ${error.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} game center checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
