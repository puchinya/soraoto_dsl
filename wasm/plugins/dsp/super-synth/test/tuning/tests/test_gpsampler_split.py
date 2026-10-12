import sys
import tempfile
import unittest
from pathlib import Path

import optuna

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import run_split_gpsampler as split  # noqa: E402
from optimize_gpsampler import run as run_mixed  # noqa: E402


class SplitStudyContractTests(unittest.TestCase):
    def test_study_names_include_full_search_identity_and_version(self):
        digest = "d502ea1b9652723a742f82e1bdd48323145c19136fa21c8be672821e6142319e"
        self.assertEqual(split.stage_study_name(1, digest), f"issue-7-grand-v9-stage1-gp-v4-{digest}")
        self.assertEqual(split.stage_study_name(2, digest), f"issue-7-grand-v9-stage2-gp-v3-{digest}")

    def test_mixed_runner_refuses_to_resume(self):
        with self.assertRaisesRegex(RuntimeError, "READ_ONLY_ARCHIVE"):
            run_mixed()

    def test_archive_preserves_all_trial_rows_and_marks_old_study_read_only(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "archive.db"
            storage = f"sqlite:///{db}"
            study = optuna.create_study(study_name="issue-7-grand-v9-opt-old", storage=storage)
            study.optimize(lambda trial: trial.suggest_float("x", 0, 1), n_trials=2)
            output = Path(directory) / "archive.json"
            old_path = split.ARCHIVE_PATH
            split.ARCHIVE_PATH = output
            try:
                result = split.archive_mixed_studies(storage, {
                    "sourceRevision": "rev", "sourceTreeSha256": "tree",
                    "evaluatorSha256": "eval", "searchSpaceSha256": "space",
                })
            finally:
                split.ARCHIVE_PATH = old_path
            reopened = optuna.load_study(study_name=study.study_name, storage=storage)
            self.assertEqual(reopened.user_attrs["workflow_state"], "READ_ONLY_ARCHIVE")
            self.assertEqual(result["studies"][0]["trialCount"], 2)
            self.assertEqual(len(result["studies"][0]["trials"]), 2)
            self.assertTrue(output.exists())

    def test_incompatible_historical_data_is_not_replayed(self):
        archive = {"studies": [{"trials": [{
            "state": "COMPLETE", "parameters": {"x": 0.2}, "objective": 0.5,
            "provenanceCompatibleWithCurrent": False,
            "userAttributes": {"stage1_metrics": {"referenceFitLoss": 0.5}},
        }]}]}
        candidates = split.compatible_legacy_candidates(archive, {
            "sourceRevision": "new", "sourceTreeSha256": "tree",
            "evaluatorSha256": "eval", "searchSpaceSha256": "space",
        })
        self.assertEqual(candidates, [])

    def test_compatible_historical_metrics_are_replayable_without_render(self):
        identity = {"sourceRevision": "rev", "sourceTreeSha256": "tree",
                    "evaluatorSha256": "eval", "searchSpaceSha256": "space"}
        metrics = {"referenceFitLoss": 0.4, "brightnessRatio": 1.31}
        attrs = {"source_revision": "rev", "source_tree_sha256": "tree",
                 "evaluator_sha256": "eval", "search_space_sha256": "space",
                 "config_sha256": "config", "wasm_sha256": "wasm",
                 "candidate_id": "old-1", "stage1_metrics": metrics,
                 "measurement_invalid_count": 0, "candidate_result": "PASS"}
        archive = {"studies": [{"trials": [{"state": "COMPLETE", "parameters": {"x": 0.2},
            "objective": 0.4, "provenanceCompatibleWithCurrent": True, "userAttributes": attrs}]}]}
        rows = split.compatible_legacy_candidates(archive, identity)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["stage1"]["metrics"], metrics)
        self.assertEqual(rows[0]["stage1Loss"], 0.4)

    def test_prior_stage2_pass_vector_is_rerender_seed_only(self):
        archive = {"studies": [{"trials": [{"state": "COMPLETE", "parameters": {"x": 0.3},
            "userAttributes": {"stage_reached": 2, "candidate_result": "PASS", "candidate_id": "old"}}]}]}
        seed = split.previous_stage2_pass_vector(archive)
        self.assertEqual(seed, {"parameters": {"x": 0.3}, "candidateId": "old"})

    def test_duplicate_seed_vector_is_enqueued_once(self):
        with tempfile.TemporaryDirectory() as directory:
            study = optuna.create_study(storage=f"sqlite:///{Path(directory) / 'queue.db'}")
            self.assertTrue(split.enqueue_once(study, {"x": 0.5}, "test"))
            self.assertFalse(split.enqueue_once(study, {"x": 0.5}, "test"))
            self.assertEqual(len(study.get_trials()), 1)


if __name__ == "__main__":
    unittest.main()
