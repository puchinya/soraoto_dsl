import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import run_level1_qmc as qmc


class QmcDesignTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.optuna = qmc.load_optuna()
        cls.space = qmc.load_json(qmc.SPACE_PATH)

    def test_exact_six_dimensions_and_domains(self):
        dimensions = self.space["dimensions"]
        self.assertEqual(len(dimensions), 6)
        self.assertEqual([entry["name"] for entry in dimensions], [
            "piano_hammer_hardness", "hammer.compression_scale", "effective_strike_position_c4",
            "piano_string_damping", "piano_string_unison", "piano_inharmonicity"
        ])
        for entry in dimensions:
            self.assertLessEqual(entry["min"], entry["baseline"])
            self.assertLessEqual(entry["baseline"], entry["max"])
            self.assertEqual(entry["scale"], "linear")

    def test_64_scrambled_sobol_points_are_unique_and_deterministic(self):
        first = qmc.generate_vectors(self.optuna, self.space, 64)
        second = qmc.generate_vectors(self.optuna, self.space, 64)
        self.assertEqual(first["candidateCount"], 64)
        self.assertEqual(first["sampler"], {
            "library": "optuna", "class": "QMCSampler", "qmcType": "sobol", "scramble": True, "seed": 7
        })
        self.assertEqual(first["vectors"], second["vectors"])
        self.assertEqual(len({json.dumps(item["parameters"], sort_keys=True) for item in first["vectors"]}), 64)
        for vector in first["vectors"]:
            qmc.check_vector(vector["parameters"], self.space)


if __name__ == "__main__":
    unittest.main()
