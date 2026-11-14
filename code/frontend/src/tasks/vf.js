/**
 * 言语流畅性：录音 → 本机离线转写 → 去重计数。
 *
 * 识别不可用（无麦克风 / 无模型）时记为「未测」，不给 0 分。
 */
import { el, button, clear } from '../ui.js';
import { recordAndTranscribe } from '../asrClient.js';

const WORD_BANK = {
  animal: [
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
    '蛇',
    '龟',
    '蛙',
    '鱼',
    '鲨',
    '鲸',
    '海豚',
    '企鹅',
    '白鹭',
  ],
};

/** 有效词数：去重、且必须在词表内。 */
export function countValid(words, bank = WORD_BANK.animal) {
  const allowed = new Set(bank);
  const seen = new Set();
  for (const word of words) {
    const text = String(word || '').trim();
    if (allowed.has(text)) seen.add(text);
  }
  return seen.size;
}

export const vfTask = {
  id: 'vf',
  mount(root, ctx) {
    const seconds = (ctx.spec && ctx.spec.seconds) || 60;
    let closed = false;
    let running = false;

    const status = el('p', { class: 'game-status', text: '一分钟内说出尽可能多的动物名' });
    const timer = el('p', { class: 'tiny', text: '' });
    const heard = el('div', { class: 'speech-heard' });
    const start = button('开始录音', () => run(), { variant: 'primary' });
    const skip = button('跳过（记为未测）', () => finishUnavailable(), { variant: 'ghost' });
    root.appendChild(status);
    root.appendChild(timer);
    root.appendChild(el('div', { class: 'row' }, [start, skip]));
    root.appendChild(heard);

    const finish = (payload) => {
      if (closed) return;
      closed = true;
      ctx.finish(null, payload);
    };

    const finishUnavailable = () => finish({ unavailable: true });

    async function run() {
      if (running || closed) return;
      running = true;
      start.disabled = true;
      status.textContent = '正在录音，请连续说出动物名称…';
      const result = await recordAndTranscribe(seconds, (left) => {
        timer.textContent = `剩余 ${left} 秒`;
      });
      if (closed) return;
      if (!result.ok) {
        status.textContent =
          result.reason === 'denied' ? '麦克风未授权' : '语音识别不可用，本项记为未测';
        running = false;
        start.disabled = false;
        return;
      }
      clear(heard);
      for (const word of result.words) {
        heard.appendChild(el('span', { class: 'speech-chip', text: word }));
      }
      finish({ validCount: countValid(result.words), seconds });
    }

    return () => {
      closed = true;
      clear(root);
    };
  },
};
