'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const core=require('./issue7-current-build-core.cjs');

const IDENTITY=JSON.parse(fs.readFileSync(path.join(core.ROOT,'docs/status/plugins/dsp/super-synth/current-build-v1/build-identity.json'),'utf8'));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

function workspace(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-current-build-core-'));
  const repo=path.join(base,'repo'),home=path.join(base,'home'),common=path.join(base,'common');
  fs.mkdirSync(repo,{recursive:true});fs.mkdirSync(home);fs.mkdirSync(common);
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  return {base,repo,home,common,roots:core.resolveRoots(repo,'stage3e',core.EPOCH,{home,commonDirectory:common})};
}
function manifest(roots,phase='baseline',identity={source:'synthetic'}){
  return {schemaVersion:1,issue:7,epoch:core.EPOCH,stage:roots.stage,phase,candidateId:'synthetic-candidate',creatorCommit:'test-commit',identity,
    authorizationSha256:'a'.repeat(64),runnerSha256:'b'.repeat(64),captureHelperSha256:'c'.repeat(64),primaryWasmSha256:'d'.repeat(64),createdAt:'2026-10-13T00:00:00.000Z'};
}
function startPhase(t,{phase='baseline',keys=['production-36-14'],identity={source:'synthetic'}}={}){
  const w=workspace(t),m=manifest(w.roots,phase,identity),cells=keys.map(key=>({key,pitch:36,velocity:14}));
  core.initializePhase({roots:w.roots,phase,manifest:m,cells,renderBudget:keys.length,now:()=>m.createdAt});
  return {...w,phase,manifest:m,identity,cells};
}
function statInventory(root){
  if(!fs.existsSync(root))return [];
  const out=[];
  function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,e.name);if(e.isDirectory())visit(file);else{const s=fs.statSync(file);out.push({file:path.relative(root,file),size:s.size,mtime:s.mtimeMs,sha256:hash(fs.readFileSync(file))});}}}
  visit(root);return out;
}
function copyIdentityWorkspace(target){
  fs.mkdirSync(target,{recursive:true});
  const files=[...Object.values(IDENTITY.inputs).map(entry=>entry.path),
    IDENTITY.toolchain.toolchainFile,
    'docs/status/plugins/dsp/super-synth/current-build-v1/build-identity.json'];
  for(const build of Object.values(IDENTITY.builds)){
    files.push(`${build.buildDirectory}/CMakeCache.txt`,`${build.buildDirectory}/${build.wasm.path}`,
      `${build.buildDirectory}/generated/super-synth_descriptor.cbor`,`${build.buildDirectory}/generated/super-synth_descriptor.h`);
  }
  for(const relative of files){const dest=path.join(target,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(core.ROOT,relative),dest);}
}

test('root resolver accepts only the current Issue #7 stage roots and rejects symlink escapes',t=>{
  const w=workspace(t);
  assert.equal(w.roots.primary,path.join(fs.realpathSync(w.common),'soraoto-agent-state','7','stage3e',core.EPOCH));
  assert.equal(w.roots.secondary,path.join(fs.realpathSync(w.home),'.soraoto-agent-archive','repo','7','stage3e',core.EPOCH));
  assert.throws(()=>core.resolveRoots(w.repo,'stage3e','generation-2',{home:w.home,commonDirectory:w.common}),/BLOCKED_EPOCH/);
  assert.throws(()=>core.resolveRoots(w.repo,'stage3e/../../stage3','current-build-v1',{home:w.home,commonDirectory:w.common}),/invalid Issue #7 stage/);

  const linked=path.join(w.home,'.soraoto-agent-archive'),outside=path.join(w.base,'outside');
  fs.mkdirSync(outside);fs.symlinkSync(outside,linked);
  assert.throws(()=>core.resolveRoots(w.repo,'stage3e',core.EPOCH,{home:w.home,commonDirectory:w.common}),/BLOCKED_EVIDENCE_SYMLINK/);
});

test('Gate 1 identity hashes every declared source, cache, WASM, and generated metadata output',()=>{
  const current=core.hashInputs(core.ROOT,IDENTITY);
  assert.equal(current.issue,7);assert.equal(current.epoch,'current-build-v1');
  assert.equal(Object.keys(current.inputs).length,16);
  assert.deepEqual(Object.keys(current.builds).sort(),['production','stage3e','stage4']);
  assert.equal(current.builds.production.wasmSha256,IDENTITY.builds.production.wasm.sha256);
  assert.equal(current.builds.stage3e.flags.SORAOTO_SUPERSYNTH_STAGE3E_DIAGNOSTICS,'ON');
  assert.equal(current.builds.stage4.cmakeCacheSha256,IDENTITY.builds.stage4.cmakeCacheSha256);
});

test('frozen identity rejects a one-byte change in each acoustic-critical input',t=>{
  const targets=[
    IDENTITY.inputs.pluginC.path,
    IDENTITY.inputs.presets.path,
    IDENTITY.inputs.generatedProfile.path,
    IDENTITY.toolchain.toolchainFile,
    `${IDENTITY.builds.production.buildDirectory}/CMakeCache.txt`,
    IDENTITY.inputs.captureHelper.path,
    IDENTITY.inputs.stage3Evaluator.path
  ];
  for(const relative of targets){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-identity-drift-'));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    copyIdentityWorkspace(dir);
    const file=path.join(dir,relative),bytes=fs.readFileSync(file);
    const changed=Buffer.from(bytes);changed[0]^=1;fs.writeFileSync(file,changed);
    assert.throws(()=>core.hashInputs(dir,IDENTITY),/BLOCKED_CURRENT_BUILD_IDENTITY_DRIFT/,relative);
  }
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'issue7-identity-record-drift-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));copyIdentityWorkspace(dir);
  const report=path.join(dir,'docs/status/plugins/dsp/super-synth/current-build-v1/build-identity.json');
  const expected=core.hashInputs(dir,IDENTITY);
  fs.appendFileSync(report,' ');
  const actual=core.hashInputs(dir,IDENTITY);
  assert.throws(()=>core.checkFrozenIdentity(expected,actual),/BLOCKED_CURRENT_BUILD_IDENTITY_DRIFT/);
});

test('dual-copy immutable writes preserve exact bytes and refuse replacement',t=>{
  const w=workspace(t),first=Buffer.from('first immutable payload\n');
  const written=core.writeImmutableDual(w.roots,'phases/baseline/test.txt',first);
  assert.equal(written.sha256,hash(first));
  assert.equal(core.writeImmutableDual(w.roots,'phases/baseline/test.txt',first).sha256,written.sha256);
  assert.throws(()=>core.writeImmutableDual(w.roots,'phases/baseline/test.txt',Buffer.from('different')),/BLOCKED_EVIDENCE_IMMUTABLE/);
  const read=core.readDualBytes(w.roots,'phases/baseline/test.txt');
  assert.equal(read.sha256,written.sha256);assert.deepEqual(read.bytes,first);
  const replacement=Buffer.from('mutable ledger\n');core.writeMutableDual(w.roots,'phases/baseline/ledger.json',replacement);
  assert.deepEqual(core.readDualBytes(w.roots,'phases/baseline/ledger.json').bytes,replacement);
});

test('cell marker, observed row, and completed ledger are dual-copied; completed cells skip',t=>{
  const phase=startPhase(t),key='production-36-14',time=()=> '2026-10-13T00:01:00.000Z';
  const started=core.startCell({roots:phase.roots,phase:phase.phase,cellKey:key,cell:phase.cells[0],identity:phase.identity,identityNow:()=>phase.identity,now:time});
  assert.equal(started.state,'IN_PROGRESS');
  assert.equal(core.readCell(phase.roots,phase.phase,key).cell.state,'IN_PROGRESS');
  const observation={metrics:{finite:true,peakDbfs:-2,outputGuardHits:0},syntheticTest:true,label:'SYNTHETIC TEST'};
  const completed=core.completeCell({roots:phase.roots,phase:phase.phase,cellKey:key,observation,now:time});
  assert.equal(completed.decision,'PASS');
  const read=core.readCell(phase.roots,phase.phase,key);
  assert.equal(read.cell.state,'COMPLETE');assert.equal(read.observation.syntheticTest,true);
  assert.equal(core.completeCell({roots:phase.roots,phase:phase.phase,cellKey:key,observation,now:time}).skipped,true);
  assert.equal(core.startCell({roots:phase.roots,phase:phase.phase,cellKey:key,cell:phase.cells[0],identity:phase.identity,identityNow:()=>phase.identity,now:time}).skipped,true);
  assert.equal(core.readPhaseLedger(phase.roots,phase.phase).ledger.renderCount,1);
});

test('unsafe and non-finite observations are stored in both copies before FAIL',async t=>{
  const cases=[
    {name:'peak',metrics:{finite:true,peakDbfs:0.1,outputGuardHits:0}},
    {name:'guard',metrics:{finite:true,peakDbfs:-2,outputGuardHits:1}},
    {name:'NaN',metrics:{finite:true,peakDbfs:NaN,outputGuardHits:0}},
    {name:'finite false',metrics:{finite:false,peakDbfs:-2,outputGuardHits:0}}
  ];
  for(const item of cases){
    await t.test(item.name,sub=>{
      const phase=startPhase(sub),key='production-36-14';
      core.startCell({roots:phase.roots,phase:phase.phase,cellKey:key,cell:phase.cells[0],identity:phase.identity,identityNow:()=>phase.identity});
      const result=core.completeCell({roots:phase.roots,phase:phase.phase,cellKey:key,observation:{...item,syntheticTest:true,label:'SYNTHETIC TEST'}});
      assert.equal(result.decision,'FAIL');
      const saved=core.readCell(phase.roots,phase.phase,key);
      assert.equal(saved.cell.decision,'FAIL');
      assert.deepEqual(fs.readFileSync(path.join(phase.roots.primary,'phases',phase.phase,'cells',key,'observation.json')),
        fs.readFileSync(path.join(phase.roots.secondary,'phases',phase.phase,'cells',key,'observation.json')));
      assert.equal(saved.observation.syntheticTest,true);
    });
  }
});

test('primary-only marker after secondary failure is ambiguous and is never rerendered',t=>{
  const phase=startPhase(t),key='production-36-14';let calls=0;
  const write=(file,bytes,base)=>{
    if(file.startsWith(phase.roots.secondary))throw new Error('injected secondary failure');
    return core.writeImmutableFile(file,bytes,base);
  };
  assert.throws(()=>core.startCell({roots:phase.roots,phase:phase.phase,cellKey:key,cell:phase.cells[0],identity:phase.identity,identityNow:()=>phase.identity,writeImmutable:write}),/injected secondary failure/);
  calls+=core.readPhaseLedger(phase.roots,phase.phase).ledger.renderCount;
  assert.equal(calls,0);
  assert.throws(()=>core.readCell(phase.roots,phase.phase,key),/BLOCKED_CELL_AMBIGUOUS/);
});

test('identity drift after a durable marker is ambiguous and blocks retry',t=>{
  const phase=startPhase(t),key='production-36-14';let checks=0;
  const identityNow=()=>++checks===1?phase.identity:{...phase.identity,source:'changed'};
  assert.throws(()=>core.startCell({roots:phase.roots,phase:phase.phase,cellKey:key,cell:phase.cells[0],identity:phase.identity,identityNow}),/BLOCKED_POST_MARKER_IDENTITY_DRIFT/);
  assert.equal(core.readCell(phase.roots,phase.phase,key).cell.state,'AMBIGUOUS');
  assert.throws(()=>core.startCell({roots:phase.roots,phase:phase.phase,cellKey:key,cell:phase.cells[0],identity:phase.identity,identityNow:()=>phase.identity}),/rerender is forbidden/);
  assert.equal(core.readPhaseLedger(phase.roots,phase.phase).ledger.renderCount,0);
});

test('writer lock rejects another worktree and only removes its own lock',t=>{
  const w=workspace(t);let entered=0;
  const result=core.withWriterLock({commonDirectory:w.common,ownerId:'worktree-a'},()=>{
    entered+=1;
    assert.throws(()=>core.withWriterLock({commonDirectory:w.common,ownerId:'worktree-b'},()=>{entered+=100;}),/BLOCKED_WRITER_LOCK/);
    return 'one phase only';
  });
  assert.equal(result,'one phase only');assert.equal(entered,1);
  assert.equal(fs.existsSync(core.lockPath(w.common)),false);
});

test('authorization is exact to Issue #7, epoch, phase, cell set, and budget',()=>{
  const cells=['a','b'],planBody=`Plan cellSetSha256=${core.cellSetSha256(cells)}`;
  const approvalBody=core.expectedApprovalStatement({stage:'stage3e',phase:'baseline',cells,renderBudget:2});
  const base={issue:7,epoch:core.EPOCH,contractSha256:core.CONTRACT_SHA256,stage:'stage3e',phase:'baseline',
    planCommentUrl:'https://github.com/puchinya/soraoto_dsl/issues/7#issuecomment-12344',planCommentSha256:hash(planBody),
    approvalCommentUrl:'https://github.com/puchinya/soraoto_dsl/issues/7#issuecomment-12345',approvalCommentSha256:hash(approvalBody),
    authorizedCellKeys:cells,maxCalls:2,approvedAtEpochMs:Date.parse('2026-10-13T00:00:00.000Z')};
  assert.throws(()=>core.validateAuthorization(null,{stage:'stage3e',phase:'baseline',cells:['a','b'],renderBudget:2}),/AUTHORIZATION_REQUIRED/);
  assert.equal(core.validateAuthorization(base,{stage:'stage3e',phase:'baseline',cells:['a','b'],renderBudget:2}).syntheticTest,false);
  assert.throws(()=>core.validateAuthorization({...base,maxCalls:3},{stage:'stage3e',phase:'baseline',cells:['a','b'],renderBudget:2}),/AUTHORIZATION_REQUIRED/);
  assert.throws(()=>core.validateAuthorization({...base,phase:'screen'},{stage:'stage3e',phase:'baseline',cells:['a','b'],renderBudget:2}),/AUTHORIZATION_REQUIRED/);
  const synthetic={synthetic:true,label:'SYNTHETIC TEST',issue:7,epoch:core.EPOCH,stage:'stage3e',phase:'baseline'};
  assert.throws(()=>core.validateAuthorization(synthetic,{stage:'stage3e',phase:'baseline',cells:['a'],renderBudget:1}),/AUTHORIZATION_REQUIRED/);
  assert.equal(core.validateAuthorization(synthetic,{stage:'stage3e',phase:'baseline',cells:['a'],renderBudget:1,allowSynthetic:true}).syntheticTest,true);
});

test('GitHub approval readback attests immutable plan and approval comments to both stores before execution',t=>{
  const phase=startPhase(t,{keys:['a','b']}),cells=['a','b'],planUrl='https://github.com/puchinya/soraoto_dsl/issues/7#issuecomment-12344';
  const approvalUrl='https://github.com/puchinya/soraoto_dsl/issues/7#issuecomment-12345';
  const planBody=`Plan cellSetSha256=${core.cellSetSha256(cells)}`;
  const approvalBody=core.expectedApprovalStatement({stage:'stage3e',phase:'baseline',cells,renderBudget:2});
  const planTime='2026-10-12T23:00:00Z',approvalTime='2026-10-13T00:00:00Z';
  const authorization={issue:7,epoch:core.EPOCH,contractSha256:core.CONTRACT_SHA256,stage:'stage3e',phase:'baseline',
    planCommentUrl:planUrl,planCommentSha256:hash(planBody),approvalCommentUrl:approvalUrl,approvalCommentSha256:hash(approvalBody),
    authorizedCellKeys:cells,maxCalls:2,approvedAtEpochMs:Date.parse(approvalTime)};
  const comment=(id,url,body,created_at)=>({id:String(id),html_url:url,issue_url:'https://api.github.com/repos/puchinya/soraoto_dsl/issues/7',
    body,created_at,updated_at:created_at,user:{login:'puchinya'}});
  const readback=()=>({authenticatedLogin:'puchinya',comments:{
    '12344':comment('12344',planUrl,planBody,planTime),'12345':comment('12345',approvalUrl,approvalBody,approvalTime)}});
  const verified=core.verifyAndPersistAuthorization(authorization,{roots:phase.roots,stage:'stage3e',phase:'baseline',cells,renderBudget:2,readback,
    now:()=> '2026-10-13T00:01:00.000Z'});
  assert.equal(verified.syntheticTest,false);
  assert.match(verified.sha256,/^[a-f0-9]{64}$/);
  const relative='authorizations/stage3e-baseline.attestation.json';
  const stored=core.readDualBytes(phase.roots,relative);
  assert.equal(stored.sha256,verified.sha256);
  assert.equal(fs.readFileSync(core.dualPaths(phase.roots,relative).primary,'utf8'),fs.readFileSync(core.dualPaths(phase.roots,relative).secondary,'utf8'));
  const attestation=JSON.parse(stored.bytes.toString('utf8'));
  assert.equal(attestation.approverLogin,'puchinya');
  assert.equal(attestation.cellSetSha256,core.cellSetSha256(cells));
  assert.equal(attestation.renderBudget,2);
  const repeated=core.verifyAndPersistAuthorization(authorization,{roots:phase.roots,stage:'stage3e',phase:'baseline',cells,renderBudget:2,readback,
    now:()=> '2026-10-13T01:00:00.000Z'});
  assert.equal(repeated.sha256,verified.sha256);
});

test('invalid or edited GitHub approval evidence fails closed without writing an attestation',t=>{
  const cells=['a','b'],planUrl='https://github.com/puchinya/soraoto_dsl/issues/7#issuecomment-12344';
  const approvalUrl='https://github.com/puchinya/soraoto_dsl/issues/7#issuecomment-12345';
  const planBody=`Plan cellSetSha256=${core.cellSetSha256(cells)}`;
  const approvalBody=core.expectedApprovalStatement({stage:'stage3e',phase:'baseline',cells,renderBudget:2});
  const planTime='2026-10-12T23:00:00Z',approvalTime='2026-10-13T00:00:00Z';
  const authorization={issue:7,epoch:core.EPOCH,contractSha256:core.CONTRACT_SHA256,stage:'stage3e',phase:'baseline',
    planCommentUrl:planUrl,planCommentSha256:hash(planBody),approvalCommentUrl:approvalUrl,approvalCommentSha256:hash(approvalBody),
    authorizedCellKeys:cells,maxCalls:2,approvedAtEpochMs:Date.parse(approvalTime)};
  const comment=(url,body,created_at,overrides={})=>({html_url:url,issue_url:'https://api.github.com/repos/puchinya/soraoto_dsl/issues/7',
    body,created_at,updated_at:created_at,user:{login:'puchinya'},...overrides});
  const valid={authenticatedLogin:'puchinya',comments:{
    '12344':comment(planUrl,planBody,planTime),'12345':comment(approvalUrl,approvalBody,approvalTime)}};
  const cases=[
    ['fake approval URL', {...authorization,approvalCommentUrl:'https://github.com/puchinya/soraoto_dsl/issues/7#issuecomment-99999'},valid],
    ['wrong raw body SHA', {...authorization,approvalCommentSha256:'a'.repeat(64)},valid],
    ['different authenticated author', authorization,{...valid,authenticatedLogin:'someone-else'}],
    ['different comment author',authorization,{...valid,comments:{...valid.comments,'12345':{...valid.comments['12345'],user:{login:'someone-else'}}}}],
    ['edited approval comment', authorization,{...valid,comments:{...valid.comments,'12345':{...valid.comments['12345'],updated_at:'2026-10-13T00:02:00Z'}}}],
    ['wrong approval wording', authorization,{...valid,comments:{...valid.comments,'12345':{...valid.comments['12345'],body:'approved, go ahead'}}}],
    ['plan for a different cell set', authorization,{...valid,comments:{...valid.comments,'12344':{...valid.comments['12344'],body:'Plan cellSetSha256='+core.cellSetSha256(['a','c'])}}}],
    ['budget mismatch', {...authorization,maxCalls:3},valid]
  ];
  for(const [name,auth,data] of cases){
    const phase=startPhase(t,{keys:['a','b']});let renders=0;
    const before=[fs.existsSync(phase.roots.primary),fs.existsSync(phase.roots.secondary)];
    assert.throws(()=>{
      core.verifyAndPersistAuthorization(auth,{roots:phase.roots,stage:'stage3e',phase:'baseline',cells,renderBudget:2,readback:()=>data});
      renders+=1;
    },/AUTHORIZATION_REQUIRED/,name);
    assert.equal(renders,0,name);
    assert.deepEqual([fs.existsSync(phase.roots.primary),fs.existsSync(phase.roots.secondary)],before,name);
  }
});

test('finalization preserves failures and is byte-stable on repeated verification',t=>{
  const phase=startPhase(t),key='production-36-14';
  core.startCell({roots:phase.roots,phase:phase.phase,cellKey:key,cell:phase.cells[0],identity:phase.identity,identityNow:()=>phase.identity});
  core.completeCell({roots:phase.roots,phase:phase.phase,cellKey:key,observation:{metrics:{finite:true,peakDbfs:-2,outputGuardHits:0},syntheticTest:true,label:'SYNTHETIC TEST'}});
  const first=core.finalizePhase({roots:phase.roots,phase:phase.phase,decision:'PASS',summary:{label:'SYNTHETIC TEST'},now:()=> '2026-10-13T00:02:00.000Z'});
  const before=[statInventory(phase.roots.primary),statInventory(phase.roots.secondary)];
  const second=core.finalizePhase({roots:phase.roots,phase:phase.phase,decision:'PASS',summary:{label:'SYNTHETIC TEST'},now:()=> '2026-10-13T01:02:00.000Z'});
  assert.equal(first.sha256,second.sha256);assert.equal(first.archiveSha256,second.archiveSha256);
  assert.deepEqual([statInventory(phase.roots.primary),statInventory(phase.roots.secondary)],before);
  assert.equal(core.readFinal(phase.roots,phase.phase).result.decision,'PASS');
});

test('a failed observation cannot be finalized as PASS',t=>{
  const phase=startPhase(t),key='production-36-14';
  core.startCell({roots:phase.roots,phase:phase.phase,cellKey:key,cell:phase.cells[0],identity:phase.identity,identityNow:()=>phase.identity});
  core.completeCell({roots:phase.roots,phase:phase.phase,cellKey:key,observation:{metrics:{finite:true,peakDbfs:0.1,outputGuardHits:0},syntheticTest:true,label:'SYNTHETIC TEST'}});
  assert.throws(()=>core.finalizePhase({roots:phase.roots,phase:phase.phase,decision:'PASS'}),/failed observations cannot finalize as PASS/);
});

test('read-only dual-copy verification does not change size, SHA, or mtime',t=>{
  const phase=startPhase(t),key='production-36-14';
  core.startCell({roots:phase.roots,phase:phase.phase,cellKey:key,cell:phase.cells[0],identity:phase.identity,identityNow:()=>phase.identity});
  const before=[statInventory(phase.roots.primary),statInventory(phase.roots.secondary)];
  core.readPhaseLedger(phase.roots,phase.phase);core.readCell(phase.roots,phase.phase,key);core.readDualBytes(phase.roots,'phases/baseline/manifest.json');
  assert.deepEqual([statInventory(phase.roots.primary),statInventory(phase.roots.secondary)],before);
});
