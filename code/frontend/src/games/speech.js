/**
 * 言语流畅性（vf）：语音命名。
 *
 * 依赖浏览器 Web Speech API；不支持时明确提示，不给分也不记账，
 * 避免把「打字速度」混进言语流畅性。
 */
import { el, clear, now } from '../ui.js';

const LIMIT_MS = 60000;
const TARGET_VALID = 20;

function recognitionCtor() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

export function scoreSpeech(valid) {
  const safe = Math.max(0, Number(valid) || 0);
  return Math.round(Math.min(1, safe / TARGET_VALID) * 100);
}

function notice(root, title) {
  root.appendChild(
    el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', text: '这个游戏需要语音识别' }),
      el('p', {
        class: 'muted',
        text: `${title} 依赖浏览器的语音识别能力。请用 Chrome 或 Edge 打开，并允许麦克风权限。`,
      }),
      el('p', { class: 'tiny', text: '为避免把打字速度误当成言语流畅性，这里不提供键盘替代。' }),
    ]),
  );
}

function createSpeechGame(config) {
  const { id, dim, title, desc, topics } = config;
  return {
    id,
    dim,
    title,
    desc,
    mount(root, ctx) {
      const Ctor = recognitionCtor();
      if (!Ctor) {
        notice(root, title);
        const skip = el('button', { class: 'btn ghost', type: 'button', text: '继续（本维度记为未测）' });
        skip.addEventListener('click', () => ctx.finish(0, { unavailable: true }));
        root.querySelector('.card')?.appendChild(skip);
        return () => clear(root);
      }

      const allowed = new Set();
      for (const topic of topics) for (const word of topic.words) allowed.add(word);

      const said = new Set();
      let closed = false;
      const startedAt = now();

      const status = el('p', { class: 'game-status', text: '准备中…' });
      const heard = el('div', { class: 'speech-heard' });
      const topicLine = el('div', { class: 'speech-topic' });
      root.appendChild(status);
      root.appendChild(topicLine);
      root.appendChild(heard);

      let topicIndex = 0;
      const topicTimer = globalThis.setInterval(() => {
        if (closed) return;
        topicIndex = (topicIndex + 1) % topics.length;
        topicLine.textContent = `现在说：${topics[topicIndex].name}`;
      }, 20000);

      topicLine.textContent = `现在说：${topics[0].name}`;

      const finish = () => {
        if (closed) return;
        closed = true;
        globalThis.clearInterval(timer);
        globalThis.clearInterval(topicTimer);
        globalThis.clearTimeout(idleTimer);
        try {
          recognition.stop();
        } catch {
          /* 已经停了 */
        }
        ctx.finish(scoreSpeech(said.size), { valid: said.size, seconds: LIMIT_MS / 1000 });
      };

      const recognition = new Ctor();
      recognition.lang = 'zh-CN';
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.addEventListener('result', (event) => {
        if (closed) return;
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const text = String(event.results[i][0].transcript || '').trim();
          if (!text) continue;
          heard.appendChild(el('span', { class: 'speech-chip', text }));
          if (allowed.has(text) && !said.has(text)) {
            said.add(text);
            heard.lastChild.classList.add('ok');
          }
        }
      });

      recognition.addEventListener('error', () => {
        status.textContent = '麦克风不可用，或未授权';
      });

      try {
        recognition.start();
      } catch {
        notice(root, title);
        return () => clear(root);
      }

      // 识别器存在但一直没结果（WebView2 常见）：给一个「记为未测」的出口
      const idleTimer = globalThis.setTimeout(() => {
        if (closed || said.size > 0) return;
        const skip = el('button', {
          class: 'btn ghost',
          type: 'button',
          text: '一直没识别到，跳过（记为未测）',
        });
        skip.addEventListener('click', () => ctx.finish(0, { unavailable: true }));
        root.appendChild(skip);
      }, 12000);

      const timer = globalThis.setInterval(() => {
        const left = Math.max(0, LIMIT_MS - (now() - startedAt));
        if (closed) return;
        if (left <= 0) {
          finish();
          return;
        }
        status.textContent = `已识别 ${said.size} 个有效词 · 剩余 ${(left / 1000).toFixed(0)}s`;
      }, 200);

      return () => {
        closed = true;
        globalThis.clearInterval(timer);
        globalThis.clearInterval(topicTimer);
        globalThis.clearTimeout(idleTimer);
        try {
          recognition.stop();
        } catch {
          /* ignore */
        }
        clear(root);
      };
    },
  };
}

const ANIMALS = [
  '猫',
  '狗',
  '猪',
  '牛',
  '羊',
  '马',
  '驴',
  '鸡',
  '鸭',
  '鹅',
  '兔',
  '鼠',
  '虎',
  '狮',
  '豹',
  '象',
  '熊',
  '狼',
  '狐',
  '鹿',
  '猴',
  '猿',
  '蛇',
  '龟',
  '蛙',
  '鱼',
  '鲨',
  '鲸',
  '海豚',
  '企鹅',
];

const FLOWERS = [
  '玫瑰',
  '牡丹',
  '菊花',
  '兰花',
  '梅花',
  '荷花',
  '桂花',
  '杜鹃',
  '水仙',
  '茉莉',
  '百合',
  '向日葵',
  '郁金香',
  '康乃馨',
  '桃花',
  '杏花',
];

const CATEGORIES = [
  {
    name: '水果（说「苹果」这样具体的词）',
    words: [
      '苹果',
      '香蕉',
      '橘子',
      '葡萄',
      '西瓜',
      '桃子',
      '梨',
      '草莓',
      '樱桃',
      '芒果',
      '菠萝',
      '柚子',
      '荔枝',
      '龙眼',
      '柠檬',
    ],
  },
  {
    name: '城市（说中国城市名）',
    words: [
      '北京',
      '上海',
      '广州',
      '深圳',
      '杭州',
      '南京',
      '成都',
      '重庆',
      '武汉',
      '西安',
      '苏州',
      '天津',
      '长沙',
      '青岛',
      '厦门',
    ],
  },
  {
    name: '工具（说具体工具名）',
    words: [
      '锤子',
      '螺丝刀',
      '扳手',
      '钳子',
      '锯子',
      '电钻',
      '卷尺',
      '剪刀',
      '镊子',
      '凿子',
      '斧头',
      '锉刀',
      '水平尺',
      '美工刀',
      '胶枪',
    ],
  },
];

export const naming = createSpeechGame({
  id: 'naming',
  dim: 'vf',
  title: '60 秒动物命名',
  desc: '一分钟内说出尽可能多的动物名，重复不计。',
  topics: [{ name: '动物', words: ANIMALS }],
});

export const charChain = createSpeechGame({
  id: 'charChain',
  dim: 'vf',
  title: '花字开头的词',
  desc: '说以「花」或花名相关的词，限时 60 秒。',
  topics: [{ name: '花的名称', words: FLOWERS }],
});

export const categoryFlip = createSpeechGame({
  id: 'categoryFlip',
  dim: 'vf',
  title: '类别闪卡',
  desc: '每 20 秒换一个类别（水果 → 城市 → 工具），考察类别切换。',
  topics: CATEGORIES,
});
