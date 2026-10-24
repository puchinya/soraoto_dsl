'use strict';

// Pure Generation-2 grid, identity, and ranking helpers. Keep this module free
// of CLI runner imports so both the master wrapper and phase runner can depend
// on it without a circular require.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const capture=require('./capture-supersynth-stage3e-matrix.cjs');
const durable=require('./durable-evidence.cjs');
const historicalReference=require('./run-stage3e-historical-reference-requalification.cjs');
const generation2Core=require('./stage3e-generation2-core.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const GENERATION_1_EXECUTION_ID='ae69731b7e0a9046';
const GENERATION_1_LEDGER_SHA256='dfb3bd6eab4b8b6d3907713536ddab867e32bc7f2093094946471e03c542b7e4';
const GENERATION_1_WASM_SHA256='7ff39592e48dd5e38a5c8a4fb251f373c47243d2538784482904126a5ce2d6c5';
const BASELINE_EVIDENCE_RELATIVE_PATHS=[
  `7/stage3e/${historicalReference.REFERENCE_SET_ID}/${historicalReference.REFERENCE_FILE}`,
  `7/stage3e/${historicalReference.REFERENCE_SET_ID}/${historicalReference.REFERENCE_FILE}.sha256`,
];
const LAUNCH_GRID=[1,.95,.90,.85,.80,.75,.70,.65,.60,.55,.50,.45,.40,.35];
const BASS_HARDNESS_GRID=[0,.25,.50,.75,1,1.25,1.50,1.75,2];
const MID_GRID=LAUNCH_GRID.slice(0,9);
const SCREEN_VELOCITIES=[14,61,124];
const OFFICIAL_VELOCITIES=[14,31,36,40,45,49,54,61,69,77,85,93,101,109,117,124];
const BASELINE_EQUIVALENCE_CELLS=[[36,14],[36,124],[39,14],[39,124],[51,14],[51,124],[54,14],[54,124],[96,31]];
const MIDI41_NORMALIZED=[.25,.55,.90];

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function fileSha(file){return sha256(fs.readFileSync(file));}
function cellId(cell){
  const tuple=cell.response?`L${cell.response.low}-M${cell.response.mid}-H${cell.response.bassHardness}`:'';
  const velocity=cell.velocityNormalized!==undefined?`v${String(Math.round(cell.velocityNormalized*1000)).padStart(3,'0')}`:`v${String(cell.velocity).padStart(3,'0')}`;
  return `${cell.phase||'cell'}-${tuple?`${tuple}-`:''}midi-${String(cell.pitch).padStart(3,'0')}-${velocity}`;
}
function currentProtectedIdentity(root=ROOT){
  const capturePath=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs');
  const runnerPath=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-velocity-response.cjs');
  const sourcePath=path.join(root,'wasm/plugins/dsp/super-synth/src/plugin.c');
  const presetsPath=path.join(root,'wasm/plugins/dsp/super-synth/presets.json');
  const profilePath=path.join(root,'wasm/shared/generated/super-synth_grand_profiles.h');
  const fixturePath=path.join(root,'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json');
  const wasmPath=path.join(process.env.SORAOTO_WASM_BUILD_DIR||path.join(root,'build/wasm-stage3e'),'plugins/dsp/super-synth/plugin.wasm');
  const presets=JSON.parse(fs.readFileSync(presetsPath,'utf8'));
  const calibrationConfig=JSON.parse(JSON.stringify(presets.concert_grand));
  delete calibrationConfig.engine_config.soundboard.radiation_scale;
  return {candidateId:'stage2n-r3-candidate-01',sourceRevision:execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    diagnosticWasmSha256:fileSha(wasmPath),sourcePluginSha256:fileSha(sourcePath),
    stage3eCaptureHelperSha256:fileSha(capturePath),stage3eRunnerSha256:fileSha(runnerPath),
    presetsSha256:fileSha(presetsPath),profileSha256:fileSha(profilePath),
    configSha256:sha256(Buffer.from(JSON.stringify(calibrationConfig))),referenceFixtureSha256:fileSha(fixturePath)};
}
function counts(ledger){return Object.fromEntries(['PENDING','IN_PROGRESS','COMPLETE'].map(state=>[state,Object.values(ledger.cells||{}).filter(cell=>cell.state===state).length]));}
function lowGridTuples(){return LAUNCH_GRID.flatMap(low=>BASS_HARDNESS_GRID.map(bassHardness=>({low,mid:1,bassHardness})));}
function midGridTuples(selected){return MID_GRID.map(mid=>({low:selected.low,mid,bassHardness:selected.bassHardness}));}
function gridCells(pitches,velocities){return pitches.flatMap(pitch=>velocities.map(velocity=>({pitch,velocity,velocityNormalized:velocity/127})));}
function lowScreenCells(){return [...gridCells([36,39,42],SCREEN_VELOCITIES),...MIDI41_NORMALIZED.map(velocityNormalized=>({pitch:41,velocityNormalized}))];}
function expectedLowScreenCells(){
  return lowGridTuples().flatMap(tuple=>lowScreenCells().map(row=>{
    const selectedResponse={low:tuple.low,mid:1,bassHardness:tuple.bassHardness};
    const cell={...row,phase:'low-screen',response:selectedResponse};
    return {...cell,key:cellId(cell)};
  }));
}
function lowFullCells(){return [...gridCells([33,36,39,42,45],OFFICIAL_VELOCITIES),...MIDI41_NORMALIZED.map(velocityNormalized=>({pitch:41,velocityNormalized}))];}
function midScreenCells(){return gridCells([48,51,54,57],SCREEN_VELOCITIES);}
function midFullCells(){return gridCells([48,51,54,57],OFFICIAL_VELOCITIES);}
function smoothstep(t){t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);}
function registerGate(pitch,start,plateauStart,plateauEnd,end){
  if(pitch<=start||pitch>=end)return 0;
  if(pitch<plateauStart)return smoothstep((pitch-start)/(plateauStart-start));
  if(pitch<=plateauEnd)return 1;
  return smoothstep((end-pitch)/(end-plateauEnd));
}
function stage3eResponse(pitch,velocity,low=1,mid=1,bassHardness=1,hardnessAmount=.5){
  if([low,mid,bassHardness].some((value,index)=>!Number.isFinite(value)||value<(index===2?0:.35)||value>(index===2?2:1)))throw new Error('Stage3E response tuple is outside approved profile bounds');
  const v=Math.max(0,Math.min(1,velocity));
  if(low===1&&mid===1&&bassHardness===1)return {launchVelocity:v,hardnessAmount};
  const gLow=registerGate(pitch,33,36,39,42),gMid=registerGate(pitch,48,51,54,57),gHard=registerGate(pitch,36,39,42,45);
  const launchScale=1-gLow*(1-low)-gMid*(1-mid);
  return {launchVelocity:Math.max(0,Math.min(1,61/127+launchScale*(v-61/127))),hardnessAmount:Math.max(0,Math.min(1,hardnessAmount*(1+gHard*(bassHardness-1))))};
}
function rankLowCandidates(candidates){
  const eligible=[];
  for(const candidate of candidates){
    if(candidate.safetyPass!==true)continue;
    const d=candidate.midi41Derivatives;
    if(!Array.isArray(d)||d.length!==3||!d.every(Number.isFinite)||!(d[1]>d[0]*1.05&&d[2]>d[1]*1.05))continue;
    const errors=candidate.spanErrorsByPitch;
    if(!errors||![36,39,42].every(p=>Array.isArray(errors[p])&&errors[p].length===3&&errors[p].every(Number.isFinite)))continue;
    const values=[36,39,42].flatMap(p=>errors[p]);
    eligible.push({...candidate,rankMaxError:Math.max(...values.map(Math.abs)),rankSumSquares:values.reduce((sum,x)=>sum+x*x,0)});
  }
  return eligible.sort((a,b)=>a.rankMaxError-b.rankMaxError||a.rankSumSquares-b.rankSumSquares||Math.abs(a.bassHardness-1)-Math.abs(b.bassHardness-1)||b.low-a.low);
}
function rankMidCandidates(candidates){
  return candidates.filter(candidate=>{
    const errors=candidate.spanErrorsByPitch;
    return candidate.safetyPass===true&&errors&&[48,51,54,57].every(p=>Array.isArray(errors[p])&&errors[p].length===3&&errors[p].every(Number.isFinite));
  }).map(candidate=>{
    const values=[48,51,54,57].flatMap(p=>candidate.spanErrorsByPitch[p]);
    return {...candidate,rankMaxError:Math.max(...values.map(Math.abs)),rankSumSquares:values.reduce((sum,x)=>sum+x*x,0)};
  }).sort((a,b)=>a.rankMaxError-b.rankMaxError||a.rankSumSquares-b.rankSumSquares||b.mid-a.mid);
}
function topFive(candidates){return candidates.slice(0,5);}
function gitCommonDir(root=ROOT){return execFileSync('rtk',['git','rev-parse','--path-format=absolute','--git-common-dir'],{cwd:root,encoding:'utf8'}).trim();}
function generation1TombstonePath(root=ROOT){return path.join(gitCommonDir(root),'soraoto-agent-state/issues/7/stage3e/generation-1/abandoned-generation.json');}
function assertGeneration1Abandoned(root=ROOT){
  const file=generation1TombstonePath(root);
  if(!fs.existsSync(file))throw new Error('BLOCKED_STAGE3E_GENERATION1_NOT_TOMBSTONED');
  let record;try{record=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('BLOCKED_STAGE3E_GENERATION1_TOMBSTONE_INVALID');}
  if(record.state!=='ABANDONED_STAGE3E_WORKTREE_LOSS'||record.executionId!==GENERATION_1_EXECUTION_ID||
     record.reportedLedgerSha256!==GENERATION_1_LEDGER_SHA256||record.historicalStage3eWasmSha256!==GENERATION_1_WASM_SHA256||
     record.baselineAcousticCalls!==12||record.failedSearchCalls!==0||record.reusableRows!==0)
    throw new Error('BLOCKED_STAGE3E_GENERATION1_TOMBSTONE_IDENTITY');
  return {path:file,record};
}
function assertGeneration2Ledger(ledger){
  if(!ledger||ledger.generation!==2||ledger.executionId===GENERATION_1_EXECUTION_ID)
    throw new Error('BLOCKED_STAGE3E_GENERATION1_ABANDONED: Generation 1 evidence cannot be resumed or reused');
  return ledger;
}

module.exports={ROOT,GENERATION_1_EXECUTION_ID,GENERATION_1_LEDGER_SHA256,GENERATION_1_WASM_SHA256,
  BASELINE_EVIDENCE_RELATIVE_PATHS,LAUNCH_GRID,BASS_HARDNESS_GRID,MID_GRID,SCREEN_VELOCITIES,OFFICIAL_VELOCITIES,
  BASELINE_EQUIVALENCE_CELLS,MIDI41_NORMALIZED,sha256,stable,same,fileSha,cellId,currentProtectedIdentity,counts,
  lowGridTuples,midGridTuples,gridCells,lowScreenCells,expectedLowScreenCells,lowFullCells,midScreenCells,midFullCells,smoothstep,
  registerGate,stage3eResponse,rankLowCandidates,rankMidCandidates,topFive,gitCommonDir,generation1TombstonePath,
  assertGeneration1Abandoned,assertGeneration2Ledger,generation2Core,historicalReference,capture,durable,
  preflightDiagnosticCapabilities:capture.preflightDiagnosticCapabilities};
