# 错误处理约定（L-01 增强）

## 一、文档信息

| 项目 | 内容 |
| --- | --- |
| 文档编号 | MM-DES-005 |
| 版本 | v1.0 |
| 状态 | 当前 |
| 负责人 | 1213lz |
| 关联 | [功能需求](../requirements/functional_spec.md)、[测试与评测计划](test-plan.md) |

## 二、原则

1. **不白屏**：任何一层抛错，用户至少能看到一句人话和一个出口。
2. **不吞错**：兜底不等于静默，错误一律经 `reportError()` 上报。
3. **不阻断主流程**：次要环节（计分、模型解读）失败时，原始作答与报告结构照常保留。
4. **不暴露技术细节**：用户看到错误码与建议，不看到堆栈、对象名、英文异常。

## 三、错误分级

| 级别 | 含义 | 处理 |
| --- | --- | --- |
| 致命 | 页面根本渲染不出来 | 切到错误页，提供「返回首页 / 重试」 |
| 可降级 | 某个功能失败，但主流程还能走 | 用模板或空值兜底 + toast 提示 |
| 可忽略 | 只影响体验细节 | 记日志，不打扰用户 |

M1 里没有「重试队列」和「自动恢复」——本地应用没这个必要。

## 四、错误码表

全部定义在 [`code/frontend/src/errors.js`](../../code/frontend/src/errors.js) 的 `ERROR_CODES`。

| 错误码 | 触发场景 | 用户看到 | 降级行为 |
| --- | --- | --- | --- |
| `render_failed` | 某页渲染函数抛错 | 「页面没能正常显示」 | 切到错误页 |
| `storage_unavailable` | 无痕模式 / 禁用 localStorage | 「浏览器不允许保存数据」 | 转内存存储，页面可用 |
| `storage_quota` | 写入超配额 | 「本地存储空间不足」 | 提示导出后清理 |
| `scoring_failed` | 计分函数抛错 | 「这次的结果没能算出来」 | 分数留空，原始作答保留 |
| `llm_timeout` | 模型调用超时 | 「模型响应超时」 | 回退模板解释 |
| `llm_network` | 连不上 endpoint | 「连不上你配置的模型接口」 | 回退模板解释 |
| `llm_http` | 非 2xx 响应 | 「模型接口返回了错误」 | 回退模板解释 |
| `llm_auth` | Key 无效 / 无权限 | 「Key 或权限不对」 | 回退模板解释 |
| `unknown` | 其他 | 「出了点意外」 | 记日志 |

> `llm_*` 四类由 `llm/client.js` 抛出的 `LlmError.code` 映射而来，映射逻辑在 `classifyError()`。

## 五、三层兜底

```
第一层  渲染兜底    safeRender()  →  错误页
第二层  全局兜底    window.error / unhandledrejection  →  toast + 日志
第三层  业务兜底    计分失败留空、模型失败回退模板
```

### 5.1 渲染兜底

路由统一经 `safeRender()` 调用页面渲染函数：

```js
safeRender(handler, { root, ctx, param, fallback: renderErrorPage, onError });
```

渲染抛错 → 调用 `renderErrorPage`，页面显示错误码与两个按钮，**不会留下半渲染的残局**。

### 5.2 全局兜底

`app.js` 注册两个监听：

```js
window.addEventListener('error', ...)              // 同步异常
window.addEventListener('unhandledrejection', ...) // 未捕获的 Promise 拒绝
```

两者都只做两件事：记日志、弹一条 toast。**不弹模态框**——用户可能正在答题，打断代价更大。

### 5.3 业务兜底

| 环节 | 兜底方式 |
| --- | --- |
| 本地存储不可用 | 降级为内存对象，页面继续可用，仅提示刷新会丢 |
| 计分失败 | `safeScores()` 返回 `null`，会话照常保存 |
| 模型不可用 | 回退 `templateExplanation()`，报告永不空白 |

## 六、不做什么

- **不展示堆栈**：用户看不懂，且可能泄露内部结构；
- **不做自动重试**：本地模型调用失败多为配置问题，自动重试只会拖慢；
- **不静默失败**：哪怕用户看不到，也必须进 console；
- **不把错误当文案**：错误码只给开发看，用户看的是 `describeError()` 的人话。

## 七、怎么新增一个错误码

1. 在 `ERROR_CODES` 加常量；
2. 在 `MESSAGES` 加 `{ title, hint }`，**title 不超过 12 字，hint 要给可执行建议**；
3. 在 `classifyError()` 加识别规则（只匹配 `code` / `name` / `message`）；
4. 在 `scripts/test_errors.js` 加一条分类断言；
5. 更新本文档的错误码表。

第 4 步是硬要求：`describeError` 有「每个码都必须有文案」的循环断言，漏写会挂。

## 八、已知限制

- 上报只到 `console`，M1 无服务端；`reportError` 的 `sink` 参数已预留，L2 可换成 sendBeacon。
- 错误页只能「返回首页 / 重试」，没有「恢复上次进度」——需配合 L-03 的 draft，尚未接线。
- 没有错误去重与限流：同一错误连续触发会重复写日志。

## 九、变更记录

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-11-07 | v1.0 | 初稿：9 个错误码、三层兜底、文案约定、测试要求 |
