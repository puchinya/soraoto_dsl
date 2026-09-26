const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
global.window = global;
eval(fs.readFileSync(path.join(ROOT, 'src/js/compiler.js'), 'utf8'));

function assert(cond, msg) { if (!cond) throw new Error(msg); }

const lab = fs.readFileSync(path.join(ROOT, 'public/songs/harmony-timeline-lab.soraoto'), 'utf8');
const ir = SoraotoCompiler.compile(lab);
assert(SoraotoCompiler.version === 5, 'compiler version must be 5');
assert(!ir.diagnostics.some(d => d.kind === 'error'), JSON.stringify(ir.diagnostics));
assert(ir.harmonies.length === 1, 'Harmony timeline missing');
assert(ir.dependencies.length === 4, 'Expected 4 harmony dependencies');
assert(ir.harmonies[0].events.length === 8, 'Expected 8 chord events');
assert(ir.harmonies[0].events.some(c => c.symbol === 'C/E' && c.bassPc !== c.rootPc), 'Slash chord bass not preserved');
assert(ir.harmonies[0].events.some(c => c.sourceMode === 'roman'), 'Roman numeral chord not resolved');
assert(ir.tracks.find(t => t.name === 'Bass').dependency === 'Harmony', 'follow dependency missing');
assert(ir.tracks.find(t => t.name === 'Guitar').events.some(e => e.stringIndex && e.fret != null), 'Generated guitar performance missing string/fret');

const nashville = `project {
 tempo: 120bpm
 meter: 4/4
 key: C.major
 chords H { @1: 1maj7, 5, 6m7, 4maj7, }
 track P { instrument: piano H |> PianoVoicing(range: c3..c5, voice_leading: nearest) }
}`;
const n = SoraotoCompiler.compile(nashville);
assert(!n.diagnostics.some(d => d.kind === 'error'), JSON.stringify(n.diagnostics));
assert(n.harmonies[0].events.every(c => c.sourceMode === 'nashville'), 'Nashville chords not resolved');
assert(n.tracks[0].events.length === 4, 'PianoVoicing did not generate one event per chord');

console.log('PASS', {
  compiler: SoraotoCompiler.version,
  harmonyChords: ir.harmonies[0].events.length,
  dependencies: ir.dependencies.length,
  events: ir.events.length,
});
