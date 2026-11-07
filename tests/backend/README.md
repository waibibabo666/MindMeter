# Backend contract tests

These tests are **contract scaffolding** for the L2 FastAPI backend. They are
skipped while `code/backend/app/` does not exist, so the repository can stay
green during the design phase; once the backend is scaffolded they become the
first guardrails.

## Run

```bash
pip install pytest httpx fastapi
pytest -q tests/backend -rs
```

CI runs this job only when `code/backend/pyproject.toml` exists.

## What is covered now

- `GET /api/v1/health` returns 200 and a healthy status.
- The OpenAPI document exposes the core L2 paths (auth, assessments, reports,
  threads, memory, trends).

## What to add next

- Auth: register/login/refresh/logout; token rotation; 401/403.
- Assessment: submit idempotency; server-side scoring; no total/norm fields.
- Memory: delete then no longer referenced by Agent.
- Export/delete: no password/BYOK key in export; 30-day deletion flow.
- Agent contract: no key in request; citations; degraded fallback.
- RAG: hit@3 / retrieval contract.

Use synthetic data only. Never commit real user answers or conversations.
