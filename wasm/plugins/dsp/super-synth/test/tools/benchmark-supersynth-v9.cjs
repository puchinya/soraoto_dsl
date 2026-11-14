#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PluginHarness, wasmPath, paramDef } = require('../../../../../test/helpers/plugin-harness.cjs');

const REPO = path.resolve(__dirname, '../../../../../../');
const FILE = 'plugins/dsp/super-synth/plugin.wasm';
const SAMPLE_RATE = 48000;
const BLOCK = 128;
const DEFAULT_FRAMES = SAMPLE_RATE * 3 / 2;
const WARMUPS = Math.max(3, Number(process.env.SORAOTO_BENCH_WARMUPS || 3));
const RUNS = Math.max(10, Number(process.env.SORAOTO_BENCH_RUNS || 10));

function addNote(events, kind, noteId, pitch, velocity, frame) {
  events.push({ kind, noteId, pitch, velocity, frame });
}

function makeScenario(name) {
  const notes = [];
  const pedals = [];
  let frames = DEFAULT_FRAMES;
  if (name === 'voice1-sustain-off') {
    addNote(notes, 1, 1, 60, 0.78, 0);
    addNote(notes, 2, 1, 60, 0, 28800);
  } else if (name === 'voice8-sustain-off') {
    for (let i = 0; i < 8; i++) {
      const pitch = 48 + i * 4;
      addNote(notes, 1, i + 1, pitch, 0.68 + (i % 4) * 0.04, 0);
      addNote(notes, 2, i + 1, pitch, 0, 19200);
    }
  } else if (name === 'voice32-sustain-off') {
    for (let i = 0; i < 32; i++) {
      const pitch = 28 + i * 2;
      addNote(notes, 1, i + 1, pitch, 0.68 + (i % 4) * 0.04, 0);
      addNote(notes, 2, i + 1, pitch, 0, 19200);
    }
  } else if (name === 'voice32-sustain-on') {
    pedals.push({ frame: 0, value: 1 }, { frame: 42000, value: 0 });
    for (let i = 0; i < 32; i++) {
      const pitch = 28 + i * 2;
      addNote(notes, 1, i + 1, pitch, 0.68 + (i % 4) * 0.04, 0);
      addNote(notes, 2, i + 1, pitch, 0, 14400);
    }
  } else if (name === 'dense-sustain-release') {
    pedals.push(
      { frame: 0, value: 1 },
      { frame: 24000, value: 0 },
      { frame: 30000, value: 1 },
      { frame: 48000, value: 0 },
    );
    for (let i = 0; i < 32; i++) {
      const pitch = 28 + i * 2;
      addNote(notes, 1, i + 1, pitch, 0.68 + (i % 4) * 0.04, 0);
      addNote(notes, 2, i + 1, pitch, 0, 12000);
    }
    for (let i = 0; i < 16; i++) {
      const pitch = 50 + i * 2;
      addNote(notes, 1, i + 101, pitch, 0.72 + (i % 3) * 0.04, 30000);
      addNote(notes, 2, i + 101, pitch, 0, 39000);
    }
  } else {
    throw new Error(`unknown scenario ${name}`);
  }
  return { name, frames, notes, pedals };
}

function runOnce(scenario) {
  const h = new PluginHarness(REPO, FILE, { sampleRate: SAMPLE_RATE, maxFrames: BLOCK });
  h.applyPreset('concert_grand');
  h.setPlain('voice_drift', 0);
  h.setPlain('lfo1_pitch', 0);
  h.setPlain('chorus_mix', 0);
  const sustain = paramDef(h.descriptor, 'sustain_pedal');
  if (!sustain) throw new Error('sustain_pedal parameter missing');

  const notesAt = new Map();
  for (const event of scenario.notes) {
    const block = Math.floor(event.frame / BLOCK);
    if (!notesAt.has(block)) notesAt.set(block, []);
    notesAt.get(block).push({ ...event, offset: event.frame % BLOCK });
  }
  const pedalsAt = new Map();
  for (const pedal of scenario.pedals) {
    const block = Math.floor(pedal.frame / BLOCK);
    if (!pedalsAt.has(block)) pedalsAt.set(block, []);
    pedalsAt.get(block).push({ id: Number(sustain.id), normalized: pedal.value, offset: pedal.frame % BLOCK });
  }

  const start = process.hrtime.bigint();
  let pos = 0;
  let blockIndex = 0;
  while (pos < scenario.frames) {
    const n = Math.min(BLOCK, scenario.frames - pos);
    const events = (notesAt.get(blockIndex) || []).map(({ frame, ...event }) => event);
    const params = pedalsAt.get(blockIndex) || [];
    h.process(n, { events, params });
    pos += n;
    blockIndex++;
  }
  const elapsedNs = Number(process.hrtime.bigint() - start);
  h.close();
  return elapsedNs / 1e6;
}

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function summarize(name) {
  const scenario = makeScenario(name);
  for (let i = 0; i < WARMUPS; i++) runOnce(scenario);
  const ms = [];
  for (let i = 0; i < RUNS; i++) ms.push(runOnce(scenario));
  const sorted = [...ms].sort((a, b) => a - b);
  return {
    name,
    generatedSeconds: scenario.frames / SAMPLE_RATE,
    measuredRuns: RUNS,
    warmupRuns: WARMUPS,
    medianMs: percentile(sorted, 0.5),
    p90Ms: percentile(sorted, 0.9),
    medianRealtimeRatio: percentile(sorted, 0.5) / (scenario.frames / SAMPLE_RATE * 1000),
    samplesMs: ms,
  };
}

const wasm = wasmPath(REPO, FILE);
const binary = fs.readFileSync(wasm);
const names = (process.env.SORAOTO_BENCH_SCENARIOS || [
  'voice1-sustain-off',
  'voice8-sustain-off',
  'voice32-sustain-off',
  'voice32-sustain-on',
  'dense-sustain-release',
].join(',')).split(',').map(x => x.trim()).filter(Boolean);
const report = {
  schemaVersion: 1,
  benchmark: 'supersynth-v9-render-cpu',
  sourceRevision: process.env.SORAOTO_BENCH_REVISION || 'working-tree',
  wasmSha256: crypto.createHash('sha256').update(binary).digest('hex'),
  runtime: process.version,
  platform: `${process.platform}-${process.arch}`,
  sampleRate: SAMPLE_RATE,
  blockFrames: BLOCK,
  scenarios: names.map(summarize),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
