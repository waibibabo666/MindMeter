# Frontend（L2 静态壳）

原生 HTML/CSS/JS（ES Module），**无构建、无依赖、无后端**。L-01 交付的是「壳」：
路由、页面骨架、标准档 4 项任务、本地进度恢复；计分与 Agent 不在这一层。

## 路由

hash 路由，刷新与浏览器返回都不丢状态（`localStorage` + draft）。

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `#/` | 首页 | 开始测评、继续未完成、清除数据 |
| `#/tier` | 档位 | 标准档可用；快测/深度标注未交付 |
| `#/consent` | 知情同意 | 18+ 与非诊断两条勾选后才能开始 |
| `#/task/<id>` | 任务 | `vc` / `ps` / `sv` / `am`，逐题存进度 |
| `#/report` | 结果 | 4 项原始指标 + 4 项未测；**无总分、无百分位** |

## 目录

```text
frontend/
├─ index.html             # 唯一页面，含跳过链接与模块入口
├─ package.json           # 仅声明 type: module，供 Node 侧测试
└─ src/
   ├─ app.js             # 入口：装配路由与状态
   ├─ router.js          # hash 路由解析与导航
   ├─ store.js           # localStorage 读写（带版本与降级）
   ├─ data.js            # 维度、档位、题库、词对、图案
   ├─ ui.js               # 极小 DOM 工具与倒计时
   ├─ random.js          # 可复现的伪随机
   ├─ pages/             # home / tier / consent / task / report
   ├─ tasks/             # vc / ps / sv / am
   └─ styles/app.css     # 360px 起、44px 触控区、减少动效
```

## 运行

无需构建，起任意静态服务器即可（浏览器不允许 `file://` 加载 ES Module）：

```bash
python -m http.server 8000 --directory code/frontend
# 打开 http://127.0.0.1:8000/
```

## 测试

```bash
node scripts/test_app_shell.js
```

覆盖：入口文件齐全、无 `fetch`/`XMLHttpRequest`（静态壳不联网）、4 项顺序、
旋转与选项唯一性、词对再认构造、指标汇总、路由解析、状态读写与损坏数据回退、
360px 与 44px 触控区等样式约定。

## 约定

- 不做客户端计分：结果页只展示原始指标，分数由服务端 `scoring-v3` 产生（L-02 起接入）；
- 只提交原始指标；不存完整对话；不存 BYOK Key；
- 反应时使用 `performance.now()`（不可用时回退 `Date.now()`），毫秒取整；
- 快测与深度档在 L-01 只占位，任务实现随 L-03～L-08 补齐。

## 已知限制

- 知觉速度为 45 秒计时任务，刷新后重开计时（已完成 trial 保留）；
- 联想记忆刷新后重新进入学习阶段（草稿只保存再认阶段进度）；
- 图案题共 8 题固定题库，未做随机抽题与难度自适应。

## 相关文档

- [软件设计](../../docs/software/software.md)
- [原型说明](../../docs/software/prototype/prototype.md)
- [Agent 接入位](../../docs/software/prototype/agent-接入位.md)
