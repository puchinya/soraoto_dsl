'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const durable=require('./durable-evidence.cjs');
const capture=require('./capture-supersynth-stage3e-matrix.cjs');
const stage3d=require('./capture-supersynth-stage3d-matrix.cjs');
const historical=require('./run-stage3e-historical-reference-requalification.cjs');
const core=require('./stage3e-generation2-core.cjs');
const amendment=require('./run-stage3e-midi41-evidence-amendment.cjs');

const HAMMER={effectiveHardness:.2,initialHammerVelocity:2,contactDurationSamples:100,peakForce:3,maxCompression:.1,postContactTransverseEnergy:.5};
const SIGNALS=stage3d.SOUNDBOARD_DIAGNOSTIC_NAMES;
function metrics({derivative}={}){
  const value={onsetMs:2,peakDbfs:-10,fullRenderPeakDbfs:-9,spectralCentroidHz:1200,above2kPowerRatio:.2,
    envelopeDbfs:[-50,-30,-12,-10,-14],envelope20msDbfs:[-40,-25,-10,-10,-11,-12],harmonicRatiosH2ToH6:[.1,.05,.02,.01,.005],
    stereoWidth:.4,stereoPan:0,inharmonicityB:.001,spectralSpreadHz:8,finite:true,outputGuardHits:0,stage2mFactorMask:3,
    stage2mHammer:{...HAMMER},soundboardDiagnostics:{frames:17760,signals:Object.fromEntries(SIGNALS.map(name=>[name,{rms:.1,peak:.2}]))}};
  if(derivative!==undefined){value.velocityDerivative=derivative;value.velocityDerivativeWindowMs=[30,180];}return value;
}
function sourceRow(velocityNormalized,side='generation2'){
  return {pitch:41,velocity:Math.round(velocityNormalized*127),velocityNormalized,kind:'stage3a',metrics:metrics(),_side:side,
    _key:`${side}-midi-041-v${Math.round(velocityNormalized*1000)}`,_relativePath:`cells/${side}-${velocityNormalized}.json`,_sha256:String(Math.round(velocityNormalized*1000)).padStart(64,'0')};
}
function baselineFixture(){
  const rows=historical.exactCellList().map(cell=>{
    const i=historical.STAGE3A_CELLS.findIndex(row=>row.velocityNormalized===cell.velocityNormalized);
    return historical.makeRow(cell,cell.kind==='stage3a'?metrics({derivative:historical.DERIVATIVE_EXPECTED[i]}):metrics());
  });
  const ref={schemaVersion:1,decision:'STAGE3E_BASELINE_SURROGATE_REQUALIFIED',referenceSetId:'stage3e-baseline-surrogate-reference-v1',
    candidateId:historical.CANDIDATE_ID,productionProvenanceClassification:'SUFFICIENT_METADATA_PROVENANCE',productionProvenanceSha256:'a'.repeat(64),
    authoritativeHistoricalProductionWasmSha256:amendment.HISTORICAL_PRODUCTION.production,stage3dWasmSha256:amendment.STAGE3D_WASM_SHA256,
    stage3dSourceSha256:'968488b7d325c42e41570c1d7add10003050ab4c87779774a6e5337244c64886',configSha256:amendment.HISTORICAL_PRODUCTION.config,
    profileSha256:amendment.HISTORICAL_PRODUCTION.profile,presetsSha256:amendment.HISTORICAL_PRODUCTION.presets,referenceFixtureSha256:amendment.HISTORICAL_PRODUCTION.fixture,
    stage3dVariant:0,stage2mFactorMask:3,authorizedCellCount:12,acousticRenderCalls:12,productionCandidateDelta:0,stage4Renders:0,rows};
  const genRows=rows.map(row=>({...row,metrics:{...row.metrics},cellKey:row.cellKey}));
  for(const row of genRows)if(row.kind==='stage3a'){delete row.metrics.velocityDerivative;delete row.metrics.velocityDerivativeWindowMs;}
  return {ref,genRows};
}

{
  const historical={configSha256:amendment.HISTORICAL_PRODUCTION.config,profileSha256:amendment.HISTORICAL_PRODUCTION.profile,
    presetsSha256:amendment.HISTORICAL_PRODUCTION.presets};
  const candidate={candidateId:amendment.CANDIDATE_ID,diagnosticWasmSha256:amendment.STAGE3E_WASM_SHA256,
    sourcePluginSha256:'a'.repeat(64),presetsSha256:'b'.repeat(64),profileSha256:'c'.repeat(64),configSha256:'d'.repeat(64),
    referenceFixtureSha256:amendment.HISTORICAL_PRODUCTION.fixture};
  assert.notDeepEqual([historical.configSha256,historical.profileSha256,historical.presetsSha256],
    [candidate.configSha256,candidate.profileSha256,candidate.presetsSha256]);
  assert.equal(amendment.sameSideCandidateIdentity(candidate,{...candidate}).pass,true,
    'historical Stage2Q hashes in another identity domain do not invalidate same-side Gen2 identity');
  assert.throws(()=>amendment.sameSideCandidateIdentity(candidate,{...candidate,configSha256:'e'.repeat(64)}),
    /BLOCKED_STAGE3E_MEASUREMENT_IDENTITY_DRIFT/);
  assert.throws(()=>amendment.verifyGeneration2CreatorIdentity({manifestIdentity:null,ledger:null,rows:[]}),
    /BLOCKED_STAGE3E_ORIGINAL_CANDIDATE_IDENTITY_UNPROVEN/);
  assert.deepEqual(amendment.parseTrackedDiffNames('Changes:\nfile-a\nfile-b\n'),['file-a','file-b'],
    'RTK summary headings are not treated as changed repository paths');
  const oldCapture=amendment.creatorBlob(amendment.ROOT,amendment.CREATOR_REVISION,
    'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs').toString('utf8');
  const currentCapture=fs.readFileSync(path.join(amendment.ROOT,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs'),'utf8');
  assert.equal(amendment.assertNamedObjectCaptureApi(currentCapture),true);
  assert.equal(amendment.normalizeMeasurementOnlyCaptureSource(oldCapture),amendment.normalizeMeasurementOnlyCaptureSource(currentCapture),
    'the v8 named-object request correction and derivative measurement are the only capture-helper changes');
  const unrelatedCaptureChange=currentCapture.replace('const count=Math.floor(SAMPLE_RATE*DURATION_MS/1000)',
    'const count=Math.floor(SAMPLE_RATE*DURATION_MS/1000)+1');
  assert.notEqual(amendment.normalizeMeasurementOnlyCaptureSource(oldCapture),amendment.normalizeMeasurementOnlyCaptureSource(unrelatedCaptureChange),
    'unrelated audio-frame changes remain outside the authorized capture correction');
  const proofBytes=amendment.jsonBytes({decision:'STAGE3E_MEASUREMENT_IDENTITY_SCOPES_VERIFIED',creatorRevision:amendment.CREATOR_REVISION});
  const proofSha=amendment.sha256(proofBytes);
  assert.equal(amendment.validateIdentityProofBytes(proofBytes,proofSha).decision,'STAGE3E_MEASUREMENT_IDENTITY_SCOPES_VERIFIED');
  const replaced=Buffer.from(proofBytes.toString('utf8').replace('SCOPES_VERIFIED','SCOPES_REJECTED'));
  assert.throws(()=>amendment.validateIdentityProofBytes(replaced,proofSha),/BLOCKED_STAGE3E_AMENDMENT_IDENTITY_COLLISION/);
}

function syntheticBaseline(){
  const refRows=[.25,.55,.90].map(v=>({pitch:41,velocity:Math.round(v*127),velocityNormalized:v,kind:'stage3a',metrics:metrics({derivative:0.1+v})}));
  const genRows=refRows.map(row=>({...row,metrics:metrics()}));
  const missing=genRows.map(row=>({...row,_side:'generation2',_key:`g2-${row.velocityNormalized}`,_relativePath:`cells/${row.velocityNormalized}.json`,_sha256:(String(row.velocityNormalized).replace('.','')+'0').padEnd(64,'0')}));
  const identities=missing.map(row=>({key:row._key,side:'generation2',pitch:41,velocityNormalized:row.velocityNormalized,originalCellRelativePath:row._relativePath,originalCellSha256:row._sha256,
    response:{low:1,mid:1,bassHardness:1},stage3dVariant:null,stage2mFactorMask:3,velocityDerivativeWindowMs:[30,180],includeSoundboardDiagnostics:true}));
  return {refRows,genRows,missing,identities};
}

{
  const fakeAudit={sha256:amendment.SOURCE_AUDIT_SHA256,audit:{decision:'STAGE3E_MIDI41_AMENDMENT_SOURCE_AUDIT',
    immutablePreexistingFileInventory:{primary:{files:[]},secondary:{files:[]}}}};
  const baseline={refMissing:[],genMissing:syntheticBaseline().missing,generation2ManifestSha256:'b'.repeat(64)};
  const proofSha='d'.repeat(64);
  const auth=amendment.makeAuthorization({audit:fakeAudit,baseline,buildIdentity:{},identityProofSha256:proofSha});
  assert.equal(auth.preAmendmentIdentityProofSha256,proofSha);
  const boundLedger=amendment.freshLedger(auth,'a'.repeat(64),{preAmendmentIdentityProofSha256:proofSha},'b'.repeat(64),()=> 'fixed');
  assert.equal(boundLedger.preAmendmentIdentityProofSha256,proofSha);
  assert.equal(auth.authorizedRenderCount,3);assert.deepEqual(auth.authorizedCells.map(x=>x.velocityNormalized),[.25,.55,.9]);
  assert.equal(auth.authorizedCells.every(x=>x.side==='generation2'&&x.pitch===41&&x.stage2mFactorMask===3),true);
  assert.equal(auth.maxAdditionalAcousticCalls,6);
  assert.throws(()=>amendment.makeAuthorization({audit:fakeAudit,baseline:{...baseline,
    refMissing:[...baseline.genMissing,...baseline.genMissing,...baseline.genMissing]},buildIdentity:{},identityProofSha256:proofSha}),/BLOCKED_STAGE3E_AMENDMENT_RENDER_BUDGET/);
  assert.throws(()=>amendment.makeAuthorization({audit:fakeAudit,baseline,buildIdentity:{}}),/BLOCKED_STAGE3E_ORIGINAL_CANDIDATE_IDENTITY_UNPROVEN/);
  assert.throws(()=>amendment.assertAuthorization({...auth,authorizedCells:[...auth.authorizedCells,{...auth.authorizedCells[0],pitch:45}],authorizedRenderCount:4},auth.authorizedCells),/BLOCKED_STAGE3E_AMENDMENT_RENDER_BUDGET/);
}

{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-midi41-capture-options-'));
  const previous=process.env.SORAOTO_STAGE3D_WASM_BUILD_DIR;
  process.env.SORAOTO_STAGE3D_WASM_BUILD_DIR=root;
  try{
    let generation2Call,stage3dCall;
    const genCell={side:'generation2',pitch:41,velocityNormalized:.55};
    const gen=amendment.renderSupplement(genCell,{root,captureGeneration2:(pitch,velocity,response,options)=>{
      generation2Call={pitch,velocity,response,options};return {pitch,velocityNormalized:velocity,metrics:metrics({derivative:.4})};
    }});
    assert.equal(generation2Call.pitch,41);assert.equal(generation2Call.velocity,.55);assert.deepEqual(generation2Call.response,{low:1,mid:1,bassHardness:1});
    assert.deepEqual([generation2Call.options.velocityDerivativeStartMs,generation2Call.options.velocityDerivativeEndMs],[30,180]);
    assert.equal(generation2Call.options.includeVelocityDerivative,true);assert.equal(generation2Call.options.includeSoundboardDiagnostics,true);
    assert.equal(gen.velocityNormalized,.55,'normalized velocity must not be integerized');

    const surrogateCell={side:'surrogate',pitch:41,velocityNormalized:.9};
    amendment.renderSupplement(surrogateCell,{root,captureSurrogate:(pitch,velocity,parameters,options)=>{
      stage3dCall={pitch,velocity,parameters,options};return {pitch,velocityNormalized:velocity,metrics:{...metrics({derivative:.2}),stage3dVariant:0}};
    }});
    assert.equal(stage3dCall.pitch,41);assert.equal(stage3dCall.velocity,.9);assert.deepEqual(stage3dCall.parameters,{});
    assert.equal(stage3dCall.options.stage2mFactorMask,3);assert.equal(stage3dCall.options.stage3dVariant,0);
    assert.deepEqual([stage3dCall.options.velocityDerivativeStartMs,stage3dCall.options.velocityDerivativeEndMs],[30,180]);
  }finally{if(previous===undefined)delete process.env.SORAOTO_STAGE3D_WASM_BUILD_DIR;else process.env.SORAOTO_STAGE3D_WASM_BUILD_DIR=previous;fs.rmSync(root,{recursive:true,force:true});}
}

{
  const original=sourceRow(.25),sameCell={...original,metrics:{...original.metrics,velocityDerivative:.1,velocityDerivativeWindowMs:[30,180]}};
  assert.equal(amendment.compareOriginalMetrics(original,sameCell),0);
  const changed={...sameCell,metrics:{...sameCell.metrics,peakDbfs:sameCell.metrics.peakDbfs+1.1e-6}};
  assert.throws(()=>amendment.compareOriginalMetrics(original,changed),/BLOCKED_STAGE3E_AMENDMENT_ORIGINAL_METRICS_MISMATCH/);
  const cell={key:'generation2-midi-041-v250',side:'generation2',pitch:41,velocityNormalized:.25,originalCellRelativePath:original._relativePath,originalCellSha256:original._sha256};
  const record={schemaVersion:1,amendmentId:amendment.AMENDMENT_ID,...cell,stage2mFactorMask:3,velocityDerivativeWindowMs:[30,180],metrics:{...sameCell.metrics}};
  assert.equal(amendment.validateSupplementCell(cell,record,{genRows:[original],refRows:[]}).originalMetricMaxDifference,0);
  assert.throws(()=>amendment.validateSupplementCell(cell,{...record,metrics:{...record.metrics,velocityDerivativeWindowMs:[0,160]}},{genRows:[original],refRows:[]}),/BLOCKED_STAGE3E_AMENDMENT_DIAGNOSTIC_SAFETY/);
}

{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-midi41-amendment-'));
  try{
    const roots={primary:path.join(tmp,'primary'),secondary:path.join(tmp,'secondary')};fs.mkdirSync(roots.primary,{recursive:true});fs.mkdirSync(roots.secondary,{recursive:true});
    const original=sourceRow(.25),identity={fixture:'test'},auth={authorizedCells:[{key:'g2-midi41-v250',side:'generation2',pitch:41,velocityNormalized:.25,
      originalCellRelativePath:original._relativePath,originalCellSha256:original._sha256}],authorizedRenderCount:1};
    const authSha='a'.repeat(64),identitySha='b'.repeat(64),ledger=amendment.freshLedger(auth,authSha,identity,identitySha,()=> 'fixed');
    let state=amendment.assertLedger(roots,ledger,auth,identity,authSha,identitySha,{genRows:[original],refRows:[]});assert.equal(state.counts.PENDING,1);
    ledger.cells['g2-midi41-v250'].state='IN_PROGRESS';
    assert.throws(()=>amendment.assertLedger(roots,ledger,auth,identity,authSha,identitySha,{genRows:[original],refRows:[]}),/ambiguous IN_PROGRESS/);
    ledger.cells['g2-midi41-v250'].state='COMPLETE';ledger.accounting.newRenderCalls=1;
    const record={schemaVersion:1,amendmentId:amendment.AMENDMENT_ID,key:'g2-midi41-v250',side:'generation2',pitch:41,velocityNormalized:.25,
      originalCellRelativePath:original._relativePath,originalCellSha256:original._sha256,stage2mFactorMask:3,velocityDerivativeWindowMs:[30,180],captureIdentitySha256:identitySha,
      metrics:{...original.metrics,velocityDerivative:.35,velocityDerivativeWindowMs:[30,180]}};
    const bytes=amendment.jsonBytes(record),stored=durable.writeDualCopy(path.join(roots.primary,'cells/g2-midi41-v250.json'),path.join(roots.secondary,'cells/g2-midi41-v250.json'),bytes);
    ledger.cells['g2-midi41-v250'].relativePath='cells/g2-midi41-v250.json';ledger.cells['g2-midi41-v250'].sha256=stored.sha256;
    state=amendment.assertLedger(roots,ledger,auth,identity,authSha,identitySha,{genRows:[original],refRows:[]});assert.equal(state.counts.COMPLETE,1);
    const missingGen=syntheticBaseline().genRows,reference=baselineFixture().ref;
    const genRows=reference.rows.map(row=>({...row,metrics:{...row.metrics},cellKey:row.cellKey}));
    for(const row of genRows)if(row.kind==='stage3a'){delete row.metrics.velocityDerivative;delete row.metrics.velocityDerivativeWindowMs;}
    const refMissing=reference.rows.filter(row=>row.kind==='stage3a');
    const supplementRows=refMissing.map((row,i)=>({key:`generation2-midi-041-v${[250,550,900][i]}`,side:'generation2',pitch:41,velocityNormalized:row.velocityNormalized,
      originalCellRelativePath:'cells/source.json',originalCellSha256:'x'.repeat(64),stage2mFactorMask:3,velocityDerivativeWindowMs:[30,180],metrics:{...row.metrics}}));
    const overlayRoots={primary:path.join(tmp,'overlay-primary'),secondary:path.join(tmp,'overlay-secondary')};fs.mkdirSync(path.join(overlayRoots.primary,'cells'),{recursive:true});fs.mkdirSync(path.join(overlayRoots.secondary,'cells'),{recursive:true});
    const overlayLedger={cells:{}};supplementRows.forEach((row,i)=>{const key=`generation2-midi-041-v${[250,550,900][i]}`,relativePath=`cells/${key}.json`,storedRow={...row,velocityDerivativeWindowMs:[30,180]};
      const written=durable.writeDualCopy(path.join(overlayRoots.primary,relativePath),path.join(overlayRoots.secondary,relativePath),amendment.jsonBytes(storedRow));overlayLedger.cells[key]={state:'COMPLETE',relativePath,sha256:written.sha256};});
    const genOriginal=genRows.map(row=>({...row,metrics:{...row.metrics}}));
    const ctx={roots:overlayRoots,baseline:{referenceSet:reference,genRows:genOriginal,refRows:reference.rows},auth:{authorizedCells:supplementRows.map((row,i)=>({key:`generation2-midi-041-v${[250,550,900][i]}`}))}};
    const effective=amendment.effectiveRows(ctx,overlayLedger);
    const pass=core.validateBaselineRows(effective.effectiveReference,effective.genRows,{tolerance:1e-6});
    assert.equal(pass.pass,true);assert.equal(pass.cellCount,12);assert.equal(pass.maximumDifference,0);
    assert.equal(Object.hasOwn(genOriginal.find(row=>row.kind==='stage3a').metrics,'velocityDerivative'),false,'the original Generation-2 row remains immutable');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
}

assert.throws(()=>require('./run-stage3e-generation2.cjs').runBaseline({}),/BLOCKED_STAGE3E_BASELINE_CAPTURE_RETIRED/);
assert.throws(()=>require('./run-stage3e-generation2.cjs').currentGenerationIdentity({referenceSetSha256:'c'.repeat(64)}),/finalized MIDI41 amendment is required/);
console.log('PASS Stage3E MIDI41 append-only amendment, exact authorization, immutable overlay, and baseline render lock');
