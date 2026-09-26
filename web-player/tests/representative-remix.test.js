const fs=require('fs'),path=require('path');global.window=global;
const R=path.resolve(__dirname,'..');eval(fs.readFileSync(path.join(R,'src/js/compiler.js'),'utf8'));
function check(x,m){if(!x)throw new Error(m);}
const reps={
  'J-POP':['jpop-blue-hour-signal','jpop-zero-gravity-heart'],
  'Anime':['anime-starforge-opening','anime-soft-comet-ending'],
  'Game Battle':['game-crimson-phase','game-break-the-core'],
  'Game Field':['field-wind-over-lumeria','field-ruins-under-glass'],
  'Techno':['techno-midnight-grid','techno-vector-pulse'],
  'Jazz':['jazz-blue-lantern','jazz-minor-steps-cafe'],
};
const catalog=JSON.parse(fs.readFileSync(path.join(R,'public/songs/index.json'),'utf8')).songs;
for(const [genre,ids] of Object.entries(reps)){
  check(ids.length>=2,`${genre}: two representative songs required`);
  for(const id of ids){
    const meta=catalog.find(x=>x.id===id);check(meta,`${id}: catalog missing`);
    const ir=SoraotoCompiler.compile(fs.readFileSync(path.join(R,'public/songs',meta.file),'utf8'));
    const errors=(ir.diagnostics||[]).filter(x=>x.kind==='error');check(!errors.length,`${id}: compile errors`);
    check((ir.structure||[]).length>=4,`${id}: insufficient section structure`);
    check(ir.tracks.length>=4,`${id}: insufficient arrangement roles`);
    const density=ir.structure.map(sc=>ir.tracks.reduce((n,t)=>n+(t.events||[]).filter(e=>e.time>=sc.startBeat&&e.time<sc.endBeat).length,0));
    const lo=Math.min(...density.filter(x=>x>0)),hi=Math.max(...density);check(hi/lo>=1.15,`${id}: section event density does not change enough (${lo}..${hi})`);
    const autos=ir.automations||[];
    check(autos.length>=7,`${id}: insufficient section automation (${autos.length})`);
    check(autos.some(c=>String(c.target).includes('.instrument.')),`${id}: timbre automation missing`);
    check(autos.some(c=>String(c.target).includes('.stereo.')),`${id}: stereo automation missing`);
    check(autos.some(c=>String(c.target).includes('.send.')),`${id}: space/send automation missing`);
    check(autos.some(c=>String(c.target).includes('.effects.')),`${id}: mix/effect automation missing`);
    const drumTracks=ir.tracks.filter(t=>(t.events||[]).some(e=>e.type==='drum'));
    if(drumTracks.length){
      const dd=ir.structure.map(sc=>drumTracks.reduce((n,t)=>n+(t.events||[]).filter(e=>e.time>=sc.startBeat&&e.time<sc.endBeat).length,0));
      const dlo=Math.min(...dd.filter(x=>x>0)),dhi=Math.max(...dd);check(dhi/dlo>=1.08,`${id}: drum density is static (${dlo}..${dhi})`);
    }
    console.log('PASS representative remix',genre,id,{density,automation:autos.length});
  }
}
