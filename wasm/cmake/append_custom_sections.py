#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path


def uleb(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def custom_section(name: str, payload: bytes) -> bytes:
    encoded_name = name.encode("utf-8")
    body = uleb(len(encoded_name)) + encoded_name + payload
    return b"\x00" + uleb(len(body)) + body


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--descriptor", required=True, type=Path)
    parser.add_argument("--interface", type=Path)
    args = parser.parse_args()

    wasm = args.input.read_bytes()
    if not wasm.startswith(b"\x00asm"):
        raise SystemExit(f"not a WebAssembly module: {args.input}")
    wasm += custom_section("soraoto.plugin.v1", args.descriptor.read_bytes())
    if args.interface:
        wasm += custom_section("soraoto.interface", args.interface.read_bytes())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(wasm)


if __name__ == "__main__":
    main()
