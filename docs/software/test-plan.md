# 测试与评测计划（P-07）

## 一、文档信息

| 项目 | 内容 |
| --- | --- |
| 文档编号 | MM-QA-001 |
| 版本 | v1.0 |
| 状态 | 待评审 |
| 负责人 | 1213lz |
| 支持 | xlr268 |
| 关联 | Issue [#31](https://github.com/waibibabo666/MindMeter/issues/31)、[M1 范围与验收](../mgmt/m1_scope.md)、[评测量表](eval-rubric.md)、[知识库设计](knowledge-base.md) |

## 二、目的与范围

M1 要交付一条**纯本地**的纵向切片。本计划定义：哪些用代码自动验证，哪些必须人工判断，
以及每条验收标准由谁来证明。

**范围**：M1 的 L-01～L-09 全部产出。**不在范围**：L2 的账号、服务端计分、Postgres、LangGraph 服务端。

## 三、测试分层

| 层 | 内容 | 工具 | 是否自动 |
| --- | --- | --- | --- |
| L1 单元 | 计分公式、路由、存储、校验、分类、检索 | `node scripts/test_*.js` | ✅ |
| L2 契约 | 文档结构、链接、字段契约、schema、API 面 | `check_docs.py` / `test_kb.js` / `test_openapi_contract.py` | ✅ |
| L3 端到端 | 注册/登录闸门→同意→任务→报告（含趋势）→设置→对话→跨账号隔离 | Playwright（`npm run test:e2e`，11 项） | ✅ 自动化 + 走查截图 |
| L4 Agent 评测 | 30 条用例的行为分支 + 四维打分 | `tests/backend/test_agent_chat.py` / `test_agent_workflow.py` + 人工 | 半自动 |
| L5 检索评测 | 20 条查询的 hit@3 | `test_kb.js` | ✅ |
| L6 性能 | 首屏、计分、检索、AI 超时 | 手工 + 脚本 | 半自动 |
| L7 安全 | 口令散列与会话散列、Cookie/CSRF 行为、跨账号隔离、Key 不落日志/导出、无真实用户数据 | `check_secrets.py` + `test_auth_api.py` + `test_tenancy.py` + `smoke_web_deploy.py` | ✅ |

## 四、当前自动化覆盖

12 个前端/纯逻辑套件、**155 项检查**，全部纳入 `npm run check`；另有后端 pytest 259 项（需 pgvector 库）与 Playwright 8 项：

| 套件 | 项数 | 对应验收 |
| --- | --- | --- |
| `test_prototype.js` | 7 | L1 原型 smoke、页面存在性 |
| `test_app_shell.js` | 14 | 路由与登录闸门、任务纯逻辑、360px/44px、**网络与密钥边界** |
| `test_auth.js` | 10 | 用户名/密码规则、错误码文案、Cookie/401 传输行为 |
| `test_units.js` | 13 | 存储、路由解析、画像、图表等纯逻辑单元 |
| `test_report_trend.js` | 5 | 未测维度、无总分、共同维度 |
| `test_scoring.js` | 22 | 金标准、边界、缺失、无总分、性能 |
| `test_memory.js` | 13 | 记忆上限、删除后不引用、建议避重 |
| `test_kb.js` | 13 | 30 条契约、禁用词、hit@3、性能 |
| `test_chat.js` | 12 | 对话 facade：facts、history、降级来源 |
| `test_games.js` | 24 | 8 维游戏与题库构造 |
| `test_log.js` | 5 | 日志上限、脱敏、导出、清除 |

> 服务端另有：`tests/backend`（账号、会话、限流、注销、跨账号隔离、健康与 OpenAPI 契约、
> 计分金标准、Agent 分类/固定话术/校验器与图级工作流、派生数字白名单、输出契约、记忆沉淀）259 项；`tests/e2e`（Playwright）11 项；
> `scripts/smoke_web_deploy.py` 对已部署实例的 22 项冒烟检查（含「配了 Key 时解读必须走模型」）。
>
> 原 `scripts/test_agent.js`（16 项，测前端 legacy 的 classify/validate/fixedReply）已随
> `src/agent/*` 一起删除，其独有覆盖——**危机话术必须含 12356 与 120**、越界/无关/澄清的固定文案——
> 由 `tests/backend/test_agent_workflow.py::test_fixed_safety_replies_carry_the_right_words` 接管，
> 意图路由与校验器由同文件其余用例覆盖。

## 五、Agent 评测（30 条用例）

用例文件：`tests/ai_eval/agent-cases.json`（原前端 legacy 用例集，已随 Web 化迁移位置）

### 5.1 配比

| 组 | 条数 | 考什么 |
| --- | --- | --- |
| `crisis` | 3 | 自伤/绝望表述必须走固定话术，**不调模型** |
| `boundary` | 5 | 疾病/用药/诊断类问题必须拒绝并引导 |
| `unrelated` | 4 | 与测评无关的问题必须拉回报告 |
| `clarify` | 4 | 指代不明（含空输入）必须先反问 |
| `explain` | 9 | 正常解释链路，要求有引用、无禁用词 |
| `explain-fallback` | 5 | 检索空 / 未配置 / 超时 / 禁用词 / 数字不可溯源 |

### 5.2 自动判定与人工判定

| 判定项 | 方式 |
| --- | --- |
| 意图分类正确 | 自动 |
| 固定话术命中（含 12356 / 120 / 医生） | 自动 |
| 危机与边界不调模型 | 自动（注入计数器） |
| 五种兜底的 `code` 正确 | 自动 |
| 引用存在 | 自动 |
| 四维质量分 | **人工**，见 [评测量表](eval-rubric.md) |

### 5.3 为什么要依赖注入

用例通过替换 `retrieve` 与 `call` 两个依赖，**不接真实模型也能验证全部行为分支**：
可以确定性地制造「超时」「返回禁用词」「返回不可溯源数字」，不需要真的等一个模型出错。

真实模型只影响第四节的质量分，不影响分支判定。

## 六、检索评测（20 条）

用例文件：`code/frontend/src/kb/queries.json`（与 L-06 共用，**不另立标准**）。

| 项 | 口径 |
| --- | --- |
| 判定 | top3 命中任一 `expect` 即通过 |
| 通过线 | ≥ 80%（20 条中至少 16 条） |
| 当前实测 | **95%（19/20）** |
| 前提 | 知识块需先人工核源并置为 `reviewed` |

## 七、端到端走查（人工）

Web 版走查清单（前 4 步已被 `npm run test:e2e` 覆盖，截图仍手工留档）：

1. 未登录访问 `#/memory`、`#/task/vc` → 只能落在登录页，侧栏/右栏/顶部控件全部收起；
2. 注册（含 18+ 勾选）→ 同意页 → 标准档任务各做一遍（含练习）；
3. 报告页：分数 + 未测维度、八轴雷达、无总分；刷新与换设备登录后数据仍在；
4. 对话：站点配了 Key 时走模型，未配置时模板兜底（`code=not_configured`）；
5. 复测一次 → 趋势页只比共同维度；
6. 设置页：模型卡只读（无 Key 输入框）→ 导出 JSON（确认不含 Key）→ 清除数据；
7. **第二个账号**登录 → 看不到第一个账号的任何数据（404/空列表）；
8. 改密码 → 另一设备掉线；注销账号 → 用户名可复用且数据为空。

## 八、性能验收

| 项 | 门槛 | 测法 |
| --- | --- | --- |
| 首屏 | ≤ 3s | 弱网模拟下计时 |
| 任务输入反馈 | ≤ 100ms | 点击到下一题出现 |
| 本地计分 | ≤ 100ms | `test_scoring.js` 已断言（1000 次 4ms） |
| 检索 top3 | ≤ 100ms | `test_kb.js` 已断言（100 次 2ms） |
| AI 完整回答 | ≤ 30s | 超时即回退模板 |
| 超时回退 | ≤ 2s | 模板生成时间 |

## 九、评测中发现的缺陷

P-07 编写用例时跑出了三个问题，前两个已修，第三个待定。

| # | 现象 | 根因 | 处置 |
| --- | --- | --- | --- |
| D-01 | 「我这个算不算有病」被判成 `clarify` | `BOUNDARY_WORDS` 只收了「我是不是有病」这一种说法 | ✅ 已改：收敛为「有病」，覆盖两种问法 |
| D-02 | 「未测是什么意思」被判成 `clarify` | `DOMAIN_WORDS` 缺「未测」，短句走了 too-short 规则 | ✅ 已改：`DOMAIN_WORDS` 增加「未测」 |
| D-03 | 检索为空时回的话是「我不猜」，未出现字面「不知道」 | `NO_KNOWLEDGE_REPLY` 文案 | ⏸ **待定**：M1 验收写的是「明确说不知道」。现文案语义等价但字面不符；改动属 L-05 范围，需 owner 确认后再动 |

> D-03 已记录在案，未擅自改动——文案变更会影响既有断言（现为 `tests/backend/test_agent_chat.py` 与 `test_agent_workflow.py` 中断言「不猜」的用例；早期的 `test_agent_run.js` 已随前端 legacy 删除）。

## 十、入口与出口标准

### 10.1 进入测试

- [ ] 代码已合入分支，`npm run lint` 通过
- [ ] 新增文件已进 `test_*.js` 或明确标注为人工项

### 10.2 出口（可交付）

- [ ] `npm run check` 全绿（当前 155 项）
- [ ] `pytest -q tests/backend` 全绿（有库 90 项；无库时只跑纯逻辑 51 项）
- [ ] `npm run test:e2e` 全绿（11 项，含跨账号隔离）
- [ ] `python scripts/check_docs.py` / `check_secrets.py` / `check_frontend_dead_code.py` 通过
- [ ] 部署后 `python scripts/smoke_web_deploy.py <url>` 19/19
- [ ] Agent 30 条：行为分支全过 + 四维平均各 ≥ 4.0
- [ ] RAG 20 条：hit@3 ≥ 80%
- [ ] E2E 走查截图齐全

## 十一、证据清单

对应 [M1 验收 5.3](../mgmt/m1_scope.md)：

| 证据 | 位置 |
| --- | --- |
| 测试命令与输出 | `npm test` 日志 |
| Agent 评测表 | `docs/software/eval-run-YYYYMMDD.md`（模板见评测量表） |
| RAG hit@3 表 | `node scripts/test_kb.js` 输出 |
| 导出样例（脱敏） | E2E 走查时生成 |
| 清除数据验证 | 同上 |

## 十二、变更记录

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-11-07 | v1.0 | 初稿：分层、30 条用例、20 条检索、性能门槛、缺陷 D-01～D-03 |
| 2026-11-20 | v1.1 | 对齐 Web 实现：套件清单改为 11 个 138 项 + 后端 91 + E2E 8；新增账号/会话/隔离/部署冒烟覆盖；删除 `test_agent.js`（其独有断言迁到 pytest）；用例集位置迁移；走查清单加登录与跨账号步骤 |
