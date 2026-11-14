/**
 * 轻微音效：用 Web Audio 实时合成，不加载任何音频文件。
 *
 * 两类声音：
 * - 界面点击：五声音阶依次取音，像轻敲玻璃；
 * - 测评答题：每个任务一套独立音色（言语/知觉/空间/记忆各不同），
 *   但同一任务里不管选哪个选项、答对答错，声音完全一样——绝不泄露对错。
 *
 * 浏览器不允许自动播放，音频上下文在第一次点击时才创建。
 */

const STORAGE_KEY = 'mindmeter.sound.v1';

const UI_NOTES = [523.25, 587.33, 659.25, 783.99, 880];

const TASK_TONES = {
  vc: { type: 'sine', notes: [523.25, 587.33, 659.25], decay: 0.34, gain: 0.05 },
  ps: { type: 'triangle', notes: [783.99, 880, 987.77], decay: 0.16, gain: 0.04 },
  sv: { type: 'sine', notes: [392, 440, 493.88], decay: 0.4, gain: 0.05 },
  am: { type: 'sine', notes: [440, 493.88, 587.33], decay: 0.5, gain: 0.045, octave: true },
};

let context = null;
const counters = {};

function store() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function isSoundOn() {
  try {
    return store()?.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundOn(on) {
  try {
    store()?.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // 存不进去也不影响本次会话。
  }
}

function getContext() {
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  if (context.state === 'suspended') context.resume().catch(() => {});
  return context;
}

function nextNote(notes, key) {
  const index = counters[key] || 0;
  counters[key] = (index + 1) % notes.length;
  return notes[index];
}

/** 一个极短的正弦/三角波包络；octave 为真时叠一层八度泛音做钟琴感。 */
function blip(audio, tone, freq) {
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const env = audio.createGain();
  osc.type = tone.type;
  osc.frequency.setValueAtTime(freq, now);
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(tone.gain, now + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, now + tone.decay);
  osc.connect(env);
  env.connect(audio.destination);
  osc.start(now);
  osc.stop(now + tone.decay + 0.02);

  if (!tone.octave) return;
  const shimmer = audio.createOscillator();
  const shimmerEnv = audio.createGain();
  shimmer.type = 'sine';
  shimmer.frequency.setValueAtTime(freq * 2, now);
  shimmerEnv.gain.setValueAtTime(0.0001, now);
  shimmerEnv.gain.exponentialRampToValueAtTime(tone.gain * 0.35, now + 0.006);
  shimmerEnv.gain.exponentialRampToValueAtTime(0.0001, now + tone.decay * 0.7);
  shimmer.connect(shimmerEnv);
  shimmerEnv.connect(audio.destination);
  shimmer.start(now);
  shimmer.stop(now + tone.decay);
}

function play(tone, key) {
  if (!isSoundOn()) return;
  try {
    const audio = getContext();
    if (!audio) return;
    blip(audio, tone, nextNote(tone.notes, key));
  } catch {
    // 音频不可用（被策略拦截、无音频设备）时静默降级，不影响点击本身。
  }
}

/** 界面点击音。 */
export function playClick() {
  play({ type: 'sine', notes: UI_NOTES, decay: 0.28, gain: 0.05 }, 'ui');
}

/** 测评答题音：按任务给不同音色，同一任务内不区分对错。 */
export function playAnswer(taskId) {
  play(TASK_TONES[taskId] || TASK_TONES.vc, taskId || 'vc');
}

/** 给按钮、链接、可点卡片挂上音效；测评页内用答题音。 */
export function attachClickSounds(doc = document) {
  doc.addEventListener(
    'click',
    (event) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const task = target.closest('.task-page');
      if (task) {
        playAnswer(task.dataset.taskId);
        return;
      }
      if (target.closest('button, a, .tier-card, .check, .navitem')) playClick();
    },
    true,
  );
}
