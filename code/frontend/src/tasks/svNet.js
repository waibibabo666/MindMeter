/**
 * 展开图折叠题：给带颜色的十字展开图，选折出来的那个立方体。
 *
 * 折叠关系（1-4-1 十字网）：
 *   中间一格 = 前面；它上面 = 顶面；它下面 = 底面；
 *   左右两格 = 左面 / 右面；最右一格折过去 = 后面。
 *
 * 选项是四个可拖动的彩色立方体：一项是正确折叠结果，三项交换了某两个面。
 */
import { el } from '../ui.js';

const COLORS = ['#d92d20', '#1570ef', '#12b76a', '#f79009', '#7a5af8', '#0e9384'];
const FACES = ['front', 'back', 'left', 'right', 'top', 'bottom'];

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

/** 生成一道展开图折叠题。 */
export function buildNetCubeQuestion(random = Math.random) {
  const colors = shuffle(COLORS, random).slice(0, 6);
  const [top, left, front, right, back, bottom] = colors;
  const correct = { front, back, left, right, top, bottom };

  const variants = [
    { ...correct, left: correct.right, right: correct.left },
    { ...correct, top: correct.bottom, bottom: correct.top },
    { ...correct, front: correct.back, back: correct.front },
  ];

  const options = shuffle([correct, ...variants], random);
  return {
    kind: 'net',
    net: { top, left, front, right, back, bottom },
    options,
    answer: options.indexOf(correct),
    q: '下面哪个立方体，是由左边的展开图折成的？',
  };
}

function netNode(net) {
  const grid = el('div', { class: 'net-grid' });
  const layout = [
    [null, net.top, null, null],
    [net.left, net.front, net.right, net.back],
    [null, net.bottom, null, null],
  ];
  for (const row of layout) {
    for (const color of row) {
      grid.appendChild(
        el('span', {
          class: `net-cell${color ? ' on' : ''}`,
          style: color ? `background:${color}` : '',
        }),
      );
    }
  }
  return grid;
}

/** 一个可拖动的彩色立方体。 */
function cubeOption(colors, onTurn) {
  const cube = el('div', { class: 'cube' });
  for (const face of FACES) {
    cube.appendChild(
      el('div', { class: `cube-face ${face}`, style: `background:${colors[face]}` }),
    );
  }
  const stage = el('div', { class: 'cube-stage small' }, [cube]);

  let rx = -20;
  let ry = 30;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let turns = 0;
  let moved = false;

  const apply = () => {
    cube.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
  };
  apply();

  stage.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    stage.setPointerCapture?.(event.pointerId);
  });
  stage.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    rx = Math.max(-120, Math.min(120, rx - dy));
    ry += dx;
    if (Math.abs(dx) + Math.abs(dy) >= 4) moved = true;
    if (Math.abs(dx) + Math.abs(dy) >= 40) {
      turns += 1;
      onTurn(turns);
    }
    apply();
  });
  const stop = () => {
    dragging = false;
  };
  stage.addEventListener('pointerup', stop);
  stage.addEventListener('pointerleave', stop);

  return {
    node: stage,
    turns: () => turns,
    /** 这次交互是否发生了拖动（用来区分「拖动」与「点击」）。 */
    consumeMoved: () => {
      const value = moved;
      moved = false;
      return value;
    },
  };
}

/**
 * 渲染整道题：展开图 + 四个可拖动立方体。
 * @returns {{node: HTMLElement, getTurns: () => number}}
 */
export function renderNetQuestion(item, onPick) {
  let totalTurns = 0;
  const wrap = el('div', { class: 'net-question' });
  wrap.appendChild(el('h2', { class: 'task-question', text: item.q }));

  const body = el('div', { class: 'net-body' }, [netNode(item.net)]);
  const options = el('div', { class: 'cube-options' });

  item.options.forEach((colors, i) => {
    const cube = cubeOption(colors, (turns) => {
      totalTurns += 1;
      if (turns === 1) totalTurns += 0;
    });
    const card = el('button', { class: 'cube-option', type: 'button' }, [cube.node]);
    card.addEventListener('click', (event) => {
      // 拖动结束后浏览器会补一个 click，这里吞掉，避免误提交
      if (cube.consumeMoved()) return;
      if (event.detail === 0) return;
      onPick(i);
    });
    options.appendChild(card);
  });

  body.appendChild(options);
  wrap.appendChild(body);
  return { node: wrap, getTurns: () => totalTurns };
}
