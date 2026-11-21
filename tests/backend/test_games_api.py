"""Practice game records: per-account storage, best-only-up, tenancy isolation."""
from __future__ import annotations


def test_games_start_empty(logged_client):
    response = logged_client.get("/api/v1/games")
    assert response.status_code == 200
    assert response.json()["records"] == {}


def test_best_only_goes_up(logged_client):
    logged_client.post("/api/v1/games/schulte", json={"score": 80})
    second = logged_client.post("/api/v1/games/schulte", json={"score": 55})
    record = second.json()["records"]["schulte"]
    assert record["best"] == 80, "低分不能覆盖最高分"
    assert record["plays"] == 2, "局数应累加"
    assert record["lastScore"] == 55, "最近一局要更新"


def test_score_is_clamped(logged_client):
    response = logged_client.post("/api/v1/games/quickmath", json={"score": 250})
    assert response.json()["records"]["quickmath"]["best"] == 100


def test_records_are_per_account(logged_client, fresh_client):
    logged_client.post("/api/v1/games/flip", json={"score": 70})
    assert fresh_client.get("/api/v1/games").json()["records"] == {}


def test_clearing_one_account_keeps_the_other(logged_client, fresh_client):
    logged_client.post("/api/v1/games/visual", json={"score": 60})
    fresh_client.post("/api/v1/games/visual", json={"score": 90})

    assert logged_client.delete("/api/v1/games").json() == {"ok": True}
    assert logged_client.get("/api/v1/games").json()["records"] == {}
    assert fresh_client.get("/api/v1/games").json()["records"]["visual"]["best"] == 90


def test_games_need_a_session(client):
    assert client.get("/api/v1/games").status_code == 401


def test_overlong_game_id_is_rejected(logged_client):
    response = logged_client.post("/api/v1/games/" + "x" * 200, json={"score": 50})
    assert response.json().get("ok") is False
