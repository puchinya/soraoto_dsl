const fs=require('fs'),path=require('path');
global.window=global;
eval(fs.readFileSync(path.resolve(__dirname,'../src/js/instrument-library.js'),'utf8'));
function check(x,m){if(!x)throw new Error(m)}
check(SoraotoInstruments.presetFor({instrument:'piano',events:[]})==='concert_grand','piano must resolve to concert_grand');
check(SoraotoInstruments.presetFor({instrument:'grand piano',events:[]})==='concert_grand','grand piano must resolve to concert_grand');
check(SoraotoInstruments.presetFor({instrument:'epiano',events:[]})==='ep_bell','epiano mapping regressed');
check(SoraotoInstruments.presetFor({instrument:'piano',instrumentDescriptor:{params:{preset:{value:'soft_piano'}}}})==='soft_piano','explicit preset must win');
check(SoraotoInstruments.superSynthPresetFor({instrument:'piano',events:[{type:'note'}]})==='concert_grand','automatic SuperSynth piano route must use concert_grand');
check(SoraotoInstruments.presets.includes('concert_grand'),'fallback preset catalog missing concert_grand');
console.log('PASS concert grand routing',{piano:SoraotoInstruments.presetFor({instrument:'piano'}),epiano:SoraotoInstruments.presetFor({instrument:'epiano'})});
