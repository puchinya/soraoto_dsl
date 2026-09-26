# Web Player export behavior

Portable render/export semantics are defined in soraotoDSL §52. This document describes browser UI
surfaces and browser-specific limits.

## Standard MIDI

The browser exports Standard MIDI File Type 1:

- tempo/meter track plus one track per non-empty musical track;
- track names;
- note on/off and velocity;
- General MIDI program changes for the browser's standard instrument mapping;
- General MIDI percussion on channel 10;
- supported control automation as MIDI CC;
- pitch-bend data where representable;
- guitar string/fret provenance as text metadata;
- lyric/phrase metadata where representable by the current exporter.

Known implementation deviations from §52 are listed in
[`reference-player-profile.md`](reference-player-profile.md). They must not be promoted to portable
normative rules.

## GarageBand MIDI

`GarageBand MIDI` uses the same SMF Type 1 data with a Web Player import guard of at most 32 musical
tracks.

It does not generate a native `.band` package.

## Offline WAV

`Render WAV` compiles the current Project to the browser audio graph, renders through
`OfflineAudioContext`, and encodes a WAV file in-browser.

The current browser encoder supports 16-bit and 24-bit PCM and up to two channels. Unsupported
portable §52 output modes are conformance gaps, not alternate soraotoDSL semantics.

## Out of MIDI scope

The browser does not serialize the following into Standard MIDI because MIDI has no portable
representation for them:

- audio waveform clips;
- audio-graph topology;
- WASM Plugin instance state;
- browser implementation internals.

The native Resolved Project IR remains the representation that retains those structures.
