from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[7]
TUNING = ROOT / "wasm/plugins/dsp/super-synth/test/tuning"
TOOLS = ROOT / "wasm/plugins/dsp/super-synth/test/tools"
sys.path.insert(0, str(TUNING))
import run_stage2j_c8_path_diagnostic as stage2j  # noqa: E402
import analyze_stage2f_v2_residuals as stage2f  # noqa: E402


def fake_candidate(candidate_id: str, *, span_count: int = 0, span_violation: float = -1,
                   post_count: int = 0, post_violation: float = -1,
                   extra: dict | None = None) -> dict:
    constraints = {
        "dynamic_span_violation_db": span_violation,
        "post_attack_shape_violation_db": post_violation,
        "stage1_violation": 0,
        "stage2_violation": 0,
        "stage2b_violation": 0,
    }
    constraints.update(extra or {})
    return {"candidateId": candidate_id, "raw": {"constraints": constraints,
            "parameters": {"identity": candidate_id}},
            "spanRows": [{"violationDb": 1.0} for _ in range(span_count)],
            "cells": [{"violationDb": 1.0} for _ in range(post_count)]}


class Stage2JSelectionTests(unittest.TestCase):
    def test_allowed_shape_and_span_failures_remain_eligible_and_exact_tuple_ranks(self):
        candidates = [
            fake_candidate(stage2j.L1_IDS[0], span_count=2, post_count=2, post_violation=3),
            fake_candidate(stage2j.L1_IDS[1], span_count=3, span_violation=2, post_count=0, post_violation=4),
            fake_candidate(stage2j.L1_IDS[2], span_count=1, span_violation=3, post_count=0, post_violation=5),
        ]
        result = stage2j.rank_l1_candidates(candidates)
        self.assertEqual(result["status"], "READY")
        self.assertEqual(result["selected"]["candidateId"], stage2j.L1_IDS[2])
        self.assertEqual(result["selected"]["rankingTuple"], [1, 3.0, 0, 5.0, stage2j.L1_IDS[2]])

    def test_unrelated_positive_constraint_filters_candidate_but_duplicate_summaries_do_not(self):
        candidates = [
            fake_candidate(stage2j.L1_IDS[0], extra={"independent_gate": 0.01,
                            "stage1_violation": 9, "stage2_violation": 8, "stage2b_violation": 7}),
            fake_candidate(stage2j.L1_IDS[1], span_count=1, span_violation=1,
                           extra={"stage1_violation": 9, "stage2_violation": 8, "stage2b_violation": 7}),
            fake_candidate(stage2j.L1_IDS[2], span_count=1, span_violation=2),
        ]
        result = stage2j.rank_l1_candidates(candidates)
        self.assertEqual([row["candidateId"] for row in result["filteredCandidates"]], [stage2j.L1_IDS[0]])
        self.assertEqual(result["filteredCandidates"][0]["independentPositiveConstraints"], {"independent_gate": 0.01})
        self.assertEqual(result["selected"]["candidateId"], stage2j.L1_IDS[1])

    def test_candidate_id_is_final_tie_breaker(self):
        rows = [fake_candidate(stage2j.L1_IDS[1]), fake_candidate(stage2j.L1_IDS[0]),
                fake_candidate(stage2j.L1_IDS[2])]
        self.assertEqual(stage2j.rank_l1_candidates(rows)["selected"]["candidateId"], min(stage2j.L1_IDS))

    def test_no_survivor_is_explicit_block(self):
        rows = [fake_candidate(cid, extra={"independent_gate": 0.1}) for cid in stage2j.L1_IDS]
        result = stage2j.rank_l1_candidates(rows)
        self.assertEqual(result["status"], "BLOCKED_NO_STAGE2J_DIAGNOSTIC_BASELINE")
        self.assertIsNone(result["selected"])


class Stage2JBudgetAndProvenanceTests(unittest.TestCase):
    def test_only_physical_count_24_authorizes_one_new_candidate(self):
        self.assertTrue(stage2j.new_candidate_slot_allowed(24))
        self.assertFalse(stage2j.new_candidate_slot_allowed(25))
        self.assertFalse(stage2j.new_candidate_slot_allowed(23))
        self.assertEqual(stage2j.physical_budget({"physicalRenderCount": 21}), (24, 25))
        with self.assertRaisesRegex(RuntimeError, "BLOCKED_PHYSICAL_EVALUATION_BUDGET"):
            stage2j.physical_budget({"physicalRenderCount": 23})

    def test_completed_pair_reuses_only_exact_matching_provenance(self):
        provenance = {key: f"value-{key}" for key in stage2j.PROVENANCE_KEYS}
        result = {"result": "COMPLETE", "candidateId": "c1", "parameters": provenance["candidateParameters"],
                  "provenance": provenance}
        manifest = {"status": "COMPLETE", "candidateId": "c1", "provenance": provenance,
                    "resultSha256": stage2j.canonical_sha(result)}
        self.assertTrue(stage2j.complete_pair_reusable(manifest, result, {**provenance, "candidateId": "c1"}))
        self.assertFalse(stage2j.complete_pair_reusable(manifest, None, provenance))
        self.assertFalse(stage2j.complete_pair_reusable({**manifest, "status": "EXECUTION_STARTED"}, result, provenance))
        self.assertFalse(stage2j.complete_pair_reusable({**manifest, "resultSha256": "bad"}, result, provenance))

    def test_each_provenance_dimension_mismatch_is_detected(self):
        expected = {key: f"same-{key}" for key in stage2j.PROVENANCE_KEYS}
        for key in stage2j.PROVENANCE_KEYS:
            actual = dict(expected)
            actual[key] = f"changed-{key}"
            self.assertEqual(stage2j.compare_provenance(expected, actual), [key])

    def test_head_held_release_mode_is_required_for_stage2j_preflight(self):
        source = subprocess.check_output(["rtk", "git", "show",
            "HEAD:wasm/plugins/dsp/super-synth/test/concert-grand-regression.test.js"],
            cwd=ROOT, text=True)
        expected = "SUPERSYNTH_HELD_RELEASE_ONLY" in source and "HELD_RELEASE_METRICS" in source
        self.assertEqual(stage2j.held_release_mode_available_in_head(), expected)


class Stage2JCoverageAndDiagnosticsTests(unittest.TestCase):
    def subset(self, velocities):
        return {"cells": [{"pitch": 45, "velocity": velocity} for velocity in velocities]}

    def test_pitch45_requires_exact_sixteen_layers(self):
        stage2j.validate_stage2b_pitch45_coverage(self.subset(stage2j.EXPECTED_VELOCITIES))
        for invalid in (stage2j.EXPECTED_VELOCITIES[:-1],
                        stage2j.EXPECTED_VELOCITIES + (14,),
                        stage2j.EXPECTED_VELOCITIES + (125,)):
            with self.assertRaisesRegex(RuntimeError, "BLOCKED_STAGE2J_REQUIRED_COVERAGE"):
                stage2j.validate_stage2b_pitch45_coverage(self.subset(invalid))

    def test_window_math_uses_authoritative_shared_helper(self):
        helper = TOOLS / "stage3-direct-reference-metrics.cjs"
        script = ("const m=require(process.argv[1]); const a={envelopeDbfs:[0,0,5,3,-4]},"
                  "r={envelopeDbfs:[0,0,2,1,-1]}; console.log(JSON.stringify(m.postAttackResiduals(a,r)))")
        out = subprocess.check_output(["node", "-e", script, str(helper)], text=True)
        measured = json.loads(out)
        self.assertEqual(measured["renderEarlyRelDb"], 2)
        self.assertEqual(measured["referenceEarlyRelDb"], 1)
        self.assertEqual(measured["earlyResidualDb"], 1)
        self.assertEqual(measured["renderLateRelDb"], -7)
        self.assertEqual(measured["referenceLateRelDb"], -2)
        self.assertEqual(measured["lateResidualDb"], -5)
        self.assertEqual(measured["postAttackShapeErrorDb"], 5)

    def test_exact_diagnostic_variants_and_mask_reset_on_success_and_failure(self):
        tool = TOOLS / "capture-stage2j-c8-path.cjs"
        script = r"""
const m=require(process.argv[1]);
const expected=[['normal',0,null],['board_off',0,0],['board_off_no_dry_transverse',1,0],['board_off_no_dry_bridge',2,0],['board_off_no_dry_contact',4,0]];
if(JSON.stringify(m.VARIANTS.map(v=>[v.name,v.mask,v.boardMix]))!==JSON.stringify(expected))throw Error('variants');
const build=m.buildRootFromWasm('/repo/build/wasm/plugins/dsp/super-synth/plugin.wasm');
if(build!=='/repo/build/wasm')throw Error(`build root ${build}`);
for(const fail of [false,true]){
 const masks=[],h={e:{soraoto_supersynth_diagnostic_set_ablation_mask:x=>masks.push(x)}};
 try{m.withAblationMask(h,4,()=>{if(fail)throw Error('capture-failure');return 7;});}catch(e){if(!fail)throw e;}
 if(JSON.stringify(masks)!=='[4,0]')throw Error('mask-reset');
}
process.stdout.write('PASS');
"""
        out = subprocess.check_output(["node", "-e", script, str(tool)], text=True)
        self.assertEqual(out, "PASS")

    def test_diagnostic_capture_cannot_promote_stage3(self):
        source = (TOOLS / "capture-stage2j-c8-path.cjs").read_text()
        self.assertIn("stage2PromotionEvidence:false", source)
        self.assertIn("diagnosticOnly:true", source)


class Stage2JPreservationTests(unittest.TestCase):
    def test_protected_evidence_snapshot_is_stable_without_writes(self):
        before = stage2j.protected_snapshot()
        after = stage2j.protected_snapshot()
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
