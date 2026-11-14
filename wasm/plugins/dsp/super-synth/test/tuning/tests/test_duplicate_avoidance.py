import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from optimize_gpsampler import duplicate_observation  # noqa: E402


class ExistingTrial:
    def __init__(self):
        self.params = {"x": 0.25}
        self.user_attrs = {
            "source_revision": "rev-a",
            "source_tree_sha256": "tree-a",
            "evaluator_sha256": "eval-a",
            "search_space_sha256": "space-a",
            "constraints": {"stage1_violation": 0.5},
        }


class FakeStudy:
    def get_trials(self, **_kwargs):
        return [ExistingTrial()]


class DuplicateAvoidanceTests(unittest.TestCase):
    def test_same_parameters_and_identity_reuse_complete_observation(self):
        result = duplicate_observation(
            FakeStudy(),
            {"x": 0.25},
            {
                "sourceRevision": "rev-a",
                "wasmTreeSha256": "tree-a",
                "evaluatorSha256": "eval-a",
                "searchSpaceSha256": "space-a",
            },
        )
        self.assertIsNotNone(result)

    def test_different_source_revision_is_not_reused(self):
        result = duplicate_observation(
            FakeStudy(),
            {"x": 0.25},
            {
                "sourceRevision": "rev-b",
                "wasmTreeSha256": "tree-a",
                "evaluatorSha256": "eval-a",
                "searchSpaceSha256": "space-a",
            },
        )
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
