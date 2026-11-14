/**
 * 通用题库引擎：知识型小游戏共用。
 *
 * 每个游戏只需提供题组：
 *   { prompt: '题干', options: ['A','B','C','D'], answer: 0 }
 * 或选项是九宫格时：
 *   { prompt: '旋转 90° 后是？', options: [{ grid: [...9] }], answer: 2 }
 *
 * 固定题量（默认 10 题），答完即结算，不计时——避免把速度混进知识类维度。
 */
import { el, clear } from '../ui.js';

function shuffle(list, random = Math.random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** 答对数占总题数的百分比。 */
export function scoreQuiz(correct, total) {
  const safeTotal = Number(total) || 0;
  if (safeTotal <= 0) return 0;
  const safeCorrect = Math.max(0, Math.min(safeTotal, Number(correct) || 0));
  return Math.round((safeCorrect / safeTotal) * 100);
}

function miniGrid(cells) {
  const node = el('div', { class: 'quiz-grid' });
  for (const cell of cells) {
    node.appendChild(el('span', { class: `quiz-cell${cell ? ' on' : ''}` }));
  }
  return node;
}

function optionNode(option, onPick) {
  if (option && Array.isArray(option.grid)) {
    const node = el('button', { class: 'quiz-grid-option', type: 'button', 'aria-label': '图案选项' }, [
      miniGrid(option.grid),
    ]);
    node.addEventListener('click', () => onPick(node));
    return node;
  }
  const text = typeof option === 'string' ? option : option.text;
  const node = el('button', { class: 'btn game-option', type: 'button', text });
  node.addEventListener('click', () => onPick(node));
  return node;
}

/**
 * @param {{id:string, dim:string, title:string, desc:string, bank:Array, pick?:number}} config
 */
export function createQuizGame(config) {
  const { id, dim, title, desc, bank, pick = 10 } = config;
  return {
    id,
    dim,
    title,
    desc,
    bank,
    mount(root, ctx) {
      const questions = shuffle(bank).slice(0, Math.min(pick, bank.length));
      let index = 0;
      let correct = 0;
      let closed = false;

      const status = el('p', { class: 'game-status' });
      const prompt = el('div', { class: 'quiz-prompt' });
      const options = el('div', { class: 'quiz-options' });
      root.appendChild(status);
      root.appendChild(prompt);
      root.appendChild(options);

      const finish = () => {
        if (closed) return;
        closed = true;
        ctx.finish(scoreQuiz(correct, questions.length), {
          correct,
          total: questions.length,
        });
      };

      const round = () => {
        const item = questions[index];
        if (!item) {
          finish();
          return;
        }
        status.textContent = `第 ${index + 1} / ${questions.length} 题 · 已答对 ${correct}`;
        prompt.textContent = item.prompt;
        if (Array.isArray(item.grid)) prompt.appendChild(miniGrid(item.grid));
        clear(options);
        // 打乱选项，避免正确答案固定落在某个位置
        const shuffled = shuffle(item.options.map((option, i) => ({ option, right: i === item.answer })));
        shuffled.forEach(({ option, right }) => {
          const node = optionNode(option, () => {
            if (closed) return;
            if (right) correct += 1;
            index += 1;
            round();
          });
          options.appendChild(node);
        });
      };

      round();
      return () => {
        closed = true;
        clear(root);
      };
    },
  };
}

export { shuffle };
