from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[7]
TUNING = ROOT / "wasm/plugins/dsp/super-synth/test/tuning"
sys.path.insert(0, str(TUNING))
import run_stage2n_revision3 as stage2n  # noqa: E402


class Stage2NRevision3Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.design = (ROOT / "docs/design/plugins/dsp/super-synth/super-synth-design.md").read_text(encoding="utf-8")
        cls.spec = (ROOT / "docs/specs/plugins/dsp/super-synth/super-synth-spec.md").read_text(encoding="utf-8")
        cls.source = (ROOT / "wasm/plugins/dsp/super-synth/src/plugin.c").read_text(encoding="utf-8")
        cls.metadata = (ROOT / "wasm/cmake/super_synth_metadata.py").read_text(encoding="utf-8")
        cls.presets = json.loads((ROOT / "wasm/plugins/dsp/super-synth/presets.json").read_text(encoding="utf-8"))

    def test_super_synth_docs_use_dsl_only_persistence(self):
        for document in (self.design, self.spec):
            self.assertIn("PluginConfigurationV1", document)
            self.assertTrue("no Plugin-owned persistent" in document or "persistent snapshot/load state is absent" in document)
            self.assertIn("transient", document)
            self.assertNotIn("STATE_DIRTY", document)
        self.assertIn("Host reapplies DSL", self.design)

    def test_stage2n_does_not_write_shared_abi_paths(self):
        written = {str(path.relative_to(ROOT)) for path in (
            ROOT / "docs/specs/plugins/dsp/super-synth/super-synth-spec.md",
            ROOT / "docs/design/plugins/dsp/super-synth/super-synth-design.md",
            ROOT / "wasm/cmake/super_synth_metadata.py",
            ROOT / "wasm/plugins/dsp/super-synth/presets.json",
            ROOT / "wasm/plugins/dsp/super-synth/src/plugin.c",
            ROOT / "wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs",
            ROOT / "wasm/plugins/dsp/super-synth/test/tools/evaluate-qmc-candidate.cjs",
            ROOT / "wasm/plugins/dsp/super-synth/test/tools/capture-stage2n-revision3.cjs",
            ROOT / "wasm/plugins/dsp/super-synth/test/tuning/run_stage2n_revision3.py",
            ROOT / "wasm/plugins/dsp/super-synth/test/tuning/tests/test_stage2n_revision3.py",
            ROOT / "docs/status/plugins/dsp/super-synth/stage2n-revision3.md",
        )}
        shared = {str(path.relative_to(ROOT)) for path in stage2n.SHARED_ABI_PATHS}
        self.assertFalse(written & shared)

    def test_profile_revision_three_and_historical_piecewise_hardness_are_present(self):
        config = self.presets["concert_grand"]["engine_config"]
        self.assertEqual(config["revision"], 3)
        self.assertIn("GRAND_PROFILE_REVISION=3", self.metadata)
        self.assertIn("if(v<=pivot){", self.source)
        self.assertIn("return h*(1.0f-amount*t);", self.source)
        self.assertIn("return h+(1.0f-h)*amount*t;", self.source)
        self.assertIn("if((g_stage2m_factor_mask&4u)!=0u)return clampf(h+amount*(v-pivot),0.0f,1.0f);", self.source)
        self.assertNotIn("state_snapshot", self.source.lower())

    def test_hardness_matches_historical_piecewise_curve_at_required_points(self):
        compiler = shutil.which("cc") or shutil.which("clang")
        if compiler is None:
            self.skipTest("no C compiler available for the extracted production function check")
        marker = "static inline float grand_effective_felt_hardness("
        start = self.source.index(marker)
        opening = self.source.index("{", start)
        depth = 0
        end = None
        for index in range(opening, len(self.source)):
            if self.source[index] == "{":
                depth += 1
            elif self.source[index] == "}":
                depth -= 1
                if depth == 0:
                    end = index + 1
                    break
        self.assertIsNotNone(end)
        production_function = self.source[start:end]
        test_source = """
#include <math.h>
#include <stdio.h>
static float clampf(float v,float lo,float hi){return v<lo?lo:(v>hi?hi:v);}
""" + production_function + """
int main(void){
  const float velocities[]={0.0f,14.0f/127.0f,61.0f/127.0f,77.0f/127.0f,124.0f/127.0f,1.0f};
  const float amounts[]={0.0f,0.5f,1.0f};
  for(unsigned a=0;a<3;a++)for(unsigned v=0;v<6;v++)
    printf("%.9g %.9g %.9g\\n",(double)amounts[a],(double)velocities[v],
      (double)grand_effective_felt_hardness(0.3719079878f,velocities[v],amounts[a]));
  return 0;
}
"""
        with tempfile.TemporaryDirectory(prefix="stage2n-hardness-") as temp:
            c_path = Path(temp) / "hardness.c"
            exe_path = Path(temp) / "hardness"
            c_path.write_text(test_source, encoding="utf-8")
            subprocess.run([compiler, "-std=c99", "-O2", str(c_path), "-lm", "-o", str(exe_path)], check=True, capture_output=True, text=True)
            output = subprocess.run([str(exe_path)], check=True, capture_output=True, text=True).stdout
        pivot = 61.0 / 127.0
        base = 0.3719079878
        for line in output.splitlines():
            amount, velocity, actual = map(float, line.split())
            if amount == 0:
                expected = base
            elif velocity <= pivot:
                expected = base * (1 - amount * ((pivot - velocity) / pivot))
            else:
                expected = base + (1 - base) * amount * ((velocity - pivot) / (1 - pivot))
            self.assertAlmostEqual(actual, expected, delta=2e-7)
            self.assertGreaterEqual(actual, 0.0)
            self.assertLessEqual(actual, 1.0)
        left = base * (1 - 0.5 * 1e-6 / pivot)
        right = base + (1 - base) * 0.5 * 1e-6 / (1 - pivot)
        self.assertLess(abs(left - right), 2e-6)

    def test_candidate_vector_and_stage2l_budget_are_frozen(self):
        stage2n.validate_candidate_vector(stage2n.EXPECTED_CANDIDATE)
        search = json.loads(stage2n.SEARCH_PATH.read_text(encoding="utf-8"))
        self.assertEqual(search["candidateBudget"]["remainingGPSamplerCandidates"], 11)
        self.assertEqual(search["maximumCandidateIdentities"], 12)
        self.assertEqual(stage2n.CANDIDATE_ID, "stage2n-r3-candidate-01")
        self.assertEqual(stage2n.MAX_CANDIDATES, 1)

    def test_fixed_stage2e_constraint_order_and_count(self):
        keys = stage2n.stage2e.STAGE2E_CONSTRAINT_KEYS
        self.assertEqual(len(keys), 32)
        values = {key: 0.0 for key in keys}
        self.assertEqual(tuple(stage2n.validate_constraint_vector(values)), keys)
        reordered = dict(reversed(list(values.items())))
        with self.assertRaisesRegex(ValueError, "keys/order"):
            stage2n.validate_constraint_vector(reordered)

    def test_decision_gate_requires_all_constraints_and_distinguishes_pitch_only(self):
        keys = stage2n.stage2e.STAGE2E_CONSTRAINT_KEYS
        result = {"stage1Metrics": {}, "stage2Metrics": {}, "heldRelease": {}, "localTopology": {}}
        preflight = {"midi21": {"measurementValid": True, "constrainedNearFundamentalCents": 13.0,
                                 "currentEstimatorCents": 29.0}}
        constraints = {key: 0.0 for key in keys}
        self.assertEqual(stage2n.classify(result, constraints, preflight), "STAGE2N_STAGE2_PASS")
        constraints["stage2_pitch_violation"] = 0.1
        constraints["stage2_violation"] = 0.1
        self.assertEqual(stage2n.classify(result, constraints, preflight), "BLOCKED_STAGE2N_PITCH_ESTIMATOR")
        constraints["direct_level_violation_db"] = 0.01
        self.assertEqual(stage2n.classify(result, constraints, preflight), "BLOCKED_STAGE2N_MODEL")

    def test_evidence_validator_confirms_mask_011_and_no_stage2n_prior_result(self):
        evidence = stage2n.validate_evidence()
        row = evidence["combination011"]
        self.assertEqual(row["mask"], 3)
        self.assertEqual(row["label"], "011")
        self.assertEqual(len(row["midi45"]), 16)
        self.assertEqual(evidence["stage2mFactorial"]["candidateBudgetAfter"], 1)

    def test_only_missing_near_fundamental_instrumentation_can_retry_same_candidate(self):
        prior_manifest = {"outcome": "BLOCKED_STAGE2N_011_EQUIVALENCE"}
        prior_preflight = {"candidateId": stage2n.CANDIDATE_ID, "parameters": stage2n.EXPECTED_CANDIDATE,
            "productionSimd": True, "stage2mExportsAbsent": True,
            "preflight": {"cellCount": 18,"midi21": {"constrainedNearFundamentalCents": None},
                "equivalence": {"midi45SpanDeltaDb": 0,"c8ShapeViolationDeltaDb": 0,"midi21EstimatorDeltaCents": 0}}}
        self.assertTrue(stage2n.retryable_missing_near_probe(prior_manifest, prior_preflight))
        prior_preflight["preflight"]["equivalence"]["c8ShapeViolationDeltaDb"] = 0.1
        self.assertFalse(stage2n.retryable_missing_near_probe(prior_manifest, prior_preflight))
        prior_preflight["preflight"]["equivalence"]["c8ShapeViolationDeltaDb"] = 0
        prior_preflight["preflight"]["midi21"]["constrainedNearFundamentalCents"] = 13.0
        self.assertFalse(stage2n.retryable_missing_near_probe(prior_manifest, prior_preflight))


if __name__ == "__main__":
    unittest.main()
