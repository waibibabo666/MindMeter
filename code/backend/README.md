# Backend（Web FastAPI，多用户）

托管版 FastAPI 服务：同源提供 `/api/v1/*` 与前端静态文件，按账号隔离数据，模型由站点环境变量提供。

```text
code/backend/
├─ app/
│  ├─ main.py              # FastAPI + 静态前端 + 启动迁移/会话清理
│  ├─ api/                 # health/auth/state/assessments/memory/chat/settings/data
│  ├─ auth.py              # PBKDF2 口令、服务端会话表、限流、依赖注入
│  ├─ audit.py             # 只记动作与结果，不记内容
│  ├─ models.py            # 多租户 SQLAlchemy 模型（user_id 复合主键）
│  ├─ scoring/             # scoring-v3.2 Python（唯一权威，与前端一致）
│  ├─ rag/                 # BM25（默认）+ pgvector 向量检索 + embedding ingest
│  ├─ agent/               # LangGraph 小图
│  ├─ llm.py               # OpenAI 兼容客户端 + site_llm_config()
│  ├─ db.py                # 连接串归一（postgres:// → postgresql+psycopg://）与小连接池
│  ├─ security.py          # 安全头/CSP + 同源写请求守卫（不再有 loopback/token）
│  └─ logging_setup.py     # 脱敏日志（托管时同时输出到 stdout）
├─ alembic/                # 0001_initial → 0005_profile
├─ pyproject.toml
└─ alembic.ini
```

## 运行

```powershell
# 本地开发（需要已存在的 pgvector 数据库）
cd code/backend
$env:MM_DATABASE_URL = "postgresql+psycopg://user:pass@127.0.0.1:5432/mindmeter"
$env:MM_LLM_API_KEY = "sk-..."        # 不填 = 解读走模板
python -m alembic upgrade head
python -m uvicorn app.main:app --reload --port 8000
```

部署到 Render 见 [docs/software/deploy-render.md](../../docs/software/deploy-render.md)；`MM_AUTO_MIGRATE=1`（默认）会在启动时补跑一次 `alembic upgrade head`，所以手工建服务也不会漏迁移。

## 约定

- 服务端计分唯一权威；前端只提交原始指标；
- 除 `/api/v1/health*` 与 `/api/v1/auth/{register,login,session}` 外，所有接口都要会话 Cookie（`app.auth.require_user`）；
- **所有业务查询必须带 `user_id`**：新增表就用 `user_pk()` 作复合主键第一列，新增接口就取 `Depends(auth.require_user)`；
- 模型 Key 只在 `MM_LLM_*` 环境变量里：数据库无 `ai_settings` 表，`GET /settings/ai` 只读，`PUT`/`DELETE key` 一律 403 `ai_managed_by_site`；
- 会话是服务端表：登出、改密码、注销账号都会撤销数据库里的会话行；
- 对话每账号只留最近 20 条、测评每账号只留最近 50 次；记忆沉淀每账号只留最近 20 条摘要、30 条建议；
- AI 失败一律回退模板，分数与结论不变；
- 日志不记录 prompt/回答/Key；`GET /logs` 需要 `MM_EXPOSE_LOGS=1` 且已登录；
- 测试使用 PostgreSQL，不用 SQLite；口令散列与令牌散列都不落明文。

## `POST /api/v1/chat` 的响应契约（记忆沉淀）

```jsonc
{
  "reply": {
    "text": "……",                  // 模型回答或确定性模板
    "intent": "explain",            // explain / summary / trend / clarify / crisis / …
    "source": "llm | template | policy",
    "code": "ok | too_long | banned_word | unsourced_number | score_misattributed | mechanism_speculation | citation_missing | citation_placeholder | empty | timeout | auth | rate_limit | http | network | bad_response | truncated | not_configured | no_knowledge | unknown | trend_no_data | intent:<intent>",
    "validation": [                 // 完整校验结论：code + 中文 detail + severity
      { "code": "too_long", "detail": "回答过长：388 字，上限 360 字", "severity": "hard" }
    ],
    "citations": [ … ], "sources": [ … ], "risk": "low | medium | high",
    "assessmentId": "s_xxx"
  },
  "memory": {                       // 与 GET /api/v1/memory 完全同形状（同一个 memory_payload）
    "schemaVersion": 1, "profile": { … }, "summaries": [ … ], "advice": [ … ], "messages": [ … ]
  },
  "memoryUpdated": true,            // 本轮服务端是否写了记忆行（前端据此刷新面板）
  "profileSuggested": null,         // {goal|preference|constraint}：画像线索，服务端未写，等用户确认
  "messages": [ … ]                 // = memory.messages，兼容旧前端
}
```

- 服务端在每轮**有效**对话后自动沉淀 `MemorySummary`（同一测评+同一天 upsert 一条）与本轮实际给出的 `MemoryAdvice`（kb 编号或建议正文哈希去重）；`pii_blocked`、`clarify`、`unrelated`、`greeting`，以及 `crisis/boundary/high_domain/support/self_blame` 这类敏感固定话术**一律不落记忆**。
- 画像只在用户明确表达目标/偏好/约束、且 `MemoryProfile.confirmed` 已为真时才更新；未确认时只回 `profileSuggested`。
- 因为 `PUT /api/v1/memory` 是**整份替换**（先删后写），对话页必须采用这里的 `memory` 更新缓存，不能把旧快照 PUT 回来，否则会抹掉服务端刚写的行。

### 记忆清除的三个不同语义（第 3 轮实测后补齐）

| 端点 | 删什么 | 谁在用 |
| --- | --- | --- |
| `DELETE /api/v1/memory` | 画像 + 摘要 + 建议 + **对话**（全部四类） | 记忆页「清除全部记忆」、设置页 |
| `DELETE /api/v1/memory/messages` | **只删对话**，画像/摘要/建议保留 | 对话页「清空对话」 |
| `DELETE /api/v1/memory/{summaries,advice,messages}/{id}` | 单行删除 | 记忆页逐条删除 |

第 3 轮实测发现第一行以前**不删 `ChatMessage`**：用户点「清除全部记忆」后对话一条不少地留着，
而界面写的是"删除后 AI 不会再引用" —— 承诺与实现不一致（课程测试表 A7 隐私透明）。
`DELETE /api/v1/memory/messages` 也是这一轮才补的：以前"只清对话"只能靠前端逐条删（最多 20 次串行往返）。
