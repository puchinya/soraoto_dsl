#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import math
import struct
import sys
from pathlib import Path

WASM_ROOT = Path(__file__).resolve().parents[1]
PLUGIN_GROUPS = {
    "gain": "effects",
    "stereo-delay": "effects",
    "channel-strip": "effects",
    "sidechain": "effects",
    "reverb": "effects",
    "master-limiter": "effects",
    "drum-machine": "dsp",
    "super-synth": "dsp",
}
DESCRIPTOR_EXTENSION = "x-net.daradara.soraotodsl-browser"


def cbor_head(major: int, value: int) -> bytes:
    if value < 24:
        return bytes([(major << 5) | value])
    if value <= 0xFF:
        return bytes([(major << 5) | 24, value])
    if value <= 0xFFFF:
        return bytes([(major << 5) | 25]) + struct.pack(">H", value)
    if value <= 0xFFFFFFFF:
        return bytes([(major << 5) | 26]) + struct.pack(">I", value)
    return bytes([(major << 5) | 27]) + struct.pack(">Q", value)


def cbor(value) -> bytes:
    if value is None:
        return b"\xf6"
    if value is False:
        return b"\xf4"
    if value is True:
        return b"\xf5"
    if isinstance(value, int):
        return cbor_head(0, value) if value >= 0 else cbor_head(1, -1 - value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("descriptor contains a non-finite number")
        return b"\xfb" + struct.pack(">d", 0.0 if value == 0 else value)
    if isinstance(value, str):
        encoded = value.encode("utf-8")
        return cbor_head(3, len(encoded)) + encoded
    if isinstance(value, list):
        return cbor_head(4, len(value)) + b"".join(cbor(item) for item in value)
    if isinstance(value, dict):
        entries = sorted(((str(key).encode("utf-8"), str(key), item) for key, item in value.items()), key=lambda entry: entry[0])
        return cbor_head(5, len(entries)) + b"".join(cbor(key) + cbor(item) for _, key, item in entries)
    raise TypeError(f"unsupported descriptor value: {type(value).__name__}")


def normalized_value(parameter: dict, value) -> float:
    kind = parameter["type"]
    minimum = parameter["min"]
    maximum = parameter["max"]
    if kind == "bool":
        return 1.0 if bool(value) else 0.0
    if kind == "enum":
        values = parameter.get("enum_values") or []
        if isinstance(value, str):
            if value not in values:
                raise ValueError(f"unknown enum value {parameter['path']}={value}")
            index = values.index(value)
        else:
            index = int(round(float(value)))
        return 0.0 if len(values) <= 1 else max(0.0, min(1.0, index / (len(values) - 1)))
    if kind == "int":
        number = max(int(minimum), min(int(maximum), int(round(float(value)))))
        count = int(maximum - minimum + 1)
        return 0.0 if count <= 1 else (number - minimum) / (count - 1)
    number = float(value)
    return 0.0 if maximum == minimum else max(0.0, min(1.0, (number - float(minimum)) / (float(maximum) - float(minimum))))


def normalized_default(parameter: dict) -> float:
    return normalized_value(parameter, parameter["default"])


def c_array(values, convert=str) -> str:
    return ",".join(convert(value) for value in values)


def float_array(values) -> str:
    return c_array(values, lambda value: repr(float(value)) + "f") if values else "0"


def int_array(values) -> str:
    return c_array(values, lambda value: str(int(value))) if values else "0"


def descriptor_header(descriptor: dict, encoded: bytes, factory_values=None, program_infos=None) -> str:
    parameters = descriptor.get("parameters", [])
    count = len(parameters)
    array_count = max(1, count)
    type_codes = {"float": 0, "int": 1, "enum": 2, "bool": 3}
    scale_codes = {"linear": 0, "log": 1, "power": 2, "piecewise": 3}
    ids = [parameter["id"] for parameter in parameters]
    minimums = [0 if parameter["min"] is None else parameter["min"] for parameter in parameters]
    maximums = [1 if parameter["max"] is None else parameter["max"] for parameter in parameters]
    defaults = [normalized_default(parameter) for parameter in parameters]
    types = [type_codes[parameter["type"]] for parameter in parameters]
    scales = [scale_codes[parameter["scale"]["kind"]] for parameter in parameters]
    interpolations = [1 if parameter.get("interpolation") == "linear" else 0 for parameter in parameters]
    scale_aux = []
    for parameter in parameters:
        kind = parameter["scale"]["kind"]
        if kind == "log":
            scale_aux.append(math.log2(float(parameter["max"]) / float(parameter["min"])))
        elif kind == "power":
            scale_aux.append(float(parameter["scale"]["exponent"]))
        else:
            scale_aux.append(0.0)

    buses = descriptor.get("audio_buses", [])
    input_count = sum(bus.get("direction") == "input" for bus in buses)
    output_count = sum(bus.get("direction") == "output" for bus in buses)
    factory = descriptor.get("factory_presets", [])
    extension = descriptor.get(DESCRIPTOR_EXTENSION, {})
    presets = extension.get("presets", {})
    if factory_values is None:
        factory_values = []
        for preset in factory:
            name = preset.get("meta", {}).get("name")
            source = presets.get(name, {})
            factory_values.append([
                normalized_value(parameter, source[parameter["path"]])
                if parameter["path"] in source
                else normalized_default(parameter)
                for parameter in parameters
            ])
    factory_ids = [preset["id"] for preset in factory]
    if program_infos is None:
        program_infos = [
            program
            for program_list in descriptor.get("program_lists", [])
            for program in program_list.get("programs", [])
        ]
    offsets = [0]
    info_bytes = bytearray()
    for program in program_infos:
        info_bytes.extend(cbor(program))
        offsets.append(len(info_bytes))

    lines = [
        "#ifndef SORAOTO_GENERATED_PLUGIN_DESCRIPTOR_H",
        "#define SORAOTO_GENERATED_PLUGIN_DESCRIPTOR_H",
        f"#define PLUGIN_IS_INSTRUMENT {1 if 'instrument' in descriptor.get('kinds', []) else 0}",
        f"#define PLUGIN_INPUT_BUS_COUNT {input_count}",
        f"#define PLUGIN_OUTPUT_BUS_COUNT {output_count}",
        f"#define PLUGIN_PARAM_COUNT {count}",
        f"static const unsigned int soraoto_param_ids[{array_count}]={{ {int_array(ids)} }};",
        f"static const float soraoto_param_min[{array_count}]={{ {float_array(minimums)} }};",
        f"static const float soraoto_param_max[{array_count}]={{ {float_array(maximums)} }};",
        f"static const float soraoto_param_default_norm[{array_count}]={{ {float_array(defaults)} }};",
        f"static const unsigned char soraoto_param_type[{array_count}]={{ {int_array(types)} }};",
        f"static const unsigned char soraoto_param_scale[{array_count}]={{ {int_array(scales)} }};",
        f"static const unsigned char soraoto_param_interpolation[{array_count}]={{ {int_array(interpolations)} }};",
        f"static const float soraoto_param_scale_aux[{array_count}]={{ {float_array(scale_aux)} }};",
    ]
    if factory:
        factory_rows = ",\n".join("{ " + float_array(row) + " }" for row in factory_values)
        program_list_id = descriptor.get("program_lists", [{}])[0].get("id", 1)
        info_list = int_array(list(offsets))
        lines.extend([
            f"#define PLUGIN_FACTORY_PRESET_COUNT {len(factory)}",
            f"static const unsigned int soraoto_factory_preset_ids[{len(factory)}]={{ {int_array(factory_ids)} }};",
            f"static const float soraoto_factory_preset_norm[{len(factory)}][{array_count}]={{\n{factory_rows}\n}};",
            f"#define PLUGIN_PROGRAM_LIST_ID {program_list_id}",
            f"#define PLUGIN_PROGRAM_COUNT {len(program_infos)}",
            f"static const unsigned int soraoto_program_ids[{max(1, len(program_infos))}]={{ {int_array([program['id'] for program in program_infos])} }};",
            f"static const unsigned int soraoto_program_info_offsets[{len(offsets)}]={{ {info_list} }};",
            f"static const unsigned char soraoto_program_info_bytes[{max(1, len(info_bytes))}]={{ {int_array(info_bytes) if info_bytes else '0'} }};",
        ])
    lines.extend([
        f"static const unsigned char soraoto_descriptor_bytes[{len(encoded)}]={{ {int_array(encoded)} }};",
        f"#define SORAOTO_DESCRIPTOR_LEN {len(encoded)}",
        "#endif",
    ])
    return "\n".join(lines) + "\n"


def load_super_synth_helpers():
    helper_path = WASM_ROOT / "cmake" / "super_synth_metadata.py"
    spec = importlib.util.spec_from_file_location("super_synth_metadata", helper_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {helper_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def descriptor_for_plugin(group: str, plugin: str):
    plugin_dir = WASM_ROOT / "plugins" / group / plugin
    descriptor = json.loads((plugin_dir / "descriptor.json").read_text(encoding="utf-8"))
    if plugin != "super-synth":
        return descriptor, None, None

    helpers = load_super_synth_helpers()
    interface_text, model = helpers.parse_interface(plugin_dir / "interface.soraoto")
    presets = json.loads((plugin_dir / "presets.json").read_text(encoding="utf-8"))
    derived = helpers.descriptor(model, presets)
    for key in ("abi_major", "abi_minor", "id", "vendor", "name", "version", "kinds"):
        if descriptor.get(key) != derived.get(key):
            raise ValueError(f"{plugin}/descriptor.json disagrees with interface.soraoto at {key}")
    for key in ("parameters", "units", "factory_presets", "program_lists"):
        descriptor[key] = derived[key]
    extension = descriptor.setdefault(DESCRIPTOR_EXTENSION, {})
    generated_extension = derived[DESCRIPTOR_EXTENSION]
    for key in ("parameters", "preset_ids", "presets"):
        extension[key] = generated_extension[key]
    descriptor["_factory_values"] = derived["_factory_values"]
    descriptor["_program_infos"] = derived["_program_infos"]
    descriptor["_grand_profile_header"] = helpers.grand_profile_header(presets)
    return descriptor, interface_text, helpers


def write_if_changed(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.read_bytes() != content:
        path.write_bytes(content)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: generate_plugin_metadata.py <build-directory>")
    generated_dir = Path(sys.argv[1]).resolve() / "generated"
    for plugin, group in PLUGIN_GROUPS.items():
        descriptor, _, _ = descriptor_for_plugin(group, plugin)
        grand_profile_header = descriptor.pop("_grand_profile_header", None)
        factory_values = descriptor.pop("_factory_values", None)
        program_infos = descriptor.pop("_program_infos", None)
        encoded = cbor(descriptor)
        header = descriptor_header(descriptor, encoded, factory_values, program_infos)
        write_if_changed(generated_dir / f"{plugin}_descriptor.cbor", encoded)
        write_if_changed(generated_dir / f"{plugin}_descriptor.h", header.encode("utf-8"))
        if grand_profile_header is not None:
            write_if_changed(WASM_ROOT / "shared" / "generated" / "super-synth_grand_profiles.h", grand_profile_header.encode("utf-8"))
        print(f"{group}/{plugin}: {len(descriptor.get('parameters', []))} parameters, {len(encoded)} descriptor bytes")


if __name__ == "__main__":
    main()
