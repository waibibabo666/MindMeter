# MindMeter 软件设计

## 一、文档信息

| 项目 | 内容 |
| --- | --- |
| 文档编号 | MM-DES-002 |
| 版本 | v2.0 |
| 状态 | 完成（2026-10-24 八维决策后重写） |
| 文档负责人 | song |
| 评审人 | waibibabo666、xlr268、1213lz |
| 最后更新 | 2026-10-24 |
| 关联文档 | [功能需求规范](../requirements/functional_spec.md)、[算法设计](../algorithm/algorithm.md)、[技术方案](architecture.md) |

> 本文只保留软件设计的总览。技术选型、模块契约、AI/ASR、数据模型和排期的细节以[技术方案](architecture.md)为准，避免两份文档各写一套。

## 二、目标与约束

6 周内做一个**纯前端、本地存储、静态部署**的 Web 应用：

- 不建账号、不接数据库、不做后端接口；
- 8 个任务和报告都在浏览器里完成；
- 计分逻辑独立成模块，方便测试和复用；
- 支持快测 / 标准 / 深度三档（5 / 13 / 28 分钟）；
- AI 为可选 BYOK，默认关闭；ASR 仅用于言语流畅性；
- 静态托管即可上线，成本接近零。

## 三、架构

```text
浏览器
├─ 页面与任务（frontend）
├─ 计分模块（core_engine，纯函数）
├─ 可选 AI（frontend/ai，BYOK）
├─ 可选 ASR（Web Speech API）
└─ localStorage（sessions / draft / settings / practice）
        │
        ▼
静态托管（GitHub Pages，HTTPS）
```

`code/backend` 继续保留为空目录，但本期**不启用**；如果未来要做账号或跨设备同步，再单独评估。

## 四、模块划分

| 模块 | 职责 | 不做什么 |
| --- | --- | --- |
| `frontend/pages` | 首页、档位、同意、任务、报告、历史、设置 | 不实现计分公式 |
| `frontend/tasks` | 8 个任务的试次、计时、指标采集 | 不判定分数 |
| `frontend/ai` | BYOK 请求、模板、护栏、降级 | 不改分数、不发身份信息 |
| `frontend/practice` | 4 款补充练习（心算、舒尔特、翻牌、分类） | 不计分、不进报告 |
| `core_engine` | 8 维计分、缺失处理、版本 | 不操作 DOM、不发请求 |
| `storage` | 四类本地键读写与异常 | 不上传 |
| `backend` | 本期空目录 | 不实现 |

## 五、目录结构

```text
code/
├─ frontend/
│  ├─ index.html
│  └─ src/
│     ├─ main.js
│     ├─ pages/
│     ├─ tasks/            # vc, vf, nc, ps, ir, sv, am, ni
│     ├─ ai/               # byok.js, validate.js, templates.js
│     ├─ practice/         # math, schulte, flip, sort
│     ├─ storage.js
│     └─ styles/
├─ core_engine/
│  ├─ src/
│  │  ├─ scoring.js
│  │  └─ config.js
│  ├─ test/
│  │  └─ scoring.test.js
│  └─ README.md
└─ backend/
   └─ README.md            # 本期不启用
```

> 原型骨架在 `docs/software/prototype/index.html`，用于走通三档流程；正式实现按上面的目录落到 `code/`。

## 六、数据流

```text
任务作答
  → 每个任务输出原始指标
  → core_engine.scoreSession(results, tier)
  → { 八维分数, 缺失维度, scoringVersion }
  → 报告页渲染（无总分）
  → localStorage 追加 session
  → 历史页读取并对比共同维度
```

报告只依赖计分结果和静态文案，不依赖网络。AI 只影响“解释那段话”，不影响分数和图表。

## 七、本地存储

- `mindmeter.sessions.v1`：已完成测评；
- `mindmeter.draft.v1`：进行中的测评，每完成一个任务写一次；
- `mindmeter.settings.v1`：AI 开关、BYOK endpoint/model/key；
- `mindmeter.practice.v1`：4 款补充练习最佳纪录。

规则：

- 只存测评数据，不存姓名、手机号、身份证、学校、公司、年龄、学历；
- 不存 ASR 原始音频/转写文本；
- 写入失败（隐私模式/空间不足）要提示用户；
- 清除数据时同时删除四类键和 BYOK Key；
- 数据 schema 见[功能需求规范](../requirements/functional_spec.md)第八节。

## 八、部署

| 项目 | 方案 |
| --- | --- |
| 托管 | GitHub Pages（备选 Vercel/Netlify 免费额度） |
| 协议 | HTTPS |
| 构建 | 纯静态文件直接部署，无构建步骤 |
| 回滚 | 每周演示版本打 tag |
| 演示兜底 | 本地打开 `index.html` + 录屏视频 |
| AI/ASR | 需要网络；断网时回退模板/提示未测 |

## 九、关键取舍

- **不做后端**：省掉账号、数据库、接口联调和部署成本；代价是换设备不同步、清浏览器会丢数据，已在隐私提示中说明。
- **不做框架锁定**：原生 JS 足够支撑 8 个短任务；不引入构建链，答辩现场最稳。
- **计分独立**：即使页面重写，`core_engine` 的公式和测试仍可复用。
- **本地优先**：课程演示不依赖网络，降低现场故障风险。
- **AI 是增强**：BYOK、默认关闭、模板兜底；关掉 AI 报告仍完整。
- **不设总分**：三档维度不同，总分不可比；只给八维分数和共同维度复测。

## 十、与旧版的关系

- 2026-10-19 的 v1.0 软件设计（4 游戏、15 分钟、Vite/React 可选）已被本版取代；
- 2026-10-24 的 v1.1 技术方案（serverless 网关、账号/后端）已被[技术方案](architecture.md)取代；
- 旧版只保留在 git 历史中，不再作为实现依据。
