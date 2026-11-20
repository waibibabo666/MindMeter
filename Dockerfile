# MindMeter web runtime（Railway / 任意 Linux 主机）
#
# 为什么用 Dockerfile：仓库根目录有 package.json（只给本地测试 / lint / playwright 用），
# Nixpacks / Railpack 会把它判定成 Node 项目，只装 Node、不装 Python，于是
# `python -m pip install -r requirements.txt` 直接 `python: command not found`（exit 127）。
# 显式用 Python 基础镜像可以彻底绕开这个误判。
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# 依赖层单独一层：requirements.txt 不变时复用缓存
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 应用代码：后端(FastAPI+alembic) + 前端静态文件
COPY code ./code

EXPOSE 8080

# Railway 通过 $PORT 注入端口。--proxy-headers 必须在反向代理后面使用，
# 否则 MM_COOKIE_SECURE=auto 判断不出 https、客户端 IP 也会错。
CMD ["sh", "-c", "cd code/backend && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips '*'"]
