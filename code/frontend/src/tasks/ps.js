/**
 * 处理速度：编码（SDMT 式）+ 颜色分类，两种题交替出。
 *
 * 规则：
 *   - 对照表常驻，每 10 题重排数字（强制继续查表）
 *   - 编码 5 题 → 分类 5 题 → 循环
 *   - 错题扣 0.5；<200ms 的作答不计分
 *   - 限时 30 / 45 / 90 秒
 *
 * 旧版的符号匹配逻辑（makeTrial / buildTrials）保留，供既有测试使���。
 */
import { PS_SYMBOLS } from '../data.js';
import { el, button, clear, now } from '../ui.js';
import { mulberry32, shuffle, pick } from '../random.js';
import { COLOR_LABEL, SHAPES, pickCombos, shapeNode } from './shapes.js';

const RT_FLOOR = 200;
const BLOCK_SIZE = 5;
const DIGITS = [1, 2, 3, 4, 5, 6];
const DIFFICULTY_CYCLE = [1, 2, 2, 3];
const COLOR_PAIRS = {
  1: ['red', 'blue'],
  2: ['blue', 'green'],
  3: ['red', 'orange'],
};

// ---------- 旧版符号匹配（保留导出，测试仍在用） ----------

export function makeTrial(random) {
  let target;
  do {
    target = Array.from({ length: 3 }, () => pick(PS_SYMBOLS, random)).join('');
  } while (new Set(target).size < 2);

  const options = new Set([target]);
  let guard = 0;
  while (options.size < 4 && guard < 60) {
    guard += 1;
    const chars = target.split('');
    const at = Math.floor(random() * 3);
    const alternatives = PS_SYMBOLS.filter((symbol) => symbol !== chars[at]);
    chars[at] = pick(alternatives, random);
    options.add(chars.join(''));
  }

  const list = shuffle([...options], random);
  return { target, options: list, answer: list.indexOf(target) };
}

export function buildTrials(seed = 20261107, count = 24) {
  const random = mulberry32(seed);
  const trials = [];
  const seen = new Set();
  for (let i = 0; i < count; i += 1) {
    let trial = makeTrial(random);
    let guard = 0;
    while (seen.has(trial.options.join('|')) && guard < 20) {
      trial = makeTrial(random);
      guard += 1;
    }
    seen.add(trial.options.join('|'));
    trials.push(trial);
  }
  return trials;
}

export function summarizePs(trials) {
  const done = trials.length;
  const correct = trials.filter((t) => t.correct).length;
  const rts = trials.map((t) => t.rtMs).filter((v) => typeof v === 'number');
  return {
    trials: done,
    correct,
    wrong: done - correct,
    meanRtMs: rts.length === 0 ? null : Math.round(rts.reduce((a, b) => a + b, 0) / rts.length),
    seconds: 45,
  };
}

// ---------- 新版：编码 + 分类 ----------

export function makeTable(random = Math.random) {
  const combos = pickCombos(6, random);
  const digits = shuffle(DIGITS, random);
  return combos.map((combo, i) => ({ shape: combo.shape, color: combo.color, digit: digits[i] }));
}

/** 重排数字，符号不变——被试必须继续查表。 */
export function remapTable(table, random = Math.random) {
  const digits = shuffle(DIGITS, random);
  return table.map((entry, i) => ({ ...entry, digit: digits[i] }));
}

/**
 * 编码题：n 个符号 → 选出对应的数字序列。
 * n 由难度决定：易 2 / 中 3 / 难 4。
 */
export function buildEncoding(table, difficulty, random = Math.random) {
  const count = [2, 3, 3, 4][difficulty] || 3;
  const picked = shuffle(table, random).slice(0, count);
  const answer = picked.map((entry) => entry.digit);
  const key = answer.join('');
  const options = [answer.slice()];
  const seen = new Set([key]);
  let guard = 0;
  while (options.length < 4 && guard < 200) {
    guard += 1;
    const candidate = shuffle(answer, random);
    const candidateKey = candidate.join('');
    if (seen.has(candidateKey)) continue;
    seen.add(candidateKey);
    options.push(candidate);
  }
  const list = shuffle(options, random);
  return { kind: 'encode', shapes: picked, options: list, answer: list.indexOf(answer) };
}

/** 分类题：判断图形是两种相近颜色中的哪一种。 */
export function buildCategory(difficulty, random = Math.random) {
  const pair = COLOR_PAIRS[difficulty] || COLOR_PAIRS[1];
  const color = pair[Math.floor(random() * pair.length)];
  const shape = SHAPES[Math.floor(random() * SHAPES.length)];
  return { kind: 'category', shape, color, options: pair, answer: pair.indexOf(color) };
}

export function nextQuestion(state, random = Math.random) {
  return state.phase === 'encode'
    ? buildEncoding(state.table, state.difficulty, random)
    : buildCategory(state.difficulty, random);
}

export const psTask = {
  id: 'ps',
  mount(root, ctx) {
    const seconds = (ctx.spec && ctx.spec.seconds) || 45;
    const durationMs = seconds * 1000;
    const state = {
      phase: 'encode',
      blockLeft: BLOCK_SIZE,
      difficulty: 1,
      questionIndex: 0,
      blocks: 0,
      table: makeTable(),
      encCorrect: 0,
      encWrong: 0,
      catCorrect: 0,
      catWrong: 0,
      done: 0,
      ignored: 0,
    };
    let current = null;
    let shownAt = now();
    let closed = false;
    const startedAt = now();

    const status = el('p', { class: 'game-status', text: '' });
    const legend = el('div', { class: 'legend' });
    const host = el('div', { class: 'ps-host' });
    root.appendChild(status);
    root.appendChild(legend);
    root.appendChild(host);

    const renderLegend = () => {
      clear(legend);
      for (const entry of state.table) {
        legend.appendChild(
          el('span', { class: 'legend-item' }, [
            shapeNode(entry.shape, entry.color, 24),
            el('span', { class: 'legend-digit', text: String(entry.digit) }),
          ]),
        );
      }
    };

    const summary = () => {
      // 只显示当前阶段在做的题型，避免另一类的统计干扰
      if (state.phase === 'encode') {
        return `已答 ${state.done} · 编码 ${state.encCorrect}对${state.encWrong}错`;
      }
      return `已答 ${state.done} · 分类 ${state.catCorrect}对${state.catWrong}错`;
    };

    const finish = () => {
      if (closed) return;
      closed = true;
      globalThis.clearInterval(timer);
      ctx.finish(null, {
        encCorrect: state.encCorrect,
        encWrong: state.encWrong,
        catCorrect: state.catCorrect,
        catWrong: state.catWrong,
        seconds,
      });
    };

    const advance = () => {
      state.questionIndex += 1;
      state.blockLeft -= 1;
      if (state.questionIndex % 10 === 0) {
        state.table = remapTable(state.table);
        renderLegend();
      }
      if (state.blockLeft <= 0) {
        state.blocks += 1;
        state.phase = state.phase === 'encode' ? 'category' : 'encode';
        state.blockLeft = BLOCK_SIZE;
        state.difficulty = DIFFICULTY_CYCLE[state.blocks % DIFFICULTY_CYCLE.length];
      }
      draw();
    };

    const answer = (choice) => {
      if (closed || !current) return;
      const rt = now() - shownAt;
      state.done += 1;
      if (rt < RT_FLOOR) {
        state.ignored += 1;
      } else if (current.kind === 'encode') {
        if (choice === current.answer) state.encCorrect += 1;
        else state.encWrong += 1;
      } else if (choice === current.answer) {
        state.catCorrect += 1;
      } else {
        state.catWrong += 1;
      }
      advance();
    };

    const draw = () => {
      current = nextQuestion(state);
      shownAt = now();
      clear(host);
      // 分类题不需要对照表，隐藏它以免干扰
      legend.style.display = current.kind === 'encode' ? 'flex' : 'none';
      status.textContent = summary();

      if (current.kind === 'encode') {
        const target = el('div', { class: 'ps-target' });
        for (const entry of current.shapes) {
          target.appendChild(shapeNode(entry.shape, entry.color, 32));
        }
        host.appendChild(target);
        host.appendChild(el('p', { class: 'tiny', text: '按对照表填出数字' }));
      } else {
        host.appendChild(
          el('div', { class: 'ps-target' }, [shapeNode(current.shape, current.color, 44)]),
        );
        host.appendChild(el('p', { class: 'tiny', text: '这是什么颜色？' }));
      }

      const options = el('div', { class: 'ps-options' });
      current.options.forEach((option, i) => {
        const label = current.kind === 'encode' ? option.join(' ') : COLOR_LABEL[option];
        options.appendChild(button(label, () => answer(i), { variant: 'option' }));
      });
      host.appendChild(options);
    };

    renderLegend();
    draw();

    const timer = globalThis.setInterval(() => {
      const left = Math.max(0, durationMs - (now() - startedAt));
      if (closed) return;
      if (left <= 0) {
        finish();
        return;
      }
      status.textContent = `剩余 ${(left / 1000).toFixed(1)}s · ${summary()}`;
    }, 300);

    return () => {
      closed = true;
      globalThis.clearInterval(timer);
      clear(host);
      clear(legend);
    };
  },
};
