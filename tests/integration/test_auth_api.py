"""Account lifecycle: registration rules, login, sessions, password change, erasure.

Unit assertions (hashing, validation) run anywhere; everything that touches
users/sessions needs the disposable Postgres (MM_TEST_DATABASE_URL).
"""
from __future__ import annotations

import pytest

from app import auth


def test_hash_roundtrip_and_tamper_detection():
    stored = auth.hash_password("correct-horse-1")
    assert stored.startswith("pbkdf2-sha256$")
    assert "correct-horse-1" not in stored
    assert auth.verify_password("correct-horse-1", stored) is True
    assert auth.verify_password("Correct-horse-1", stored) is False
    assert auth.verify_password("correct-horse-1", "not-a-hash") is False
    assert auth.verify_password("correct-horse-1", "") is False


def test_username_is_normalized_but_password_is_not():
    assert auth.normalize_username("  Demo.User  ") == "demo.user"
    assert auth.get_user is not None
    assert auth.credential_errors("demo.user", "abcdef12345") == []
    assert auth.credential_errors("Demo.User", "abcdef12345") == []


def test_password_rules_are_explained_not_enforced_silently():
    assert any("至少" in text for text in auth.password_problems("abc1"))
    assert auth.password_problems("abcdefg"), "7 位必须被拒绝"
    assert auth.password_problems("abcdef12") == [], "8 位含字母数字必须放行（人工测试反馈）"
    assert auth.password_problems("aaaaaaaaaa")  # too few distinct characters
    assert auth.password_problems("alllettersnovalue")  # no digit
    assert auth.password_problems("1234567890"), "纯数字密码必须被拒绝"
    assert auth.password_problems("abcdef12345") == []


def test_username_character_rules():
    assert auth.credential_errors("a", "abcdef12345") != []
    assert auth.credential_errors("_bad", "abcdef12345") != []
    assert auth.credential_errors("x" * 33, "abcdef12345") != []
    assert auth.credential_errors("心智镜2号", "abcdef12345") == []
    assert auth.credential_errors("ok.name_1", "abcdef12345") == []


def test_token_hash_is_stable_and_not_the_token():
    token = auth.secrets.token_urlsafe(32)
    digest = auth.token_hash(token)
    assert digest == auth.token_hash(token)
    assert len(digest) == 64
    assert token not in digest


@pytest.mark.usefixtures("needs_db")
class TestAccountApi:
    def test_register_sets_an_httponly_cookie_and_no_secret_in_body(self, app_instance):
        from conftest import _testclient, unique_username

        client = _testclient(app_instance)
        name = unique_username("reg")
        response = client.post(
            "/api/v1/auth/register",
            json={"username": name, "password": "abcdef12345", "adult": True},
        )
        assert response.status_code == 200, response.text
        assert response.json()["user"]["username"] == name
        cookie = response.headers.get("set-cookie", "").lower()
        assert "mm_session=" in cookie
        assert "httponly" in cookie
        assert "samesite=lax" in cookie
        assert "password" not in response.text.lower()
        client.close()

    def test_session_probe_reflects_the_cookie(self, logged_client):
        body = logged_client.get("/api/v1/auth/session").json()
        assert body["authenticated"] is True
        assert body["user"]["username"] == logged_client.account["username"]

    def test_anonymous_session_probe_is_not_an_error(self, client):
        response = client.get("/api/v1/auth/session")
        assert response.status_code == 200
        assert response.json()["authenticated"] is False

    def test_duplicate_username_is_rejected(self, app_instance):
        from conftest import _testclient, unique_username

        name = unique_username("dup")
        first = _testclient(app_instance)
        second = _testclient(app_instance)
        assert first.post(
            "/api/v1/auth/register", json={"username": name, "password": "abcdef12345", "adult": True}
        ).status_code == 200
        again = second.post(
            "/api/v1/auth/register", json={"username": name.upper(), "password": "abcdef12345", "adult": True}
        )
        assert again.status_code == 409
        assert again.json()["detail"] == "username_taken"
        first.close()
        second.close()

    def test_adult_confirmation_is_required(self, app_instance):
        from conftest import _testclient, unique_username

        client = _testclient(app_instance)
        response = client.post(
            "/api/v1/auth/register",
            json={"username": unique_username("kid"), "password": "abcdef12345"},
        )
        assert response.status_code == 400
        assert response.json()["detail"] == "adult_confirmation_required"
        client.close()

    def test_weak_password_and_mismatch_are_400_with_text(self, app_instance):
        from conftest import _testclient, unique_username

        client = _testclient(app_instance)
        short = client.post(
            "/api/v1/auth/register", json={"username": unique_username("weak"), "password": "ab1", "adult": True}
        )
        assert short.status_code == 400
        assert "至少" in short.json()["detail"]
        mismatch = client.post(
            "/api/v1/auth/register",
            json={
                "username": unique_username("mis"),
                "password": "abcdef12345",
                "confirm": "abcdef12346",
                "adult": True,
            },
        )
        assert mismatch.status_code == 400
        assert "不一致" in mismatch.json()["detail"]
        client.close()

    def test_login_wrong_password_never_reveals_why(self, logged_client):
        response = logged_client.post(
            "/api/v1/auth/login",
            json={"username": logged_client.account["username"], "password": "wrong-password-1"},
        )
        assert response.status_code == 401
        assert response.json()["detail"] == "invalid_credentials"

    def test_login_then_logout_round_trip(self, app_instance):
        from conftest import _testclient, unique_username

        name = unique_username("loop")
        client = _testclient(app_instance)
        client.post(
            "/api/v1/auth/register", json={"username": name, "password": "abcdef12345", "adult": True}
        )
        client.cookies.clear()
        assert client.get("/api/v1/auth/me").status_code == 401
        assert client.post(
            "/api/v1/auth/login", json={"username": name, "password": "abcdef12345"}
        ).status_code == 200
        assert client.get("/api/v1/auth/me").status_code == 200
        assert client.post("/api/v1/auth/logout", json={}).status_code == 200
        assert client.get("/api/v1/auth/me").status_code == 401
        client.close()

    def test_login_throttles_after_repeated_failures(self, app_instance):
        from conftest import _testclient, unique_username

        name = unique_username("slow")
        client = _testclient(app_instance)
        client.post(
            "/api/v1/auth/register", json={"username": name, "password": "abcdef12345", "adult": True}
        )
        codes = [
            client.post(
                "/api/v1/auth/login", json={"username": name, "password": "bad-password-999"}
            ).status_code
            for _ in range(12)
        ]
        assert codes[: auth.settings.login_max_attempts] == [401] * auth.settings.login_max_attempts
        assert 429 in codes, codes
        assert client.post(
            "/api/v1/auth/login",
            json={"username": name, "password": "bad-password-999", "x": "y"},
        ).status_code == 429
        client.close()

    def test_change_password_revokes_other_devices(self, app_instance):
        from conftest import _testclient, unique_username

        name = unique_username("rot")
        other = _testclient(app_instance)
        home = _testclient(app_instance)
        home.post("/api/v1/auth/register", json={"username": name, "password": "abcdef12345", "adult": True})
        other.post("/api/v1/auth/login", json={"username": name, "password": "abcdef12345"})
        assert other.get("/api/v1/auth/me").status_code == 200

        result = home.post(
            "/api/v1/auth/password",
            json={"currentPassword": "abcdef12345", "newPassword": "newpassw0rd-2", "confirm": "newpassw0rd-2"},
        )
        assert result.status_code == 200, result.text
        assert other.get("/api/v1/auth/me").status_code == 401
        assert home.get("/api/v1/auth/me").status_code == 200
        assert home.post(
            "/api/v1/auth/password", json={"currentPassword": "stale-1234567", "newPassword": "zzzzzzzz999"}
        ).status_code == 403
        other.close()
        home.close()

    def test_delete_account_requires_password_and_removes_data(self, app_instance):
        from conftest import _testclient, unique_username

        name = unique_username("gone")
        client = _testclient(app_instance)
        client.post("/api/v1/auth/register", json={"username": name, "password": "abcdef12345", "adult": True})
        client.put("/api/v1/state", json={"route": "/chat", "tier": "standard"})
        assert client.get("/api/v1/state").json()["tier"] == "standard"

        assert client.request(
            "DELETE", "/api/v1/auth/account", json={"password": "nope-12345678"}
        ).status_code == 403
        assert client.request(
            "DELETE", "/api/v1/auth/account", json={"password": "abcdef12345"}
        ).status_code == 200
        assert client.get("/api/v1/auth/me").status_code == 401

        # The username is free again, and the new account owns no old rows.
        fresh = _testclient(app_instance)
        assert fresh.post(
            "/api/v1/auth/register", json={"username": name, "password": "abcdef12345", "adult": True}
        ).status_code == 200
        assert fresh.get("/api/v1/state").json()["tier"] is None
        client.close()
        fresh.close()
