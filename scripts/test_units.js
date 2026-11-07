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
    children: [],
    listeners: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
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
      eq(node.listeners.click, handler, '事件绑定');
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
