SuperSynth V9 calibration reference: Salamander Grand Piano V3

This folder contains the official FreePats SFZ+FLAC source package and its license/attribution notices.
The archive is the calibration source; do not use the Studio Piano or fuhton folders for this task.

Before analysis, open this folder from Google Drive for Desktop and run these commands from the folder:

    shasum -a 256 -c SHA256SUMS.txt
    SUPERSYNTH_V9_SALAMANDER_EXTRACT="$(mktemp -d -t supersynth-v9-salamander)"
    tar -xf SalamanderGrandPiano-SFZ+FLAC-V3+20200602.tar.gz -C "$SUPERSYNTH_V9_SALAMANDER_EXTRACT"
    SUPERSYNTH_V9_SALAMANDER_REF="$SUPERSYNTH_V9_SALAMANDER_EXTRACT/SalamanderGrandPiano-SFZ+FLAC-V3+20200602"

Once implemented, pass `"$SUPERSYNTH_V9_SALAMANDER_REF"` to the offline analyzer's
`--reference-dir` option. This package directory contains SalamanderGrandPiano-V3+20200602.sfz and
its relative samples/ directory; do not pass the extraction parent or compressed archive as the
reference path.

Reference format: 48 kHz / 24-bit, AB stereo, 16 velocity layers.
Archive SHA-256: b7760e168494cf095344e217b0af013fc449ad033abbbdf1c65211cf11dc038b

Keep the source archive and extracted audio out of Git and out of the plugin binary. Preserve the source
package unchanged. See ATTRIBUTION.md and LICENSE.txt for required source credit and license terms.
