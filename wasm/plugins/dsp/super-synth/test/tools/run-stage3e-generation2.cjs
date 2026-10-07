#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const legacy=require('./run-stage3e-velocity-response.cjs');
const captureDefaults=require('./capture-supersynth-stage3e-matrix.cjs');
const core=require('./stage3e-generation2-core.cjs');
const historical=require('./run-stage3e-historical-reference-requalification.cjs');

const ROOT=legacy.ROOT;
const EXECUTION_ID='generation-2';
const TOLERANCE=1e-6;
const LOW_SCREEN_VELOCITIES=[14,61,124];
const MID_SCREEN_VELOCITIES=[14,61,124];
const OFFICIAL_VELOCITIES=legacy.OFFICIAL_VELOCITIES;

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function sameExecutionIdentity(current,expected){
  const keys=['schemaVersion','generation','executionId','creatorRevision','candidateId','protectedIdentity',
    'referenceSetSha256','captureHelperSha256','runnerSha256','coreSha256'];
  return keys.every(key=>same(current?.[key],expected?.[key]));
}
function cellId(cell){
  const tuple=cell.response?`L${cell.response.low}-M${cell.response.mid}-H${cell.response.bassHardness}`:'';
  const velocity=cell.velocityNormalized!==undefined?`v${String(Math.round(cell.velocityNormalized*1000)).padStart(3,'0')}`:`v${String(cell.velocity).padStart(3,'0')}`;
  return `${cell.phase||'cell'}-${tuple?`${tuple}-`:''}midi-${String(cell.pitch).padStart(3,'0')}-${velocity}`;
}
function historicalRoots(root=ROOT,home=process.env.HOME){return durable.resolveRoots({root,issue:'7',task:'stage3e',executionId:historical.EXECUTION_ID,home});}
function generationRoots(root=ROOT,home=process.env.HOME){return durable.resolveRoots({root,issue:'7',task:'stage3e',executionId:EXECUTION_ID,home});}
function phaseRoots(generation,phase){
  const parent=phase.startsWith('low-full-')?'low':phase.startsWith('mid-full-')?'mid':null;
  const relative=parent?path.join(parent,'validations',phase):phase;
  return {primary:path.join(generation.primary,relative),secondary:path.join(generation.secondary,relative)};
}
function readDualJson(roots,relative){return JSON.parse(durable.verifyDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative)).bytes.toString('utf8'));}
function writeDualJson(roots,relative,value){return durable.writeDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative),jsonBytes(value));}
function immutableDualJson(roots,relative,value){const a=path.join(roots.primary,relative),b=path.join(roots.secondary,relative),bytes=jsonBytes(value);if(fs.existsSync(a)||fs.existsSync(b)){if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error('BLOCKED_STAGE3E_EVIDENCE_SECONDARY_PERSISTENCE');const stored=durable.verifyDualCopy(a,b);if(!stored.bytes.equals(bytes))throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: immutable ${relative} changed`);return stored;}return durable.writeDualCopy(a,b,bytes);}
function getGeneration2Roots({root=ROOT,home=process.env.HOME,evidenceRoot=process.env.SORAOTO_STAGE3E_EVIDENCE_ROOT}={}){
  const roots=generationRoots(root,home),expected=path.resolve(roots.primary);
  if(evidenceRoot&&path.resolve(evidenceRoot)!==expected)throw new Error('BLOCKED_STAGE3E_EVIDENCE_ROOT_IDENTITY');
  const build=path.resolve(process.env.SORAOTO_WASM_BUILD_DIR||path.join(root,'build'));
  const within=(a,b)=>b===a||b.startsWith(a+path.sep);
  for(const candidate of [roots.primary,roots.secondary])if(within(path.resolve(root),candidate)||within(build,candidate))throw new Error('BLOCKED_STAGE3E_EVIDENCE_ROOT_INSIDE_WORKTREE_OR_BUILD');
  return roots;
}
function currentGenerationIdentity({root=ROOT,referenceSetSha256,protectedIdentity=legacy.currentProtectedIdentity(root)}={}){
  const runnerFile=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/run-stage3e-generation2.cjs');
  const coreFile=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/stage3e-generation2-core.cjs');
  const helperFile=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs');
  return {schemaVersion:1,generation:2,executionId:EXECUTION_ID,creatorRevision:protectedIdentity.sourceRevision,
    candidateId:protectedIdentity.candidateId,protectedIdentity,referenceSetSha256,
    captureHelperSha256:sha256(fs.readFileSync(helperFile)),runnerSha256:sha256(fs.readFileSync(runnerFile)),coreSha256:sha256(fs.readFileSync(coreFile))};
}
function assertGenerationManifest(roots,identity,now=()=>new Date().toISOString()){
  const file='generation-2-manifest.json',a=path.join(roots.primary,file),b=path.join(roots.secondary,file);
  const value={schemaVersion:1,executionId:EXECUTION_ID,generation:2,state:'ACTIVE',identity,createdAt:now(),authorizedCells:{baseline:12,lowGrid:legacy.lowGridTuples().length,midGrid:legacy.MID_GRID.length}};
  if(fs.existsSync(a)||fs.existsSync(b)){
    if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: partial generation manifest');
    const old=readDualJson(roots,file);if(!same(old.identity,identity))throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_BUILD_IDENTITY');return old;
  }
  writeDualJson(roots,file,value);return value;
}
function cellSpecs(phase,rows,response=null){return rows.map(row=>{const selectedResponse=response?{...response}:row.response?{...row.response}:null;return {...row,phase,response:selectedResponse,key:cellId({...row,phase,response:selectedResponse})};});}
function freshCellLedger(phase,identity,cells){const states={};for(const cell of cells)states[cell.key]={state:'PENDING',identity:cell,relativePath:`cells/${cell.key}.json`,sha256:null};return {schemaVersion:1,generation:2,executionId:EXECUTION_ID,phase,identity,authorizedCellCount:cells.length,accounting:{renderCalls:0},cells:states};}
function ledgerCounts(ledger){return Object.fromEntries(['PENDING','IN_PROGRESS','COMPLETE'].map(state=>[state,Object.values(ledger.cells).filter(cell=>cell.state===state).length]));}
function loadLedger(roots,phase,identity,cells,{create=false}={}){
  const file=`${phase}-ledger.json`,a=path.join(roots.primary,file),b=path.join(roots.secondary,file);
  if(!fs.existsSync(a)&&!fs.existsSync(b)){
    if(!create)throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: ${phase} ledger missing`);
    const fresh=freshCellLedger(phase,identity,cells);writeDualJson(roots,file,fresh);return fresh;
  }
  if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: partial ${phase} ledger`);
  const ledger=readDualJson(roots,file);
  if(ledger.phase!==phase||ledger.generation!==2||!same(ledger.identity,identity)||ledger.authorizedCellCount!==cells.length||Object.keys(ledger.cells||{}).length!==cells.length)
    throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_BUILD_IDENTITY: ${phase} ledger identity mismatch`);
  for(const cell of cells){const state=ledger.cells[cell.key];if(!state||!same(state.identity,cell))throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: unauthorized or changed cell ${cell.key}`);}
  const inProgress=Object.entries(ledger.cells).filter(([,value])=>value.state==='IN_PROGRESS');if(inProgress.length)throw new Error(`BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING: ${inProgress.map(([key])=>key).join(',')}`);
  for(const [key,state] of Object.entries(ledger.cells))if(state.state==='COMPLETE'){
    const bytes=durable.verifyDualCopy(path.join(roots.primary,state.relativePath),path.join(roots.secondary,state.relativePath));if(bytes.sha256!==state.sha256)throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: completed cell SHA mismatch ${key}`);
    const row=JSON.parse(bytes.bytes.toString('utf8'));if(row.cellKey!==key||!same(row.identity,identity)||!same(row.cell,state.identity))throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: completed cell identity mismatch ${key}`);
  }
  return ledger;
}
function writeCellState(roots,ledger){writeDualJson(roots,`${ledger.phase}-ledger.json`,ledger);}
function validateReferenceSet(roots){return core.loadFinalizedReferenceSet(roots);}
function renderOne(cell,response,capture){
  const effectiveResponse=response??cell.response??[1,1,1];
  if(cell.velocityNormalized!==undefined){
    const diagnostics=cell.pitch===41;
    const captured=capture.renderNormalized(cell.pitch,cell.velocityNormalized,effectiveResponse,{stage2mFactorMask:diagnostics?3:undefined,
      includeVelocityDerivative:diagnostics,velocityDerivativeStartMs:30,velocityDerivativeEndMs:180,includeSoundboardDiagnostics:diagnostics});
    return {pitch:cell.pitch,velocity:Math.round(cell.velocityNormalized*127),velocityNormalized:cell.velocityNormalized,kind:cell.kind||'search',metrics:captured.metrics};
  }
  const captured=capture.render(cell.pitch,cell.velocity,effectiveResponse,{});return {pitch:cell.pitch,velocity:cell.velocity,velocityNormalized:cell.velocity/127,kind:cell.kind||'search',metrics:captured.metrics};
}
function capturePhaseRows({roots,ledger,cells,identity,capture= captureDefaults,render=renderOne,response,identityNow,now=()=>new Date().toISOString()}={}){
  let calls=0;
  for(const cell of cells){
    const state=ledger.cells[cell.key];if(state.state==='COMPLETE')continue;
    if(state.state!=='PENDING')throw new Error(`BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING: ${cell.key} is ${state.state}`);
    const current=identityNow();if(!sameExecutionIdentity(current,identity))throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_BUILD_IDENTITY: identity drift before ${cell.key}`);
    state.state='IN_PROGRESS';state.startedAt=now();writeCellState(roots,ledger);
    const measured=render(cell,response??cell.response??[1,1,1],capture);const row={schemaVersion:1,cellKey:cell.key,cell,identity,pitch:measured.pitch,velocity:measured.velocity,velocityNormalized:measured.velocityNormalized,kind:measured.kind,metrics:measured.metrics,capturedAt:now()};
    const bytes=jsonBytes(row),sha=durable.writeDualCopy(path.join(roots.primary,state.relativePath),path.join(roots.secondary,state.relativePath),bytes);
    state.state='COMPLETE';state.sha256=sha.sha256;state.completedAt=now();ledger.accounting.renderCalls++;calls++;writeCellState(roots,ledger);
  }
  return {ledger,calls,counts:ledgerCounts(ledger)};
}
function readCompletedRows(roots,ledger,cells){return cells.map(cell=>{const state=ledger.cells[cell.key];if(state.state!=='COMPLETE')throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: incomplete ${cell.key}`);const stored=durable.verifyDualCopy(path.join(roots.primary,state.relativePath),path.join(roots.secondary,state.relativePath));if(stored.sha256!==state.sha256)throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: SHA mismatch ${cell.key}`);return JSON.parse(stored.bytes.toString('utf8'));});}
function finalizePhase({roots,phase,identity,ledger,decision,result,now=()=>new Date().toISOString()}={}){
  const counts=ledgerCounts(ledger);
  if(counts.PENDING!==0||counts.IN_PROGRESS!==0||counts.COMPLETE!==ledger.authorizedCellCount)throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: cannot finalize ${phase} while cells are incomplete`);
  const existing=loadResult(roots,phase,identity);
  if(existing){
    if(existing.decision!==decision||existing.cellCount!==ledger.authorizedCellCount||existing.renderCalls!==ledger.accounting.renderCalls||!same(existing.result,result))
      throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: finalized ${phase} result changed`);
    durable.writeFinalizedManifest({primaryRoot:roots.primary,secondaryRoot:roots.secondary,metadata:{creatorRevision:identity.creatorRevision,executionId:EXECUTION_ID,generation:2,runnerSha256:identity.runnerSha256,helperSha256:identity.captureHelperSha256,wasmSha256:identity.protectedIdentity.diagnosticWasmSha256,startedAt:ledger.startedAt||existing.finalizedAt,finalizedAt:existing.finalizedAt,decision}});
    const archive=durable.createPhaseArchive({primaryRoot:roots.primary,secondaryRoot:roots.secondary,phase});
    return {...existing,archiveSha256:archive.sha256};
  }
  const output={schemaVersion:1,generation:2,phase,decision,identity,cellCount:ledger.authorizedCellCount,renderCalls:ledger.accounting.renderCalls,ledgerSha256:durable.verifyDualCopy(path.join(roots.primary,`${phase}-ledger.json`),path.join(roots.secondary,`${phase}-ledger.json`)).sha256,result,finalizedAt:now(),productionCandidateDelta:0,stage4Renders:0};
  immutableDualJson(roots,`${phase}-result.json`,output);
  durable.writeFinalizedManifest({primaryRoot:roots.primary,secondaryRoot:roots.secondary,metadata:{creatorRevision:identity.creatorRevision,executionId:EXECUTION_ID,generation:2,runnerSha256:identity.runnerSha256,helperSha256:identity.captureHelperSha256,wasmSha256:identity.protectedIdentity.diagnosticWasmSha256,startedAt:ledger.startedAt||output.finalizedAt,finalizedAt:output.finalizedAt,decision}});
  const archive=durable.createPhaseArchive({primaryRoot:roots.primary,secondaryRoot:roots.secondary,phase});
  return {...output,archiveSha256:archive.sha256};
}
function loadResult(roots,phase,identity){
  const a=path.join(roots.primary,`${phase}-result.json`),b=path.join(roots.secondary,`${phase}-result.json`);if(!fs.existsSync(a)&&!fs.existsSync(b))return null;
  if(!fs.existsSync(a)||!fs.existsSync(b))throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: partial ${phase} result`);
  const result=readDualJson(roots,`${phase}-result.json`);if(!same(result.identity,identity))throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_BUILD_IDENTITY: ${phase} result identity mismatch`);return result;
}
function assertFinalizedRootReadOnly(roots,archiveName){
  const primaryManifest=path.join(roots.primary,'evidence-manifest.json'),secondaryManifest=path.join(roots.secondary,'evidence-manifest.json');
  const primaryHash=path.join(roots.primary,'evidence-manifest.sha256'),secondaryHash=path.join(roots.secondary,'evidence-manifest.sha256');
  const manifest=durable.verifyDualCopy(primaryManifest,secondaryManifest);
  if(fs.readFileSync(primaryHash,'utf8')!==`${manifest.sha256}\n`||fs.readFileSync(secondaryHash,'utf8')!==`${manifest.sha256}\n`)throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: finalized manifest hash mismatch');
  const value=JSON.parse(manifest.bytes.toString('utf8'));
  const current=durable.assertMatchingInventory(roots.primary,roots.secondary);
  if(!same(value.files,current))throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: finalized inventory drift');
  return durable.verifyDualCopy(path.join(roots.primary,'archives',archiveName),path.join(roots.secondary,'archives',archiveName));
}
function baselineCells(){
  return [...legacy.BASELINE_EQUIVALENCE_CELLS.map(([pitch,velocity])=>({kind:'production',pitch,velocity,velocityNormalized:velocity/127})),...legacy.MIDI41_NORMALIZED.map(velocityNormalized=>({kind:'stage3a',pitch:41,velocity:Math.round(velocityNormalized*127),velocityNormalized}))];
}
function buildFixtureMap(root){return core.loadReferenceFixture(root);}
function makeResponse(tuple){return [tuple.low,tuple.mid,tuple.bassHardness];}
function lowCandidateScreenCells(tuple){return [...legacy.lowScreenCells()].map(cell=>({...cell,response:{low:tuple.low,mid:1,bassHardness:tuple.bassHardness}}));}
function midCandidateScreenCells(tuple){return [...legacy.midScreenCells()].map(cell=>({...cell,response:{low:tuple.low,mid:tuple.mid,bassHardness:tuple.bassHardness}}));}
function fullCellsFor(tuple,pitches,phase){return [...legacy.gridCells(pitches,OFFICIAL_VELOCITIES)].map(cell=>({...cell,phase,response:{...tuple}}));}
function fullLowCells(tuple){return [...fullCellsFor(tuple,[33,36,39,42,45],'low-full'),...legacy.MIDI41_NORMALIZED.map(velocityNormalized=>({phase:'low-full',pitch:41,velocity:Math.round(velocityNormalized*127),velocityNormalized,response:{...tuple}}))];}
function candidateSummary(rows,tuple,fixture,kind){return kind==='low'?core.lowScreenResult(tuple,rows,fixture):core.midScreenResult(tuple,rows,fixture);}
function phaseIdentity(identity,phase,referenceSetSha256,extra={}){return { ...identity,phase,referenceSetSha256,...extra};}
function lowPhaseIdentity(identity,referenceSetSha256){return phaseIdentity(identity,'low',referenceSetSha256,{authorizedGrid:legacy.lowGridTuples(),screenCoordinates:legacy.lowScreenCells()});}
function midPhaseIdentity(identity,referenceSetSha256,selected){return phaseIdentity(identity,'mid',referenceSetSha256,{authorizedGrid:legacy.midGridTuples(selected),screenCoordinates:legacy.midScreenCells(),lowSelection:selected});}
function writeReferenceComparison(roots,result,now){
  const phase='baseline';const cells=cellSpecs(phase,baselineCells());
  const identity=phaseIdentity(result.identity,phase,result.referenceSetSha256,{response:[1,1,1],tolerance:TOLERANCE});
  const ledger=loadLedger(phaseRoots(roots,phase),phase,identity,cells,{create:false});
  const rows=readCompletedRows(phaseRoots(roots,phase),ledger,cells);
  const comparison=core.validateBaselineRows(result.referenceSet,rows,{tolerance:TOLERANCE});
  if(!comparison.pass)throw new Error('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT');
  return finalizePhase({roots:phaseRoots(roots,phase),phase,identity,ledger,decision:'STAGE3E_BASELINE_EQUIVALENCE_PASS',result:comparison,now});
}
function assertBaselined(roots,identity){
  const result=loadResult(phaseRoots(roots,'baseline'),'baseline',phaseIdentity(identity,'baseline',identity.referenceSetSha256,{response:[1,1,1],tolerance:TOLERANCE}));
  if(!result||result.decision!=='STAGE3E_BASELINE_EQUIVALENCE_PASS')throw new Error('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT');return result;
}
function runBaseline({roots,identity,referenceSet,capture,preflight,identityNow,render,now}){
  const phase='baseline',pr=phaseRoots(roots,phase),rows=baselineCells(),cells=cellSpecs(phase,rows),phaseId=phaseIdentity(identity,phase,referenceSet.sha256,{response:[1,1,1],tolerance:TOLERANCE});
  const existing=loadResult(pr,phase,phaseId);if(existing)return existing;
  const ledger=loadLedger(pr,phase,phaseId,cells,{create:true});
  if(!ledger.startedAt){ledger.startedAt=now();writeCellState(pr,ledger);}
  const done=capturePhaseRows({roots:pr,ledger,cells,identity:phaseId,capture,response:[1,1,1],identityNow,render,now});
  if(done.counts.COMPLETE!==12)throw new Error('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT: baseline rows incomplete');
  const measured=readCompletedRows(pr,ledger,cells),comparison=core.validateBaselineRows(referenceSet.referenceSet,measured,{tolerance:TOLERANCE});
  if(!comparison.pass){finalizePhase({roots:pr,phase,identity:phaseId,ledger,decision:'BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT',result:comparison,now});throw new Error('BLOCKED_STAGE3E_BASELINE_NON_EQUIVALENT');}
  return finalizePhase({roots:pr,phase,identity:phaseId,ledger,decision:'STAGE3E_BASELINE_EQUIVALENCE_PASS',result:comparison,now});
}
function screenLedgerRows(roots,phase,identity,cells,capture,response,identityNow,now,render=renderOne){
  const pr=phaseRoots(roots,phase),ledger=loadLedger(pr,phase,identity,cells,{create:true});if(!ledger.startedAt){ledger.startedAt=now();writeCellState(pr,ledger);}
  capturePhaseRows({roots:pr,ledger,cells,identity,capture,response,identityNow,now,render});return {ledger,rows:readCompletedRows(pr,ledger,cells)};
}
function executeLow({roots,identity,referenceSet,capture,identityNow,render,now}){
  assertBaselined(roots,identity);
  const fixture=buildFixtureMap(ROOT),screenRows=[];
  const tuples=legacy.lowGridTuples();
  const screenCells=tuples.flatMap(tuple=>lowCandidateScreenCells(tuple));
  const screenId=lowPhaseIdentity(identity,referenceSet.sha256);
  const existing=loadResult(phaseRoots(roots,'low'),'low',screenId);if(existing)return existing;
  const screen=screenLedgerRows(roots,'low',screenId,cellSpecs('low-screen',screenCells),capture,null,identityNow,now,render);
  const screenByTuple=new Map();for(const row of screen.rows){const key=`${row.cell.response.low}:${row.cell.response.bassHardness}`;if(!screenByTuple.has(key))screenByTuple.set(key,[]);screenByTuple.get(key).push(row);}
  for(const tuple of tuples){const rows=screenByTuple.get(`${tuple.low}:${tuple.bassHardness}`)||[];screenRows.push(candidateSummary(rows,tuple,fixture,'low'));}
  const ranked=legacy.rankLowCandidates(screenRows),top=legacy.topFive(ranked);let selected=null;const fullResults=[];let fullCalls=0;
  for(const candidate of top){
    const tuple={low:candidate.low,mid:1,bassHardness:candidate.bassHardness};const cells=cellSpecs(`low-full-${candidate.low}-${candidate.bassHardness}`,fullLowCells(tuple));
    const phase=cells[0]?.phase||`low-full-${candidate.low}-${candidate.bassHardness}`;
    const phaseId=phaseIdentity(identity,phase,referenceSet.sha256,{response:tuple,lowScreenResultSha256:sha256(jsonBytes(candidate))});
    const full=screenLedgerRows(roots,phase,phaseId,cells,capture,makeResponse(tuple),identityNow,now,render);fullCalls+=full.ledger.accounting.renderCalls;
    const evaluation=core.validateLowFullRows(full.rows,fixture);fullResults.push({tuple,pass:evaluation.pass,pitchDiagnostics:{derivatives:evaluation.derivatives,brightness:evaluation.brightness},directEvaluation:evaluation.evaluation});
    immutableDualJson(phaseRoots(roots,phase),`${phase}-validation.json`,{identity:phaseId,evaluation:fullResults.at(-1)});
    finalizePhase({roots:phaseRoots(roots,phase),phase,identity:phaseId,ledger:full.ledger,
      decision:evaluation.pass?'STAGE3E_LOW_CANDIDATE_FULL_PASS':'STAGE3E_LOW_CANDIDATE_FULL_FAIL',result:fullResults.at(-1),now});
    if(evaluation.pass){selected={...tuple,rank:{rankMaxError:candidate.rankMaxError,rankSumSquares:candidate.rankSumSquares}};break;}
  }
  const decision=selected?'STAGE3E_LOW_RESPONSE_FAMILY_PASS':'BLOCKED_STAGE3E_LOW_RESPONSE_FAMILY';
  const result={identity:screenId,decision,selected,screenCandidateCount:tuples.length,rankedCandidates:ranked.map(({low,bassHardness,rankMaxError,rankSumSquares})=>({low,bassHardness,rankMaxError,rankSumSquares})),fullyValidated:fullResults,topFiveCount:top.length,searchRenderCalls:screen.ledger.accounting.renderCalls+fullCalls};
  const aggregatePhaseRoots=phaseRoots(roots,'low');
  immutableDualJson(aggregatePhaseRoots,'low-result.json',result);
  // The screen and each candidate full validation are separately immutable; this archive binds their current inventories.
  durable.writeFinalizedManifest({primaryRoot:aggregatePhaseRoots.primary,secondaryRoot:aggregatePhaseRoots.secondary,metadata:{creatorRevision:identity.creatorRevision,executionId:EXECUTION_ID,generation:2,runnerSha256:identity.runnerSha256,helperSha256:identity.captureHelperSha256,wasmSha256:identity.protectedIdentity.diagnosticWasmSha256,startedAt:screen.ledger.startedAt||now(),finalizedAt:now(),decision}});
  const archive=durable.createPhaseArchive({primaryRoot:aggregatePhaseRoots.primary,secondaryRoot:aggregatePhaseRoots.secondary,phase:'low-selection'});
  if(!selected)throw new Error('BLOCKED_STAGE3E_LOW_RESPONSE_FAMILY');
  return {...result,archiveSha256:archive.sha256};
}
function executeMid({roots,identity,referenceSet,capture,identityNow,render,now}){
  const low=readDualJson(phaseRoots(roots,'low'),'low-result.json');
  const expectedLowId=lowPhaseIdentity(identity,referenceSet.sha256);
  if(!same(low.identity,expectedLowId)||low.decision!=='STAGE3E_LOW_RESPONSE_FAMILY_PASS'||!low.selected)throw new Error('BLOCKED_STAGE3E_LOW_RESPONSE_FAMILY');
  const fixture=buildFixtureMap(ROOT),tuples=legacy.midGridTuples(low.selected),screenCells=tuples.flatMap(tuple=>midCandidateScreenCells(tuple));
  const screenId=midPhaseIdentity(identity,referenceSet.sha256,low.selected);
  const existing=loadResult(phaseRoots(roots,'mid'),'mid',screenId);if(existing)return existing;
  const screen=screenLedgerRows(roots,'mid',screenId,cellSpecs('mid-screen',screenCells),capture,null,identityNow,now,render);
  const grouped=new Map();for(const row of screen.rows){const key=String(row.cell.response.mid);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row);}
  const scored=tuples.map(tuple=>candidateSummary(grouped.get(String(tuple.mid))||[],tuple,fixture,'mid'));
  const ranked=legacy.rankMidCandidates(scored),top=legacy.topFive(ranked);let selected=null;const fullResults=[];let fullCalls=0;
  for(const candidate of top){
    const tuple={low:low.selected.low,mid:candidate.mid,bassHardness:low.selected.bassHardness};const phase=`mid-full-${candidate.mid}`;
    const cells=cellSpecs(phase,fullCellsFor(tuple,[48,51,54,57],phase));
    const phaseId=phaseIdentity(identity,phase,referenceSet.sha256,{response:tuple,midScreenResultSha256:sha256(jsonBytes(candidate))});
    const full=screenLedgerRows(roots,phase,phaseId,cells,capture,makeResponse(tuple),identityNow,now,render);fullCalls+=full.ledger.accounting.renderCalls;
    const evaluation=core.validateFullRows(full.rows,{pitches:[48,51,54,57],fixture});fullResults.push({tuple,pass:evaluation.pass,directEvaluation:evaluation.evaluation});
    immutableDualJson(phaseRoots(roots,phase),`${phase}-validation.json`,{identity:phaseId,evaluation:fullResults.at(-1)});
    finalizePhase({roots:phaseRoots(roots,phase),phase,identity:phaseId,ledger:full.ledger,
      decision:evaluation.pass?'STAGE3E_MID_CANDIDATE_FULL_PASS':'STAGE3E_MID_CANDIDATE_FULL_FAIL',result:fullResults.at(-1),now});
    if(evaluation.pass){selected={...tuple,rank:{rankMaxError:candidate.rankMaxError,rankSumSquares:candidate.rankSumSquares}};break;}
  }
  const decision=selected?'STAGE3E_MID_RESPONSE_FAMILY_PASS':'BLOCKED_STAGE3E_MID_RESPONSE_FAMILY';
  const result={identity:screenId,decision,selected,lowSelection:low.selected,screenCandidateCount:tuples.length,rankedCandidates:ranked.map(({mid,rankMaxError,rankSumSquares})=>({mid,rankMaxError,rankSumSquares})),fullyValidated:fullResults,topFiveCount:top.length,searchRenderCalls:screen.ledger.accounting.renderCalls+fullCalls};
  const aggregate=phaseRoots(roots,'mid');immutableDualJson(aggregate,'mid-result.json',result);
  durable.writeFinalizedManifest({primaryRoot:aggregate.primary,secondaryRoot:aggregate.secondary,metadata:{creatorRevision:identity.creatorRevision,executionId:EXECUTION_ID,generation:2,runnerSha256:identity.runnerSha256,helperSha256:identity.captureHelperSha256,wasmSha256:identity.protectedIdentity.diagnosticWasmSha256,startedAt:screen.ledger.startedAt||now(),finalizedAt:now(),decision}});
  const archive=durable.createPhaseArchive({primaryRoot:aggregate.primary,secondaryRoot:aggregate.secondary,phase:'mid-selection'});
  if(!selected)throw new Error('BLOCKED_STAGE3E_MID_RESPONSE_FAMILY');return {...result,archiveSha256:archive.sha256};
}
function dryRun({root=ROOT,home=process.env.HOME,evidenceRoot=process.env.SORAOTO_STAGE3E_EVIDENCE_ROOT,preflight=legacy.preflightDiagnosticCapabilities}={}){
  preflight({root});legacy.assertGeneration1Abandoned(root);const refs=validateReferenceSet(historicalRoots(root,home));const roots=getGeneration2Roots({root,home,evidenceRoot});
  const identity=currentGenerationIdentity({root,referenceSetSha256:refs.sha256});
  return {decision:'GENERATION2_READY_FOR_BASELINE_EQUIVALENCE',builds:0,renders:0,acousticRenders:0,generation:2,baselineCells:12,lowGridCandidates:legacy.lowGridTuples().length,midCandidates:legacy.MID_GRID.length,historicalReferenceSetSha256:refs.sha256,identity,searchEnabled:false};
}
function run({mode,root=ROOT,home=process.env.HOME,evidenceRoot=process.env.SORAOTO_STAGE3E_EVIDENCE_ROOT,preflight=legacy.preflightDiagnosticCapabilities,capture=captureDefaults,render=renderOne,now=()=>new Date().toISOString()}={}){
  const allowed=['--dry-run','--baseline','--low','--mid','--finalize'];if(!allowed.includes(mode))throw new Error(`explicit Generation-2 mode required: ${allowed.join(' or ')}`);
  if(mode==='--dry-run')return dryRun({root,home,evidenceRoot,preflight});
  preflight({root});legacy.assertGeneration1Abandoned(root);
  const refs=validateReferenceSet(historicalRoots(root,home)),roots=getGeneration2Roots({root,home,evidenceRoot});
  const protectedIdentity=legacy.currentProtectedIdentity(root),identity=currentGenerationIdentity({root,referenceSetSha256:refs.sha256,protectedIdentity});
  assertGenerationManifest(roots,identity,now);
  const identityNow=()=>currentGenerationIdentity({root,referenceSetSha256:refs.sha256,protectedIdentity:legacy.currentProtectedIdentity(root)});
  if(mode==='--baseline'){
    const result=runBaseline({roots,identity,referenceSet:refs,capture,preflight,identityNow,render,now});
    return {decision:result.decision,builds:0,renders:result.renderCalls,baselineCells:result.cellCount,baselineResultSha256:sha256(durable.verifyDualCopy(path.join(phaseRoots(roots,'baseline').primary,'baseline-result.json'),path.join(phaseRoots(roots,'baseline').secondary,'baseline-result.json')).bytes),phaseArchiveSha256:result.archiveSha256};
  }
  if(mode==='--low')return executeLow({roots,identity,referenceSet:refs,capture,identityNow,render,now});
  if(mode==='--mid'){
    const result=executeMid({roots,identity,referenceSet:refs,capture,identityNow,render,now});
    if(result.selected){
      const selectedRoots=phaseRoots(roots,'stage3e-selection');
      const selection={schemaVersion:1,decision:'STAGE3E_SELECTED_RESPONSE',identity,selected:result.selected,
        lowResultSha256:durable.verifyDualCopy(path.join(phaseRoots(roots,'low').primary,'low-result.json'),path.join(phaseRoots(roots,'low').secondary,'low-result.json')).sha256,
        midResultSha256:durable.verifyDualCopy(path.join(phaseRoots(roots,'mid').primary,'mid-result.json'),path.join(phaseRoots(roots,'mid').secondary,'mid-result.json')).sha256,productionCandidateDelta:0};
      immutableDualJson(selectedRoots,'selection.json',selection);
      const stored=readDualJson(selectedRoots,'selection.json');
      durable.writeFinalizedManifest({primaryRoot:selectedRoots.primary,secondaryRoot:selectedRoots.secondary,metadata:{creatorRevision:identity.creatorRevision,executionId:EXECUTION_ID,generation:2,runnerSha256:identity.runnerSha256,helperSha256:identity.captureHelperSha256,wasmSha256:identity.protectedIdentity.diagnosticWasmSha256,startedAt:now(),finalizedAt:now(),decision:stored.decision}});
      durable.createPhaseArchive({primaryRoot:selectedRoots.primary,secondaryRoot:selectedRoots.secondary,phase:'stage3e-selection'});
      durable.writeFinalizedManifest({primaryRoot:roots.primary,secondaryRoot:roots.secondary,metadata:{creatorRevision:identity.creatorRevision,executionId:EXECUTION_ID,generation:2,runnerSha256:identity.runnerSha256,helperSha256:identity.captureHelperSha256,wasmSha256:identity.protectedIdentity.diagnosticWasmSha256,startedAt:now(),finalizedAt:now(),decision:stored.decision}});
      durable.createPhaseArchive({primaryRoot:roots.primary,secondaryRoot:roots.secondary,phase:'stage3e-selection'});
    }
    return result;
  }
  // Read-only replay after status commits. Never creates a ledger or performs a render.
  const baseline=assertBaselined(roots,identity),low=readDualJson(phaseRoots(roots,'low'),'low-result.json'),mid=readDualJson(phaseRoots(roots,'mid'),'mid-result.json');
  if(!same(low.identity,lowPhaseIdentity(identity,refs.sha256))||!low.selected)throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: low selection identity mismatch');
  if(low.decision!=='STAGE3E_LOW_RESPONSE_FAMILY_PASS'||mid.decision!=='STAGE3E_MID_RESPONSE_FAMILY_PASS')throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: selected low/mid result is incomplete');
  if(!same(mid.identity,midPhaseIdentity(identity,refs.sha256,low.selected))||!mid.selected)throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: mid selection identity mismatch');
  const selectedRoots=phaseRoots(roots,'stage3e-selection'),selection=readDualJson(selectedRoots,'selection.json');
  if(selection.decision!=='STAGE3E_SELECTED_RESPONSE'||!same(selection.identity,identity))throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: missing or changed final selection');
  const selectedResultSha=durable.verifyDualCopy(path.join(selectedRoots.primary,'selection.json'),path.join(selectedRoots.secondary,'selection.json')).sha256;
  if(!selection.selected||selection.lowResultSha256!==durable.verifyDualCopy(path.join(phaseRoots(roots,'low').primary,'low-result.json'),path.join(phaseRoots(roots,'low').secondary,'low-result.json')).sha256
      ||selection.midResultSha256!==durable.verifyDualCopy(path.join(phaseRoots(roots,'mid').primary,'mid-result.json'),path.join(phaseRoots(roots,'mid').secondary,'mid-result.json')).sha256)
    throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: final selection bindings changed');
  assertFinalizedRootReadOnly(selectedRoots,'stage3e-selection.tar.gz');
  assertFinalizedRootReadOnly(roots,'stage3e-selection.tar.gz');
  return {decision:'STAGE3E_SELECTION_READY_FOR_PRODUCTION_PREFLIGHT',builds:0,renders:0,acousticRenders:0,baseline,low,mid,selection,selectionSha256:selectedResultSha};
}
function main(argv=process.argv.slice(2)){if(argv.length!==1)throw new Error('one explicit mode is required');const result=run({mode:argv[0]});process.stdout.write(JSON.stringify(result)+'\n');}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}
module.exports={ROOT,EXECUTION_ID,TOLERANCE,LOW_SCREEN_VELOCITIES,MID_SCREEN_VELOCITIES,OFFICIAL_VELOCITIES,sha256,jsonBytes,stable,same,sameExecutionIdentity,cellId,historicalRoots,generationRoots,phaseRoots,readDualJson,writeDualJson,immutableDualJson,getGeneration2Roots,currentGenerationIdentity,assertGenerationManifest,cellSpecs,freshCellLedger,ledgerCounts,loadLedger,writeCellState,validateReferenceSet,renderOne,capturePhaseRows,readCompletedRows,finalizePhase,loadResult,baselineCells,buildFixtureMap,makeResponse,lowCandidateScreenCells,midCandidateScreenCells,fullCellsFor,fullLowCells,candidateSummary,phaseIdentity,lowPhaseIdentity,midPhaseIdentity,runBaseline,executeLow,executeMid,dryRun,run,main};
