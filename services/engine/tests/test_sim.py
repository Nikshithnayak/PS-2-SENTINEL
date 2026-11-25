from sim.generator import SCENARIO_CATALOG, generate_scenario


def test_all_11_scenarios_deterministic_and_synthetic_labeled() -> None:
    for name in SCENARIO_CATALOG:
        r1 = generate_scenario(name, seed=77, total_days=14)
        r2 = generate_scenario(name, seed=77, total_days=14)
        assert len(r1.samples) == len(r2.samples)
        assert r1.samples[0] == r2.samples[0]
        assert all(s["isSynthetic"] is True for s in r1.samples)
        assert all(s["source"] == "synthetic_sim" for s in r1.samples)


def test_copd_and_exercise_and_silence_scenarios() -> None:
    copd = generate_scenario("copd_exacerbation", seed=12, total_days=16)
    spo2_vals = [s["value"] for s in copd.samples if s["metricType"] == "spo2"]
    assert min(spo2_vals) < 88.0

    ex = generate_scenario("exercise_confounder", seed=12, total_days=5)
    assert any(
        s["metricType"] == "heart_rate" and s["value"] > 120 and s["context"] == "exercise"
        for s in ex.samples
    )

    silent = generate_scenario("off_wrist_silence", seed=12, total_days=5)
    assert silent.onset_at is not None
    last_ts = max(s["recordedAt"] for s in silent.samples)
    assert last_ts < silent.onset_at
