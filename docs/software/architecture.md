# MindMeter 技术方案

## 一、文档信息

| 项目 | 内容 |
| --- | --- |
| 文档编号 | MM-DES-008 |
| 版本 | v3.0 |
| 状态 | 完成（2026-10-24 八维决策后重写） |
| 编写 | xlr268 |
| 负责人 | song |
| 评审人 | waibibabo666、1213lz |
| 最后更新 | 2026-10-24 |
| 上游 | [功能需求](../requirements/functional_spec.md)、[非功能需求](../requirements/nonfunctional_spec.md) |
| 关联 | [算法设计](../algorithm/algorithm.md)、[原型说明](../software/prototype/prototype.md) |

> 本版取代 2026-10-19 的软件设计与 2026-10-24 的 v1.1 技术方案。旧文档中的 Vite/React、serverless 网关、账号/后端方案不再适用。

## 二、摘要

| 决策 | 结论 | 理由 |
| --- | --- | --- |
| 前端 | 原生 HTML/CSS/JS，无构建 | 8 个任务、无路由；计时比渲染重要；答辩现场可双击打开 |
| 计分 | 独立纯函数 + `node:test` | 可复现、可单测、与 UI 解耦 |
| 存储 | `localStorage`，存任务级结果和 draft | 无账号、不出设备；断点恢复需要 |
| 部署 | GitHub Pages | 零成本、可回滚、断网可演示 |
| AI | 用户自带 Key（BYOK），浏览器直连 | 不自建后端、不代管 Key、不保存用户数据 |
| ASR | 浏览器 Web Speech API | 语言流畅性需要口头作答；不引入音频存储 |
| 总分 | 不设 | 三档维度不同，跨档不可比；避免被读成智商 |

## 三、约束

| 约束 | 数值 | 影响 |
| --- | --- | --- |
| 人力 | 4 人兼职 | 不做后端、不做常模、不做多语言 |
| 周期 | 6 周 | 8 项任务必须分档交付 |
| 时长 | 快测 5 / 标准 13 / 深度 28 分钟 | 每项任务 2–5 分钟 |
| 成本 | 近零 | 静态托管；AI 由用户付费 |
| 合规 | 非医疗器械、18+、不收集身份信息 | 数据本地；AI/ASR 可关闭 |
| 兼容 | Chrome/Edge/Safari 近两版，360–1920px | ASR 仅 Chrome/Edge |

## 四、技术选型

### 4.1 前端

| 维度 | 原生 JS | Vite+React | Vite+Vue | Next.js |
| --- | --- | --- | --- | --- |
| 学习成本 | 低 | 中 | 中 | 高 |
| 构建 | 无 | 需要 | 需要 | 需要运行时 |
| 计时适配 | 好 | 一般 | 一般 | 一般 |
| 演示风险 | 低 | 中 | 中 | 高 |

**结论：原生 JS。** 核心是毫秒级计时和 8 个短任务，不是复杂页面状态；6 周内不引入构建链。

### 4.2 存储

| 方案 | 结论 | 理由 |
| --- | --- | --- |
| `localStorage` | ✅ | 同步、简单；任务级结果和 draft 够用 |
| IndexedDB | ❌ | 异步复杂，需求未到 |
| 后端库 | ❌ | 要账号/运维，与“数据不出设备”冲突 |

### 4.3 部署

GitHub Pages；每周演示版本打 tag；回滚即切 tag；断网时本地文件 + 录屏兜底。

## 五、架构

### 5.1 模块

| 模块 | 职责 | 红线 |
| --- | --- | --- |
| `pages` | 首页、档位、同意、任务、报告、历史、设置 | 不写计分 |
| `tasks` | 8 个任务的试次控制、计时、指标采集 | 不判定分数 |
| `core_engine` | 8 维计分、缺失处理、版本 | 不碰 DOM、不发请求 |
| `ai` | BYOK 请求、模板、护栏、降级 | 不改分数、不改结论集合 |
| `storage` | sessions/draft/settings/practice 读写 | 不上传 |
| `practice` | 4 款补充练习（心算、舒尔特、翻牌、分类） | 不计分、不进报告 |

### 5.2 数据流

```text
任务作答
  → 原始指标
  → core_engine.scoreSession()
  → { 八维分数, 缺失标记, scoringVersion }
  → 报告页（无总分）
  → localStorage 追加 session
  → 历史页 / 复测对比

AI（可选，默认关）
  → buildFacts(八维分数 + 建议 ID + 复测差值)
  → 用户 BYOK endpoint
  → validate(禁用词/数字/长度)
  → 通过则展示；失败/超时 → 模板
```

### 5.3 目录

```text
code/
├─ frontend/
│  ├─ index.html
│  └─ src/
│     ├─ main.js
│     ├─ pages/            # 首页、档位、同意、报告、历史、设置
│     ├─ tasks/            # vc, vf, nc, ps, ir, sv, am, ni
│     ├─ ai/               # byok.js, validate.js, templates.js
│     ├─ storage.js
│     ├─ practice/         # math, schulte, flip, sort
│     └─ styles/
├─ core_engine/
│  ├─ src/scoring.js
│  ├─ src/config.js
│  └─ test/scoring.test.js
├─ ai/                     # 预留：仅类型/契约文档，不部署服务
│  └─ README.md
└─ backend/                # 本期空目录，不启用
   └─ README.md
```

> `code/ai/` 只放契约与校验说明，**不是后端**；实际请求在 `frontend/src/ai/byok.js` 中由浏览器发起。

## 六、数据模型

```json
{
  "schemaVersion": 1,
  "scoringVersion": "scoring-v3",
  "sessions": [
    {
      "id": "s_20261024_1",
      "tier": "deep",
      "startedAt": "2026-10-24T20:00:00+08:00",
      "finishedAt": "2026-10-24T20:28:00+08:00",
      "scores": {
        "vc": 62, "vf": 55, "nc": 70, "ps": 68,
        "ir": 51, "sv": 74, "am": 60, "ni": 66
      },
      "tasks": {
        "vc": { "status": "done", "correct": 9, "total": 15 },
        "vf": { "status": "done", "validCount": 21 },
        "am": { "status": "done", "hits": 9, "falseAlarms": 3 }
      },
      "ai": { "enabled": false, "model": null }
    }
  ]
}
```

| 键 | 用途 | 生命周期 |
| --- | --- | --- |
| `mindmeter.sessions.v1` | 已完成测评 | 用户清除 |
| `mindmeter.draft.v1` | 进行中的测评 | 完成/退出/24h 过期 |
| `mindmeter.settings.v1` | AI 开关、BYOK endpoint/model/key | 用户清除 |
| `mindmeter.practice.v1` | 4 款补充练习最佳纪录 | 用户清除 |

规则：

- 只存测评数据；不存姓名、手机、身份证、学校、公司、年龄、学历；
- 不存 ASR 原始音频/转写文本；
- 每条记录写 `scoringVersion`；
- 清除数据同时删除四类键和 BYOK Key。

## 七、模块契约

| 函数 | 输入 | 输出 | 失败 |
| --- | --- | --- | --- |
| `scoreSession(results, tier)` | 8 个任务的原始指标 | `{ scores: {vc...ni: number|null}, missing: string[], version }` | 缺数据返回 `null` 维度 |
| `buildFacts(session)` | session | `{ dims, adviceIds, retestDelta, completed }` | 数据不足标记 `complete: false` |
| `readSessions()` | — | 数组 | 解析失败返回空数组 |
| `appendSession(s)` | session | `true/false` | 存储失败返回 false |
| `callModel(facts, question)` | facts + 用户问题 + BYOK 配置 | 文本 JSON | 超时/异常返回 `null`，由上层降级 |
| `validate(text, facts)` | 文本 + facts | `{ ok, reason }` | 任何异常视为不通过 |
| `renderAITemplate(session)` | session | 模板文本 | 永远可渲染 |

## 八、AI 方案（BYOK）

### 8.1 边界

AI 只做三件事：

1. **报告解读**：把八维分数和完成度写成人话；
2. **追问回答**：回答“为什么这项低/这项什么意思”；
3. **复测解释**：解释两次共同维度的变化，不判断进步/退步。

不做：两周计划、理解度复盘、AI 自检、语音多模态、AI 判分、AI 选维度。

### 8.2 两种形态

| 形态 | 做法 | 数据 |
| --- | --- | --- |
| A 模板（默认） | 本地模板 + 固定建议库 | 不出设备 |
| B BYOK（可选） | 用户填 endpoint/model/key，浏览器直连 | 只发维度分、建议 ID、复测差值、完成度 |

B 的硬要求：

- 默认关闭；用户主动开启并确认“分数会发送到模型服务”；
- Key 只存本机 `localStorage`，页面提示“公用设备不要保存”；
- 只发维度分与 facts，不发身份、人口学、原始试次、ASR 文本；
- 超时 8 秒、限流、空返回、命中禁用词 → 模板；
- 模型输出必须通过结构/ID/数字/长度校验；不通过不展示。

### 8.3 请求/响应

请求：

```json
{
  "task": "report",
  "locale": "zh-CN",
  "dims": [
    { "id": "vc", "score": 62, "band": "mid" },
    { "id": "am", "score": 60, "band": "mid" }
  ],
  "completed": ["vc", "ps", "sv", "am"],
  "adviceIds": ["adv_vc_01", "adv_am_02"],
  "retestDelta": { "ps": 4, "am": -2 },
  "constraints": { "noDiagnosis": true, "maxChars": 200 }
}
```

响应：

```json
{
  "headline": "你的空间视觉化相对突出，联想记忆还有提升空间",
  "body": "……",
  "source": "model",
  "degraded": false
}
```

### 8.4 降级

| 情况 | 处理 |
| --- | --- |
| 未配置 Key / 未开启 | 不发请求，显示模板 |
| 超时 / 限流 / 空返回 | 模板 |
| 命中禁用词 | 重试一次 → 模板 |
| 返回结构不合法 | 模板 |
| 断网 | 模板 |

**铁律：报告页永远不空；AI 出错只影响措辞，不影响分数。**

## 九、ASR 方案

- 言语流畅性使用浏览器 `SpeechRecognition`（Chrome/Edge）；
- 用户点击“开始录音”并授权麦克风后开始 60 秒计时；
- 只把识别文本用于计数，不落库、不上传项目服务器；
- 浏览器不支持/拒绝麦克风：显示“快测不可用，建议标准档；深度档该维度记未测”；
- 不提供键盘替代，避免把输入速度混入分数；
- 页面明确提示：语音识别可能由浏览器厂商处理。

## 十、质量保障

| 层级 | 内容 | 门槛 |
| --- | --- | --- |
| 单元测试 | 8 个公式：正常/边界/缺失 | ≥24 例全绿 |
| 集成 | 快测/标准/深度完整跑通 | 无控制台报错 |
| 断点 | 每任务写 draft，刷新恢复 | 已完成任务不丢 |
| 用户测试 | 10–15 人 | 完成率 85/80/60 |
| 手动走查 | 真机 + 断网 + 隐私模式 | 无阻断问题 |
| AI | 20 条人工评分 | 准确/有用/无越界各 ≥4/5 |
| ASR | Chrome/Edge 各 5 次 | 识别可用；失败有提示 |

## 十一、性能预算

| 指标 | 目标 | 测法 |
| --- | --- | --- |
| 首屏（4G） | ≤3 秒 | Lighthouse |
| 点击反馈 | ≤100ms | `performance.now` + rAF |
| 单任务计分 | ≤100ms | 计时 |
| 模板报告 | ≤1 秒 | 计时 |
| AI 报告 | ≤8 秒 | 计时，超时降级 |
| 存储写入 | ≤50ms | 计时 |

## 十二、安全与隐私

| 项 | 措施 |
| --- | --- |
| 密钥 | 仓库零密钥；BYOK Key 只存用户本机；不写日志 |
| 数据 | 只存本地；不上传原始试次/ASR 文本 |
| 依赖 | 零第三方依赖，无供应链风险 |
| 传输 | HTTPS；AI 请求直连用户配置的 endpoint |
| 清除 | 一键清除 sessions/draft/settings（含 Key）/practice |
| 合规 | 18+、非诊断、非常模；报告固定声明 |

## 十三、技术风险

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 移动端点击延迟 | 污染反应时 | `touch-action: manipulation`，统一 `pointerdown` |
| 后台节流 | 试次错乱 | 监听 `visibilitychange`，切回重置当前试次 |
| 存储不可用 | 静默丢数据 | `try/catch` + 明确提示 |
| ASR 不稳定 | 言语流畅性缺测 | 明确提示；深度档记“未测” |
| BYOK Key 泄露 | 用户模型账户风险 | 本机存储、提示公用设备勿用、可一键清除 |
| 模型幻觉 | 编造数字 | 数字比对 + ID 校验 + 模板兜底 |
| 无常模 | 无法给百分位 | 只做维度分与自身复测 |
| 8 任务做不完 | 深度档延期 | 先保快测/标准；深度档可标“后续版本” |

## 十四、排期

| 周 | 目标 | 判定 |
| --- | --- | --- |
| W1 | 8 项任务定义、三档规则、计分口径 | 团队确认 |
| W2 | 原型骨架、8 任务路由、存储 schema | 三档流程可点 |
| W3 | 快测 2 项 + 标准 4 项、core_engine（含 ASR 最小实现） | 快测/标准可跑通 |
| W4 | 深度档补齐 4 项 + 八维报告 + 历史 | 深度可跑通 |
| W5 | BYOK、ASR 调优、用户测试、缺陷修复 | 完成率达标 |
| W6 | 冻结、部署、答辩材料 | 线上可访问 |

> 如果 W4 深度档未完成，W5 只做快测/标准；答辩演示稳定路径，深度档标“后续版本”。这是明确的降级方案，不临时改口径。

## 十五、明确不做

- 账号、后端、云数据库、跨设备同步；
- 引入 React/Vue/构建链；
- 自建常模与百分位；
- AI 判分、AI 自适应出题、两周计划、理解度复盘、AI 自检、语音多模态；
- 工作记忆、抑制控制、认知灵活性任务；
- 多语言、B 端、付费。
