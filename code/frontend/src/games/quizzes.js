/**
 * 知识型小游戏的题库（用 quiz 引擎跑）。
 * 每项 8–10 题，答完即结算。
 */
import { createQuizGame } from './quiz.js';

const OPT = (answer, ...wrong) => [answer, ...wrong];

/* ---------------- 言语理解 ---------------- */

const CLOZE = [
  {
    prompt: '这道题他____，十分钟就做完了。',
    options: OPT('举重若轻', '一筹莫展', '手足无措', '望而生畏'),
    answer: 0,
  },
  {
    prompt: '会上他____，把问题讲得条理分明。',
    options: OPT('条分缕析', '含糊其辞', '语无伦次', '避重就轻'),
    answer: 0,
  },
  {
    prompt: '方案还没论证就急着上马，未免太____。',
    options: OPT('草率', '严谨', '审慎', '周密'),
    answer: 0,
  },
  {
    prompt: '这篇文章____，读起来很费劲。',
    options: OPT('艰深晦涩', '通俗易懂', '深入浅出', '明白晓畅'),
    answer: 0,
  },
  {
    prompt: '暴雨过后，山路____，车辆无法通行。',
    options: OPT('泥泞不堪', '平坦宽阔', '一尘不染', '车水马龙'),
    answer: 0,
  },
  {
    prompt: '她____地照顾生病的母亲，三年如一日。',
    options: OPT('无微不至', '漠不关心', '敷衍了事', '三心二意'),
    answer: 0,
  },
  {
    prompt: '面对质疑，他用数据____了对方的观点。',
    options: OPT('驳倒', '附和', '认同', '支持'),
    answer: 0,
  },
  {
    prompt: '他做事一向____，从不拖延。',
    options: OPT('雷厉风行', '拖泥带水', '优柔寡断', '举棋不定'),
    answer: 0,
  },
];

const WORD_MEANING = [
  {
    prompt: '「踌躇」最接近的意思是？',
    options: OPT('犹豫不决', '大步向前', '心满意足', '惊慌失措'),
    answer: 0,
  },
  {
    prompt: '「迥异」最接近的意思是？',
    options: OPT('差别很大', '完全相同', '略有相似', '逐渐接近'),
    answer: 0,
  },
  {
    prompt: '「恪守」最接近的意思是？',
    options: OPT('严格遵守', '随意更改', '暂时放弃', '公开反对'),
    answer: 0,
  },
  { prompt: '「遴选」最接近的意思是？', options: OPT('挑选', '淘汰', '推荐', '登记'), answer: 0 },
  { prompt: '「桎梏」最接近的意思是？', options: OPT('束缚', '保护', '支撑', '装饰'), answer: 0 },
  {
    prompt: '「逡巡」最接近的意思是？',
    options: OPT('徘徊不前', '快速奔跑', '昂首挺胸', '四处张望'),
    answer: 0,
  },
  {
    prompt: '「相左」最接近的意思是？',
    options: OPT('不一致', '相符合', '相互支持', '彼此靠近'),
    answer: 0,
  },
  { prompt: '「汲取」最接近的意思是？', options: OPT('吸取', '倾倒', '蒸发', '过滤'), answer: 0 },
];

/* ---------------- 归纳推理 ---------------- */

const SEQUENCE = [
  { prompt: '2, 4, 8, 16, ?', options: OPT('32', '24', '20', '64'), answer: 0 },
  { prompt: '1, 4, 9, 16, ?', options: OPT('25', '20', '24', '36'), answer: 0 },
  { prompt: '1, 1, 2, 3, 5, ?', options: OPT('8', '7', '6', '9'), answer: 0 },
  { prompt: '2, 3, 5, 7, 11, ?', options: OPT('13', '12', '14', '15'), answer: 0 },
  { prompt: '1, 3, 6, 10, 15, ?', options: OPT('21', '18', '20', '24'), answer: 0 },
  { prompt: '3, 6, 12, 24, ?', options: OPT('48', '36', '42', '30'), answer: 0 },
  { prompt: '100, 81, 64, 49, ?', options: OPT('36', '25', '30', '40'), answer: 0 },
  { prompt: '2, 6, 12, 20, 30, ?', options: OPT('42', '40', '36', '44'), answer: 0 },
];

const PATTERN = [
  {
    prompt: '上面两行，黑格数依次是 1、2。按「每行多 1 个」的规律，第三行应该是？',
    grid: [1, 0, 0, 1, 1, 0, 0, 0, 0],
    options: [
      { grid: [1, 0, 0, 1, 1, 0, 1, 1, 1] },
      { grid: [1, 0, 0, 1, 1, 0, 0, 0, 0] },
      { grid: [1, 0, 0, 1, 1, 0, 1, 0, 0] },
      { grid: [1, 0, 0, 1, 1, 0, 1, 1, 0] },
    ],
    answer: 0,
  },
  {
    prompt: '黑格沿对角线向右下移动：第一行在左上，第二行在中间。第三行应该停在？',
    grid: [1, 0, 0, 0, 1, 0, 0, 0, 0],
    options: [
      { grid: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
      { grid: [1, 0, 0, 0, 1, 0, 0, 1, 0] },
      { grid: [1, 0, 0, 0, 1, 0, 1, 0, 0] },
      { grid: [1, 0, 0, 0, 1, 0, 0, 0, 0] },
    ],
    answer: 0,
  },
  {
    prompt: '这个图形上下对称：第一行和第三行应该一样。第三行应该是？',
    grid: [1, 0, 1, 0, 1, 0, 0, 0, 0],
    options: [
      { grid: [1, 0, 1, 0, 1, 0, 1, 0, 1] },
      { grid: [1, 0, 1, 0, 1, 0, 0, 1, 0] },
      { grid: [1, 0, 1, 0, 1, 0, 1, 1, 1] },
      { grid: [1, 0, 1, 0, 1, 0, 0, 0, 0] },
    ],
    answer: 0,
  },
  {
    prompt: '每一列的黑格数从左到右依次是 1、2、3。上面两行已给出，第三行应该是？',
    grid: [1, 1, 1, 0, 1, 1, 0, 0, 0],
    options: [
      { grid: [1, 1, 1, 0, 1, 1, 0, 0, 1] },
      { grid: [1, 1, 1, 0, 1, 1, 1, 0, 0] },
      { grid: [1, 1, 1, 0, 1, 1, 0, 1, 0] },
      { grid: [1, 1, 1, 0, 1, 1, 1, 1, 1] },
    ],
    answer: 0,
  },
];

/* ---------------- 数字运算 ---------------- */

const CHAIN = [
  {
    prompt: '从 12 开始，依次 +7、−3、×2，结果是？',
    options: OPT('32', '28', '36', '30'),
    answer: 0,
  },
  {
    prompt: '从 20 开始，依次 −5、×2、+4，结果是？',
    options: OPT('34', '30', '28', '36'),
    answer: 0,
  },
  { prompt: '从 3 开始，依次 ×4、−2、÷2，结果是？', options: OPT('5', '4', '6', '7'), answer: 0 },
  {
    prompt: '从 50 开始，依次 ÷5、+6、×3，结果是？',
    options: OPT('48', '42', '54', '36'),
    answer: 0,
  },
  {
    prompt: '从 8 开始，依次 +12、÷4、×9，结果是？',
    options: OPT('45', '36', '40', '54'),
    answer: 0,
  },
  {
    prompt: '从 7 开始，依次 ×3、−5、×2，结果是？',
    options: OPT('32', '30', '34', '28'),
    answer: 0,
  },
  {
    prompt: '从 100 开始，依次 ÷4、−5、×2，结果是？',
    options: OPT('40', '45', '35', '50'),
    answer: 0,
  },
  {
    prompt: '从 6 开始，依次 +14、÷5、×7，结果是？',
    options: OPT('28', '21', '35', '24'),
    answer: 0,
  },
];

/* ---------------- 空间视觉化 ---------------- */

const FOLD = [
  {
    prompt: '正方体展开图为「一四一」形时，同一行四个面里，第 1 个和第 3 个折起来是？',
    options: OPT('相对', '相邻', '重合', '无法确定'),
    answer: 0,
  },
  {
    prompt: '同一列三个连续的面中，第 1 个和第 3 个折起来是？',
    options: OPT('相对', '相邻', '重合', '垂直于底面'),
    answer: 0,
  },
  {
    prompt: '正方体的一个面，与它相邻的面有几个？',
    options: OPT('4 个', '2 个', '3 个', '6 个'),
    answer: 0,
  },
  {
    prompt: '正方体站在桌面上，最多能同时看到几个面？',
    options: OPT('3 个', '2 个', '4 个', '6 个'),
    answer: 0,
  },
  {
    prompt: '把一张正方形纸对折一次后剪去一个角，展开后有几个缺口？',
    options: OPT('2 个', '1 个', '4 个', '3 个'),
    answer: 0,
  },
  {
    prompt: '把纸沿中线对折两次（两个方向），在折角处剪一刀，展开后有几个缺口？',
    options: OPT('4 个', '2 个', '1 个', '8 个'),
    answer: 0,
  },
];

/* ---------------- 自然探索 ---------------- */

const SPECIES = [
  { prompt: '🐬 海豚 属于？', options: OPT('动物', '植物', '真菌'), answer: 0 },
  { prompt: '🌻 向日葵 属于？', options: OPT('植物', '动物', '真菌'), answer: 0 },
  { prompt: '🍄 香菇 属于？', options: OPT('真菌', '植物', '动物'), answer: 0 },
  { prompt: '🐜 蚂蚁 属于？', options: OPT('动物', '植物', '真菌'), answer: 0 },
  { prompt: '🌿 苔藓 属于？', options: OPT('植物', '真菌', '动物'), answer: 0 },
  { prompt: '🦠 酵母菌 属于？', options: OPT('真菌', '植物', '动物'), answer: 0 },
  { prompt: '🐋 蓝鲸 属于？', options: OPT('动物', '植物', '真菌'), answer: 0 },
  { prompt: '🌾 水稻 属于？', options: OPT('植物', '动物', '真菌'), answer: 0 },
];

const CHAIN_FOOD = [
  { prompt: '狼主要以什么为食？', options: OPT('羊', '草', '蘑菇', '阳光'), answer: 0 },
  { prompt: '青蛙主要捕食？', options: OPT('昆虫', '蛇', '水草', '鱼'), answer: 0 },
  { prompt: '鹰主要捕食？', options: OPT('田鼠', '草', '蘑菇', '浮游生物'), answer: 0 },
  { prompt: '蚜虫的天敌是？', options: OPT('瓢虫', '蚂蚁', '蝴蝶', '蜜蜂'), answer: 0 },
  { prompt: '牛的主要食物是？', options: OPT('草', '肉', '鱼', '昆虫'), answer: 0 },
  { prompt: '鲨鱼主要捕食？', options: OPT('鱼', '海藻', '珊瑚', '浮游植物'), answer: 0 },
  { prompt: '大熊猫的主要食物是？', options: OPT('竹子', '鱼', '昆虫', '坚果'), answer: 0 },
  { prompt: '啄木鸟主要吃什么？', options: OPT('树干里的虫子', '树叶', '花蜜', '种子'), answer: 0 },
];

const SEASON = [
  { prompt: '「大雁南飞」通常发生在？', options: OPT('秋季', '春季', '夏季', '冬季'), answer: 0 },
  { prompt: '「蝉鸣不止」通常发生在？', options: OPT('夏季', '冬季', '春季', '秋季'), answer: 0 },
  { prompt: '「桃花盛开」通常发生在？', options: OPT('春季', '秋季', '夏季', '冬季'), answer: 0 },
  { prompt: '「河面结冰」通常发生在？', options: OPT('冬季', '夏季', '春季', '秋季'), answer: 0 },
  {
    prompt: '「银杏叶变黄掉落」通常发生在？',
    options: OPT('秋季', '春季', '夏季', '冬季'),
    answer: 0,
  },
  { prompt: '「荷花盛开」通常发生在？', options: OPT('夏季', '冬季', '春季', '秋季'), answer: 0 },
  { prompt: '「播种插秧」通常发生在？', options: OPT('春季', '秋季', '冬季', '夏季'), answer: 0 },
  { prompt: '「初雪落下」通常发生在？', options: OPT('冬季', '夏季', '春季', '秋季'), answer: 0 },
];

/* ---------------- 成语与 24 点 ---------------- */

const IDIOM = [
  {
    prompt: '上一个成语是「一马当先」，下一个接哪个？',
    options: OPT('先发制人', '人山人海', '海阔天空', '空穴来风'),
    answer: 0,
  },
  {
    prompt: '上一个成语是「先发制人」，下一个接哪个？',
    options: OPT('人山人海', '海阔天空', '先入为主', '入木三分'),
    answer: 0,
  },
  {
    prompt: '上一个成语是「人山人海」，下一个接哪个？',
    options: OPT('海阔天空', '人定胜天', '天南地北', '空谷足音'),
    answer: 0,
  },
  {
    prompt: '上一个成语是「海阔天空」，下一个接哪个？',
    options: OPT('空穴来风', '风和日丽', '海枯石烂', '天马行空'),
    answer: 0,
  },
  {
    prompt: '上一个成语是「空穴来风」，下一个接哪个？',
    options: OPT('风和日丽', '云淡风轻', '来日方长', '穴居野处'),
    answer: 0,
  },
  {
    prompt: '上一个成语是「风和日丽」，下一个接哪个？',
    options: OPT('丽句清词', '日新月异', '和风细雨', '风调雨顺'),
    answer: 0,
  },
  {
    prompt: '上一个成语是「日新月异」，下一个接哪个？',
    options: OPT('异想天开', '口若悬河', '月明星稀', '新仇旧恨'),
    answer: 0,
  },
  {
    prompt: '上一个成语是「异想天开」，下一个接哪个？',
    options: OPT('开卷有益', '山清水秀', '天衣无缝', '想入非非'),
    answer: 0,
  },
];

const TWENTY_FOUR = [
  {
    prompt: '用 3、3、8、8 凑 24，哪个式子成立？',
    options: OPT('8 ÷ (3 − 8÷3)', '8 × 3 − 3 + 8', '8 + 8 + 3 + 3', '8 × (3 + 3) − 8'),
    answer: 0,
  },
  {
    prompt: '用 1、5、5、5 凑 24，哪个式子成立？',
    options: OPT('5 × (5 − 1÷5)', '5 × (5 − 1) + 5', '5 + 5 + 5 + 1', '5 × 5 × 1 − 5'),
    answer: 0,
  },
  {
    prompt: '用 4、4、10、10 凑 24，哪个式子成立？',
    options: OPT('(10 × 10 − 4) ÷ 4', '10 + 10 + 4 + 4', '10 × 4 − 4 × 4', '10 × 4 ÷ 4 + 10'),
    answer: 0,
  },
  {
    prompt: '用 2、3、4、6 凑 24，哪个式子成立？',
    options: OPT('6 ÷ (3 − 2) × 4', '6 + 4 + 3 + 2', '6 × 4 − 3 × 2', '6 × 3 + 4 + 2'),
    answer: 0,
  },
  {
    prompt: '用 3、3、7、7 凑 24，哪个式子成立？',
    options: OPT('7 × (3 + 3÷7)', '7 + 7 + 3 + 3', '7 × 3 + 7 − 3', '7 × 3 + 7 + 3'),
    answer: 0,
  },
  {
    prompt: '用 1、2、3、4 凑 24，哪个式子成立？',
    options: OPT('1 × 2 × 3 × 4', '1 + 2 + 3 + 4', '1 × 2 + 3 × 4', '1 + 2 × 3 × 4'),
    answer: 0,
  },
  {
    prompt: '用 3、4、5、6 凑 24，哪个式子成立？',
    options: OPT('(3 + 5 − 4) × 6', '6 + 5 + 4 + 3', '6 × 5 − 4 − 3', '6 × 4 − 5 + 3'),
    answer: 0,
  },
  {
    prompt: '用 1、3、4、6 凑 24，哪个式子成立？',
    options: OPT('6 ÷ (1 − 3÷4)', '6 + 4 + 3 + 1', '6 × 4 + 3 − 1', '6 × 3 + 4 + 1'),
    answer: 0,
  },
];

/* ---------------- 导出 ---------------- */

export const cloze = createQuizGame({
  id: 'cloze',
  dim: 'vc',
  title: '完形闯关',
  desc: '一句话挖掉一个词，四选一补全，考的是语境里选词。',
  bank: CLOZE,
});

export const describe = createQuizGame({
  id: 'describe',
  dim: 'vc',
  title: '词义辨析',
  desc: '给出一个词，从四个解释里选出最接近的一个。',
  bank: WORD_MEANING,
});

export const sequence = createQuizGame({
  id: 'sequence',
  dim: 'ir',
  title: '数列找规律',
  desc: '给出前几项，推出下一个数，考的是规则提取。',
  bank: SEQUENCE,
});

export const pattern = createQuizGame({
  id: 'pattern',
  dim: 'ir',
  title: '图形规律',
  desc: '九个格子的黑白变化，选出符合规律的那一个。',
  bank: PATTERN,
});

export const chainCalc = createQuizGame({
  id: 'chainCalc',
  dim: 'nc',
  title: '算式接力',
  desc: '连续几步运算，前一步的结果作为下一步的输入。',
  bank: CHAIN,
});

export const fold = createQuizGame({
  id: 'fold',
  dim: 'sv',
  title: '展开图与折叠',
  desc: '正方体展开、纸张对折，考的是空间关系推断。',
  bank: FOLD,
});

export const species = createQuizGame({
  id: 'species',
  dim: 'ni',
  title: '生物分类',
  desc: '判断给出的生物属于动物、植物还是真菌。',
  bank: SPECIES,
});

export const foodChain = createQuizGame({
  id: 'foodChain',
  dim: 'ni',
  title: '食物链配对',
  desc: '按捕食关系判断谁吃谁。',
  bank: CHAIN_FOOD,
});

export const season = createQuizGame({
  id: 'season',
  dim: 'ni',
  title: '物候与季节',
  desc: '自然现象对应哪个季节。',
  bank: SEASON,
});

export const idiom = createQuizGame({
  id: 'idiom',
  dim: 'vc',
  title: '成语接龙',
  desc: '上一个成语的末字，就是下一个成语的首字。',
  bank: IDIOM,
});

export const twentyFour = createQuizGame({
  id: 'twentyFour',
  dim: 'nc',
  title: '24 点',
  desc: '四个数字用加减乘除凑出 24，选出成立的式子。',
  bank: TWENTY_FOUR,
});
