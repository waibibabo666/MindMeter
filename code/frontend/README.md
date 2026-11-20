# Frontend（Web 托管版）

原生 HTML/CSS/JS（ES Module），**无构建步骤**，由同一个 FastAPI 服务同源托管（`app.mount("/")`）。
没有独立端口、没有 CORS 配置，会话就是浏览器自动带的 `HttpOnly` Cookie。

## 分层

- `api.js`：唯一的网络出口。`fetch` + `credentials: 'same-origin'`；把非 2xx 归一成 `ApiError(code)`；遇到非认证路径的 401 广播一次 `mm:unauthenticated`；
- `auth.js`：`session` 状态、用户名/密码规则（与服务端同源口径，但**不是安全边界**）、错误码→人话文案；
- `boot.js`：先探 `GET /auth/session`，未登录不预取任何业务数据；已登录再并发拉 state/sessions/memory/settings；
- `app.js` + `shell.js`：入口与工作台外壳；`app.js` 里的 `gateRoute` 是路由闸门（未登录只放行 `#/login`、`#/register`）；
- `storage.js` / `store.js` / `cache.js`：内存缓存 facade + 写入队列；未登录时 `store.js` 只改本地缓存、不发请求（避免每个路由跳转一个 401）；
- 业务数据一律在服务端 PostgreSQL，**按 `user_id` 隔离**；浏览器 localStorage 只剩设备级偏好（音效、侧栏折叠、游戏练习最佳分、测评前采集的年龄/教育）。

## 路由

hash 路由；刷新与浏览器返回不丢状态（进度存在服务端 `app_state`）。

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `#/login` `#/register` | 账号 | 未登录时唯一可达页面；注册需 18+ 与边界勾选 |
| `#/` | 首页 | 开始测评、继续未完成、导出、设置、清除数据 |
| `#/tier` | 档位 | 快测 2 / 标准 8 / 深度 8（`STANDARD_ORDER` 固定顺序） |
| `#/consent` | 知情同意 | 非诊断与数据说明，勾选后才能开始 |
| `#/intake` | 开始之前 | 年龄/教育（只填一次）+ 睡眠/疲劳（每次填），不参与计分 |
| `#/task/<id>` | 任务 | `vc/vf/nc/ps/ir/sv/am/ni`，逐题存进度 |
| `#/report` | 结果 | 原始指标 + 参考分 + 未测维度；无总分、无百分位；AI 解读卡 |
| `#/memory` `#/chat` | 记忆 / 对话 | 对话每账号留最近 20 条；记忆由服务端沉淀 |
| `#/trend` | 兼容入口 | 重定向到 `#/report`（趋势已并入报告页） |
| `#/games` `#/game/<id>` | 游戏中心 | 自由练习，成绩不进报告、不改维度分 |
| `#/settings` | 设置 | 账号（改密/退出/注销）、站点模型只读、导出导入、清除、日志 |

## 目录

```text
frontend/
├─ index.html             # 唯一页面：顶栏、侧栏、#app、右栏、toast
├─ package.json           # 仅声明 type: module，供 Node 侧测试
└─ src/
   ├─ app.js             # 入口：路由闸门 + 页面装配 + ctx
   ├─ router.js          # hash 路由与白名单
   ├─ shell.js           # 顶栏 chip / 侧栏高亮 / 右栏快捷操作
   ├─ auth.js            # 会话状态与凭证规则
   ├─ api.js             # 同源 fetch + Cookie + 错误归一
   ├─ boot.js            # 启动预取与缓存重置
   ├─ cache.js store.js storage.js  # 内存缓存、状态写入队列
   ├─ pages/             # auth home tier consent intake task report trend memory chat games game about settings
   ├─ tasks/ charts/ games/ scoring/ kb/   # 任务实现、雷达与折线、练习游戏、本地对照计分、知识块
   ├─ data.js profile.js random.js ui.js icons.js motion.js sound.js ui-prefs.js log.js trend.js
   └─ styles/app.css     # 360px 起、44px 触控区、减少动效
```

浏览器直连模型的旧实现（`src/llm/`、`src/agent/`、`src/eval/`）已随桌面/BYOK 形态删除：
**前端不存在任何携带模型凭证的代码路径**，`check_frontend_dead_code.py` 会持续确认没有不可达模块回来。

## 数据层（按账号隔离）

| 缓存 | 服务端来源 | 说明 |
| --- | --- | --- |
| `cache.state` | `GET/PUT /api/v1/state` | 路由、档位、进度、草稿（本账号一份） |
| `cache.sessions` | `GET/POST /api/v1/assessments` | 每账号最多 50 条 |
| `cache.memory` | `GET/PUT /api/v1/memory` | 画像/摘要/建议/最近 20 条消息 |
| `cache.settings` | `GET /api/v1/settings/ai` | `endpoint/model/enabled/hasKey/keyHint/readOnly`，**永远没有 Key** |

- 写入进入队列串行发送，`beforeunload` 时只在已登录状态下 flush；
- `exportData()` 由后端生成并只含本账号数据；
- 导入 JSON 与本账号数据合并（相同 id 跳过），导入文件里的 Key 字段被忽略并给出提示。

## 诊断日志

`src/log.js`：`globalThis.__MM_LOG__` 内存环形缓冲（最多 200 条）、**不写 `console`**、导出前脱敏
（`apiKey`/`authorization`/`password`/`token`/`secret`/`key` 字段、`sk-*`、`Bearer …`、`ghp_*`），刷新即清空。
服务端日志见 [docs/software/logging.md](../../docs/software/logging.md)。

## AI 解读的降级契约

模型调用只发生在后端（`app/llm.py` + `app/agent`）。错误码由服务端产生，前端按码给文案：

| 码 | 触发 | 处理 |
| --- | --- | --- |
| `not_configured` | 站点未配 `MM_LLM_API_KEY`/基址/模型名 | 走模板，设置页显示“未配置” |
| `timeout` | 超过 `MM_LLM_TIMEOUT_S`（默认 45s） | 回退模板 |
| `auth` | 模型返回 401/403 | 回退模板，提示站点 Key 无效 |
| `rate_limit` | 429 | 回退模板，提示稍后再试 |
| `http` / `network` | 其它非 2xx / 连不上 | 回退模板 |
| `bad_response` / `truncated` | 响应缺 `choices[0].message.content` 或被 token 上限截断 | 回退模板 |
| 校验不通过 | 出现禁用词、幻觉数字、缺引用 | 回退该场景模板（`code` 带原因） |

**降级契约**：`/chat`、`/reports/{id}/explain` 无论模型侧发生什么都返回
`{ text, source: 'llm' | 'template', code, reason }` 且 `text` 永不为空；页面据此显示「LLM / 模板」标记。
浏览器不直连模型，因此不存在 CORS 预检问题（同源）。

## 运行

不要单独起静态服务器（那样没有 API 也没有会话）：

```powershell
python scripts/e2e_server.py     # 库 + 迁移 + 服务，打开 http://127.0.0.1:8100
```

## 测试

```bash
npm run test:app-shell   # 结构、路由、题库、闸门与网络边界（禁止 fetch 出现在 api.js 之外）
npm run test:auth        # 凭证规则、错误码文案、Cookie/401 传输行为
npm run test:units       # 纯逻辑单元
npm run test:kb          # 知识块结构与 schema（种子导出：node scripts/export_kb_seed.mjs）
npm run test:scoring     # 计分对照
npm run test:memory report log chat games prototype units kb
# 或 npm run check（含 ESLint + Prettier）；浏览器层：npm run test:e2e
```

## L-08：报告与趋势

**报告页**：八维雷达 + 表格。已测维度画点连线，未测留空标「未测」，**不按 0 计**；
分数 0–100 整数，**不设总分、不做百分位、没有常模**；已测少于 3 个维度时不画多边形，避免误读成“塌陷”。
正式分数以服务端 `scoring-v3.2` 为准，`src/scoring/` 只作即时展示与对照（见 `src/scoring/README.md`）。

**与上次相比（报告页内区块）**：取本账号最近两次已完成测评；只比两次都测过的维度；间隔 <7 天提示练习效应但不禁止；
只有一次测评时给出**基线态**（本次各维度分数 +「下次复测起这里会显示变化」），不再摆空态；折线图至少三次记录才出现。
纯逻辑在 `pages/trend.js` 的 `buildCompareModel`，可无 DOM 测试。

**不做的**：不做人群比较、不拟合成长曲线、不把变化解释成训练效果。

## 已知限制

- 知觉速度 45 秒计时任务，刷新后重开计时（已完成 trial 保留）；
- 联想记忆刷新后重新进入学习阶段（草稿只保存再认阶段进度）；
- 图案题为固定题库，未做随机抽题与难度自适应；
- 游戏最佳分与测评前采集的年龄/教育仍是**设备级**（localStorage），换设备需要重填，不进报告；
- 未做流式输出、离线缓存与 PWA（免费实例冷启动慢，首屏会有一段等待）。

## 相关文档

- [Web 本地开发与测试](../../docs/software/local-development.md)
- [部署指南](../../docs/software/deploy-render.md)
- [ADR-0003 账号与托管决策](../../docs/adr/0003-web-accounts-and-hosted-deployment.md)
- [软件设计](../../docs/software/software.md)
