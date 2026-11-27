"""游戏质量后验：合成数据验证三种典型游戏 + 小样本诚实性。"""
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code" / "backend"))

from app.game_quality import evaluate, pooled_prior  # noqa: E402


def _clip(x):
    return max(0, min(100, x))


def synth(n_users=60, seed=1):
    """vc 维度三个游戏：g_good/g_good2 随能力变化，g_noise 与能力无关；
    另有一个 vf 维度的几乎满分游戏 g_easy（每个 vf 游戏需要同维度的伙伴才能算区分度，
    这里只用它验证天花板）。"""
    rng = random.Random(seed)
    plays = []
    for uid in range(n_users):
        ability = rng.gauss(0, 1)
        plays.append((uid, "g_good", "vc", _clip(55 + 22 * ability + rng.gauss(0, 10))))
        plays.append((uid, "g_good2", "vc", _clip(55 + 22 * ability + rng.gauss(0, 10))))
        plays.append((uid, "g_noise", "vc", _clip(rng.gauss(55, 25))))
        plays.append((uid, "g_easy", "vf", _clip(97 + rng.gauss(0, 2))))
    return plays


def test_verdict_is_never_reversed_and_noise_game_is_rejected_at_scale():
    """序贯判断可以「继续收集」，但不能判反：好游戏不判不足，噪声游戏不判合格。"""
    for seed in range(1, 9):
        for n in (40, 100):
            report = evaluate(synth(n, seed))
            assert report["g_good"]["discrimination"]["verdict"] != "weak", (n, seed)
            assert report["g_good2"]["discrimination"]["verdict"] != "weak", (n, seed)
            assert report["g_noise"]["discrimination"]["verdict"] != "good", (n, seed)
    big = evaluate(synth(200, 1))
    assert big["g_good"]["discrimination"]["verdict"] == "good"
    assert big["g_noise"]["discrimination"]["verdict"] == "weak"
    assert any("区分度不足" in flag for flag in big["g_noise"]["flags"])


def test_verdict_becomes_more_decisive_as_samples_grow():
    small = evaluate(synth(12))["g_noise"]["discrimination"]
    large = evaluate(synth(200))["g_noise"]["discrimination"]
    assert large["pGood"] <= small["pGood"] + 0.05
    assert large["verdict"] == "weak"


def test_ceiling_game_is_flagged_with_credible_interval():
    report = evaluate(synth())
    assert report["g_easy"]["ceiling"]["grade"] == "severe", report["g_easy"]["ceiling"]
    assert any("天花板" in flag for flag in report["g_easy"]["flags"])
    assert report["g_good"]["ceiling"]["grade"] in {"ok", "watch"}


def test_tiny_sample_says_insufficient_instead_of_guessing():
    report = evaluate(synth(n_users=3))
    for entry in report.values():
        assert entry["discrimination"]["verdict"] == "insufficient"
        assert any("数据不足" in flag for flag in entry["flags"])


def test_single_game_players_cannot_be_rated_for_discrimination():
    plays = [(uid, "solo", "vc", 50 + uid % 40) for uid in range(40)]
    entry = evaluate(plays)["solo"]
    assert entry["discrimination"]["eligible"] == 0
    assert entry["discrimination"]["verdict"] == "insufficient"


def test_pooled_prior_borrows_strength_when_games_look_alike():
    similar = pooled_prior([(0.50, 40), (0.52, 40), (0.49, 40)])
    different = pooled_prior([(0.10, 40), (0.50, 40), (0.90, 40)])
    assert sum(similar) > sum(different)  # 越像，先验越强
    assert abs(similar[0] / sum(similar) - 0.5) < 0.05


def test_window_keeps_only_recent_plays():
    old = [(i, "g", "vc", 100) for i in range(300)]
    new = [(i, "g", "vc", 0) for i in range(300)]
    assert evaluate(old + new)["g"]["mean"] == 0.0
