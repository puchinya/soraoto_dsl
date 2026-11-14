import sys
import tempfile
import unittest
from pathlib import Path

import optuna

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from constraints import STAGE1_CONSTRAINT_KEYS, STAGE2_CONSTRAINT_KEYS, STAGE2B_CONSTRAINT_KEYS  # noqa: E402
from objective import stage1_objective_result, stage2_objective_result, stage2b_objective_result  # noqa: E402


def stage(result="PASS", brightness=1.30, invalid=0):
    return {
        "result": result,
        "metrics": {
            "referenceFitLoss": 0.75,
            "brightnessRatio": brightness,
            "peakDbfs": -1.0,
            "guardHits": 0,
            "measurementInvalidCount": invalid,
            "lowRegisterBuzz": 0.10,
            "pitchErrorsCents": [2.0, -5.0] if invalid < 2 else [],
            "finite": True,
            "harmonicSparsity": {"h2ToH1": 0.30, "h3ToH1": 0.20},
        },
        "measurement": {"invalidCount": invalid},
    }


class FakeTrial:
    def __init__(self):
        self.constraints = {}
        self.constraint_order = []
        self.user_attrs = {}

    def set_constraint(self, name, value):
        self.constraints[name] = value
        self.constraint_order.append(name)

    def set_user_attr(self, name, value):
        self.user_attrs[name] = value


class ObjectiveStudyTests(unittest.TestCase):
    def test_stage1_failure_is_measured_and_stage2_is_not_run(self):
        trial = FakeTrial()
        called = []

        def evaluate(which):
            called.append(which)
            return stage(result="FAIL", brightness=1.20)

        value, detail = stage1_objective_result(trial, {"x": 0.2}, evaluate)
        self.assertEqual(called, [1])
        self.assertEqual(detail["stage_reached"], 1)
        self.assertTrue(value == value and abs(value) < float("inf"))
        self.assertGreater(trial.constraints["stage1_violation"], 0.0)
        self.assertEqual(tuple(trial.constraint_order), STAGE1_CONSTRAINT_KEYS)
        self.assertNotIn("stage2_violation", trial.constraints)

    def test_stage2_always_measures_even_when_stage1_fails(self):
        trial = FakeTrial()
        called = []

        def evaluate(which):
            called.append(which)
            return stage(result="FAIL", brightness=1.20) if which == 1 else stage()

        value, detail = stage2_objective_result(trial, {"x": 0.2}, evaluate)
        self.assertEqual(called, [1, 2])
        self.assertEqual(detail["stage_reached"], 2)
        self.assertTrue(value == value and abs(value) < float("inf"))
        self.assertGreater(trial.constraints["stage1_violation"], 0.0)
        self.assertLessEqual(trial.constraints["stage2_violation"], 0.0)
        self.assertEqual(tuple(trial.constraint_order), STAGE2_CONSTRAINT_KEYS)

    def test_stage2_measurement_invalid_is_separate_and_positive(self):
        trial = FakeTrial()
        results = {1: stage(), 2: stage(invalid=1)}
        stage2_objective_result(trial, {}, results.__getitem__)
        self.assertGreater(trial.constraints["stage2_measurement_invalid"], 0.0)
        self.assertGreater(trial.constraints["stage2_violation"], 0.0)

    def test_stage2b_measures_fixed_proxy_schema_after_stage2_failure(self):
        trial = FakeTrial()
        result = {"stage1Result": "FAIL", "stage2Result": "PASS",
                  "stage1Metrics": stage("FAIL", brightness=1.20)["metrics"],
                  "stage2Metrics": stage()["metrics"],
                  "metrics": {"referenceFitLoss": .5,
                              "directProxy": {"postAttackShape": {"maxViolationDb": 2.0},
                                  "dynamicSpan": {"maxViolationDb": 4.0},
                                  "brightnessDirection": {"minimumDirectionMargin": -.1},
                                  "directLevel": {"maxViolationDb": -2.0},
                                  "peakWorstDbfs": -2.0, "guardHitTotal": 0, "finite": True}},
                  "measurement": {"invalidCount": 0}}
        value, details = stage2b_objective_result(trial, {"x": .2}, lambda: result)
        self.assertEqual(value, .75)
        self.assertEqual(details["stage_reached"], "2B")
        self.assertEqual(tuple(trial.constraint_order), STAGE2B_CONSTRAINT_KEYS)
        self.assertGreater(trial.constraints["stage1_violation"], 0)
        self.assertLessEqual(trial.constraints["stage2_violation"], 0)
        self.assertEqual(trial.constraints["stage2b_violation"], 4.0)
        self.assertTrue(trial.user_attrs["stage2_pass"])

    def test_measurement_invalid_with_no_pitch_estimate_is_not_pitch_failure(self):
        trial = FakeTrial()
        result = stage(invalid=2)
        stage1_objective_result(trial, {}, lambda _which: result)
        self.assertEqual(trial.constraints["pitch_violation"], 0.0)
        self.assertEqual(trial.constraints["measurement_invalid"], 2.0)
        self.assertGreater(trial.constraints["stage1_violation"], 0.0)

    def test_infrastructure_error_propagates_for_optuna_fail_state(self):
        trial = FakeTrial()
        def evaluate(_which):
            raise RuntimeError("candidate build failed")
        with self.assertRaisesRegex(RuntimeError, "candidate build failed"):
            stage2_objective_result(trial, {}, evaluate)

    def test_split_gpsampler_studies_complete_with_fixed_constraint_schemas(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = f"sqlite:///{Path(directory) / 'split.db'}"
            stage1 = optuna.create_study(study_name="stage1", storage=storage,
                sampler=optuna.samplers.GPSampler(seed=7, deterministic_objective=True, n_startup_trials=1))
            def objective1(trial):
                value, _ = stage1_objective_result(trial, {}, lambda _: stage(result="FAIL", brightness=1.20))
                return value
            stage1.optimize(objective1, n_trials=2)
            self.assertEqual([trial.state.name for trial in stage1.trials], ["COMPLETE", "COMPLETE"])
            self.assertTrue(all(tuple(trial.user_attrs["constraints"]) == STAGE1_CONSTRAINT_KEYS for trial in stage1.trials))

            stage2 = optuna.create_study(study_name="stage2", storage=storage,
                sampler=optuna.samplers.GPSampler(seed=7, deterministic_objective=True, n_startup_trials=1))
            calls = []
            def objective2(trial):
                def evaluate(which):
                    calls.append(which)
                    return stage(result="FAIL", brightness=1.20) if which == 1 else stage()
                value, _ = stage2_objective_result(trial, {}, evaluate)
                return value
            stage2.optimize(objective2, n_trials=2)
            self.assertEqual([trial.state.name for trial in stage2.trials], ["COMPLETE", "COMPLETE"])
            self.assertEqual(calls, [1, 2, 1, 2])
            self.assertTrue(all(tuple(trial.user_attrs["constraints"]) == STAGE2_CONSTRAINT_KEYS for trial in stage2.trials))


if __name__ == "__main__":
    unittest.main()
