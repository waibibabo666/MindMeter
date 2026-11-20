"""对话后的记忆沉淀（画像 / 摘要 / 建议记录）——服务端唯一写入方。

课程用户测试表 A10/A11 的口径是"敢信、能验证、能控制"：对话结束后，记忆面板
必须真的长出东西，而且写进去的每一条都能回到这次对话的事实上。之前
`POST /chat` 只在 `source=="llm"` 且引用了 kb-plan 知识块时写一条 MemoryAdvice，
MemorySummary 永远不写、画像永远不动，实测对话 6 条后 `GET /api/v1/memory`
是 `profile={} summaries=0 advice=0` —— 核心功能等于没做。

三条纪律：

1. **不编数字。** 摘要里出现的数字只可能来自本次 facts 的参考分、或我们自己对
   本轮数据的计数（维度数、建议条数），绝不把摘要里的数字当作本次指标引用；
2. **敏感轮次不落记忆。** crisis / boundary / high_domain / support / self_blame
   这些固定话术分支只在对话流里出现，不写摘要、不写画像（隐私透明 A7）；
3. **画像必须由用户确认。** 对话里出现的目标/偏好/约束线索只作为 `profileSuggested`
   返回给前端走确认流程，未确认（confirmed=False）时一个字段都不写。
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import MemoryAdvice, MemoryProfile, MemorySummary, User
from ..analysis import SPECIFIC_SUGGESTIONS
from ..privacy import redact
from ..serializers import find_advice, find_summary, memory_payload
from ..templates import DIM_NAMES
from .classify import conversation_topic

# 环形上限：对话 20 条、测评 50 次是既有模式，这里同构。
KEEP_SUMMARIES = 20
KEEP_ADVICE = 30
# 单轮最多沉淀几条建议（再多就是模板刷量，用户控制不住）。
ADVICE_PER_TURN = 3

# 只有真正在谈本次结果的意图才沉淀。
# crisis / boundary / high_domain / support / self_blame / greeting 有意排除：
# 记忆面板是能被导出、被第三个人看见的长期档案，把情绪或临床话题沉淀进去
# 与 ADR-0002 的隐私承诺相反（用户测试表 A7）。
SEDIMENT_INTENTS = {"explain", "summary", "trend"}

SECTION_HEADINGS = ["可以试试", "下一步可以这样安排", "可以这样安排", "接下来"]
# 建议小节标题行的形态：真实模型写得比固定词表杂（"练习建议：" / "**可以试试：**" /
# "下面两条建议："），所以判"短行 + 含建议词 + 以冒号结尾"。
# 词表**有意不含**"数字/指标"这类：模板的 "这次相关维度的原始数字是：" 也是冒号结尾，
# 认成小节就会把指标行当建议抽走（那是上一轮已经修过的 bug）。
_ADVICE_HEAD_RE = re.compile(
    r"^\s*[#>·*\-\s]*[^：:]{0,24}"
    r"(?:练习建议|改进建议|调整建议|小建议|建议|试试|怎么练|如何练|怎么做|如何安排"
    r"|可以这样|下一步|接下来|安排|做法)"
    r"[^：:]{0,12}[：:]\s*[*#]*\s*$"
)
CITATION_TAIL_RE = re.compile(r"[（(]\s*(?:参考|引用)\s*[:：][^)）]*[)）]\s*")
KB_CITED_RE = re.compile(
    r"(?:参考|引用)\s*[:：]\s*"
    r"((?:kb|s)-[A-Za-z0-9\-_]+(?:\s*[·、,]\s*(?:kb|s)-[A-Za-z0-9\-_]+)*)"
)
CITATION_LINE_RE = re.compile(r"^\s*(?:参考|引用)\s*[:：]")
# 条目形态：`· / - / *` 与 `N. / N、/ N)` 都算。**编号列表不要求先命中建议小节** ——
# 真实模型经常直接甩一个 "1. 睡眠与休息：保证充足睡眠…" 的列表，一行标题都没有。
BULLET_RE = re.compile(r"^\s*(?:[·•\-*]|\d{1,2}\s*[.、)）])\s*(.+)$")
NUMBERED_RE = re.compile(r"^\s*\d{1,2}\s*[.、)）]\s*(.+)$")
# 指标行不是建议行：兜底模板的 "· 联想记忆：再认命中 5 个、虚报 3 个"、
# "· 知觉速度：限时 45 秒；编码答对 12 题" 都不该落进建议表。判形必须要求"指标词后面紧跟读数"，
# 否则会把模型的真实建议 "1. 限时训练：使用计时器模拟测试环境" 一起杀掉。
METRIC_ONLY_RE = re.compile(
    r"^(?:限时|共|完成|答对|答错|说出|再认|首次|编码|分类|平均|按转动)\D{0,6}\d"
)
# 免责/口径句不是建议（实测模型会把"这些数字不能说明能力高低"写成条目）。
DISCLAIMER_RE = re.compile(
    r"不能说明|不会说明|无法说明|不足以说明|不说明|不能判断|无法判断|不能读成|不能当作"
    r"|不是常模|没有常模|不与人群|不与人比较|不与他人比较|只反映本次|只反映这次|仅反映本次"
    r"|不等于训练效果|仅作参考|仅供参考|原始数据|原始指标|今天的快照"
)
# 可执行动作提示词：建议要"今天就能照做"，所以只收**动词**。
# 有意不收"睡眠/休息/环境/安静"这类话题名词：那样会把"睡眠不足会拉低速度类表现"
# 这种因果陈述当成建议存进长期档案（陈述不是建议）。
ACTION_CUE_RE = re.compile(
    r"练习|训练|试试|尝试|使用|采用|计时|模拟|安排|分散|拆分|分组|整理|记录|复测|重测"
    r"|隔[一二三四五六七八九十两\d]|每天|每晚|每周|先把|放在|减少|避免|降低|提高|加快|放慢|控制"
    r"|睡足|专注|集中|对照|比较|区分|画出|写出|背诵|想象|回顾|朗读|复盘|睡好"
    r"|建议|可以|能够|请|优先|保证|保持|先把|先练|先写|先做|先记|先测|写下|验证|拆成"
)
_MD_RE = re.compile(r"\*\*|__|`")
_SENTENCE_END_RE = re.compile(r"[。！？!?；;]\s*$")
# "知觉速度 · 需要快速判断时…" 与 "需要快速判断时…" 是同一条建议，去重前先剥掉维度前缀。
_ADVICE_PREFIX_RE = re.compile(r"^\s*[\u4e00-\u9fa5A-Za-z0-9]{2,8}\s*[·・]\s*")
_PUNCT_RE = re.compile(r"[\s，,。.、；;：:！!？?\"'“”‘’()（）【】\[\]]+")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clip(value: str, limit: int) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    # 截断要停在分句处，不要停在半句话中间（记忆面板上是长期可见文案）。
    for separator in ("；", ";", "，", ",", "、"):
        index = cut.rfind(separator)
        if index >= 12:
            return cut[:index]
    return cut


def _advice_title(line: str) -> str:
    """建议正文短句：去掉引用尾巴与句末标点，压到 56 字，并抹掉敏感号码。

    "标题：正文"必须**整体**留在面板文案里 —— 只留"睡眠与休息"四个字，用户回到记忆页
    根本想不起来要做什么（2026-11-20 实测：模型给的正是 `1. 睡眠与休息：保证充足睡眠…`）。
    所以按句号切第一句；第一句短到只够当标题（"限时训练。"）时再并一句。
    """
    text = CITATION_TAIL_RE.sub("", str(line or ""))
    sentences = [part.strip() for part in re.split(r"[。！？!?]", text) if part.strip()]
    if not sentences:
        return ""
    picked = sentences[0]
    index = 1
    while len(picked) < 10 and index < len(sentences) and index < 3:
        picked = f"{picked}；{sentences[index]}"
        index += 1
    picked = redact(picked).strip(" 、，,；;：:")
    return _clip(picked, 56)


def _item_body(line: str) -> str:
    """条目正文（先剥掉引用尾巴），用来判"是不是指标行"。"""
    return CITATION_TAIL_RE.sub("", str(line or "")).strip()


def _after_label(text: str) -> str:
    """"联想记忆：再认命中 5 个" → "再认命中 5 个"：指标行常带维度名前缀。"""
    value = str(text or "")
    for separator in ("：", ":"):
        index = value.find(separator)
        if 0 <= index <= 14:
            return value[index + 1 :].strip()
    return value


def _is_metric_line(text: str) -> bool:
    body = _item_body(text)
    return bool(METRIC_ONLY_RE.match(body) or METRIC_ONLY_RE.match(_after_label(body)))


def advice_key(title: str) -> str:
    """归一化后的比对键：同一句建议不管有没有带"知觉速度 · "前缀、有没有截断，都算一条。"""
    text = _ADVICE_PREFIX_RE.sub("", str(title or ""))
    text = _PUNCT_RE.sub("", text.lower())
    return text[:24]


def _normalized_title(title: str) -> str:
    """内容哈希用的完整归一化文本（比 advice_key 长，避免前缀相同的两条建议撞 id）。"""
    text = _ADVICE_PREFIX_RE.sub("", str(title or ""))
    return _PUNCT_RE.sub("", text.lower())


def _advice_id(text: str, cited_ids: list[str]) -> str:
    """稳定 id：引用了知识块就用知识块 id（与前端既有记录同源），否则内容哈希。"""
    if cited_ids:
        return str(cited_ids[0])
    digest = hashlib.sha256(str(text or "").encode("utf-8")).hexdigest()[:16]
    return f"adv_{digest}"


def _cited_ids(line: str) -> list[str]:
    match = KB_CITED_RE.search(line)
    if not match:
        return []
    return [part.strip() for part in re.split(r"[、,·\s]+", match.group(1)) if part.strip()]


def advice_blocks(text: str) -> list[tuple[str, str]]:
    """把回答切成"建议候选条目"，返回 `(形态, 正文)`。

    形态两种：`numbered`（`1.` / `1、` / `1)`）与 `bullet`（`· / - / *`）。
    边界纪律：**bullet 只在建议小节里才算建议**（否则兜底模板的指标清单一行行漏进建议表），
    而编号列表本身就是"这里是可以照做的事"的信号（2026-11-20 实测模型经常不给标题）。
    条目后面没有句末标点时，下一行按换行续写并进同一条（模型长句会折行）。
    """
    items: list[tuple[str, str]] = []
    inside = False
    for raw in str(text or "").splitlines():
        line = _MD_RE.sub("", str(raw or "").strip()).strip()
        if not line:
            continue
        if CITATION_LINE_RE.match(line):
            inside = False  # 引用行：建议段落到此为止
            continue
        if _ADVICE_HEAD_RE.match(line) or any(word in line for word in SECTION_HEADINGS):
            inside = True
            continue
        numbered = NUMBERED_RE.match(line)
        bullet = None if numbered else BULLET_RE.match(line)
        if numbered or bullet:
            if bullet and not inside:
                continue
            items.append(("numbered" if numbered else "bullet", (numbered or bullet).group(1).strip()))
            continue
        if items and not _SENTENCE_END_RE.search(items[-1][1]) and len(line) <= 60:
            # 上一条建议折行续写（不以句末标点收尾才会并进来）
            items[-1] = (items[-1][0], f"{items[-1][1]} {line}")
            continue
        inside = False  # 回到指标清单、解释段或声明段
    return items


def advice_item(body: str) -> dict | None:
    """一条候选 → 建议记录；不合规返回 None。"""
    if not body or _is_metric_line(body):
        return None
    title = _advice_title(body)
    if len(title) < 6:
        return None
    if DISCLAIMER_RE.search(title) or not ACTION_CUE_RE.search(title):
        return None  # 免责句 / 没有可执行动作的句子不是建议
    cited = _cited_ids(body)
    return {"id": _advice_id(_normalized_title(title), cited), "title": title, "key": advice_key(title)}


def advice_from_reply(text: str, sources: list | None = None) -> list[dict]:
    """把这一轮**真的给出过**的建议挑出来。

    三个来源（2026-11-20 用真实模型复跑后才补齐）：
      1. 建议小节（"可以试试 / 练习建议 / 下一步"）下的 `·` 条目 —— 兜底模板的形状；
      2. 编号列表条目（`1. 睡眠与休息：保证充足睡眠…`）—— 真实模型最常见的形状，
         经常**不带任何小节标题**，旧实现因此一条都抽不到（`advice=0`）；
      3. 被引用的 plan 类知识块。
    指标行、免责句、没有可执行动作的句子、缺字段跳过后剩下的空行都不算建议。
    """
    found: list[dict] = []
    seen_ids: set[str] = set()
    seen_keys: set[str] = set()
    for _kind, body in advice_blocks(text):
        item = advice_item(body)
        if item is None or item["id"] in seen_ids or item["key"] in seen_keys:
            continue
        seen_ids.add(item["id"])
        seen_keys.add(item["key"])
        found.append(item)

    for source in sources or []:
        source_id = str(source.get("id") or "") if isinstance(source, dict) else str(source or "")
        if not source_id.startswith("kb-plan") or source_id in seen_ids:
            continue
        title = _clip((source.get("title") if isinstance(source, dict) else "") or source_id, 42)
        seen_ids.add(source_id)
        seen_keys.add(advice_key(title))
        found.append({"id": source_id, "title": title, "key": advice_key(title)})

    if not found:
        # 兜底（2026-11-20 用户点名的核心功能：这一轮真的给过东西，面板就该长出东西）：
        # 文本里抽不到条目时，用**本轮真的被引用过**的知识块反推一条具体建议。
        # 文案取 SPECIFIC_SUGGESTIONS 的既有口径（服务端自己写的，不是模型的话），
        # id 用知识块编号，所以和文本条目、和前几轮记录都是同一条，不会重复。
        for source in sources or []:
            source_id = str(source.get("id") or "") if isinstance(source, dict) else str(source or "")
            title = _suggestion_from_chunk(source_id)
            if not title or source_id in seen_ids:
                continue
            seen_ids.add(source_id)
            found.append({"id": source_id, "title": title, "key": advice_key(title)})
            if len(found) >= 2:
                break
    return found[:ADVICE_PER_TURN]


def _suggestion_from_chunk(chunk_id: str) -> str:
    """kb-dim-<维度>-* / kb-plan-* / kb-task-<维度>-* → 该维度的具体建议文案。"""
    parts = str(chunk_id or "").split("-")
    if len(parts) < 2 or parts[0] != "kb" or parts[1] not in {"dim", "plan", "task"}:
        return ""
    if parts[1] == "plan":
        tip, _source = SPECIFIC_SUGGESTIONS["vf"]
        return _clip(redact(tip), 56)
    dim = parts[2] if len(parts) > 2 else ""
    tip = SPECIFIC_SUGGESTIONS.get(dim, (None, None))[0]
    if not tip:
        return ""
    return _clip(redact(f"{DIM_NAMES.get(dim, dim)} · {tip}"), 56)


def _lowest(facts: dict | None) -> tuple[str | None, int | None]:
    """本次参考分最低的维度（只从 facts 的 score 里取，不自己算分）。"""
    scored = [
        (dim, metrics["score"])
        for dim, metrics in (facts or {}).items()
        if dim in DIM_NAMES and isinstance(metrics, dict) and isinstance(metrics.get("score"), int)
    ]
    if not scored:
        return None, None
    dim, value = min(scored, key=lambda pair: pair[1])
    return dim, value


def summary_text(
    *, topic: str, tier: str, lowest: tuple[str | None, int | None], advice_count: int
) -> str:
    """确定性中文摘要：最低维度 + 本次对话主题 + 已给建议数。缺件就整句跳过。"""
    parts = [f"对话摘要（{tier}档）：这次主要聊的是{topic}"]
    dim, value = lowest
    if dim:
        name = DIM_NAMES.get(dim, dim)
        parts.append(f"参考分最低的是{name}（{value}）" if value is not None else f"参考分最低的是{name}")
    parts.append(f"已给 {advice_count} 条建议")
    return "；".join(parts) + "。这些数字只反映本次任务，不是常模、不与人群比较。"


# ---------------------------------------------------------------------------
# 画像线索：只识别，不擅自落库
# ---------------------------------------------------------------------------

# 「我想考研」「我的目标是通过体测」这类明确陈述才算目标；
# 「我想问下知觉速度」是提问不是目标，所以后面紧跟的疑问/动词要先排除。
GOAL_RE = re.compile(
    r"(?:我的目标|我想|我要|我打算|我准备|为了)([^，。；！？,.!?;]{2,24})", re.IGNORECASE
)
GOAL_STOPWORDS = ("问", "知道", "了解", "看看", "确认", "查", "请问", "怎么", "为什么", "是不是", "看看")
PREFERENCE_RE = re.compile(r"(?:我(?:比较)?喜欢|我更愿意|我习惯|我偏好|我不喜欢)([^，。；！？,.!?;]{2,24})")
CONSTRAINT_RE = re.compile(
    r"((?:每天|每次|每周)[^，。；！？,.!?;]{0,12}(?:分钟|小时|次|天)"
    r"|我没时间|我时间不多|我只能|我不方便|我没设备"
    r"|我在[^，。；！？,.!?;]{1,12}(?:宿舍|图书馆|家|车间|路上))"
)


def _clean_signal(value: str) -> str:
    text = str(value or "").strip()
    # 「我的目标**是**通过体测」：连接词不属于目标本身。
    text = re.sub(r"^(?:是|为|要|想|打算|计划)+", "", text)
    return _clip(redact(text), 40)


def profile_signal(question: str) -> dict:
    """用户明确表达出的目标/偏好/约束（未确认时只作为建议返回，不落库）。"""
    text = str(question or "")
    signal: dict[str, str] = {}
    match = GOAL_RE.search(text)
    if match:
        tail = match.group(1).strip()
        if tail and not tail.startswith(GOAL_STOPWORDS):
            signal["goal"] = _clean_signal(tail)
    for pattern, key in ((PREFERENCE_RE, "preference"), (CONSTRAINT_RE, "constraint")):
        match = pattern.search(text)
        if match:
            signal[key] = _clean_signal(match.group(1))
    return signal


# ---------------------------------------------------------------------------
# 写入
# ---------------------------------------------------------------------------


def _trim(db: Session, uid: int, model, keep: int) -> int:
    """按账号保留最近 keep 条，其余删除（与对话 20 条、测评 50 次同一模式）。"""
    keep_ids = list(
        db.scalars(
            select(model.id)
            .where(model.user_id == uid)
            .order_by(model.at.desc(), model.id.desc())
            .limit(keep)
        ).all()
    )
    if len(keep_ids) < keep:
        return 0
    result = db.execute(delete(model).where(model.user_id == uid, model.id.not_in(keep_ids)))
    return int(result.rowcount or 0)


def after_turn(
    db: Session,
    user: User,
    *,
    question: str,
    reply: dict,
    facts: dict | None,
    assessment_id: str | None,
    tier: str | None,
) -> dict:
    """一轮有效对话结束后写记忆；返回 {"memory", "updated", "profileSuggested"}。

    任何一步失败都不能把对话本身打挂，所以调用方包了 try/except。
    """
    uid = int(user.id)
    intent = str(reply.get("intent") or "")
    if intent not in SEDIMENT_INTENTS:
        return {"memory": memory_payload(db, uid), "updated": False, "profileSuggested": None}

    tier_name = str(tier or "standard")
    text = str(reply.get("text") or "")
    items = advice_from_reply(text, reply.get("sources") or [])

    written_ids: list[str] = []
    if items:
        # 同一句建议换个措辞（带不带"知觉速度 ·"前缀、被截断过）也只该有一条记录：
        # 先按归一化文本把本轮条目对到已有行上。
        by_key: dict[str, str] = {}
        for row in db.scalars(select(MemoryAdvice).where(MemoryAdvice.user_id == uid)).all():
            by_key.setdefault(advice_key(row.title), row.id)
        for item in items:
            advice_id = by_key.get(item["key"], item["id"])
            row = find_advice(db, uid, advice_id)
            if row is None:
                row = MemoryAdvice(
                    user_id=uid,
                    id=advice_id,
                    at=_now(),
                    title=item["title"],
                    shown=True,
                    done=False,
                )
            else:
                # 去重：同一条建议不重复插入；用户勾掉的完成状态一律不动（A11 能控制）。
                row.title = item["title"] or row.title
                row.shown = True
                row.at = _now()
            db.add(row)
            written_ids.append(advice_id)

    summary_id = f"sum_chat_{assessment_id or 'na'}_{_now().strftime('%Y%m%d')}"
    row = find_summary(db, uid, summary_id) or MemorySummary(
        user_id=uid, id=summary_id, at=_now(), tier=tier_name, text=""
    )
    previous_ids = [str(item) for item in (row.advice_ids or [])]
    merged_ids = list(dict.fromkeys([*previous_ids, *written_ids]))
    lowest = _lowest(facts)
    row.at = _now()
    row.tier = tier_name
    row.assessment_id = assessment_id
    row.lowest_dim, row.lowest_value = lowest
    row.advice_ids = merged_ids[-6:]
    row.text = summary_text(
        topic=conversation_topic(question, facts),
        tier=tier_name,
        lowest=lowest,
        advice_count=len(merged_ids[-6:]),
    )
    db.add(row)
    db.flush()

    _trim(db, uid, MemorySummary, KEEP_SUMMARIES)
    _trim(db, uid, MemoryAdvice, KEEP_ADVICE)

    signal = profile_signal(question)
    suggested = signal or None
    profile_row = db.get(MemoryProfile, uid)
    if signal and profile_row is not None and profile_row.confirmed:
        # 画像只有用户确认过才由服务端更新；未确认时一个字段都不写，
        # 只把线索回传给前端走确认流程（记忆面板上"能不能被写"是用户说了算）。
        for key, value in signal.items():
            if value and (getattr(profile_row, key) or "") != value:
                setattr(profile_row, key, value)
                profile_row.updated_at = _now()
                db.add(profile_row)
                suggested = None  # 已写进画像，前端不必再提示确认

    db.commit()
    return {
        "memory": memory_payload(db, uid),
        # 有效轮次一定写了摘要（同一测评同一天是刷新那条，不是新增条）
        "updated": True,
        "profileSuggested": suggested,
    }
