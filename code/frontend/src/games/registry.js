/**
 * 游戏中心登记表。
 *
 * 每个维度 3 个游戏；`game` 为 null 表示尚未实现，列表页显示「即将开放」。
 * 约束：游戏成绩只记本机最佳，**不进测评报告**。
 */
import { schulte } from './schulte.js';
import { quickmath } from './quickmath.js';
import { flip } from './flip.js';
import { guess } from './guess.js';

const RAW = [
  // 言语理解
  ['idiom', 'vc', '成语接龙', '上一个成语的末字开头继续接，60 秒内接得越多分越高', null],
  ['cloze', 'vc', '完形闯关', '一句话挖掉一个词，四选一补全，逐关加长', null],
  ['describe', 'vc', '你描述我猜', '用不含该词的话描述，让对面猜出目标词', null],
  // 言语流畅性
  ['naming', 'vf', '60 秒动物命名', '一分钟内尽量说出不同的动物名，重复不计', null],
  ['charChain', 'vf', '限定字接龙', '说以指定字开头的词，限时内越多越好', null],
  ['categoryFlip', 'vf', '类别闪卡', '每隔几秒换一类词（水果→城市→工具）', null],
  // 数字运算
  ['quickmath', 'nc', '限时口算', '60 秒连续作答两位数加减与一位数乘法', quickmath],
  ['twentyFour', 'nc', '24 点', '四张牌用加减乘除凑出 24', null],
  ['chainCalc', 'nc', '算式接力', '上一步的结果作为下一步的操作数', null],
  // 知觉速度
  ['schulte', 'ps', '舒尔特方格', '5×5 数字打乱，按 1→25 顺序点，限时 60 秒', schulte],
  ['linkLink', 'ps', '符号连连看', '找出相同的两个符号配对消除', null],
  ['spotDiff', 'ps', '找不同', '两幅图之间找出差异', null],
  // 归纳推理
  ['guess', 'ir', '猜数字', '4 位不重复数字，按 nAnB 提示逐步逼近', guess],
  ['sequence', 'ir', '数列找规律', '给出前几项，推出下一项', null],
  ['matrix', 'ir', '图形矩阵', '3×3 矩阵缺一格，选出补全项', null],
  // 空间视觉化
  ['tetris', 'sv', '方块消除', '旋转下落的方块，填满整行消除', null],
  ['tangram', 'sv', '七巧板', '用七块拼出给定轮廓', null],
  ['netFold', 'sv', '展开图折叠', '给出正方体展开图，判断折起来是哪一个', null],
  // 联想记忆
  ['flip', 'am', '记忆翻牌', '8 组图案两两配对，步数越少分越高', flip],
  ['pairLink', 'am', '词对连线', '先记 8 组词对，再连线配对', null],
  ['shoppingList', 'am', '购物清单', '看 10 样商品，30 秒后凭记忆回忆', null],
  // 自然探索
  ['species', 'ni', '动植物分类', '给图片判断属于动物 / 植物 / 真菌', null],
  ['foodChain', 'ni', '食物链配对', '按捕食关系把生物连起来', null],
  ['seasonWatch', 'ni', '四季观察打卡', '现实中固定一株植物，按季节记录变化', null],
];

export const GAMES = RAW.map(([id, dim, title, desc, game]) => ({
  id,
  dim,
  title,
  desc,
  game,
  ready: Boolean(game),
}));

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
