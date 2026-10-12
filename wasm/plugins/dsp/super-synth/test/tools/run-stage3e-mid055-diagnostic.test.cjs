'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const search=require('./stage3e-search-core.cjs');
const paths=require('./stage3e-evidence-paths.cjs');
const diagnostic=require('./stage3e-mid055-diagnostic.cjs');
const runner=require('./run-stage3e-mid055-diagnostic.cjs');

function git(root,args){return execFileSync('rtk',['git',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function write(file,bytes){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
function metric(level){return {finite:true,outputGuardHits:0,peakDbfs:-2,fullRenderPeakDbfs:-1,envelopeDbfs:[level-3,level-2,level-1,level,level+1]};}
function level(pitch,velocity){return ({14:-30,61:-24,124:-18}[velocity])-(pitch-48)/2;}
function fixture(){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue9-mid055-readonly-'));
  const root=path.join(temp,'repo');fs.mkdirSync(root,{recursive:true});
  git(root,['init','--quiet']);git(root,['config','user.name','Issue 9 synthetic test']);git(root,['config','user.email','issue9@example.invalid']);
  const helper=path.join(root,'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage3e-matrix.cjs');
  write(helper,Buffer.from('synthetic helper identity\n'));
  const helperSha=durable.sha256(fs.readFileSync(helper));
  const base={primary:path.join(temp,'evidence-primary'),secondary:path.join(temp,'evidence-secondary')};
  const roots={primary:path.join(base.primary,'generation-2','search-v1'),secondary:path.join(base.secondary,'generation-2','search-v1'),base};
  fs.mkdirSync(roots.primary,{recursive:true});fs.mkdirSync(roots.secondary,{recursive:true});
  const protectedIdentity={sourceRevision:'f'.repeat(40),candidateId:'test-candidate',diagnosticWasmSha256:'a'.repeat(64),
    sourcePluginSha256:'b'.repeat(64),stage3eCaptureHelperSha256:helperSha,stage3eRunnerSha256:'d'.repeat(64),
    presetsSha256:'e'.repeat(64),profileSha256:'1'.repeat(64),configSha256:'2'.repeat(64),referenceFixtureSha256:'3'.repeat(64)};
  const searchIdentity={schemaVersion:1,generation:2,executionId:'generation-2',searchEpoch:'search-v1',creatorRevision:'f'.repeat(40),
    protectedIdentity,referenceSetSha256:'4'.repeat(64),captureHelperSha256:helperSha,runnerSha256:'d'.repeat(64),coreSha256:'5'.repeat(64)};
  const parentManifest={schemaVersion:1,generation:2,executionId:'generation-2',searchEpoch:'search-v1',state:'ACTIVE',identity:searchIdentity};
  const parentBytes=Buffer.from(JSON.stringify(parentManifest,null,2)+'\n'),parentSha=durable.sha256(parentBytes);
  durable.writeDualCopy(path.join(roots.primary,'generation-2-manifest.json'),path.join(roots.secondary,'generation-2-manifest.json'),parentBytes);
  const midLedger={schemaVersion:1,generation:2,executionId:'generation-2',phase:'mid',identity:searchIdentity,authorizedCellCount:108,
    accounting:{renderCalls:108},cells:{}};
  for(const cell of diagnostic.exactCells()){
    const control={phase:'mid-screen',response:{...diagnostic.CONTROL_RESPONSE},pitch:cell.pitch,velocity:cell.velocity,velocityNormalized:cell.velocityNormalized};
    const key=search.cellId(control),identity={...control,key},metrics=metric(level(cell.pitch,cell.velocity));
    const row={schemaVersion:1,cellKey:key,cell:identity,identity:searchIdentity,pitch:cell.pitch,velocity:cell.velocity,
      velocityNormalized:cell.velocityNormalized,kind:'search',metrics};
    const bytes=Buffer.from(JSON.stringify(row,null,2)+'\n'),sha=durable.sha256(bytes),relativePath=`cells/${key}.json`;
    midLedger.cells[key]={state:'COMPLETE',identity,relativePath,sha256:sha};
    durable.writeDualCopy(path.join(roots.primary,'mid',relativePath),path.join(roots.secondary,'mid',relativePath),bytes);
  }
  durable.writeDualCopy(path.join(roots.primary,'mid','mid-ledger.json'),path.join(roots.secondary,'mid','mid-ledger.json'),
    Buffer.from(JSON.stringify(midLedger,null,2)+'\n'));
  const source={decision:'STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE',acceptedCommit:'9'.repeat(40),sha256:'8'.repeat(64),builds:0,acousticRenders:0,evidenceWrites:0};
  return {temp,root,base,roots,protectedIdentity,source,parentSha,parentManifest,searchIdentity,
    options:{root,home:temp,roots,sourceVerifier:()=>source,identityProvider:()=>protectedIdentity,
      searchPreflightVerifier:()=>({decision:'STAGE3E_SEARCH_PREFLIGHT_READY',builds:0,acousticRenders:0,evidenceWrites:0}),
      expectedParentManifestSha256:parentSha,now:()=>new Date('2026-10-12T00:00:00.000Z').toISOString()}};
}
function cleanup(value){fs.rmSync(value.temp,{recursive:true,force:true});}

{
  const f=fixture();
  try{
    const controls=diagnostic.bindMid060Controls({searchRoots:f.roots,parentManifestSha256:f.parentSha});
    assert.equal(controls.length,12,'all twelve original COMPLETE 0.60 rows bind from the saved ledger');
    assert.ok(controls.every(row=>row.response.mid===0.6));
    assert.throws(()=>diagnostic.bindMid060Controls({searchRoots:f.roots,parentManifestSha256:'0'.repeat(64)}),/manifest does not match/);
    const ledgerPath=path.join(f.roots.primary,'mid','mid-ledger.json');
    const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
    const first=Object.keys(ledger.cells)[0];ledger.cells[first].sha256='f'.repeat(64);
    const changed=Buffer.from(JSON.stringify(ledger,null,2)+'\n');
    durable.writeDualCopy(ledgerPath,path.join(f.roots.secondary,'mid','mid-ledger.json'),changed);
    assert.throws(()=>diagnostic.bindMid060Controls({searchRoots:f.roots,parentManifestSha256:f.parentSha}),/SHA differs/);
  }finally{cleanup(f);}
}

{
  const f=fixture();
  try{
    const cells=runner.cellsForCapture();
    const controls=diagnostic.bindMid060Controls({searchRoots:f.roots,parentManifestSha256:f.parentSha});
    const captureId=runner.captureIdentity(f.root,f.protectedIdentity,cells);
    const manifest=runner.createManifest({root:f.root,source:f.source,parentManifest:{sha256:f.parentSha,value:f.parentManifest},cells,controls,
      protectedIdentity:f.protectedIdentity,captureId,sourceContext:f.source,executionId:'synthetic-run',now:()=> 'fixture-time'});
    assert.equal(diagnostic.validateDiagnosticManifest(manifest,{sourceCommit:f.source.acceptedCommit,parentManifestSha256:f.parentSha,cells,
      expectedSearchIdentity:f.searchIdentity,expectedControls:controls,
      expectedAcousticIdentity:f.protectedIdentity,expectedCaptureIdentity:captureId}),manifest);
    const wrongControl={...manifest,controls:manifest.controls.map((control,index)=>index===0?{...control,sha256:'0'.repeat(64)}:control)};
    assert.throws(()=>diagnostic.validateDiagnosticManifest(wrongControl,{sourceCommit:f.source.acceptedCommit,parentManifestSha256:f.parentSha,cells,
      expectedSearchIdentity:f.searchIdentity,expectedControls:controls,expectedAcousticIdentity:f.protectedIdentity,
      expectedCaptureIdentity:captureId}),/frozen control/);
    const namespace=paths.resolveMid055DiagnosticRoots({primary:f.base.primary,secondary:f.base.secondary});
    fs.mkdirSync(namespace.primary,{recursive:true});fs.mkdirSync(namespace.secondary,{recursive:true});
    const manifestBytes=diagnostic.jsonBytes(manifest),manifestSha256=diagnostic.sha256(manifestBytes);
    const ledger=diagnostic.freshLedger(cells,{executionId:manifest.executionId,manifestSha256,sourceCommit:manifest.sourceCommit,createdAt:manifest.createdAt});
    const ledgerBytes=diagnostic.jsonBytes(ledger),genesis={schemaVersion:1,kind:'ISSUE9_MID055_DIAGNOSTIC_GENESIS',
      executionId:manifest.executionId,manifestSha256,initialLedgerSha256:diagnostic.sha256(ledgerBytes),attemptCount:0,createdAt:manifest.createdAt};
    const initialFiles=[[diagnostic.FILES.manifest,manifestBytes],[diagnostic.FILES.ledger,ledgerBytes],
      [diagnostic.FILES.genesis,diagnostic.jsonBytes(genesis)],[diagnostic.FILES.genesisLedger,ledgerBytes]];
    for(const [relative,bytes] of initialFiles)durable.writeDualCopy(path.join(namespace.primary,relative),path.join(namespace.secondary,relative),bytes);
    const incomplete=diagnostic.validateMid055DiagnosticNamespace({primaryRoot:f.base.primary,secondaryRoot:f.base.secondary,
      sourceCommit:f.source.acceptedCommit,parentManifestSha256:f.parentSha,v15AttestationSha256:f.source.sha256,expectedCaptureIdentity:captureId});
    assert.equal(incomplete.decision,diagnostic.DECISIONS.blocked,'initialized but unattempted diagnostic cannot report a screen result');
    write(path.join(namespace.primary,'unexpected.bin'),Buffer.from('unknown\n'));
    write(path.join(namespace.secondary,'unexpected.bin'),Buffer.from('unknown\n'));
    assert.throws(()=>diagnostic.validateMid055DiagnosticNamespace({primaryRoot:f.base.primary,secondaryRoot:f.base.secondary,
      sourceCommit:f.source.acceptedCommit,parentManifestSha256:f.parentSha,v15AttestationSha256:f.source.sha256,
      expectedCaptureIdentity:captureId}),/file allowlist mismatch/);
  }finally{cleanup(f);}
}

{
  const f=fixture();
  try{
    const ledgerPath=path.join(f.roots.primary,'mid','mid-ledger.json');
    const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
    const first=Object.keys(ledger.cells)[0];ledger.cells[first].identity.response.mid=0.55;
    const changed=Buffer.from(JSON.stringify(ledger,null,2)+'\n');
    durable.writeDualCopy(ledgerPath,path.join(f.roots.secondary,'mid','mid-ledger.json'),changed);
    assert.throws(()=>diagnostic.bindMid060Controls({searchRoots:f.roots,parentManifestSha256:f.parentSha}),/missing or mismatched/);
  }finally{cleanup(f);}
}

{
  const f=fixture();let renderCalls=0,validationCalls=0;
  try{
    const before=runner.snapshotEvidenceRoots(f.base);
    const capture={validateCaptureRequest(pitch,velocity,response,options){
      validationCalls++;assert.ok(diagnostic.PITCHES.includes(pitch));assert.ok(diagnostic.VELOCITIES.includes(Math.round(velocity*127)));
      assert.deepEqual(response,diagnostic.RESPONSE);assert.deepEqual(options,diagnostic.captureOptionsForCell({pitch,phase:diagnostic.PHASE}));
    },render(){renderCalls++;throw new Error('renderer must not be called by read-only modes');}};
    const dry=runner.run({mode:'--dry-run',...f.options,capture});
    assert.equal(dry.decision,'DRY_RUN_READY');assert.equal(dry.namespace,'NOT_STARTED');assert.equal(dry.writerLockCreated,false);
    assert.equal(dry.acousticRenders,0);assert.equal(dry.evidenceWrites,0);
    const verified=runner.run({mode:'--verify',...f.options,capture});
    assert.equal(verified.decision,'NOT_STARTED');assert.equal(verified.attemptedCount,0);
    assert.equal(validationCalls,24,'dry-run and verify validate all twelve fixed requests');
    assert.equal(renderCalls,0,'no mocked capture call is made');
    assert.equal(fs.existsSync(path.join(f.base.primary,'generation-2','diagnostics','mid-0.55-screen-v1')),false);
    assert.equal(fs.existsSync(path.join(f.base.secondary,'generation-2','diagnostics','mid-0.55-screen-v1')),false);
    assert.deepEqual(runner.snapshotEvidenceRoots(f.base),before,'read-only modes preserve evidence SHA, mtime, and ctime');
  }finally{cleanup(f);}
}

{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue9-mid055-journal-'));
  try{
    const roots={primary:path.join(temp,'p'),secondary:path.join(temp,'s')};
    fs.mkdirSync(roots.primary,{recursive:true});fs.mkdirSync(roots.secondary,{recursive:true});
    const cells=diagnostic.exactCells().map(cell=>({...cell,captureOptions:diagnostic.captureOptionsForCell(cell)}));
    const ledger=diagnostic.freshLedger(cells,{executionId:'fixture-run',manifestSha256:'a'.repeat(64),sourceCommit:'b'.repeat(40),createdAt:'t0'});
    durable.writeDualCopy(path.join(roots.primary,diagnostic.FILES.ledger),path.join(roots.secondary,diagnostic.FILES.ledger),diagnostic.jsonBytes(ledger));
    const now=()=> 't1';
    const started=runner.storeTransition({roots,ledger,cell:cells[0],oldState:'PENDING',newState:'IN_PROGRESS',now});
    assert.equal(started.ledger.attemptCount,1,'one durable start transition consumes one unique attempt');
    assert.equal(started.ledger.transitionCount,1);
    assert.throws(()=>runner.storeTransition({roots,ledger:started.ledger,cell:cells[0],oldState:'PENDING',newState:'IN_PROGRESS',now}),
      /invalid pre-transition state/,'the same identity cannot consume a second attempt');
    const marker=runner.appendRenderStart({roots,ledger:started.ledger,cell:cells[0],transition:started.transition,
      transitionSha256:started.transitionSha256,now});
    assert.ok(fs.existsSync(path.join(roots.primary,diagnostic.renderStartPath(started.transition.sequence))));
    assert.ok(fs.existsSync(path.join(roots.secondary,diagnostic.renderStartPath(started.transition.sequence))));
    assert.equal(marker.sha256,durable.verifyDualCopy(path.join(roots.primary,diagnostic.renderStartPath(1)),
      path.join(roots.secondary,diagnostic.renderStartPath(1))).sha256);
    assert.equal(diagnostic.ledgerCounts(started.ledger).IN_PROGRESS,1);
    assert.equal(diagnostic.PHASE,'mid055-screen');
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}

{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'issue9-mid055-archive-test-'));
  try{
    const roots={primary:path.join(temp,'primary'),secondary:path.join(temp,'secondary')};
    const files=['cells/test-cell.json','diagnostic-ledger.json'];
    for(const relative of files){
      const bytes=Buffer.from(`${relative}\n`);
      durable.writeDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative),bytes);
    }
    const created=runner.safeCreateArchive({roots,allowedFiles:files});
    const primary=path.join(roots.primary,diagnostic.FILES.archive),secondary=path.join(roots.secondary,diagnostic.FILES.archive);
    assert.equal(durable.verifyDualCopy(primary,secondary).sha256,created.sha256,'archive bytes are mirrored exactly');
    const members=execFileSync('tar',['-tzf',primary],{encoding:'utf8'}).trim().split(/\r?\n/).map(name=>name.replace(/^\.\//,'')).sort();
    assert.deepEqual(members,[...files].sort(),'archive contains only the validated allowlist');
    write(path.join(roots.primary,'unknown.json'),Buffer.from('unknown\n'));
    assert.throws(()=>runner.safeCreateArchive({roots,allowedFiles:files}),/validated namespace allowlist/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}

console.log('PASS Issue #9 dry-run/verify remain read-only and journal primitives consume a start exactly once');
