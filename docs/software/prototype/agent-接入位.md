# AI 教练接入位说明

> 状态：**已留位，未接入**
> 位置：`mindmeter-v3.html` 报告页 P5
> 更新：2026-10-24

---

## 1. 现在是什么状态

| 项目 | 状态 |
| --- | --- |
| 报告页「AI 教练」卡片 | ✅ 已占位（虚线框，按钮置灰） |
| 前端请求逻辑 | ✅ 已写好，但被开关关闭 |
| 实际网络请求 | ❌ 不发起（`AGENT.enabled = false`） |
| 建议文案来源 | 本地规则表 `ADVICE`（4 条，按最弱维度触发） |

**当前行为**：报告页建议区块显示本地文案，下方标注「当前：本地规则文案（未接入 AI）」。

---

## 2. 接入位在哪

### 2.1 前端开关

`mindmeter-v3.html` 中搜索 `const AGENT`：

```js
const AGENT = {
  enabled: false,              // ← 改成 true 即启用
  endpoint: '/api/advice',     // ← 换成自己的后端地址
  timeoutMs: 8000,
  maxCallsPerDay: 5            // 仅提示，真正限流应在后端
};
```

### 2.2 三个函数

| 函数 | 职责 | 接入后要改吗 |
| --- | --- | --- |
| `buildProfile()` | 组装用户档案 | 否，按契约给全即可 |
| `fetchAgentAdvice(profile)` | 发请求、解析、失败返回 `null` | 否，只要后端符合契约 |
| `loadAdvice()` | 调用 + 渲染 + 回退 | 否 |

**所以接入只需要两件事：把 `enabled` 改 `true`，让 `endpoint` 有个真实服务。**

---

## 3. 请求契约

`POST {endpoint}`，`Content-Type: application/json`

```json
{
  "scores": { "wm": 62, "ic": 41, "ps": 78, "em": 55 },
  "raw": {
    "corsi": { "span": 6, "pass": 4, "total": 6, "acc": 0.67 },
    "gn":    { "goAcc": 0.93, "nogoAcc": 0.73, "commRate": 0.27, "commission": 4, "nogoTotal": 15 },
    "srt":   { "median": 318, "iqr": 64, "misses": 1, "n": 29 },
    "rec":   { "dprime": 1.82, "hits": 13, "fa": 2, "n": 16 }
  },
  "demographics": { "age_band": "18-24", "edu": "本科" },
  "state": { "sleep_h": "5-6", "energy": 2, "caffeine": false },
  "self_report": { "memory": 2 },
  "reliability": "中",
  "history": [ { "t": 1730000000000, "total": 58, "wm": 58, "ic": 45, "ps": 75, "em": 52 } ],
  "practice": { "schulte_normal": 74, "flip_easy": 82 },
  "session_type": "full"
}
```

### 字段用途（缺了哪项，建议质量会掉）

| 字段 | 缺了会怎样 |
| --- | --- |
| `raw` | 只能看到 0–100 的分数，说不出 d′、误报率这些细节 |
| `reliability` | 会拿「只睡 5 小时」的成绩下确定结论 |
| `history` | 说不出「比上周降了 4 分」 |
| `practice` | 会推荐用户已经在玩的东西 |
| `state` | 无法解释偏差来源 |

---

## 4. 响应契约

```json
{
  "headline": "你的反应速度很好，抑制控制是短板",
  "advice": {
    "focus": "抑制控制",
    "action": "每天 5 分钟反向指令练习",
    "how": "看到向上点向下，3 组 × 20 次",
    "when": "状态放松时"
  },
  "caveat": "本次睡眠不足 6 小时，抑制控制可能被低估",
  "source": "model",
  "degraded": false
}
```

- `source`: `model` | `rule`
- `degraded: true` 表示走了降级路径
- **前端只读 `advice.action/how/when`、`caveat`、`source`**，其余字段可扩展

---

## 5. 开启步骤

1. **准备后端**：`server.py` 已有 `/api/advice` 实现，改造成接收上述完整档案
2. **配置 Key**：环境变量 `DEEPSEEK_API_KEY`（或其他模型）
3. **改开关**：`AGENT.enabled = true`
4. **改地址**：如果后端不在同域，`AGENT.endpoint` 写成完整 URL，并配置 CORS
5. **验证降级**：断网跑一次，确认回退到本地文案而不是空白

---

## 6. 降级行为（已实现，不要改坏）

```
enabled = false          → 不发请求，显示本地文案 + 提示「未接入 AI」
请求超时（8s）            → 回退本地文案 + 提示「AI 暂不可用」
非 2xx / JSON 解析失败     → 同上
返回结构缺 advice         → 同上
```

**铁律：报告页永远不空。** 分数和图表是本地算的，只有「那段话」依赖 AI。

---

## 7. 三条红线（写进提示词，也要在代码里验）

1. **分数不由模型算** —— 模型只解释，不测量
2. **不做疾病判断** —— 输出后扫描禁词：诊断、治疗、痴呆、抑郁、治愈、疗效
3. **不虚构研究** —— 提示词明确禁止编造文献与数据

命中禁词时的处理：直接丢弃模型输出，回退规则文案。（`server.py` 里已有实现）

---

## 8. 上线前检查清单

- [ ] `AGENT.enabled` 在生产环境为 `true`
- [ ] API Key 只在后端环境变量，前端 bundle 里搜不到
- [ ] 断网、超时、500 三种情况都回退正常
- [ ] 报告页首屏不依赖 AI（先出分数和雷达图）
- [ ] 同一用户连续点击不会重复计费（后端缓存或前端节流）
- [ ] 输出禁词扫描生效
- [ ] 隐私政策里写明「认知数据会发送至第三方模型服务」

---

## 9. 以后升级成对话式 agent 的路径

当前是「单轮 + 结构化输出」。要升级时，按顺序做：

| 阶段 | 增加什么 | 前置条件 |
| --- | --- | --- |
| 1 | 工具调用：`get_history` / `search_exercises` / `save_plan` | 有训练库 |
| 2 | 多轮对话入口 | 单轮质量稳定 |
| 3 | 计划持久化与打卡 | 有用户体系 |

**不要跳过阶段 1 直接做对话。** 对话会放大所有质量问题。

---

## 10. 相关文件

| 文件 | 作用 |
| --- | --- |
| `mindmeter-v3.html` | 前端接入位（`AGENT`、`buildProfile`、`fetchAgentAdvice`） |
| `server.py` | 后端示例实现（零依赖，可跑） |
| `维度依据调研.md` | 计分口径依据（scoring-v2） |
