from __future__ import annotations

import json
import hashlib
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from constraints import STAGE2B_CONSTRAINT_KEYS, STAGE2E_CONSTRAINT_KEYS
from run_stage2f_anchored_recovery import (
    DELIVERY_REQUIRED_PATHS,
    MAX_NEW_EVALUATIONS,
    PRIOR_PHYSICAL_RENDERS,
    TOTAL_PHYSICAL_BUDGET,
    V1_MANIFEST_PATH,
    V1_RUN_PATH,
    load_v1_anchor_observations,
    no_feasible_classification,
    reusable_identity_matches,
    source_identity,
)
from stage2f_anchored import (
    ALL_ORIGINAL_AXES,
    ANCHOR_IDS,
    FROZEN_AXES,
    build_anchor_manifest,
    local_points,
    pitch_diagnostics,
    recoverable_seed_qualification,
    resolve_anchors,
    STAGE2F_RECOVERY_OBJECTIVE_KEYS,
    verify_manifest,
)


class Stage2FAnchorTests(unittest.TestCase):
    @unittest.skipUnless(V1_RUN_PATH.is_file() and V1_MANIFEST_PATH.is_file(), "requires private historical acoustic evidence")
    def test_v1_anchor_evidence_is_reused_without_mutating_v1_files(self):
        root = Path(__file__).resolve().parents[7]
        v2_manifest_path = root / ".agent-state/issues/7/calibration-optuna/stage2f-v2/manifests/stage2f-v2-anchor-manifest.json"
        v2_manifest = json.loads(v2_manifest_path.read_text(encoding="utf-8"))
        saved_run = json.loads(V1_RUN_PATH.read_text(encoding="utf-8"))
        saved_identity = saved_run["sourceIdentity"]
        anchors = resolve_anchors()
        self.assertTrue(verify_manifest(json.loads(V1_MANIFEST_PATH.read_text(encoding="utf-8"))))
        self.assertEqual(reusable_identity_matches(saved_identity, saved_identity), (True, []))

        # Validate the preserved observation using its historical identity first. This checks the
        # stored result, exact 32-key constraints, result bytes and hashes without weakening the
        # production current-HEAD reuse guard.
        historical = load_v1_anchor_observations(anchors, saved_identity)
        v2_anchor_hashes = {row["v1ResultPath"]: row["v1ResultSha256"] for row in v2_manifest["anchors"]}
        protected_paths = {V1_MANIFEST_PATH, V1_RUN_PATH, v2_manifest_path}
        for row in historical.values():
            result_path = root / row["rawResultPath"]
            result_bytes = result_path.read_bytes()
            self.assertEqual(hashlib.sha256(result_bytes).hexdigest(), row["resultSha256"])
            self.assertEqual(v2_anchor_hashes.get(row["rawResultPath"]), row["resultSha256"])
            protected_paths.add(result_path)
        before = {path: path.read_bytes() for path in protected_paths}

        current_identity = source_identity()
        compatible, mismatches = reusable_identity_matches(current_identity, saved_identity)
        self.assertEqual(mismatches, [] if compatible else ["sourceRevision"])
        if compatible:
            reused = load_v1_anchor_observations(anchors, current_identity)
        else:
            with self.assertRaisesRegex(RuntimeError, r"BLOCKED_ANCHOR_EVIDENCE_IDENTITY: acoustic identity mismatch: sourceRevision"):
                load_v1_anchor_observations(anchors, current_identity)
            reused = historical
        self.assertEqual(set(reused), {row["sourceCandidateId"] for row in anchors})
        self.assertTrue(all(row["result"].get("productionSimd") is True for row in reused.values()))
        self.assertTrue(all(row["result"]["constraints"]["release_tail2_min_violation"] > 0 for row in reused.values()))
        self.assertEqual({path: path.read_bytes() for path in protected_paths}, before)

    def test_acoustic_reuse_identity_ignores_runner_bookkeeping_only(self):
        baseline = {key: key for key in (
            "sourceRevision", "sourceConfigSha256", "evaluatorSha256", "searchSpaceSha256",
            "oatResultSha256", "subsetSha256", "studyName", "stage2eConstraintSchemaSha256",
        )}
        previous = {**baseline, "sourceTreeSha256": "old-tree", "stage2fEvaluatorSha256": "old-runner"}
        current = {**baseline, "sourceTreeSha256": "new-tree", "stage2fEvaluatorSha256": "new-runner"}
        self.assertEqual(reusable_identity_matches(current, previous), (True, []))
        current["evaluatorSha256"] = "changed-evaluator"
        matches, mismatches = reusable_identity_matches(current, previous)
        self.assertFalse(matches)
        self.assertEqual(mismatches, ["evaluatorSha256"])

    def test_source_revision_only_is_historical_but_blocks_current_reuse(self):
        baseline = {key: key for key in (
            "sourceRevision", "sourceConfigSha256", "evaluatorSha256", "searchSpaceSha256",
            "oatResultSha256", "subsetSha256", "studyName", "stage2eConstraintSchemaSha256",
        )}
        current = {**baseline, "sourceRevision": "current-revision"}
        compatible, mismatches = reusable_identity_matches(current, baseline)
        self.assertFalse(compatible)
        self.assertEqual(mismatches, ["sourceRevision"])
        for key in set(baseline) - {"sourceRevision"}:
            changed = {**current, key: "changed-value"}
            compatible, mismatches = reusable_identity_matches(changed, baseline)
            self.assertFalse(compatible)
            self.assertEqual(mismatches, ["sourceRevision", key])

    def test_cumulative_physical_render_budget_reserves_one_unused_slot(self):
        self.assertEqual(PRIOR_PHYSICAL_RENDERS, 3)
        self.assertEqual(MAX_NEW_EVALUATIONS, 21)
        self.assertEqual(PRIOR_PHYSICAL_RENDERS + MAX_NEW_EVALUATIONS, 24)
        self.assertEqual(TOTAL_PHYSICAL_BUDGET, 25)

    def test_only_named_anchors_can_use_tail2_seed_exception_at_exact_five_percent(self):
        constraints = {key: 0.0 for key in STAGE2E_CONSTRAINT_KEYS}
        constraints["release_tail2_min_violation"] = 0.05
        topology = {"pianoStringUnison": 0.4, "pianoSoundboardMix": 0.5}
        allowed, status, failures, shortfall = recoverable_seed_qualification(
            "stage2b-v1-0001", constraints, topology, 0.00015 * 0.95,
        )
        self.assertTrue(allowed)
        self.assertEqual(status, "RECOVERABLE_SEED")
        self.assertEqual(failures, [])
        self.assertAlmostEqual(shortfall, 0.05)
        outside, status, failures, _ = recoverable_seed_qualification(
            "stage2b-v1-0001", constraints, topology, 0.00015 * 0.949999,
        )
        self.assertFalse(outside)
        self.assertEqual(status, "INELIGIBLE")
        self.assertIn("release_tail2_outside_seed_exception", failures)
        outside_id, status, failures, _ = recoverable_seed_qualification(
            "unrelated-candidate", constraints, topology, 0.000145,
        )
        self.assertFalse(outside_id)
        self.assertEqual(status, "INELIGIBLE")
        self.assertIn("anchor_id_not_authorized", failures)

    def test_seed_tail2_requires_finite_positive_shortfall_and_all_other_gates(self):
        topology = {"pianoStringUnison": 0.8, "pianoSoundboardMix": 0.8}
        for tail2 in (float("nan"), float("inf"), 0.0, -1.0):
            constraints = {key: 0.0 for key in STAGE2E_CONSTRAINT_KEYS}
            allowed, _, _, _ = recoverable_seed_qualification("stage2b-v1-0015", constraints, topology, tail2)
            self.assertFalse(allowed, tail2)

        equal_constraints = {key: 0.0 for key in STAGE2E_CONSTRAINT_KEYS}
        allowed, _, _, _ = recoverable_seed_qualification("stage2b-v1-0015", equal_constraints, topology, 0.00015)
        self.assertFalse(allowed)  # Strict production gate is tail2 > 0.00015.

        for key in (
            "stage1_violation", "stage2_violation", "held_decay_ratio_violation",
            "release_tail1_min_violation", "release_tail_decay_ratio_violation",
            "release_finite_violation", "stuck_voice_violation", "pitch", "buzz", "peak", "guard",
        ):
            constraints = {name: 0.0 for name in STAGE2E_CONSTRAINT_KEYS}
            if key in constraints:
                constraints[key] = 0.001
            else:
                # The measured hard checks are represented inside the stage aggregates.
                constraints["stage2_violation"] = 0.001
            constraints["release_tail2_min_violation"] = 0.03
            allowed, _, failures, _ = recoverable_seed_qualification(
                "stage2b-v1-0016", constraints, topology, 0.0001455,
            )
            self.assertFalse(allowed, key)
            self.assertNotIn("release_tail2_min_violation", failures)

    def test_strict_candidate_feasibility_does_not_inherit_seed_waiver(self):
        constraints = {key: 0.0 for key in STAGE2E_CONSTRAINT_KEYS}
        constraints["release_tail2_min_violation"] = 0.001
        self.assertFalse(all(value <= 0.0 for value in constraints.values()))

    def test_seed_can_retain_local_recovery_objective_failures_without_waiving_safety(self):
        constraints = {key: 0.0 for key in STAGE2E_CONSTRAINT_KEYS}
        constraints["release_tail2_min_violation"] = 0.05
        for key in STAGE2F_RECOVERY_OBJECTIVE_KEYS:
            constraints[key] = 0.25
        topology = {"pianoStringUnison": 0.4, "pianoSoundboardMix": 0.5}
        allowed, status, _, _ = recoverable_seed_qualification(
            "stage2b-v1-0015", constraints, topology, 0.00015 * 0.95,
        )
        self.assertTrue(allowed)
        self.assertEqual(status, "RECOVERABLE_SEED")
        constraints["direct_guard_violation"] = 0.001
        allowed, _, failures, _ = recoverable_seed_qualification(
            "stage2b-v1-0015", constraints, topology, 0.000145,
        )
        self.assertFalse(allowed)
        self.assertIn("direct_guard_violation", failures)

    @unittest.skipUnless(V1_RUN_PATH.is_file(), "requires private historical candidate provenance")
    def test_anchor_ids_resolve_by_provenance_and_exact_vector(self):
        anchors = resolve_anchors()
        self.assertEqual(tuple(row["historicalResultId"] for row in anchors), ANCHOR_IDS)
        self.assertEqual([row["sourceCandidateId"] for row in anchors], [
            "split-v3-s2-0001", "split-v3-s2-0015", "split-v3-s2-0016",
        ])
        self.assertEqual([row["sourceStage2TrialId"] for row in anchors], [
            "split-v3-s2-0001", "split-v3-s2-0015", "split-v3-s2-0016",
        ])
        self.assertTrue(all(set(row["parameters"]) == set(ALL_ORIGINAL_AXES) for row in anchors))

    def test_manifest_has_canonical_digest(self):
        from stage2f_anchored import canonical_sha256
        manifest = {"schemaVersion": 1, "anchors": []}
        manifest["canonicalSha256"] = canonical_sha256(manifest)
        self.assertTrue(verify_manifest(manifest))

    def test_local_design_is_exactly_seven_ordered_points_and_freezes_axes(self):
        anchor = {"parameters": {
            "effective_strike_position_c4": 0.137,
            "hammer.compression_scale": 0.0005,
            "piano_hammer_hardness": 0.335,
            "piano_inharmonicity": 0.083,
            "piano_string_unison": 1.0,
            "piano_string_damping": 1.0,
        }}
        rows = local_points(anchor)
        self.assertEqual([row["point"] for row in rows], [f"L{i}" for i in range(1, 8)])
        self.assertEqual([(r["hammer.velocity_hardness_amount"], r["termination_loss_floor_scale"], r["piano_string_damping"]) for r in rows], [
            (0.5, 0.0, 0.0), (0.25, 0.0, 0.0), (0.75, 0.0, 0.0),
            (0.5, 0.25, 0.0), (0.5, 0.5, 0.0), (0.5, 0.0, 0.5), (0.5, 0.0, 1.0),
        ])
        for row in rows:
            for key in FROZEN_AXES:
                self.assertEqual(row[key], anchor["parameters"][key])

    def test_dependency_closure_and_dry_run_need_no_private_history_or_audio(self):
        root = Path(__file__).resolve().parents[7]
        self.assertTrue(all((root / path).is_file() for path in DELIVERY_REQUIRED_PATHS))
        import subprocess
        runner = Path(__file__).resolve().parents[1] / "run_stage2f_anchored_recovery.py"
        process = subprocess.run([sys.executable, str(runner), "--dry-run"], capture_output=True, text=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        report = json.loads(process.stdout)
        self.assertEqual(report["result"], "PASS")
        self.assertFalse(report["historicalEvidenceRead"])
        self.assertFalse(report["productionBuildInvoked"])
        self.assertEqual(report["physicalRenders"], 0)

    def test_pareto_summary_reads_nested_candidate_constraints(self):
        constraints = {key: 0.0 for key in STAGE2E_CONSTRAINT_KEYS}
        constraints["post_attack_shape_violation_db"] = 1.0
        classification, per_anchor = no_feasible_classification([{
            "anchorId": "split-v3-s2-0001",
            "candidateId": "stage2f-split-v3-s2-0001-L1",
            "result": {"constraints": constraints},
        }])
        self.assertEqual(classification, "POST_ATTACK_STILL_UNRESOLVED")
        self.assertFalse(per_anchor["split-v3-s2-0001"]["post_attack_shape"])

    def test_stage2f_schema_is_current_stage2e_not_stage2b(self):
        self.assertEqual(STAGE2E_CONSTRAINT_KEYS[:len(STAGE2B_CONSTRAINT_KEYS)], STAGE2B_CONSTRAINT_KEYS)
        self.assertEqual(STAGE2E_CONSTRAINT_KEYS[-6:], (
            "held_decay_ratio_violation", "release_tail1_min_violation", "release_tail2_min_violation",
            "release_tail_decay_ratio_violation", "release_finite_violation", "stuck_voice_violation",
        ))
        self.assertNotEqual(STAGE2E_CONSTRAINT_KEYS, STAGE2B_CONSTRAINT_KEYS)

    def test_pitch_diagnostics_preserve_failure_without_reclassifying_it_as_invalid(self):
        diag = pitch_diagnostics({"measurementInvalidCount": 0, "pitchCells": [{"valid": True, "pitchMeasurement": {
            "measurement_valid": True,
            "windows": [{"pitch_error_cents": 18.0}, {"pitch_error_cents": 19.0}],
        }}]})
        self.assertEqual(diag["pitchFailureClass"], "OFFSET")
        self.assertEqual(diag["pitchWorstAbsCents"], 19.0)
        unstable = pitch_diagnostics({"measurementInvalidCount": 0, "pitchCells": [{"valid": True, "pitchMeasurement": {
            "measurement_valid": True,
            "window_pitch_spread_cents": 8.01,
            "window_results": [{"pitch_error_cents": 17.0}, {"pitch_error_cents": 25.01}],
        }}]})
        self.assertEqual(unstable["pitchFailureClass"], "WINDOW_INSTABILITY")
        estimator = Path("wasm/plugins/dsp/super-synth/test/tools/piano-pitch-estimator.cjs").read_text()
        current = float(re.search(r"const MAX_WINDOW_PITCH_SPREAD_CENTS = ([0-9.]+)", estimator).group(1))
        from stage2f_anchored import MAX_WINDOW_PITCH_SPREAD_CENTS
        self.assertEqual(MAX_WINDOW_PITCH_SPREAD_CENTS, current)
        invalid = pitch_diagnostics({"measurementInvalidCount": 1, "pitchCells": []})
        self.assertEqual(invalid["pitchFailureClass"], "MEASUREMENT_INVALID")

    def test_public_unison_range_is_not_changed_by_calibration_bound(self):
        descriptor = json.loads(Path("wasm/plugins/dsp/super-synth/descriptor.json").read_text())
        public = next(item for item in descriptor["parameters"] if item["path"] == "piano_string_unison")
        self.assertEqual((public["min"], public["max"]), (0.0, 1.0))
        search = json.loads(Path("wasm/plugins/dsp/super-synth/test/tuning/active-search-space.json").read_text())
        unison = next(item for item in search["dimensions"] if item["name"] == "piano_string_unison")
        self.assertEqual((unison["min"], unison["max"]), (0.4, 1.0))


if __name__ == "__main__":
    unittest.main()
