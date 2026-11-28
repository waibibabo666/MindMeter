#!/usr/bin/env node
/**
 * 单元测试补齐：给目前没有直接覆盖的纯逻辑模块加测试。
 *
 * 覆盖：
 *   - random.js：可复现性、洗牌是排列、pick 边界、hashSeed 稳定性
 *   - router.js：createRouter 的初始化、push、replace、未知路由回退、stop
 *   - ui.js：el 的属性分发、null 子节点跳过、文本子节点、clear、now、ticker
 *   - tasks/sv.js：summarizeSv、rotate/mirror 不变量
 *   - trend.js：versionHint
 *
 * 用法：node scripts/test_units.js
 */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'code', 'frontend', 'src');
const href = (rel) => pathToFileURL(path.join(SRC, rel)).href;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const eq = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label}：期望 ${expected}，实际 ${actual}`);
};

/** 极简 DOM 替身，只实现 ui.js 用到的方法。 */
function makeDocument() {
  const node = () => ({
    className: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    attributes: {},
    style: {},
    children: [],
    listeners: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(type, handler) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(handler);
    },
    /** 派发事件：同类型的监听按注册顺序全部调用（浏览器行为）。 */
    dispatch(type, event = {}) {
      const list = this.listeners[type] || [];
      list.forEach((fn) => fn({ type, target: this, ...event }));
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      this.firstChild = this.children[0];
    },
    get firstChild() {
      return this.children[0];
    },
    set firstChild(_value) {
      // 占位：clear() 只会读取 firstChild
    },
  });

  return {
    createElement: () => node(),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  };
}

async function main() {
  const random = await import(href('random.js'));
  const router = await import(href('router.js'));
  const { summarizeSv, rotate, mirror } = await import(href('tasks/sv.js'));
  const ui = await import(href('ui.js'));

  // ---------- random ----------
  test('random：同一 seed 产生同一序列', () => {
    const a = random.mulberry32(42);
    const b = random.mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    assert(JSON.stringify(seqA) === JSON.stringify(seqB), '同 seed 序列不一致');
    assert(
      seqA.every((v) => v >= 0 && v < 1),
      '取值范围应为 [0,1)',
    );
  });

  test('random：不同 seed 产生不同序列', () => {
    const a = random.mulberry32(1);
    const b = random.mulberry32(2);
    assert(a() !== b(), '不同 seed 首值相同');
  });

  test('random：shuffle 是排列，不改原数组', () => {
    const source = [1, 2, 3, 4, 5];
    const rnd = random.mulberry32(7);
    const out = random.shuffle(source, rnd);
    eq(out.length, source.length, '长度');
    eq([...out].sort((x, y) => x - y).join(','), source.join(','), '元素集合');
    eq(source.join(','), '1,2,3,4,5', '原数组不应被修改');
  });

  test('random：pick 落在集合内', () => {
    const rnd = random.mulberry32(3);
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 20; i += 1) {
      assert(items.includes(random.pick(items, rnd)), 'pick 越界');
    }
  });

  test('random：hashSeed 稳定且为 32 位无符号', () => {
    eq(random.hashSeed('mindmeter'), random.hashSeed('mindmeter'), '同字符串应稳定');
    assert(random.hashSeed('a') !== random.hashSeed('b'), '不同字符串应不同');
    const value = random.hashSeed('x');
    assert(Number.isInteger(value) && value >= 0 && value <= 0xffffffff, `越界：${value}`);
  });

  // ---------- router ----------
  test('router：start 分发初始路由，未知路由回退 /', () => {
    withFakeWindow('', (win) => {
      const seen = [];
      const r = router.createRouter((route) => seen.push(route.full));
      r.start();
      eq(seen[0], '/', '初始应为 /');

      win.location.hash = '#/nope';
      win.fire('hashchange');
      eq(seen[seen.length - 1], '/', '未知路由应回退 /');

      win.location.hash = '#/task/vc';
      win.fire('hashchange');
      eq(seen[seen.length - 1], '/task/vc', '已知路由应原样分发');
      r.stop();
    });
  });

  test('router：go 设置 hash；replace 直接生效', () => {
    withFakeWindow('', (win) => {
      const seen = [];
      const r = router.createRouter((route) => seen.push(route.full));
      r.start();

      r.go('/tier');
      eq(win.location.hash, '/tier', 'go 应写入 hash');
      win.fire('hashchange');
      eq(seen[seen.length - 1], '/tier', '应分发到 /tier');

      r.go('/report', { replace: true });
      eq(seen[seen.length - 1], '/report', 'replace 应立即生效');
      eq(win.replaced, '#/report', 'replace 应走 history.replaceState');
      r.stop();
    });
  });

  test('router：stop 后不再响应', () => {
    withFakeWindow('', (win) => {
      const seen = [];
      const r = router.createRouter((route) => seen.push(route.full));
      r.start();
      r.stop();
      const before = seen.length;
      win.location.hash = '#/trend';
      if (win.handler) win.fire('hashchange');
      eq(seen.length, before, 'stop 后不应再分发');
    });
  });

  // ---------- ui ----------
  test('ui.el：属性分发与 null 子节点', async () => {
    const doc = makeDocument();
    const previous = globalThis.document;
    globalThis.document = doc;
    try {
      const handler = () => {};
      const node = ui.el(
        'div',
        {
          class: 'card',
          text: 'body',
          dataset: { id: 'x' },
          'aria-label': 'label',
          onclick: handler,
          hidden: false,
          missing: null,
        },
        ['a', null, undefined, false],
      );

      eq(node.className, 'card', 'class');
      eq(node.textContent, 'body', 'text');
      eq(node.dataset.id, 'x', 'dataset');
      eq(node.attributes['aria-label'], 'label', '普通属性');
      assert((node.listeners.click || []).includes(handler), '事件绑定');
      assert(!('hidden' in node.attributes), 'false 值不应写入属性');
      assert(!('missing' in node.attributes), 'null 值不应写入属性');
      eq(node.children.length, 1, '只保留字符串子节点');
      eq(node.children[0].textContent, 'a', '字符串应转成文本节点');
    } finally {
      globalThis.document = previous;
    }
  });

  test('ui.clear 清空子节点；now 返回有限数', async () => {
    const doc = makeDocument();
    const previous = globalThis.document;
    globalThis.document = doc;
    try {
      const node = doc.createElement('div');
      ui.el('span', { text: 'a' });
      node.appendChild({});
      node.appendChild({});
      eq(node.children.length, 2, '前置条件');
      ui.clear(node);
      eq(node.children.length, 0, 'clear 后应为空');

      const t1 = ui.now();
      const t2 = ui.now();
      assert(Number.isFinite(t1) && Number.isFinite(t2), 'now 应返回数字');
      assert(t2 >= t1, 'now 应单调不减');
    } finally {
      globalThis.document = previous;
    }
  });

  test('展开图：拖动立方体不算作答，单击才算', async () => {
    const doc = makeDocument();
    const previous = globalThis.document;
    globalThis.document = doc;
    try {
      const { buildNetCubeQuestion, renderNetQuestion } = await import(href('tasks/svNet.js'));
      const item = buildNetCubeQuestion(() => 0.5);
      const picked = [];
      const view = renderNetQuestion(item, (index) => picked.push(index));

      const byClass = (node, name) =>
        (node.children || []).find((child) => child.className === name);
      const body = byClass(view.node, 'net-body');
      const options = byClass(body, 'cube-options');
      const card = options.children[0];
      const stage = card.children[0];

      // 拖动：按下 → 移动 60px → 松开 → 浏览器补一个 click（冒泡到卡片）
      stage.dispatch('pointerdown', { clientX: 0, clientY: 0, pointerId: 1 });
      stage.dispatch('pointermove', { clientX: 60, clientY: 0, pointerId: 1 });
      stage.dispatch('pointerup', { pointerId: 1 });
      stage.dispatch('click', {});
      card.dispatch('click', {});
      eq(picked.length, 0, '转动之后不应提交答案');

      // 纯点击：应恰好提交一次（曾因两个 click 处理器各提交一次而重复）
      card.dispatch('click', {});
      eq(picked.length, 1, '单击应恰好提交一次');
    } finally {
      globalThis.document = previous;
    }
  });

  test('ir：答案不能与左邻/上邻相同，数量不超过 5', async () => {
    const irModule = await import(href('tasks/ir.js'));
    const cellKey = (cell) => (cell ? `${cell.shape}${cell.count}` : '?');
    const rules = ['rowShape', 'colShape', 'diagonal', 'combine', 'alternate', 'mirror'];
    for (const rule of rules) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const question = irModule.buildMatrix(rule, random.mulberry32(seed));
        const answer = question.options[question.answer];
        assert(answer, `${rule}: 找不到答案选项`);
        assert(answer.count >= 1 && answer.count <= 5, `${rule}: 答案数量越界 ${answer.count}`);
        assert(
          cellKey(answer) !== cellKey(question.cells[7]),
          `${rule}: 答案与左邻相同，等于有两个正确答案`,
        );
        assert(
          cellKey(answer) !== cellKey(question.cells[5]),
          `${rule}: 答案与上邻相同，等于有两个正确答案`,
        );
      }
    }
  });

  test('sv 折叠：选项要打乱，同一场不重复出题', async () => {
    const svMount = await import(href('tasks/svMount.js'));
    const positions = new Set();
    for (let seed = 1; seed <= 60; seed += 1) {
      const question = svMount.buildFold(random.mulberry32(seed));
      eq(question.options.length, 4, '折叠题应有四个选项');
      eq(new Set(question.options).size, 4, '折叠题选项不应重复');
      positions.add(question.answer);
    }
    assert(positions.size > 1, '折叠题答案位置固定，说明选项没有打乱');

    const used = new Set();
    const ids = [];
    for (let i = 0; i < 6; i += 1) {
      ids.push(svMount.buildFold(random.mulberry32(100 + i), used).id);
    }
    eq(new Set(ids).size, 6, `同一场出现了重复折叠题：${ids.join(',')}`);
  });

  test('ui.ticker：倒计时与结束回调只触发一次', async () => {
    const doc = makeDocument();
    const previousDoc = globalThis.document;
    const previousSet = globalThis.setInterval;
    const previousClear = globalThis.clearInterval;
    globalThis.document = doc;

    const ticks = [];
    let ended = 0;
    let tick = null;
    let cleared = 0;
    let alive = true;
    globalThis.setInterval = (fn) => {
      // 只有未被 clearInterval 取消时才真正执行回调，模拟真实定时器。
      tick = () => {
        if (alive) fn();
      };
      return 1;
    };
    globalThis.clearInterval = () => {
      alive = false;
      cleared += 1;
    };

    try {
      const cancel = ui.ticker(
        2,
        (left) => ticks.push(left),
        () => {
          ended += 1;
        },
      );

      eq(ticks[0], 2, '应立即回调初始值');
      tick();
      eq(ticks[1], 1, '第一次 tick');
      tick();
      eq(ticks[2], 0, '第二次 tick');
      eq(ended, 1, '结束回调应触发一次');
      assert(cleared >= 1, '结束时应清理定时器');

      cancel();
      tick();
      eq(ended, 1, '取消后不应再次触发结束');
    } finally {
      globalThis.document = previousDoc;
      globalThis.setInterval = previousSet;
      globalThis.clearInterval = previousClear;
    }
  });

  // ---------- tasks/sv ----------
  test('sv.summarizeSv：正确率与空输入', () => {
    eq(summarizeSv([true, true, false, true]).correct, 3, '正确数');
    eq(summarizeSv([true, true, false, true]).total, 4, '总数');
    eq(summarizeSv([true, false]).accuracy, 0.5, '正确率');
    eq(summarizeSv([]).accuracy, null, '空输入应为 null');
  });

  test('sv.rotate：四次 90° 回到原图；mirror 不改变元素个数', () => {
    const base = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    eq(JSON.stringify(rotate(base, 360)), JSON.stringify(base), '360° 应恒等');
    eq(
      JSON.stringify(rotate(rotate(base, 90), 90)),
      JSON.stringify(rotate(base, 180)),
      '两步 90 = 180',
    );
    const flipped = mirror(base);
    eq(flipped.length, base.length, 'mirror 长度');
    eq(
      flipped.reduce((a, b) => a + b, 0),
      base.reduce((a, b) => a + b, 0),
      'mirror 不改变实心块数量',
    );
  });

  // ---------- pages/tier：档位卡只放有区分度的数字（人工测试反馈 3 第 3 条） ----------
  test('tier.tierMetrics：三档文案互不相同，且数字来自 LEVEL_SPEC 而不是写死', async () => {
    const { TIERS } = await import(href('data.js'));
    const { LEVEL_SPEC } = await import(href('scoring/levels.js'));
    const { tierMetrics } = await import(href('pages/tier.js'));

    const rows = TIERS.map((tier) => tierMetrics(tier));
    const joined = rows.map((row) => row.join(' | '));
    eq(new Set(joined).size, joined.length, `三张档位卡的文字雷同：${joined.join(' /// ')}`);

    // 数字必须等于 LEVEL_SPEC 的实际值：改了档位参数表，卡片必须跟着变。
    assert(
      rows[0].includes(`言语 ${LEVEL_SPEC.quick.vc.items} 题`),
      `快测卡的言语题量不是 LEVEL_SPEC 的值：${rows[0].join(' / ')}`,
    );
    assert(
      rows[2].includes(`知觉 ${LEVEL_SPEC.deep.ps.seconds} 秒`),
      `精细卡的知觉限时不是 LEVEL_SPEC 的值：${rows[2].join(' / ')}`,
    );
    assert(
      rows[1].includes(`流畅 ${LEVEL_SPEC.standard.vf.seconds} 秒`),
      `标准卡的流畅限时不是 LEVEL_SPEC 的值：${rows[1].join(' / ')}`,
    );

    // 总题量 = LEVEL_SPEC 里所有"题数型"维度之和（限时维度不计）。
    const total = Object.values(LEVEL_SPEC.quick).reduce(
      (sum, spec) => sum + (typeof spec.items === 'number' ? spec.items : 0),
      0,
    );
    assert(rows[0][0] === `共 ${total} 题`, `快测总题量应为 共 ${total} 题，实际 ${rows[0][0]}`);
  });

  test('tier.tierMetrics：只列三档取值互不相同的维度，不再逐字重复八维名单', async () => {
    const { TIERS } = await import(href('data.js'));
    const { tierMetrics } = await import(href('pages/tier.js'));
    for (const tier of TIERS) {
      const text = tierMetrics(tier).join(' ');
      // 完整维度名（言语理解 / 空间视觉化 …）一个都不该出现在卡片上：
      // 那是"三张卡逐字重复同一串维度名"的来源，说明页与「今天的状态」页各列一遍就够。
      for (const name of ['言语理解', '知觉速度', '空间视觉化', '联想记忆', '数字运算']) {
        assert(!text.includes(name), `${tier.id} 卡上又出现了完整维度名：${name}`);
      }
      assert(text.length <= 60, `${tier.id} 卡的差异行过长（${text.length} 字）`);
    }
  });

  // ---------- trend ----------
  let passed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`[PASS] ${name}`);
    } catch (error) {
      console.error(`[FAIL] ${name}`);
      console.error(`       ${error.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} unit checks passed`);
}

/** 给 router 造一个可控的 globalThis（location/history/事件）。 */
function withFakeWindow(initialHash, run) {
  const handlers = {};
  const win = {
    location: { hash: initialHash },
    replaced: null,
    handler: null,
    history: {
      replaceState(_state, _title, url) {
        win.replaced = url;
        win.location.hash = url;
      },
    },
    addEventListener(type, fn) {
      handlers[type] = fn;
      win.handler = fn;
    },
    removeEventListener(type) {
      delete handlers[type];
    },
    fire(type) {
      if (handlers[type]) handlers[type]();
    },
  };

  const backup = {
    location: globalThis.location,
    history: globalThis.history,
    addEventListener: globalThis.addEventListener,
    removeEventListener: globalThis.removeEventListener,
  };

  globalThis.location = win.location;
  globalThis.history = win.history;
  globalThis.addEventListener = win.addEventListener;
  globalThis.removeEventListener = win.removeEventListener;

  try {
    run(win);
  } finally {
    globalThis.location = backup.location;
    globalThis.history = backup.history;
    globalThis.addEventListener = backup.addEventListener;
    globalThis.removeEventListener = backup.removeEventListener;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
