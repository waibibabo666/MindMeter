# AI 接入位说明（BYOK）

> 状态：**已留位，默认关闭；未配置 Key 时不发任何请求**
> 位置：`index.html` 报告页 / 设置页
> 更新：2026-10-24

---

## 1. 现在是什么状态

| 项目 | 状态 |
| --- | --- |
| 报告页「AI 解读」卡片 | ✅ 已占位（默认显示模板） |
| 设置页 BYOK 表单 | ✅ endpoint / model / key 三个字段 |
| 实际网络请求 | ❌ 未配置或 `settings.enabled = false` 时不发起 |
| 建议文案来源 | 本地规则表 `ADVICE`（8 个维度各 2 条，按最低的 1–2 个维度取 2–3 条） |
| 后端 | ❌ 不存在；没有 `server.py`、没有网关、没有云端 Key |

**当前行为**：报告页显示模板解读，下方标注“当前：模板解释（未开启 AI）”。

---

## 2. 接入位在哪

### 2.1 前端开关

`index.html` 中搜索 `let settings =`：

```js
let settings = Object.assign({
  enabled: false,          // 用户配置并勾选后才为 true
  endpoint: '',            // OpenAI-compatible /chat/completions
  model: '',               // 用户填写
  apiKey: ''               // 只存本机 localStorage
}, store.get(K.settings, {}));
```

### 2.2 三个已实现函数 + 一个待抽出

| 函数 | 职责 | 说明 |
| --- | --- | --- |
| `buildFacts(session)` | 从 session 组装 facts | 只含维度分、完成度、建议 ID、复测差值 |
| `callModel(facts, question)` | 发请求、解析、失败返回 `null` | 浏览器直连，无代理；校验目前内联 |
| `validate(text, facts)` | 结构/ID/数字/禁用词/长度校验 | **正式实现从 `callModel` 抽出**；骨架内联在 `callModel` |
| `renderAITemplate(session)` | 渲染 + 回退 | 失败时用模板；不是 `renderAdvice` |

**接入只需要两件事**：用户在设置页填 endpoint/model/key；`settings.enabled` 置 `true`。

---

## 3. 请求契约

`POST {endpoint}`，`Content-Type: application/json`，`Authorization: Bearer {apiKey}`

```json
{
  "model": "user-model",
  "messages": [
    { "role": "system", "content": "你是 MindMeter 的报告解释助手。只解释给定 facts，不算分、不诊断、不新增建议。" },
    { "role": "user", "content": "{\"task\":\"report\",\"dims\":[{\"id\":\"vc\",\"score\":62},{\"id\":\"am\",\"score\":60}],\"completed\":[\"vc\",\"ps\",\"sv\",\"am\"],\"adviceIds\":[\"adv_vc_01\",\"adv_am_02\"],\"retestDelta\":{\"ps\":4},\"constraints\":{\"maxChars\":200}}" }
  ],
  "temperature": 0.3,
  "max_tokens": 400
}
```

### 字段说明

| 字段 | 用途 | 缺了会怎样 |
| --- | --- | --- |
| `dims` | 八维分数（未测不传） | 只能泛泛而谈 |
| `completed` | 完成度 | 可能把“未测”说成“低分” |
| `adviceIds` | 固定建议 ID | 可能自创建议，校验会失败 |
| `retestDelta` | 共同维度差值 | 复测解释缺失 |
| `constraints` | 长度/禁诊断 | 输出不可控 |

**绝不发送**：姓名、手机号、年龄、学历、学校、公司、原始试次、ASR 文本。

---

## 4. 响应契约

```json
{
  "headline": "你的空间视觉化相对突出，联想记忆还有提升空间",
  "body": "这次你完成了标准档四项。……",
  "source": "model",
  "degraded": false
}
```

- `source`: `model` | `template`
- `degraded: true` 表示走了降级路径
- 前端只读 `headline/body/source`，其余字段忽略

---

## 5. 校验（五条）

1. JSON 结构合法，`headline/body` 是字符串；
2. 建议 ID 必须在池内，不新增建议；
3. 回答里的数字必须来自 facts；
4. 禁用词命中 0：诊断、治疗、治愈、疗效、正常、异常、提升智商、脑龄、抑郁、痴呆、ADHD；
5. 总长 ≤200 字，追问 ≤120 字。

> 原型骨架的 `callModel` 目前内联做结构/长度/禁用词校验；建议 ID 与数字来源校验在正式实现中抽成 `validate(text, facts)` 补齐。

不通过 → 重试一次 → 仍不通过 → 模板。

---

## 6. 降级行为

```
未配置 Key / 未开启        → 不发请求，模板 + “未开启 AI”
超时（8s）                → 模板 + “AI 暂不可用”
非 2xx / JSON 解析失败     → 模板
结构缺 headline/body       → 模板
命中禁用词                → 重试一次 → 模板
数字不在 facts 中          → 模板
endpoint 不支持 CORS       → 提示换 endpoint + 模板
```

**铁律：报告页永远不空。分数和图表是本地算的，只有“那段话”依赖 AI。**

---

## 7. 三条红线

1. **分数不由模型算** —— 模型只解释，不测量；
2. **不做疾病判断** —— 输出后扫描禁词；
3. **不虚构研究/数字** —— 提示词禁止编造，校验拦截 facts 之外的数字。

命中禁词/幻觉数字：丢弃输出，回退模板。

---

## 8. 隐私与安全

| 项 | 要求 |
| --- | --- |
| Key 存储 | 只存本机 `mindmeter.settings.v1`；不写日志、不进导出 |
| 公用设备 | 设置页提示“请勿在公用设备保存 Key” |
| 数据出境 | 仅用户主动开启后，发维度分与 facts；由用户选择的模型厂商处理 |
| 清除 | 清除数据时同时删除 Key |
| CORS | endpoint 必须支持浏览器 CORS；不支持则 AI 不可用，不绕过 |
| 无后端 | 项目组不托管 Key、不代理请求、不保存对话 |

---

## 9. 上线前检查清单

- [ ] 默认 `settings.enabled = false`
- [ ] 未配置 Key 时，网络面板无 AI 请求
- [ ] Key 只在 localStorage，仓库/日志/导出里搜不到
- [ ] 断网、超时、500、越界词四种情况都回退模板
- [ ] 报告页首屏不依赖 AI（先出分数和雷达图）
- [ ] 请求体不含身份/人口学/原始试次/ASR 文本
- [ ] 输出禁词/数字/长度校验生效
- [ ] 清除数据后 Key 也被删除
- [ ] 页面提示“AI 生成·非诊断·可关闭”

---

## 10. 相关文件

| 文件 | 作用 |
| --- | --- |
| `index.html` | 前端接入位（`settings`、`buildFacts`、`callModel`、`renderAITemplate`） |
| `../requirements/xlragentdesign.md` | AI 功能与边界 |
| `../../algorithm/algorithm.md` | 八维计分与 facts 来源 |
| `../../software/architecture.md` | 无后端/BYOK 架构 |

> 没有 `server.py`，没有 `mindmeter-v3.html`，没有 serverless 网关。旧文档中的这些引用已删除。
