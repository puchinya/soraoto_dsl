'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');
const search=require('./stage3e-search-core.cjs');
const validator=require('./stage3e-evidence-validator.cjs');
const recovery=require('./stage3e-recovery-reconciliation-v2.cjs');
const gen2=require('./run-stage3e-generation2.cjs');
const preAbortEvidence=require('./stage3e-pre-render-abort-evidence.cjs');

assert.equal(typeof preAbortEvidence.readOriginalArtifacts,'function');
assert.equal(typeof preAbortEvidence.validateAbortForensic,'function');
assert.doesNotMatch(fs.readFileSync(require.resolve('./stage3e-recovery-reconciliation-v2.cjs'),'utf8'),
  /require\(['"]\.\/run-stage3e-pre-render-abort-recovery\.cjs/,'reconciliation depends on the pure evidence module, not its CLI wrapper');

function fixture(){
  const cells=search.expectedLowScreenCells(),states=Object.fromEntries(cells.map(cell=>[cell.key,{identity:cell,state:'PENDING',sha256:null}]));
  const genesis={schemaVersion:1,phase:'low',generation:2,executionId:'generation-2',authorizedCellCount:1512,
    identity:{candidateId:'stage2n-r3-candidate-01'},accounting:{renderCalls:0},cells:states};
  const genesisBytes=gen2.jsonBytes(genesis),working=JSON.parse(genesisBytes.toString('utf8'));
  working.cells[recovery.TARGET_KEY].state='IN_PROGRESS';working.cells[recovery.TARGET_KEY].startedAt='original';
  const oldBytes=gen2.jsonBytes(working),oldSha=recovery.sha256(oldBytes),next=recovery.proposedLedger(working),nextBytes=gen2.jsonBytes(next),nextSha=recovery.sha256(nextBytes);
  const transition1={schemaVersion:1,sequence:1,previousLedgerSha256:recovery.sha256(genesisBytes),nextLedgerSha256:oldSha,
    cellKey:recovery.TARGET_KEY,cellIdentity:cells.find(item=>item.key===recovery.TARGET_KEY),oldState:'PENDING',newState:'IN_PROGRESS',
    previousRenderCount:0,newRenderCount:0,capturedCellSha256:null,manifestSha256:'a'.repeat(64),proofSha256:'b'.repeat(64),
    compatibilitySha256:'c'.repeat(64)};
  const transactionIntentSha256='d'.repeat(64),authorizationSha256='e'.repeat(64),sourceAuditSha256='f'.repeat(64),invalidResult='1'.repeat(64),reconCompat='2'.repeat(64);
  const transition2={schemaVersion:1,sequence:2,previousLedgerSha256:oldSha,nextLedgerSha256:nextSha,cellKey:recovery.TARGET_KEY,
    cellIdentity:cells.find(item=>item.key===recovery.TARGET_KEY),oldState:'IN_PROGRESS',newState:'PENDING',previousRenderCount:0,
    newRenderCount:0,capturedCellSha256:null,manifestSha256:'a'.repeat(64),proofSha256:'b'.repeat(64),compatibilitySha256:'c'.repeat(64),
    eventType:'ADMIN_REQUEUE_NO_RENDER',recoveryAuthorizationSha256:authorizationSha256,transactionIntentSha256,sourceAuditSha256,
    invalidRecoveryResultSha256:invalidResult,recoveryReconciliationCompatibilitySha256:reconCompat};
  const replay=()=>validator.validateLedgerTransitions({genesisLedgerBytes:genesisBytes,currentLedgerBytes:nextBytes,
    transitionEntries:[transition1,transition2],renderStartEntries:[],expectedCells:cells,
    bindings:{manifestSha256:'a'.repeat(64),proofSha256:'b'.repeat(64),compatibilitySha256:'c'.repeat(64),
      recoveryCompatibilitySha256:'c'.repeat(64),recoveryReconciliationCompatibilitySha256:reconCompat}});
  return {cells,genesisBytes,oldBytes,oldSha,next,nextBytes,nextSha,transition1,transition2,replay};
}

{
  const {oldBytes,next,nextBytes,nextSha,replay}=fixture();
  assert.equal(JSON.parse(oldBytes.toString('utf8')).accounting.renderCalls,0);
  assert.equal(next.cells[recovery.TARGET_KEY].state,'PENDING');
  assert.equal(Object.hasOwn(next.cells[recovery.TARGET_KEY],'startedAt'),false);
  assert.equal(recovery.sha256(nextBytes),nextSha);
  assert.deepEqual(replay(),{pending:1512,inProgress:0,complete:0,renderCalls:0,
    genesisLedgerSha256:recovery.sha256(fixture().genesisBytes),currentLedgerSha256:nextSha,transitionCount:2});
}

for(const mutate of [
  ledger=>{ledger.cells[recovery.TARGET_KEY].state='COMPLETE';},
  ledger=>{ledger.cells[recovery.TARGET_KEY].sha256='a'.repeat(64);},
  ledger=>{ledger.cells[Object.keys(ledger.cells).find(key=>key!==recovery.TARGET_KEY)].state='IN_PROGRESS';},
  ledger=>{ledger.accounting.renderCalls=1;}
]){
  const {oldBytes}=fixture(),ledger=JSON.parse(oldBytes.toString('utf8'));mutate(ledger);
  assert.throws(()=>recovery.proposedLedger(ledger),/BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING/);
}

{
  const f=fixture();
  const duplicate={...f.transition2,sequence:3,previousLedgerSha256:f.nextSha,nextLedgerSha256:f.nextSha};
  assert.throws(()=>validator.validateLedgerTransitions({genesisLedgerBytes:f.genesisBytes,currentLedgerBytes:f.nextBytes,
    transitionEntries:[f.transition1,f.transition2,duplicate],renderStartEntries:[],expectedCells:f.cells,
    bindings:{manifestSha256:'a'.repeat(64),proofSha256:'b'.repeat(64),compatibilitySha256:'c'.repeat(64),
      recoveryCompatibilitySha256:'c'.repeat(64),recoveryReconciliationCompatibilitySha256:'2'.repeat(64)}}),/ledger transition/);
  const forged={...f.transition2,recoveryReconciliationCompatibilitySha256:'0'.repeat(64)};
  assert.throws(()=>validator.validateLedgerTransitions({genesisLedgerBytes:f.genesisBytes,currentLedgerBytes:f.nextBytes,
    transitionEntries:[f.transition1,forged],renderStartEntries:[],expectedCells:f.cells,
    bindings:{manifestSha256:'a'.repeat(64),proofSha256:'b'.repeat(64),compatibilitySha256:'c'.repeat(64),
      recoveryCompatibilitySha256:'c'.repeat(64),recoveryReconciliationCompatibilitySha256:'2'.repeat(64)}}),/ledger transition/);
}

{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-reconcile-v2-'));
  try{
    const roots={primary:path.join(temp,'primary'),secondary:path.join(temp,'secondary')};
    fs.mkdirSync(roots.primary,{recursive:true});fs.mkdirSync(roots.secondary,{recursive:true});
    const bytes=Buffer.from('immutable evidence\n'),saved=recovery.immutableDual(roots,'authorization-v2.json',bytes);
    assert.equal(durable.verifyDualCopy(path.join(roots.primary,'authorization-v2.json'),path.join(roots.secondary,'authorization-v2.json')).sha256,saved.sha256);
    assert.equal(recovery.immutableDual(roots,'authorization-v2.json',bytes).sha256,saved.sha256,'same immutable bytes are read-only reused');
    assert.throws(()=>recovery.immutableDual(roots,'authorization-v2.json',Buffer.from('replacement\n')),/BLOCKED_STAGE3E_RECOVERY_TRANSACTION_COLLISION/);
    fs.unlinkSync(path.join(roots.secondary,'authorization-v2.json'));
    assert.equal(recovery.immutableDual(roots,'authorization-v2.json',bytes).sha256,saved.sha256,'exact missing mirror may be restored');
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}

{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-reconcile-ledger-'));
  try{
    const resolved={primary:{lowLedger:path.join(temp,'p-low.json')},secondary:{lowLedger:path.join(temp,'s-low.json')}};
    const {oldBytes,nextBytes,nextSha,oldSha}=fixture();fs.writeFileSync(resolved.primary.lowLedger,oldBytes);fs.writeFileSync(resolved.secondary.lowLedger,oldBytes);
    const tx={stagedLedgerBytes:nextBytes,stagedLedgerSha256:nextSha};
    assert.equal(recovery.mirrorLiveLedger(resolved,tx,oldBytes).sha256,nextSha);
    assert.equal(recovery.mirrorLiveLedger(resolved,tx,oldBytes).sha256,nextSha,'resume reuses the authorized new bytes');
    fs.writeFileSync(resolved.secondary.lowLedger,Buffer.from('unknown'));
    assert.throws(()=>recovery.mirrorLiveLedger(resolved,tx,oldBytes),/BLOCKED_STAGE3E_AMBIGUOUS_RENDER_ACCOUNTING/);
    assert.match(oldSha,/^[0-9a-f]{64}$/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}

{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-reconcile-crash-'));
  try{
    const roots={primary:path.join(temp,'primary'),secondary:path.join(temp,'secondary')};
    fs.mkdirSync(roots.primary,{recursive:true});fs.mkdirSync(roots.secondary,{recursive:true});
    const resolved={primary:{lowLedger:path.join(roots.primary,'low/low-ledger.json')},secondary:{lowLedger:path.join(roots.secondary,'low/low-ledger.json')}};
    const {oldBytes,nextBytes,nextSha}=fixture(),transition=Buffer.from('one authorized admin requeue\n'),transitionSha=recovery.sha256(transition);
    fs.mkdirSync(path.dirname(resolved.primary.lowLedger),{recursive:true});fs.mkdirSync(path.dirname(resolved.secondary.lowLedger),{recursive:true});
    fs.writeFileSync(resolved.primary.lowLedger,oldBytes);fs.writeFileSync(resolved.secondary.lowLedger,oldBytes);
    recovery.appendJournalOnce(roots,transition,transitionSha);
    let writes=0;
    assert.throws(()=>recovery.mirrorLiveLedger(resolved,{stagedLedgerBytes:nextBytes,stagedLedgerSha256:nextSha},oldBytes,{write(file,bytes){
      writes++;if(file===resolved.secondary.lowLedger)throw new Error('injected secondary interruption');fs.writeFileSync(file,bytes);
    }}),/BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE/);
    assert.equal(recovery.sha256(fs.readFileSync(resolved.primary.lowLedger)),nextSha,'primary ledger may be the only committed mirror after interruption');
    assert.equal(recovery.sha256(fs.readFileSync(resolved.secondary.lowLedger)),recovery.sha256(oldBytes));
    assert.equal(recovery.appendJournalOnce(roots,transition,transitionSha).sha256,transitionSha,'resume validates and reuses the same journal transition');
    recovery.mirrorLiveLedger(resolved,{stagedLedgerBytes:nextBytes,stagedLedgerSha256:nextSha},oldBytes);
    assert.equal(durable.verifyDualCopy(resolved.primary.lowLedger,resolved.secondary.lowLedger).sha256,nextSha);
    assert.equal(fs.readdirSync(path.join(roots.primary,'ledger-transition-journal')).filter(name=>name==='transition-000002.json').length,1);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}

{
  const calls=[];let snapshotCount=0;
  const expected=[
    ['run-stage3e-pre-render-abort-recovery.cjs','--verify','STAGE3E_PRE_RENDER_ABORT_COMMIT_VERIFIED'],
    ['run-stage3e-generation2.cjs','--dry-run','GENERATION2_SEARCH_READY'],
    ['run-stage3e-master-orchestrator.cjs','--dry-run','STAGE3E_MASTER_DRY_RUN_READY']
  ];
  const gates=recovery.runRequiredCliGates({root:recovery.ROOT,home:process.env.HOME,
    invoke(_root,_home,script,mode){calls.push([script,mode]);return {decision:expected[calls.length-1][2],builds:0,renders:0,acousticRenders:0,evidenceWrites:0};},
    snapshot(){snapshotCount++;return {stable:'same-files-and-mtimes'};}});
  assert.deepEqual(calls,expected.map(([script,mode])=>[script,mode]));
  assert.equal(snapshotCount,2,'the read-only CLI gate snapshots both sides before and after');
  assert.equal(gates.pass,true);assert.equal(gates.evidenceWrites,0);
  assert.throws(()=>recovery.runRequiredCliGates({root:recovery.ROOT,home:process.env.HOME,
    invoke(){return {decision:'GENERATION2_SEARCH_READY',builds:0,renders:1,acousticRenders:1,evidenceWrites:0};},snapshot(){return {};}}),/BLOCKED_STAGE3E_RECOVERY_TRANSACTION_PREFLIGHT/);
}

{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-no-phantom-result-'));
  try{
    const roots={primary:temp,secondary:path.join(temp,'secondary')};fs.mkdirSync(roots.secondary);
    const forbiddenResult=path.join(temp,recovery.FILES.result);
    assert.throws(()=>recovery.finalizeArtifacts({}, {tRoots:roots,stagedLedgerSha256:'a'.repeat(64)}, {}, {
      gates:{pass:false},ledger:{sha256:'a'.repeat(64)},replay:{pending:1512,inProgress:0,complete:0,renderCalls:0}
    }),/BLOCKED_STAGE3E_RECOVERY_TRANSACTION_EVIDENCE/);
    assert.equal(fs.existsSync(forbiddenResult),false,'result is not emitted before all postconditions and CLI gates pass');
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}

{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-verifier-anchor-'));
  const git=(...args)=>execFileSync('rtk',['git',...args],{cwd:temp,encoding:'utf8'});
  try{
    git('init','-q');git('config','user.name','Codex Test');git('config','user.email','codex-test@example.invalid');
    const protectedFiles=['wasm/plugins/dsp/super-synth/src/plugin.c','wasm/plugins/dsp/super-synth/presets.json','wasm/shared/generated/super-synth_grand_profiles.h'];
    for(const relative of [...recovery.VERIFIER_RUNTIME_PATHS,...protectedFiles]){
      const file=path.join(temp,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'base\n');
    }
    git('add','.');git('commit','-q','-m','base');const base=git('rev-parse','HEAD').trim();
    const changedRuntime=path.join(temp,'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs');
    fs.writeFileSync(changedRuntime,'verifier fix\n');git('add','.');git('commit','-q','-m','verifier fix');const anchor=git('rev-parse','HEAD').trim();
    fs.writeFileSync(path.join(temp,'docs.md'),'later documentation only\n');git('add','.');git('commit','-q','-m','docs only');let current=git('rev-parse','HEAD').trim();
    const identity=recovery.assertCurrentVerifierAtAnchor(temp,anchor,current,base);
    assert.equal(identity.files['wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs'],recovery.sha256(Buffer.from('verifier fix\n')));
    fs.writeFileSync(changedRuntime,'behavior drift\n');git('add','.');git('commit','-q','-m','runtime drift');current=git('rev-parse','HEAD').trim();
    assert.throws(()=>recovery.assertCurrentVerifierAtAnchor(temp,anchor,current,base),/verifier runtime changed after compatibility anchor/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}

assert.throws(()=>recovery.run({mode:'--create-v3'}),/supported modes/);
process.stdout.write('PASS Stage3E reconciliation v2 transaction, no-render requeue, immutable writes, and recovery guards\n');
