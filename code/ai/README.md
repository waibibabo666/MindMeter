# AI（仅契约，无服务端）

本目录只放 AI 的**契约与校验说明**，不是后端，不部署任何服务。

- 运行时请求在 `code/frontend/src/ai/byok.js` 中由浏览器发起；
- endpoint / model / API Key 由用户在设置页填写，Key 只存本机；
- 只发送维度分、完成度、建议 ID、复测差值；不发送身份、人口学、原始试次、ASR 文本；
- 超时 8 秒、失败/越界/幻觉数字一律回退模板；
- 没有 `server.py`、没有网关、没有云端 Key。

契约见：

- [Agent 设计](../../docs/requirements/xlragentdesign.md)
- [AI 接入位](../../docs/software/prototype/agent-接入位.md)
- [技术方案](../../docs/software/architecture.md)
