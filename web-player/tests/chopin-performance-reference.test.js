const fs=require('fs'),path=require('path');global.window=global;
const R=path.resolve(__dirname,'..');eval(fs.readFileSync(path.join(R,'src/js/compiler.js'),'utf8'));
function check(x,m){if(!x)throw new Error(m)}
function beatToSeconds(ir,beat){const target=Math.max(0,beat),map=ir.tempoMap||[{kind:'step',beat:0,bpm:ir.tempo||120}];let t=0,bpm=ir.tempo||120;const bounds=new Set([0,target]);for(const s of map){if(s.kind==='step'&&s.beat>0&&s.beat<target)bounds.add(s.beat);if(s.kind==='ramp'){if(s.startBeat>0&&s.startBeat<target)bounds.add(s.startBeat);if(s.endBeat>0&&s.endBeat<target)bounds.add(s.endBeat);}}const pts=[...bounds].sort((a,b)=>a-b);for(let i=1;i<pts.length;i++){const a=pts[i-1],z=pts[i],mid=(a+z)/2,ramp=map.find(s=>s.kind==='ramp'&&mid>=s.startBeat&&mid<=s.endBeat);if(ramp){const n=32,step=(z-a)/n;for(let j=0;j<n;j++){const x=a+(j+.5)*step,q=(x-ramp.startBeat)/(ramp.endBeat-ramp.startBeat||1),local=ramp.startBpm+(ramp.endBpm-ramp.startBpm)*q;t+=step*60/local;}}else{for(const s of map)if(s.kind==='step'&&s.beat<=a)bpm=s.bpm;t+=(z-a)*60/bpm;}}return t;}
const cases={
 'chopin-prelude-op28-no4.soraoto':{seconds:[110,127],velocity:[.45,.62],minTempoPoints:6},
 'chopin-prelude-op28-no7.soraoto':{seconds:[48,60],velocity:[.40,.58],minTempoPoints:7},
 'chopin-prelude-op28-no20.soraoto':{seconds:[84,96],velocity:[.62,.78],minTempoPoints:4},
 'chopin-waltz-a-minor-b150.soraoto':{seconds:[126,136],velocity:[.45,.62],minTempoPoints:8},
};
for(const [file,want] of Object.entries(cases)){
 const ir=SoraotoCompiler.compile(fs.readFileSync(path.join(R,'public/songs',file),'utf8'));check(!ir.diagnostics.some(x=>x.kind==='error'),`${file}: compile error`);
 const end=Math.max(...ir.tracks.flatMap(t=>(t.events||[]).filter(e=>e.type==='note').map(e=>e.time+e.duration))),seconds=beatToSeconds(ir,end);
 const vel=ir.tracks.flatMap(t=>(t.events||[]).filter(e=>e.type==='note').map(e=>Number(e.velocity)||0)),mean=vel.reduce((a,b)=>a+b,0)/Math.max(1,vel.length);
 check(seconds>=want.seconds[0]&&seconds<=want.seconds[1],`${file}: performance duration ${seconds.toFixed(1)}s`);
 check(mean>=want.velocity[0]&&mean<=want.velocity[1],`${file}: piano velocity mean ${mean.toFixed(3)}`);
 check((ir.tempoMap||[]).length>=want.minTempoPoints,`${file}: expressive tempo map missing`);
 console.log('PASS Chopin performance reference',file,{seconds:+seconds.toFixed(1),meanVelocity:+mean.toFixed(3),tempoPoints:ir.tempoMap.length});
}
