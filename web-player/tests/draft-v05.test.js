const fs=require('fs');const path=require('path');global.window=global;
const R=path.resolve(__dirname,'..');
eval(fs.readFileSync(path.join(R,'src/js/compiler.js'),'utf8'));
function check(x,m){if(!x)throw new Error(m);}
const src=`
import plugin SuperSynth from "../wasm/plugins/dsp/super-synth/plugin.wasm"
let ROOT = c4
let Kick4 = "x...x...x...x..."
pattern Motif(root: Pitch) -> NotesFragment {
  notes { @8: root . +2 -2 }
}
pattern Beat() -> DrumFragment {
  drums {
    @16:
    Kick Kick4 * 2
    Snare "....X.......X..." * 2
  }
}
project {
  version: 1
  title: "Draft v0.5 Conformance"
  tempo: 120bpm
  meter: 4/4
  key: C.major
  structure { A { bars: 2 } }
  track Vocal {
    performance vocal { language: "ja-JP" }
    instrument { SuperSynth { preset: soft_lead } }
    instrument: synth
    A {
      notes {
        let Riff = notes { @8: ROOT . +2 -2 }
        use Riff * 2
      }
      lyrics { "き み _ . / こ{コ} | え" }
    }
  }
  track Drums { A { Beat() * 2 } }
}
`;
const ir=SoraotoCompiler.compile(src);
const errors=ir.diagnostics.filter(d=>d.kind==='error');
check(!errors.length,JSON.stringify(errors));
check(SoraotoCompiler.version===5,'compiler v5');
check(ir.languageVersion==='Draft v0.5','language version');
check(ir.componentAbi==='soraoto:component@1.0.0','component ABI');
check(ir.pluginAbi==='1.0','plugin ABI');
check(ir.imports.some(i=>i.kind==='plugin'&&i.name==='SuperSynth'),'canonical plugin import');
check(ir.bindings.some(b=>b.name==='ROOT'&&b.immutable),'let ROOT');
check(ir.bindings.some(b=>b.name==='Riff'&&b.kind==='notesFragment'),'local NotesFragment let');
check(ir.patterns.some(p=>p.name==='Motif'&&p.resultType==='NotesFragment'),'NotesFragment pattern');
check(ir.patterns.some(p=>p.name==='Beat'&&p.resultType==='DrumFragment'),'DrumFragment pattern');
const vocal=ir.tracks.find(t=>t.name==='Vocal');
const drums=ir.tracks.find(t=>t.name==='Drums');
check(vocal.instrumentDescriptor?.kind==='wasm-plugin','plugin instrument IR kind');
check(vocal.events.filter(e=>e.type==='note').length>=8,'fragment expansion did not emit notes');
check(drums.events.some(e=>e.type==='drum'),'DrumFragment pattern did not emit drums');
check(ir.lyrics.length>=6,'lyrics not lowered');
check(ir.vocalEvents.every(e=>e.dialect==='soraoto-vocal-v1'),'vocal dialect');
check(ir.lyrics.some(x=>x.melisma),'melisma missing');
check(ir.lyrics.some(x=>x.kind==='none'),'no-lyric unit missing');
check(ir.lyrics.some(x=>x.reading==='コ'),'surface{reading} missing');
check(ir.resolvedProjectIR.languageVersion==='Draft v0.5','resolved IR version');
const legacy=SoraotoCompiler.compile(`import dsp X from "x.wasm" project { track T { notes { @4: c4, } } }`);
check(legacy.diagnostics.some(d=>d.kind==='error'&&/import dsp is not supported/.test(d.message)),'import dsp must be rejected');
check(!legacy.imports.some(i=>i.kind==='plugin'),'legacy dsp must not normalize into plugin');
const badConst=SoraotoCompiler.compile(`const X = c4 project { track T { notes { @4: c4, } } }`);
check(badConst.diagnostics.some(d=>d.kind==='error'&&/const is removed/.test(d.message)),'const must error in v0.5');
console.log('PASS draft-v0.5',{events:ir.events.length,lyrics:ir.lyrics.length,patterns:ir.patterns.map(p=>[p.name,p.resultType])});
