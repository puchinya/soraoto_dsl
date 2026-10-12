const assert=require("assert");
const fs=require("fs");
const path=require("path");

global.window=globalThis;
const WEB=path.resolve(__dirname,"..");
eval(fs.readFileSync(path.join(WEB,"src/js/compiler.js"),"utf8"));

const source=`
import plugin SuperSynth from "../wasm/plugins/dsp/super-synth/plugin.wasm"
project {
  version: 1
  title: "Ephemeral Project Contract"
  allow_plugin_transport_control: false
  sample_rate: 48khz
  bit_depth: 24bit
  tempo: 124bpm
  meter: 4/4
  tuning: 440hz
  key: C.major
  track Piano {
    instrument {
      SuperSynth {
        preset: soft_lead
        master_gain: 0.4
      }
    }
    notes { @4: c4 }
  }
}
`;
function compile(text){
  const ir=SoraotoCompiler.compile(text);
  const errors=(ir.diagnostics||[]).filter(d=>d.kind==="error");
  assert.deepStrictEqual(errors,[],JSON.stringify(errors));
  return ir;
}

const first=compile(source);
const second=compile(source);
assert.notStrictEqual(first,second,"each compile must create a fresh Project value");
assert.notStrictEqual(first.resolvedProjectIR,second.resolvedProjectIR,"each compile must regenerate Resolved Project IR");
assert.strictEqual(JSON.stringify(first.resolvedProjectIR),JSON.stringify(second.resolvedProjectIR),"same DSL must produce equivalent initial IR");
assert.strictEqual(first.title,"Ephemeral Project Contract","Project title was not compiled");
assert.strictEqual(first.tempo,124,"Project tempo was not compiled");
assert.strictEqual(first.languageVersion,"Draft v0.5","DSL version changed");
assert.strictEqual(first.pluginAbi,"1.0","Plugin ABI version changed");

const piano=first.tracks.find(t=>t.name==="Piano");
assert(piano?.instrumentDescriptor?.kind==="wasm-plugin","DSL Plugin instance missing from compiled IR");
assert.strictEqual(String(piano.instrumentDescriptor.params?.preset?.value||piano.instrumentDescriptor.params?.preset?.raw),"soft_lead","authored preset selection missing from IR");
const edited=compile(source.replace("preset: soft_lead","preset: mellow_pad"));
const editedPiano=edited.tracks.find(t=>t.name==="Piano");
assert.strictEqual(String(editedPiano.instrumentDescriptor.params?.preset?.value||editedPiano.instrumentDescriptor.params?.preset?.raw),"mellow_pad","edited DSL preset did not replace the authored selection");

const app=fs.readFileSync(path.join(WEB,"src/js/app.js"),"utf8");
const storageKeys=[...app.matchAll(/localStorage\.(?:getItem|setItem)\(\s*["']([^"']+)["']/g)].map(m=>m[1]);
assert(storageKeys.length>0,"source editor convenience storage missing");
assert(storageKeys.every(key=>key==="soraotoDSL.source"),`non-source localStorage key found: ${storageKeys.join(", ")}`);
assert(!/\bsessionStorage\b|\bindexedDB\b/i.test(app),"WebPlayer added a separate Project/runtime persistence store");
assert(!/state\.(?:ir|graph)[^\n]*(?:localStorage|sessionStorage|indexedDB)/i.test(app),"derived Project/graph is persisted");

const host=fs.readFileSync(path.join(WEB,"src/js/plugin-host.js"),"utf8");
assert(host.includes("function initialConfiguration("),"Plugin initialization is still described as state restoration");
assert(!host.includes("soraoto_plugin_state_snapshot")&&!host.includes("soraoto_plugin_state_load"),"WebPlayer still depends on Plugin state APIs");
console.log("PASS ephemeral Project / DSL-only configuration",{compiles:2,authoredPreset:"soft_lead",storageKeys:[...new Set(storageKeys)]});
