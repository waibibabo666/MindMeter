# Agent 接入位（L2：前端 → 后端）

> L2 的 Agent 在后端（FastAPI + LangGraph），前端不直连模型；对话请求不携带 BYOK Key（设置页只在保存时提交一次，后端加密存储，之后前端不再接触）。
> 本文件定义前端与后端的最小契约；详细图/节点见 [Agent 设计](../../requirements/xlragentdesign.md)。

## 1. 角色

| 层 | 职责 |
| --- | --- |
| 前端 | 展示消息、建议卡片、引用；发问题；显示降级状态 |
| FastAPI | JWT 鉴权、限流、thread/memory API |
| LangGraph | 取 facts/记忆 → 检索 → 生成 → 校验 → 存摘要 |
| 模型 | 后端用用户加密的 BYOK Key 调用；Key 不出后端 |

## 2. 接口

### 2.1 创建对话

`POST /api/v1/threads`

```json
{ "assessment_id": "a_123" }
```

响应：

```json
{ "thread_id": "t_456", "created_at": "2026-10-24T20:00:00+08:00" }
```

### 2.2 发消息

`POST /api/v1/threads/{thread_id}/messages`

```json
{ "content": "为什么我联想记忆低？" }
```

响应（M1 非流式）：

```json
{
  "message_id": "m_789",
  "role": "assistant",
  "content": "本次联想记忆 60 分，低于你的空间视觉化 74 分。……",
  "citations": ["kb_am_01", "kb_lim_02"],
  "degraded": false,
  "suggestions": [
    { "advice_id": "adv_am_01", "title": "间隔重复", "accepted": null }
  ]
}
```

### 2.3 最近消息

`GET /api/v1/threads/{thread_id}/messages?limit=20`

只返回最近 20 条；更早内容由摘要体现。

### 2.4 记忆

```text
GET  /api/v1/memory/profile
PUT  /api/v1/memory/profile
GET  /api/v1/memory/summaries
DELETE /api/v1/memory
```

## 3. 请求约束

- 必须带 `Authorization: Bearer <access_token>`；
- 只接受当前用户自己的 thread/assessment；
- 不允许前端传 `user_id`、`facts`、`system prompt`、`model key`；
- 后端从 DB 取 facts/记忆，从加密存储解密 Key；
- 限流：每用户每分钟/每天上限（M1 可 30/500）。

## 4. 响应约束

- `content` 必须来自校验通过的模型输出或模板；
- `citations` 至少 1 个（有知识块时）；无检索结果时为空并说明；
- `degraded=true` 表示模板兜底；
- 不返回内部报错/堆栈/Key/完整 prompt；
- 不返回未授权记忆。

## 5. 降级

| 情况 | 前端看到 |
| --- | --- |
| 模型超时/限流 | 模板回答 + “AI 暂不可用，已回退模板” |
| 校验不过 | 模板回答 |
| 无 facts | 引导先完成测评 |
| 无检索结果 | 回答 + “知识库暂未覆盖” |
| 未登录/过期 | 401 → 刷新/登录 |

**铁律：对话页不空；分数/报告不受 AI 失败影响。**

## 6. 前端展示

- 消息列表：用户/助手气泡；
- 建议卡片：标题、时长、接受/拒绝；
- 引用：显示 `kb_*` 对应标题；
- 降级：黄色提示，不显示报错栈；
- 记忆：单独的“记忆”页，可删除；
- 不展示原始 prompt/模型 Key。

## 7. 安全与隐私

- Key 只在后端解密使用；前端只在设置页提交一次，对话请求不带 Key；
- 前端不缓存完整对话到 localStorage（只保留当前视图）；
- 退出登录清空内存中的消息；
- 删除账号/记忆后，后续请求不得引用；
- 不把对话发给第三方分析/SDK。

## 8. 上线检查

- [ ] 对话请求体无 Key；设置页只在保存时提交
- [ ] 401 能刷新/回登录
- [ ] 只返回当前用户 thread
- [ ] 最近 20 条限制生效
- [ ] citations 可点击/可读
- [ ] 降级提示可见，不显示堆栈
- [ ] 删除记忆后不再引用
- [ ] 限流生效

## 9. 相关

- [Agent 设计](../../requirements/xlragentdesign.md)
- [技术方案](../../software/architecture.md)
- [功能需求](../../requirements/functional_spec.md)
