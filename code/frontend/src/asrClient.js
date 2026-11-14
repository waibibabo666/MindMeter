/**
 * 浏览器端录音 + 上传到本机 ASR。
 *
 * MediaRecorder 输出的是 webm/opus，而 Vosk 需要 16kHz 单声道 PCM。
 * 这里用 AudioContext 解码后再降采样、编码成 WAV，全程不出本机。
 */
import { api } from './api.js';

const TARGET_RATE = 16000;

/** Float32 单声道 → 16bit PCM WAV。 */
export function encodeWav(samples, sampleRate = TARGET_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

/** 简单线性重采样到 16kHz。 */
export function downsample(samples, fromRate, toRate = TARGET_RATE) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += samples[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

/** 把一段录音 Blob 转成 16k 单声道 WAV。 */
export async function toWav(blob) {
  const audioCtx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
  try {
    const decoded = await audioCtx.decodeAudioData(await blob.arrayBuffer());
    const channel = decoded.getChannelData(0);
    return encodeWav(downsample(channel, decoded.sampleRate));
  } finally {
    audioCtx.close?.();
  }
}

/**
 * 录一段音频并请求本机转写。
 * @returns {Promise<{ok: boolean, words: string[], reason?: string}>}
 */
export async function recordAndTranscribe(seconds, onTick) {
  if (!globalThis.navigator?.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
    return { ok: false, words: [], reason: 'unsupported' };
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return { ok: false, words: [], reason: 'denied' };
  }

  const chunks = [];
  const recorder = new MediaRecorder(stream);
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size) chunks.push(event.data);
  });

  const startedAt = Date.now();
  recorder.start();
  const timer = globalThis.setInterval(() => {
    const left = Math.max(0, seconds * 1000 - (Date.now() - startedAt));
    onTick?.(Math.ceil(left / 1000));
  }, 200);

  await new Promise((resolve) => {
    globalThis.setTimeout(resolve, seconds * 1000);
  });
  globalThis.clearInterval(timer);

  await new Promise((resolve) => {
    recorder.addEventListener('stop', resolve, { once: true });
    recorder.stop();
  });
  for (const track of stream.getTracks()) track.stop();

  try {
    const wav = await toWav(new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' }));
    const form = new FormData();
    form.append('audio', wav, 'answer.wav');
    const response = await api.upload('/asr', form);
    return { ok: true, words: Array.isArray(response?.words) ? response.words : [] };
  } catch (error) {
    return { ok: false, words: [], reason: error?.code || 'failed' };
  }
}
