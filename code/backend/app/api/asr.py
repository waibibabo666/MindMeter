"""Offline speech-to-text for the verbal fluency task.

Vosk runs entirely on this machine: no audio leaves the device. The model is
optional — when it is missing the endpoint returns 503 so the frontend can mark
the dimension as "not measured" instead of scoring it as zero.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

router = APIRouter()

_MODEL_LOCK = threading.Lock()
_MODEL = None
_MODEL_ERROR = ""


def model_dir() -> Path:
    """Vendored model path, mirroring how portable PostgreSQL is shipped."""
    root = Path(__file__).resolve().parents[4]
    return root / "vendor" / "vosk-model-small-cn"


def _load_model():
    """Lazily build the recognizer once; never at import time."""
    global _MODEL, _MODEL_ERROR
    if _MODEL is not None:
        return _MODEL
    with _MODEL_LOCK:
        if _MODEL is not None:
            return _MODEL
        directory = model_dir()
        if not directory.exists():
            _MODEL_ERROR = "model missing"
            return None
        try:
            from vosk import Model, SetLogLevel  # imported lazily: optional dependency

            SetLogLevel(-1)
            _MODEL = Model(str(directory))
        except Exception as exc:  # noqa: BLE001 - optional enhancement
            _MODEL_ERROR = str(exc)
            return None
    return _MODEL


def _transcribe(path: Path) -> list[str]:
    from vosk import KaldiRecognizer

    model = _load_model()
    if model is None:
        raise RuntimeError(_MODEL_ERROR or "model unavailable")

    recognizer = KaldiRecognizer(model, 16000)
    recognizer.SetWords(True)

    words: list[str] = []
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(4000)
            if not chunk:
                break
            if recognizer.AcceptWaveform(chunk):
                payload = json.loads(recognizer.Result())
                words.extend(str(payload.get("text", "")).split())
    payload = json.loads(recognizer.FinalResult())
    words.extend(str(payload.get("text", "")).split())
    return [word for word in words if word.strip()]


@router.post("/asr")
async def transcribe(audio: UploadFile = File(...)):
    """Return the words recognised in the uploaded audio.

    503 means "no offline model installed" — the caller should treat the
    dimension as unmeasured rather than failed.
    """
    if _load_model() is None:
        raise HTTPException(status_code=503, detail={"code": "asr_unavailable"})

    suffix = Path(audio.filename or "audio.wav").suffix or ".wav"
    temporary = Path(__file__).resolve().parents[4] / ".asr-upload" + suffix
    try:
        temporary.write_bytes(await audio.read())
        words = _transcribe(temporary)
    except Exception as exc:  # noqa: BLE001 - surface as a typed error
        raise HTTPException(status_code=500, detail={"code": "asr_failed", "message": str(exc)})
    finally:
        temporary.unlink(missing_ok=True)

    return {"words": words, "count": len(words)}
