const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
global.window = global;

eval(fs.readFileSync(path.join(ROOT,"src/js/compiler.js"),"utf8"));
eval(fs.readFileSync(path.join(ROOT,"src/js/midi-export.js"),"utf8"));

const source = fs.readFileSync(path.join(ROOT,"public/songs/export-feature-lab.soraoto"),"utf8");
const ir = SoraotoCompiler.compile(source);

if (ir.diagnostics.some(d => d.kind === "error")) {
  throw new Error(JSON.stringify(ir.diagnostics));
}

const guitar = ir.tracks.find(t => t.name === "Guitar");
if (!guitar) throw new Error("Guitar track missing");
if (!guitar.events.some(e => e.stringIndex === 6 && e.fret === 3)) throw new Error("TAB metadata missing");
if (!guitar.controls.some(e => e.type === "pitchBend")) throw new Error("Pitch bend missing");
if (!guitar.controls.some(e => e.type === "cc" && e.cc === 74)) throw new Error("CC74 missing");
if (!guitar.controls.some(e => e.type === "automation" && e.target === "gain")) throw new Error("Automation missing");

const midi = SoraotoMidi.buildType1(ir,{garageBand:true,title:ir.title});
const buf = Buffer.from(midi);
if (buf.subarray(0,4).toString() !== "MThd") throw new Error("Invalid MIDI header");
if (![...buf].some(x => (x & 0xf0) === 0xe0)) throw new Error("Pitch bend status missing");
if (![...buf].some(x => (x & 0xf0) === 0xb0)) throw new Error("CC status missing");

console.log("PASS", {
  title:ir.title,
  events:ir.events.length,
  controls:ir.tracks.reduce((n,t)=>n+t.controls.length,0),
  midiBytes:buf.length,
});
