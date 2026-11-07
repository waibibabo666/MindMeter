# Frontend（M1 本地壳 + BYOK）

原生 HTML/CSS/JS（ES Module），**无构建、无依赖、无后端**。

- **L-01**：路由、页面骨架、标准档 4 项任务、本地进度恢复；
- **L-03**：版本化本地存储（sessions / draft / settings / memory），导出与清除；
- **L-04**：BYOK 设置、OpenAI 兼容客户端、超时与降级。

计分（L-02）与 Agent 状态机不在这一层。

## 路由

hash 路由，刷新与浏览器返回都不丢状态（`localStorage` + draft）。

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `#/` | 首页 | 开始测评、继续未完成、导出数据、设置、清除数据 |
| `#/tier` | 档位 | 标准档可用；快测/深度标注未交付 |
| `#/consent` | 知情同意 | 18+ 与非诊断两条勾选后才能开始 |
| `#/task/<id>` | 任务 | `vc` / `ps` / `sv` / `am`，逐题存进度 |
| `#/report` | 结果 | 4 项原始指标 + 4 项未测；无总分、无百分位；AI 解读 |
| `#/settings` | 设置 | BYOK：endpoint / 模型 / Key，测试连接、清除 Key |

## 目录

```text
frontend/
├─ index.html             # 唯一页面，含跳过链接与模块入口
├─ package.json           # 仅声明 type: module，供 Node 侧测试
└─ src/
   ├─ app.js             # 入口：装配路由与状态
   ├─ router.js          # hash 路由解析与导航
   ├─ store.js           # L-01 app shell 状态（版本与降级）
   ├─ storage.js         # L-03 版本化本地存储（四类 key + 导出/清除）
   ├─ log.js             # 诊断日志：200 条环形缓冲、脱敏、导出/清除
   ├─ data.js            # 维度、档位、题库、词对、图案
   ├─ scoring/           # scoring-v3.1：config / formulas / stats / index
   ├─ charts/radar.js    # 八维雷达几何与 SVG
   ├─ trend.js           # 共同维度、变化、7 天提示
   ├─ ui.js               # 极小 DOM 工具与倒计时
   ├─ random.js          # 可复现的伪随机
   ├─ llm/               # client（请求/超时/错误码）、degrade（模板回退）
   ├─ pages/             # home / tier / consent / task / report / settings
   ├─ tasks/             # vc / ps / sv / am
   └─ styles/app.css     # 360px 起、44px 触控区、减少动效
```

## 本地存储（L-03）

| key | 内容 | 说明 |
| --- | --- | --- |
| `mindmeter.app.shell.v1` | 当前路由、档位、进度、结果 | L-01 app shell |
| `mindmeter.sessions.v1` | 已完成测评 | 最多 50 条；含原始指标/可选分数 |
| `mindmeter.draft.v1` | 进行中测评 | 24h 过期；刷新恢复 |
| `mindmeter.settings.v1` | LLM endpoint/model/key/enabled | Key 只存本机 |
| `mindmeter.memory.v1` | 画像/摘要/建议/消息 | 最近 20 条 |

- 每条记录带 `schemaVersion`；损坏或版本不符自动回退默认值；
- `exportData()` 导出 JSON，**永远剥离 `apiKey`**；
- `clearAllData()` 连同 app shell 状态一起清除；
- localStorage 不可用时退化为内存 Map，页面仍可用。

## 诊断日志

`src/log.js` 提供统一日志：

- 只写 `globalThis.__MM_LOG__` 内存环形缓冲，最多 200 条；
- **不写 `console`**，避免 Key 被浏览器日志/扩展采集；
- 入库前脱敏 `apiKey` / `Authorization` / `Bearer` / `sk-*` / `ghp_*`；
- 设置页可「导出诊断日志 / 清除日志」；导出 JSON 已脱敏；
- 刷新页面后清空，不落盘。

排查时可在控制台查看 `__MM_LOG__`，或从设置页导出。

## L-04：BYOK 与降级

设置页把配置写入 `mindmeter.settings.v1`（复用 L-03 的存储层，不另建 key）。

| 字段 | 说明 |
| --- | --- |
| Endpoint | 可填基址（自动补 `/chat/completions`），也可填完整地址 |
| 模型名 | 透传给请求体的 `model` |
| API Key | 只进 `Authorization` 头，不进 URL、不进 body |

**Key 的处理**：只保存在本机；界面只回显 `sk-…7890`；不写日志；`exportData()` 剥离；
点「清除 Key」立即抹掉；「清除本地数据」整体删除。

**错误码**（收敛成有限集合，页面据此决定文案）：

| 码 | 触发 | 处理 |
| --- | --- | --- |
| `not_configured` | 缺 endpoint/model/key，或开关关闭 | 直接走模板 |
| `timeout` | 超过 20s（`AbortController`） | 回退模板 |
| `network_cors` | fetch 抛 `TypeError`（CORS 未放行 / 断网） | 回退模板并提示检查 CORS |
| `auth` | 401 / 403 | 回退模板，提示 Key 无效 |
| `rate_limit` | 429 | 回退模板 |
| `http` | 其它非 2xx | 回退模板 |
| `bad_response` | 非 JSON 或缺少 `choices[0].message.content` | 回退模板 |

**降级契约**：`explain()` 无论模型侧发生什么，都返回
`{ text, source: 'llm' | 'template', code, reason }`，且 `text` 永不为空。
结果页据此显示「LLM / 模板」徽标与原因。

**CORS 说明**：直连前浏览器会发 `OPTIONS` 预检，服务端必须允许当前来源与
`Authorization` 头；不满足时脚本只能拿到 `TypeError`，因此提示语写成
「可能是 CORS 未放行或网络不可达」。

**不做**：流式输出、自动重试、模型输出缓存——失败即降级，保证行为可预期。

## 运行

无需构建，起任意静态服务器即可（浏览器不允许 `file://` 加载 ES Module）：

```bash
python -m http.server 8000 --directory code/frontend
# 打开 http://127.0.0.1:8000/
```

## 测试

```bash
node scripts/test_app_shell.js     # 12 项：结构、路由、题库、状态
node scripts/test_storage.js       # 本地存储：四类 key、24h 过期、20 条、导出不含 Key
node scripts/test_llm_client.js    # 16 项：错误码、Key 位置、超时、降级
node scripts/test_log.js           # 5 项：日志上限、脱敏、导出、清除
node scripts/test_prototype.js     # 7 项：L1 原型未受影响
# 或根目录 npm test
```

覆盖：入口文件齐全、无 `fetch`/`XMLHttpRequest`（测评壳不联网）、4 项顺序、
旋转与选项唯一性、词对再认构造、指标汇总、路由解析、状态读写与损坏数据回退、
360px 与 44px 触控区等样式约定；以及四类本地 key、draft 24h 过期、memory 20 条、
导出不含 Key、清除全部、localStorage 不可用降级；BYOK 的错误码、Key 位置与回退契约。

## L-08：报告与趋势

**报告页**：八维雷达 + 表格。

- 已测维度画点并连线，未测维度留空并标「未测」，**不按 0 计**；
- 分数为 0–100 整数，**不设总分、不做百分位、没有常模**；
- 已测少于 3 个维度时不画多边形，避免误读成"塌陷"。

**分数来源**：`src/scoring/index.js`（`scoring-v3.1`），公式见 `docs/algorithm/algorithm.md`，
分母按当前壳的实际题数校准（例如言语理解 6 题而不是 15 题）。详见 `src/scoring/README.md`。

**趋势页**：

- 取本机最近两次已完成测评（`mindmeter.sessions.v1`，完成最后一项时写入）；
- **只比较两次都测过的维度**；只有一边测过的维度单独列出、不参与对比；
- 间隔不足 7 天时提示练习效应，但不禁止；
- 少于两次记录时给空态，不显示空表。

**不做的**：不做人群比较、不做成长曲线拟合、不把变化解释成训练效果。

## 约定

- L-01 只展示原始指标；L-02 接本地计分，分数由 `scoring-v3` 产生；
- 只提交原始指标；不存完整对话；设置里的 LLM Key 只存本机，不上传、不导出；
- 反应时使用 `performance.now()`（不可用时回退 `Date.now()`），毫秒取整；
- 快测与深度档在 L-01 只占位，任务实现随 L-03～L-08 补齐。

## 已知限制

- 知觉速度为 45 秒计时任务，刷新后重开计时（已完成 trial 保留）；
- 联想记忆刷新后重新进入学习阶段（草稿只保存再认阶段进度）；
- 图案题共 8 题固定题库，未做随机抽题与难度自适应；
- AI 解读是一次性生成，未接 Agent 状态机与引用（属 L-05）。

## 相关文档

- [软件设计](../../docs/software/software.md)
- [原型说明](../../docs/software/prototype/prototype.md)
- [Agent 接入位](../../docs/software/prototype/agent-接入位.md)
