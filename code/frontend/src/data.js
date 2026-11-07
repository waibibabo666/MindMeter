/**
 * 静态内容与常量。
 *
 * 这里只有数据，不含 DOM 逻辑，便于 Node 侧直接 import 做单测。
 */

export const DIMS = [
  { id: 'vc', name: '言语理解', short: '言语' },
  { id: 'vf', name: '言语流畅性', short: '流畅' },
  { id: 'nc', name: '数字运算', short: '运算' },
  { id: 'ps', name: '知觉速度', short: '知觉' },
  { id: 'ir', name: '归纳推理', short: '归纳' },
  { id: 'sv', name: '空间视觉化', short: '空间' },
  { id: 'am', name: '联想记忆', short: '记忆' },
  { id: 'ni', name: '自然探索', short: '自然' },
];

export const TIERS = [
  {
    id: 'quick',
    name: '快测',
    minutes: 5,
    tasks: ['ps', 'vf'],
    available: false,
    note: 'L-01 未交付',
  },
  {
    id: 'standard',
    name: '标准',
    minutes: 13,
    tasks: ['vc', 'ps', 'sv', 'am'],
    available: true,
    note: '',
  },
  {
    id: 'deep',
    name: '深度',
    minutes: 28,
    tasks: ['vc', 'nc', 'ir', 'ps', 'sv', 'am', 'ni', 'vf'],
    available: false,
    note: 'L-01 未交付',
  },
];

/** L-01 只交付标准档的 4 项；顺序即测评顺序。 */
export const STANDARD_ORDER = ['vc', 'ps', 'sv', 'am'];

export const TASK_META = {
  vc: { id: 'vc', name: '言语理解', minutes: 2, desc: '6 道四选一：近义词、反义词、句子理解。' },
  ps: {
    id: 'ps',
    name: '知觉速度',
    minutes: 1,
    desc: '45 秒内从四个选项中选出与目标完全相同的符号组。',
  },
  sv: {
    id: 'sv',
    name: '空间视觉化',
    minutes: 2,
    desc: '8 道三乘三图案旋转题，选出旋转后的正确图案。',
  },
  am: { id: 'am', name: '联想记忆', minutes: 3, desc: '先记 12 组词对，再做 16 题配对再认。' },
};

/** 言语理解题库：question / options / answer。 */
export const VC_ITEMS = [
  { q: '「谨慎」最接近的意思是：', options: ['慎重', '迟疑', '胆小', '缓慢'], answer: 0 },
  { q: '「冗长」的反义词是：', options: ['繁琐', '简练', '重复', '沉闷'], answer: 1 },
  {
    q: '「尽管他已尽力，结果仍不理想。」这句话的意思是：',
    options: ['他没有尽力', '努力了但没达到预期', '结果很好', '他放弃了'],
    answer: 1,
  },
  { q: '「显著」最接近的意思是：', options: ['明显', '特殊', '偶然', '轻微'], answer: 0 },
  { q: '「稀疏」的反义词是：', options: ['分散', '密集', '空旷', '薄弱'], answer: 1 },
  {
    q: '「这项新规____了此前的漏洞。」最合适的词是：',
    options: ['弥补', '掩埋', '替换', '忽略'],
    answer: 0,
  },
];

/** 联想记忆词对：学习阶段使用。 */
export const AM_PAIRS = [
  ['河流', '铅笔'],
  ['月亮', '书包'],
  ['铁钉', '苹果'],
  ['窗户', '青蛙'],
  ['纸张', '雨水'],
  ['镜子', '竹子'],
  ['骆驼', '毛巾'],
  ['钟表', '沙漠'],
  ['石头', '帽子'],
  ['灯笼', '面包'],
  ['针线', '山谷'],
  ['勺子', '闪电'],
];

/** 空间视觉化基础图案：3×3，1 表示实心块。
 *  只选旋转四次互不相同、且镜像不等于任一旋转的图案，
 *  否则干扰项会退化成“随意翻转”的变体。 */
export const SV_PATTERNS = [
  [1, 1, 0, 0, 1, 0, 0, 0, 0],
  [0, 1, 0, 1, 0, 0, 1, 0, 0],
  [0, 0, 0, 1, 1, 1, 1, 0, 0],
  [1, 0, 1, 0, 1, 1, 0, 1, 0],
  [0, 0, 1, 1, 0, 1, 1, 1, 0],
  [1, 1, 0, 1, 0, 1, 0, 0, 1],
  [0, 0, 1, 0, 0, 1, 1, 0, 1],
  [1, 1, 0, 0, 0, 1, 0, 1, 1],
];

/** 知觉速度可用符号。 */
export const PS_SYMBOLS = ['◆', '●', '▲', '■', '★', '✦'];

/** 报告里的局限说明，避免各页重复。 */
export const LIMITS = [
  '当前分数由本机临时折算（local-provisional-v1），正式分数由服务端 scoring-v3 产生；本页不参与最终计分。',
  '无总分、无百分位、不与人群比较；未测维度显示为「未测」。',
  '样本少、无临床常模，受睡眠、情绪、设备与练习效应影响。',
  'MindMeter 不是医疗器械，不提供诊断、治疗或医疗建议。',
];
