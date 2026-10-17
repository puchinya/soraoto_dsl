# Specification index

[`soraotoDSL/`](soraotoDSL/README.md) is the normative public contract for soraotoDSL, including
the portable WASM Plugin model and ABI.

The specification is intentionally split by semantic ownership. Do not duplicate the same rule in
multiple modules and do not create implementation-specific normative copies under `web-player/`.

For browser-reference behavior, see
[`../../web-player/docs/specs/README.md`](../../web-player/docs/specs/README.md).

For repository plugin product contracts, see [`plugins/README.md`](plugins/README.md). These
specifications are subordinate to the shared soraotoDSL specification and cannot redefine its ABI.
