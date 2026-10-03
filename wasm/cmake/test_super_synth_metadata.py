import copy
import importlib.util
import json
import math
import pathlib
import unittest


WASM_ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_SPEC = importlib.util.spec_from_file_location(
    "super_synth_metadata", pathlib.Path(__file__).with_name("super_synth_metadata.py")
)
metadata = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(metadata)
PRESETS = json.loads((WASM_ROOT / "plugins/dsp/super-synth/presets.json").read_text(encoding="utf-8"))


class GrandProfileSchemaTests(unittest.TestCase):
    def test_complete_factory_profile_is_valid(self):
        self.assertEqual(len(metadata.validate_grand_profiles(PRESETS)), 1)
        self.assertEqual(metadata.GRAND_PROFILE_REVISION, 3)
        self.assertEqual(PRESETS["concert_grand"]["engine_config"]["revision"], 3)

    def test_time_normalized_string_loss_schema_is_revision_three(self):
        config = PRESETS["concert_grand"]["engine_config"]["string"]
        self.assertEqual(config["decay_reference_midi"], 60.0)
        self.assertEqual(config["reference_loss_base"], 0.0019965984251968504)
        self.assertNotIn("reference_loss_velocity_base", config)
        self.assertNotIn("reference_loss_velocity_scale", config)

    def test_revision_mismatch_is_rejected(self):
        for revision in (2, 4):
            presets = copy.deepcopy(PRESETS)
            presets["concert_grand"]["engine_config"]["revision"] = revision
            with self.subTest(revision=revision), self.assertRaisesRegex(ValueError, "engine_config.revision must be 3"):
                metadata.validate_grand_profiles(presets)

    def test_velocity_hardness_amount_accepts_approved_domain(self):
        for value in (0.0, 1.0):
            presets = copy.deepcopy(PRESETS)
            presets["concert_grand"]["engine_config"]["hammer"]["velocity_hardness_amount"] = value
            metadata.validate_grand_profiles(presets)

    def test_velocity_hardness_amount_rejects_outside_domain(self):
        for value in (-1e-9, 1.0 + 1e-9, math.nan, math.inf):
            presets = copy.deepcopy(PRESETS)
            presets["concert_grand"]["engine_config"]["hammer"]["velocity_hardness_amount"] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "velocity_hardness_amount"):
                metadata.validate_grand_profiles(presets)

    def test_velocity_hardness_amount_is_required(self):
        presets = copy.deepcopy(PRESETS)
        del presets["concert_grand"]["engine_config"]["hammer"]["velocity_hardness_amount"]
        with self.assertRaisesRegex(ValueError, "missing fields: velocity_hardness_amount"):
            metadata.validate_grand_profiles(presets)

    def test_missing_field_is_rejected(self):
        presets = copy.deepcopy(PRESETS)
        del presets["concert_grand"]["engine_config"]["hammer"]["force_scale"]
        with self.assertRaisesRegex(ValueError, "missing fields: force_scale"):
            metadata.validate_grand_profiles(presets)

    def test_unknown_field_is_rejected(self):
        presets = copy.deepcopy(PRESETS)
        presets["concert_grand"]["engine_config"]["soundboard"]["unknown_tuning"] = 1.0
        with self.assertRaisesRegex(ValueError, "unknown fields: unknown_tuning"):
            metadata.validate_grand_profiles(presets)

    def test_dry_longitudinal_gain_is_fixed_at_zero(self):
        presets = copy.deepcopy(PRESETS)
        presets["concert_grand"]["engine_config"]["radiation"]["dry_longitudinal_gain"] = 0.0
        metadata.validate_grand_profiles(presets)
        presets["concert_grand"]["engine_config"]["radiation"]["dry_longitudinal_gain"] = 0.0001
        with self.assertRaisesRegex(ValueError, "dry_longitudinal_gain is FIXED_ARCHITECTURE and must be 0.0"):
            metadata.validate_grand_profiles(presets)

    def test_wrong_array_length_is_rejected(self):
        presets = copy.deepcopy(PRESETS)
        presets["concert_grand"]["engine_config"]["soundboard"]["modes"].pop()
        with self.assertRaisesRegex(ValueError, "exactly 24 entries"):
            metadata.validate_grand_profiles(presets)

    def test_non_finite_numeric_field_is_rejected(self):
        presets = copy.deepcopy(PRESETS)
        presets["concert_grand"]["engine_config"]["hammer"]["force_scale"] = math.inf
        with self.assertRaisesRegex(ValueError, "finite number"):
            metadata.validate_grand_profiles(presets)

    def test_invalid_order_and_passivity_are_rejected(self):
        presets = copy.deepcopy(PRESETS)
        presets["concert_grand"]["engine_config"]["string"]["one_to_two_string_midi"] = 50
        with self.assertRaisesRegex(ValueError, "string-count transitions"):
            metadata.validate_grand_profiles(presets)
        presets = copy.deepcopy(PRESETS)
        presets["concert_grand"]["engine_config"]["string"]["bridge_termination"]["passive_max"] = 0.8
        with self.assertRaisesRegex(ValueError, "passive range"):
            metadata.validate_grand_profiles(presets)

    def test_missing_grand_profile_is_rejected(self):
        presets = copy.deepcopy(PRESETS)
        del presets["concert_grand"]["engine_config"]
        with self.assertRaisesRegex(ValueError, "requires engine_config"):
            metadata.validate_grand_profiles(presets)

    def test_second_profile_generates_without_source_changes_and_is_deterministic(self):
        presets = copy.deepcopy(PRESETS)
        variant = copy.deepcopy(presets["concert_grand"])
        variant["engine_config"]["hammer"]["force_scale"] = 123.0
        presets["test_grand_variant"] = variant
        first = metadata.grand_profile_header(presets)
        second = metadata.grand_profile_header(presets)
        self.assertEqual(first.encode("utf-8"), second.encode("utf-8"))
        self.assertIn("#define SORAOTO_GRAND_PROFILE_COUNT 2", first)
        self.assertIn(".force_scale = 123.0f", first)
        self.assertIn(".velocity_hardness_amount = 0.0f", first)

    def test_descriptor_does_not_expose_internal_config_or_plugin_state(self):
        _, model = metadata.parse_interface(WASM_ROOT / "plugins/dsp/super-synth/interface.soraoto")
        descriptor = metadata.descriptor(model, PRESETS)
        extension_presets = descriptor["x-net.daradara.soraotodsl-browser"]["presets"]
        self.assertNotIn("engine_config", extension_presets["concert_grand"])
        self.assertNotIn("state", descriptor)
        self.assertNotIn("supports_unit_data", descriptor["units"][0])
        self.assertNotIn("supports_program_data", descriptor["program_lists"][0])


if __name__ == "__main__":
    unittest.main()
