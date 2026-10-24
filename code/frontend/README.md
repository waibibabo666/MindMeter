# Frontend（L2）

原生 HTML/CSS/JS，接 FastAPI。页面：

| 页面 | 作用 |
| --- | --- |
| 登录/注册 | 邮箱、密码、18+、隐私同意 |
| 档位/同意 | 快测/标准/深度；ASR 提示；四项同意 |
| 任务 | 8 个任务；练习；计时；提交原始指标 |
| 报告 | 八维雷达、维度分、2–3 条建议、局限；**无总分** |
| 对话 | 消息、建议卡片、引用、接受/拒绝 |
| 记忆 | 画像、摘要、建议记录、删除 |
| 趋势 | 共同维度、复测提示、“让 Agent 解释趋势” |
| 设置 | BYOK、AI 开关、导出、注销 |

## 计划目录

```text
frontend/
├─ index.html
└─ src/
   ├─ api.js          # fetch + JWT refresh
   ├─ auth.js
   ├─ pages/          # login, register, report, chat, memory, trend, settings
   ├─ tasks/          # vc, vf, nc, ps, ir, sv, am, ni
   ├─ asr/            # Web Speech API
   └─ styles/
```

## 约定

- 不做客户端计分；显示服务端结果；
- 8 个任务只提交原始指标；
- ASR 仅 Chrome/Edge；不支持时快测禁用；
- 不存完整对话；只显示服务端返回的最近 20 条；
- 不把 BYOK Key 写进前端源码；设置页只提交给后端加密存储。

## 启动

M0 定 API 后补充；静态文件可由 FastAPI 或 CDN 提供。
