# 诊断日志（桌面本地版）

> 当前实现同时有前端内存日志（`code/frontend/src/log.js`）和后端脱敏文件日志
> （`%LOCALAPPDATA%\MindMeter\logs\backend.log`）。后端不记录 prompt/回答/Key；
> 详见 [本地运行时](local-runtime.md)。

## 目标

本地优先的 M1 没有服务端日志。前端需要一个**不写 console、默认不落盘、可脱敏导出**的诊断日志，用于排查白屏、存储失败、模型调用失败与路由问题。

## 实现

- 文件：`code/frontend/src/log.js`
- 缓冲：`globalThis.__MM_LOG__`，最多 **200 条**
- 级别：`debug` / `info` / `warn` / `error`；未知级别回退 `info`
- 每条：`{ at, level, event, args }`
- **不调用 `console.*`**：避免浏览器扩展/日志采集把 Key 带走
- **不持久化**：刷新页面即清空；需要留存时从设置页导出
- **入库前脱敏**：
  - `apiKey` / `authorization` / `password` / `token` / `secret` / `key` 字段 → `[redacted]`
  - 字符串里的 `sk-*`、`Bearer ...`、`ghp_*` → `[redacted]`
  - 字符串截断到 500 字符；对象最多 3 层、20 个键；循环引用 → `[circular]`

## 使用

代码中：

```js
import { log } from './log.js';

log('info', '开始测评', 'standard');
log('warn', '模型调用失败', error.code);
```

设置页：

- 显示当前日志条数与最近一条；
- **导出诊断日志**：下载 `mindmeter-logs-YYYY-MM-DD.json`，内容已脱敏；
- **清除日志**：二次确认后清空。

浏览器控制台（仅本机调试）：

```js
__MM_LOG__; // 查看最近 200 条
```

## 不记录什么

- 不记录 LLM Key、Authorization 头、密码；
- 不记录完整对话、完整画像、原始作答；
- 不记录真实姓名/手机号等身份信息；
- 不做远程上报，不引入第三方日志 SDK。

## 测试

```bash
node scripts/test_log.js
```

覆盖：级别、200 条上限、Key/Bearer/`sk-*`/`ghp_*` 脱敏、Error/循环引用、导出结构、清除。

## 限制

- 刷新后日志丢失（设计如此，避免把诊断数据长期留在浏览器）；
- 不支持跨标签页聚合；
- 不替代服务端可观测性；L2 再考虑结构化后端日志/告警。
