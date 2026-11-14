/**
 * 游戏中心登记表。
 *
 * 每个维度 3 个游戏，共 24 个；全部可玩。
 * 约束：游戏成绩只记本机最佳，**不进测评报告**。
 */
import { schulte } from './schulte.js';
import { quickmath } from './quickmath.js';
import { flip } from './flip.js';
import { guess } from './guess.js';
import {
  chainCalc,
  cloze,
  describe,
  fold,
  idiom,
  pattern,
  season,
  sequence,
  twentyFour,
} from './quizzes.js';
import { svMirror, svRotate } from './svGames.js';
import { linkLink, pairLink, shoppingList, spotDiff } from './visual.js';
import { categoryFlip, charChain, naming } from './speech.js';
import { foodChainOrder, speciesDrag } from './nature.js';

const BY_DIM = {
  vc: [idiom, cloze, describe],
  vf: [naming, charChain, categoryFlip],
  nc: [quickmath, twentyFour, chainCalc],
  ps: [schulte, linkLink, spotDiff],
  ir: [guess, sequence, pattern],
  sv: [svRotate, svMirror, fold],
  am: [flip, pairLink, shoppingList],
  ni: [speciesDrag, foodChainOrder, season],
};

export const GAMES = Object.entries(BY_DIM).flatMap(([dim, list]) =>
  list.map((game) => ({
    id: game.id,
    dim,
    title: game.title,
    desc: game.desc,
    game,
    ready: true,
  })),
);

export function findGame(id) {
  return GAMES.find((item) => item.id === id) || null;
}

export function gamesOfDim(dimId) {
  return GAMES.filter((item) => item.dim === dimId);
}

/** 某维度的最佳分：该维度下所有已玩游戏 best 的最大值。 */
export function dimBest(dimId, records = {}) {
  let best = null;
  for (const item of gamesOfDim(dimId)) {
    const record = records[item.id];
    if (!record || typeof record.best !== 'number') continue;
    best = best === null ? record.best : Math.max(best, record.best);
  }
  return best;
}
