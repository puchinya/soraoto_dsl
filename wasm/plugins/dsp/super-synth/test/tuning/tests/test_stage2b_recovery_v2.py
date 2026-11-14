import json
import sys
import tempfile
import unittest
from pathlib import Path

import optuna

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import run_stage2b_gpsampler as runner  # noqa: E402
from constraints import STAGE2B_CONSTRAINT_KEYS  # noqa: E402


def stage_metrics():
    return {"referenceFitLoss": 0.75, "brightnessRatio": 1.30, "peakDbfs": -1.0,
            "guardHits": 0, "measurementInvalidCount": 0, "lowRegisterBuzz": 0.10,
            "pitchErrorsCents": [2.0, -5.0], "finite": True,
            "harmonicSparsity": {"h2ToH1": 0.30, "h3ToH1": 0.20}}


def result_for(params, index, identity):
    metrics = stage_metrics()
    return {"schemaVersion": 1, "candidateId": f"old-{index}", "parameters": params,
            "result": "COMPLETE", "stage2bReached": True, "sourceRevision": identity["sourceRevision"],
            "sourceTreeSha256": identity["sourceTreeSha256"],
            "evaluatorSha256": identity.get("resultEvaluatorSha256", identity["evaluatorSha256"]),
            "subsetSha256": identity["subsetSha256"], "sourceDirty": True,
            "configSha256": f"config-{index}", "wasmSha256": f"wasm-{index}",
            "stage1Result": "PASS", "stage2Result": "PASS", "stage1Metrics": metrics,
            "stage2Metrics": metrics, "metrics": {"referenceFitLoss": 0.75, "directProxy": {
                "postAttackShape": {"maxViolationDb": 2.0}, "dynamicSpan": {"maxViolationDb": 4.0},
                "brightnessDirection": {"minimumDirectionMargin": 0.1},
                "directLevel": {"maxViolationDb": -2.0}, "peakWorstDbfs": -1.0,
                "guardHitTotal": 0, "finite": True}},
            "measurement": {"invalidCount": 0, "totalCount": 24}}


class FakeTrial:
    def __init__(self, number, params, user_attrs):
        self.number = number
        self.params = params
        self.user_attrs = user_attrs
        self.state = optuna.trial.TrialState.COMPLETE
        self.value = 0.75
        self.constraints = {}
        self.constraint_order = []

    def set_constraint(self, name, value):
        self.constraints[name] = value
        self.constraint_order.append(name)

    def set_user_attr(self, name, value):
        self.user_attrs[name] = value


class FakeStudy:
    def __init__(self, trials, attrs):
        self.trials = trials
        self.user_attrs = attrs
        self.study_name = "v1-parent"


class Stage2BRecoveryV2Tests(unittest.TestCase):
    def test_unique_historical_import_is_18_with_two_completed_oat(self):
        with tempfile.TemporaryDirectory() as directory:
            original_root = runner.ROOT
            runner.ROOT = Path(directory)
            try:
                identity = {"sourceRevision": "abc", "sourceTreeSha256": "tree",
                            "evaluatorSha256": "eval", "searchSpaceSha256": "space",
                            "subsetSha256": "subset", "presetSha256": "preset"}
                prior = [{"parameters": {"x": float(i)}, "sourceCandidateId": f"base-{i}",
                          "sourceLoss": float(i)} for i in range(16)]
                oat = [{"parameters": {"x": 100.0 + i}, "parameter": "x", "direction": str(i)}
                       for i in range(12)]
                all_rows = [(item, "stage2-prior-candidate") for item in prior]
                all_rows += [(item, "one-at-a-time-authority-probe") for item in oat[:2]]
                trials = []
                for i, (item, seed_kind) in enumerate(all_rows):
                    params = item["parameters"]
                    result = result_for(params, i, identity)
                    result["sourceCandidateId"] = item.get("sourceCandidateId", f"oat-{i}")
                    path = Path(directory) / f"result-{i}.json"
                    path.write_text(json.dumps(result))
                    attrs = {"stage_reached": "2B", "seed_kind": seed_kind,
                             "candidate_id": result["candidateId"], "result_path": path.name,
                             "source_candidate_id": item.get("sourceCandidateId", "base-0"),
                             "source_tree_sha256": identity["sourceTreeSha256"],
                             "evaluator_identity_sha256": identity["evaluatorSha256"],
                             "search_space_sha256": identity["searchSpaceSha256"],
                             "subset_sha256": identity["subsetSha256"],
                             "config_sha256": result["configSha256"], "wasm_sha256": result["wasmSha256"],
                             "constraints": {key: 0.0 for key in STAGE2B_CONSTRAINT_KEYS}}
                    trials.append(FakeTrial(i, params, attrs))
                parent = FakeStudy(trials, {"sourceIdentity": identity,
                                           "constraintSchema": list(STAGE2B_CONSTRAINT_KEYS)})
                seeds = runner.historical_stage2b_seeds(parent, identity, prior, oat)
                self.assertEqual(len(seeds), 18)
                self.assertEqual(sum(seed["seedKind"] == "stage2-prior-candidate" for seed in seeds), 16)
                self.assertEqual(sum(seed["seedKind"] == "one-at-a-time-authority-probe" for seed in seeds), 2)
                self.assertEqual(len({runner.canonical(seed["parameters"]) for seed in seeds}), 18)
                self.assertEqual(seeds[0]["sourceCandidateId"], "base-0")
                self.assertEqual(seeds[-1]["sourceCandidateId"], "base-0")
            finally:
                runner.ROOT = original_root

    def test_replay_populates_the_fixed_constraint_vector_without_evaluator(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original_root = runner.ROOT
            runner.ROOT = root
            try:
                params = {"x": 0.5}
                identity = {"evaluatorSha256": "orchestrator-eval", "resultEvaluatorSha256": "eval",
                            "searchSpaceSha256": "space"}
                result = result_for(params, 1, {"sourceRevision": "abc", "sourceTreeSha256": "tree",
                                                "evaluatorSha256": "eval", "subsetSha256": "subset"})
                path = root / "result.json"
                path.write_text(json.dumps(result))
                trial = FakeTrial(1, params, {"historical_parent_trial_number": 10})
                value = runner.replay_stage2b_result(trial, params, result, path, identity, "v1-parent")
                self.assertEqual(value, 0.75)
                self.assertEqual(tuple(trial.constraint_order), STAGE2B_CONSTRAINT_KEYS)
                self.assertTrue(trial.user_attrs["historical_replay"])
                self.assertEqual(trial.user_attrs["historical_parent_trial_number"], 10)
                self.assertEqual(trial.user_attrs["elapsed_seconds"], 0.0)
                self.assertEqual(trial.user_attrs["evaluator_identity_sha256"], "orchestrator-eval")
                self.assertEqual(trial.user_attrs["result_evaluator_sha256"], "eval")
            finally:
                runner.ROOT = original_root

    def test_waiting_fixed_parameters_are_not_enqueued_twice(self):
        with tempfile.TemporaryDirectory() as directory:
            study = optuna.create_study(storage=f"sqlite:///{Path(directory) / 'recovery.db'}")
            first = {"parameters": {"x": 0.5}}
            second = {"parameters": {"x": 0.6}}
            study.enqueue_trial(first["parameters"])
            added = runner.enqueue_missing(study, [first, second], "oat")
            self.assertEqual(added, 1)
            waiting = [trial for trial in study.trials if trial.state == optuna.trial.TrialState.WAITING]
            self.assertEqual(len(waiting), 2)
            fixed = {runner.canonical(trial.system_attrs["fixed_params"]) for trial in waiting}
            self.assertEqual(fixed, {runner.canonical(first["parameters"]), runner.canonical(second["parameters"])})


if __name__ == "__main__":
    unittest.main()
