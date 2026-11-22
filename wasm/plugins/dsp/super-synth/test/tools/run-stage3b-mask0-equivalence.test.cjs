'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const runner=require('./run-stage3b-mask0-equivalence.cjs');
const stage3a=require('./run-stage3a-velocity-diagnostic.cjs');

function identity(){
  return {candidateId:'stage2n-r3-candidate-01',productionWasmSha256:'a'.repeat(64),stage3aDiagnosticWasmSha256:'b'.repeat(64),
    stage3bDiagnosticWasmSha256:'c'.repeat(64),configSha256:'d'.repeat(64),profileSha256:'e'.repeat(64),presetsSha256:'f'.repeat(64),
    referenceFixtureSha256:'1'.repeat(64),preflightProvenanceClassification:'SUFFICIENT_METADATA_PROVENANCE',
    preflightProvenanceSha256:'2'.repeat(64),stage3aLedgerSha256:'3'.repeat(64),stage3aFinalSha256:'4'.repeat(64),
    stage3aSupplementSha256:'5'.repeat(64),productionCaptureSha256:'6'.repeat(64),authorizedCells:runner.CELLS,equivalenceTolerance:runner.TOLERANCE};
}
function metrics(overrides={}){
  const signals=Object.fromEntries(stage3a.DIAGNOSTIC_SIGNALS.map(name=>[name,{rms:0.125,peak:0.25}]));
  return {envelopeDbfs:[-20,-15,-10,-8,-7],spectralCentroidHz:900,above2kPowerRatio:0.2,peakDbfs:-6,
    finite:true,outputGuardHits:0,fullRenderPeakDbfs:-5,velocityDerivative:2.5,velocityDerivativeWindowMs:[0,160],
    stage2mFactorMask:3,stage3bVariantMask:0,stage2mHammer:{effectiveHardness:0.3,initialHammerVelocity:2,
      contactDurationSamples:12,peakForce:4,maxCompression:0.1,postContactTransverseEnergy:0.7},
    soundboardDiagnostics:{frames:100,signals},...overrides};
}
function context(identityValue=identity()){
  const productionByKey=new Map(),baseline=new Map();
  for(const cell of runner.CELLS){const m=metrics();productionByKey.set(runner.cellKey(cell),m);baseline.set(runner.cellKey(cell),{metrics:m});}
  return {identity:identityValue,productionByKey,baseline};
}
function tempRoot(){return fs.mkdtempSync(path.join(os.tmpdir(),'stage3b-mask0-'));}
function cleanup(root){fs.rmSync(root,{recursive:true,force:true});}
function validator(root){
  const result=JSON.parse(fs.readFileSync(runner.pathsFor(root).result,'utf8'));
  return {mask0Result:result,mask0EquivalenceSha256:'7'.repeat(64),preflightProvenanceSha256:result.preflightProvenanceSha256};
}

test('authorization is exactly the six Stage3A equivalence coordinates and required masks',()=>{
  assert.equal(runner.assertAuthorizedCells(runner.CELLS),runner.CELLS);
  assert.throws(()=>runner.assertAuthorizedCells([...runner.CELLS.slice(0,5),{...runner.CELLS[5],pitch:97}]),/BLOCKED_STAGE3B_MASK0_IDENTITY/);
  assert.throws(()=>runner.assertAuthorizedCells([...runner.CELLS.slice(0,5),runner.CELLS[0]]),/BLOCKED_STAGE3B_MASK0_IDENTITY/);
  assert.throws(()=>runner.assertAuthorizedCells(runner.CELLS.map((cell,i)=>i?cell:{...cell,stage3bVariantMask:1})),/BLOCKED_STAGE3B_MASK0_IDENTITY/);
  assert.throws(()=>runner.assertAuthorizedCells(runner.CELLS.map((cell,i)=>i?cell:{...cell,stage2mFactorMask:2})),/BLOCKED_STAGE3B_MASK0_IDENTITY/);
});

test('dry-run reports exactly six cells and writes no private evidence',()=>{
  const root=tempRoot(),ctx=context();
  try{
    const result=runner.dryRun({root,identityProvider:()=>ctx});
    assert.equal(result.builds,0);assert.equal(result.renders,0);assert.equal(result.authorizedRenderCount,6);
    assert.deepEqual(result.authorizedCells,runner.CELLS.map(({pitch,velocity,stage2mFactorMask,stage3bVariantMask})=>({pitch,velocity,stage2mFactorMask,stage3bVariantMask})));
    assert.equal(fs.existsSync(runner.pathsFor(root).base),false);
  }finally{cleanup(root);}
});

test('production comparison covers all acoustic fields and enforces 1e-6',()=>{
  const base=metrics();
  const atLimit=metrics({spectralCentroidHz:base.spectralCentroidHz+1e-6});
  assert.equal(stage3a.compareEquivalence(base,atLimit).pass,true);
  const outside=metrics({spectralCentroidHz:base.spectralCentroidHz+1.000001e-6});
  assert.equal(stage3a.compareEquivalence(base,outside).pass,false);
  for(const field of ['envelopeDbfs','spectralCentroidHz','above2kPowerRatio','peakDbfs','finite','outputGuardHits']){
    const altered=metrics();
    altered[field]=field==='envelopeDbfs'?[-20,-15,-10,-8,-6]:field==='finite'?false:field==='outputGuardHits'?1:altered[field]+0.01;
    assert.equal(stage3a.compareEquivalence(base,altered).pass,false,field);
  }
});

test('Stage3A diagnostics include derivative, hammer and every soundboard signal',()=>{
  const base=metrics(),same=runner.compareDiagnostics(base,base);
  assert.equal(same.pass,true);
  assert.equal(same.maxAbsoluteDiff,0);
  const changed=metrics({stage2mHammer:{...base.stage2mHammer,peakForce:4.000002}});
  assert.equal(runner.compareDiagnostics(changed,base).pass,false);
  const missing=metrics();delete missing.soundboardDiagnostics.signals[stage3a.DIAGNOSTIC_SIGNALS[0]].rms;
  assert.equal(runner.compareDiagnostics(missing,base).pass,false);
  const wrongFrame=metrics({soundboardDiagnostics:{...base.soundboardDiagnostics,frames:101}});
  assert.equal(runner.compareDiagnostics(wrongFrame,base).pass,false);
  const wrongMask=metrics({stage2mFactorMask:2});
  assert.equal(runner.compareDiagnostics(wrongMask,base).pass,false);
  assert.equal(runner.compareDiagnostics({},{}).pass,false);
});

test('safety requires finite output, zero guard and negative render peaks',()=>{
  assert.equal(runner.safety(metrics()).pass,true);
  assert.equal(runner.safety(metrics({finite:false})).pass,false);
  assert.equal(runner.safety(metrics({outputGuardHits:1})).pass,false);
  assert.equal(runner.safety(metrics({peakDbfs:0})).pass,false);
  assert.equal(runner.safety(metrics({fullRenderPeakDbfs:0})).pass,false);
});

test('ledger allows six cells only; IN_PROGRESS, missing, or changed COMPLETE evidence blocks resume',()=>{
  const root=tempRoot();
  try{
    const paths=runner.pathsFor(root),ctx=context(),ledger=runner.makeLedger(ctx.identity);
    assert.deepEqual(runner.counts(ledger),{PENDING:6,IN_PROGRESS:0,COMPLETE:0});
    assert.equal(runner.assertLedger(ledger,ctx.identity),ledger);
    ledger.cells[runner.cellKey(runner.CELLS[0])].state='IN_PROGRESS';
    fs.mkdirSync(path.dirname(paths.ledger),{recursive:true});fs.writeFileSync(paths.ledger,JSON.stringify(ledger));
    assert.throws(()=>runner.inspectState(paths,ctx.identity,ctx),/ambiguous IN_PROGRESS/);
    ledger.cells[runner.cellKey(runner.CELLS[0])].state='COMPLETE';
    ledger.accounting.newRenderCalls=1;
    const completePath=runner.cellPath(paths,runner.CELLS[0]);fs.mkdirSync(path.dirname(completePath),{recursive:true});fs.writeFileSync(completePath,'{}');
    ledger.cells[runner.cellKey(runner.CELLS[0])].path=path.relative(path.dirname(paths.ledger),completePath);
    ledger.cells[runner.cellKey(runner.CELLS[0])].sha256='0'.repeat(64);
    fs.writeFileSync(paths.ledger,JSON.stringify(ledger));
    assert.throws(()=>runner.inspectState(paths,ctx.identity,ctx),/COMPLETE cell missing\/hash mismatch/);
  }finally{cleanup(root);}
});

test('execute persists exactly six complete cells, skips them on resume, and never makes a seventh render',()=>{
  const root=tempRoot(),ctx=context();let calls=0;
  try{
    const renderFn=()=>{calls++;return metrics();};
    const first=runner.execute({root,baselineContext:ctx,identityProvider:()=>ctx,renderFn});
    assert.equal(calls,6);assert.equal(first.renderCalls,6);assert.equal(first.counts.COMPLETE,6);
    const second=runner.execute({root,baselineContext:ctx,identityProvider:()=>ctx,renderFn});
    assert.equal(calls,6);assert.equal(second.renderCalls,0);assert.equal(second.counts.COMPLETE,6);
  }finally{cleanup(root);}
});

test('an identity change before the next cell blocks before IN_PROGRESS and preserves completed evidence',()=>{
  const root=tempRoot(),first=context(),changed=context({...first.identity,preflightProvenanceSha256:'8'.repeat(64)});let checks=0,calls=0;
  try{
    const identityProvider=()=>{checks++;return checks>=2?changed:first;};
    assert.throws(()=>runner.execute({root,baselineContext:first,identityProvider,renderFn:()=>{calls++;return metrics();}}),/protected identity changed/);
    const paths=runner.pathsFor(root),ledger=JSON.parse(fs.readFileSync(paths.ledger,'utf8'));
    assert.equal(calls,1);assert.equal(runner.counts(ledger).COMPLETE,1);assert.equal(runner.counts(ledger).PENDING,5);
    assert.equal(runner.counts(ledger).IN_PROGRESS,0);
  }finally{cleanup(root);}
});

test('capture failure leaves IN_PROGRESS and blocks rerender after interruption',()=>{
  const root=tempRoot(),ctx=context();let calls=0;
  try{
    assert.throws(()=>runner.execute({root,baselineContext:ctx,identityProvider:()=>ctx,renderFn:()=>{calls++;throw new Error('simulated capture failure');}}),/simulated capture failure/);
    assert.equal(calls,1);
    assert.throws(()=>runner.execute({root,baselineContext:ctx,identityProvider:()=>ctx,renderFn:()=>{calls++;return metrics();}}),/ambiguous IN_PROGRESS/);
    assert.equal(calls,1);
  }finally{cleanup(root);}
});

test('finalize requires six cells, writes success once, validates it, and repeats with zero renders',()=>{
  const root=tempRoot(),ctx=context();
  try{
    assert.throws(()=>runner.finalize({root,baselineContext:ctx,identityProvider:()=>ctx,mask0Validator:()=>{}}),/requires six COMPLETE cells/);
    runner.execute({root,baselineContext:ctx,identityProvider:()=>ctx,renderFn:()=>metrics()});
    const first=runner.finalize({root,baselineContext:ctx,identityProvider:()=>ctx,mask0Validator:validator});
    assert.equal(first.decision,'STAGE3B_MASK0_EQUIVALENCE_COMPLETE');assert.equal(first.renders,0);
    const paths=runner.pathsFor(root),artifact=JSON.parse(fs.readFileSync(paths.result,'utf8'));
    assert.equal(artifact.mask0RenderCount,6);assert.equal(artifact.equivalenceTolerance,1e-6);assert.ok(artifact.maxMetricDifference<=1e-6);
    const resultBytes=fs.readFileSync(paths.result);const second=runner.finalize({root,baselineContext:ctx,identityProvider:()=>ctx,mask0Validator:validator});
    assert.equal(second.idempotent,true);assert.equal(second.renders,0);assert.deepEqual(fs.readFileSync(paths.result),resultBytes);
  }finally{cleanup(root);}
});

test('comparison or safety failure cannot create the authoritative result artifact',()=>{
  for(const bad of [metrics({spectralCentroidHz:900.01}),metrics({outputGuardHits:1})]){
    const root=tempRoot(),ctx=context();
    try{
      runner.execute({root,baselineContext:ctx,identityProvider:()=>ctx,renderFn:()=>bad});
      const final=runner.finalize({root,baselineContext:ctx,identityProvider:()=>ctx,mask0Validator:validator});
      assert.match(final.decision,/^BLOCKED_STAGE3B_MASK0_(NON_EQUIVALENT|DIAGNOSTIC_SAFETY)$/);
      assert.equal(fs.existsSync(runner.pathsFor(root).result),false);
    }finally{cleanup(root);}
  }
});
