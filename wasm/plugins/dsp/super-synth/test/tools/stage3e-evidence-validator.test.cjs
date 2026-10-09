'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const validator=require('./stage3e-evidence-validator.cjs');

function write(file,bytes){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
function inventory(root){return validator.walkFiles(root);}
function makeRoots(){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-evidence-'));
  const primary=path.join(base,'primary'),secondary=path.join(base,'secondary');
  for(const root of [primary,secondary])for(let index=0;index<35;index++)write(path.join(root,`frozen/${String(index).padStart(2,'0')}.json`),Buffer.from(`frozen-${index}`));
  return {base,primary,secondary};
}
function auditFor(primary,secondary){return {immutablePreexistingFileInventory:{primary:{files:inventory(primary)},secondary:{files:inventory(secondary)}}};}

{
  const roots=makeRoots();
  try{
    const expected=['low-cell-a'];
    const audit=auditFor(roots.primary,roots.secondary);
    write(path.join(roots.primary,'generation-2/search-v1/generation-2-manifest.json'),Buffer.from('manifest'));
    write(path.join(roots.secondary,'generation-2/search-v1/generation-2-manifest.json'),Buffer.from('manifest'));
    write(path.join(roots.primary,'generation-2/search-v1/low/low-ledger.json'),Buffer.from('ledger'));
    write(path.join(roots.secondary,'generation-2/search-v1/low/low-ledger.json'),Buffer.from('ledger'));
    write(path.join(roots.primary,'generation-2/search-v1/low/cells/low-cell-a.json'),Buffer.from('cell'));
    write(path.join(roots.secondary,'generation-2/search-v1/low/cells/low-cell-a.json'),Buffer.from('cell'));
    for(const name of ['verifier-compatibility-v10.json','verifier-compatibility-v10-2.json']){
      write(path.join(roots.primary,'generation-2/search-v1/recovery-reconciliation-v2',name),Buffer.from(name));
      write(path.join(roots.secondary,'generation-2/search-v1/recovery-reconciliation-v2',name),Buffer.from(name));
    }
    const before=inventory(roots.primary),result=validator.validateNamespaceAdditions({primaryRoot:roots.primary,secondaryRoot:roots.secondary,audit,authorizedKeys:expected});
    assert.equal(result.frozenCount,35);assert.equal(result.additionCount,5);
    assert.deepEqual(inventory(roots.primary).filter(item=>item.path.startsWith('frozen/')),before.filter(item=>item.path.startsWith('frozen/')));
    assert.equal(validator.isSearchAddition('generation-2/search-v1/low/cells/unauthorized.json',{authorizedKeys:expected}),false);
    assert.equal(validator.isSearchAddition('generation-2/search-v1/low/validations/low-full-x/cells/unauthorized.json',{authorizedKeys:expected}),false);
    assert.equal(validator.isSearchAddition('generation-2/search-v1/verifier-compatibility-v2.json'),true);
    assert.equal(validator.isSearchAddition('generation-2/search-v1/verifier-compatibility-v2.sha256'),true);
    assert.equal(validator.isSearchAddition('generation-2/search-v1/archives/verifier-compatibility-v2.tar.gz'),true);
    assert.equal(validator.isSearchAddition('generation-2/search-v1/recovery-reconciliation-v2/verifier-compatibility-v10.json'),true);
    assert.equal(validator.isSearchAddition('generation-2/search-v1/recovery-reconciliation-v2/verifier-compatibility-v10-2.json'),true);
    assert.equal(validator.isSearchAddition('generation-2/search-v1/recovery-reconciliation-v2/verifier-compatibility-v10-3.json'),false);
    write(path.join(roots.primary,'random/unowned.json'),Buffer.from('unexpected'));
    write(path.join(roots.secondary,'random/unowned.json'),Buffer.from('unexpected'));
    assert.throws(()=>validator.validateNamespaceAdditions({primaryRoot:roots.primary,secondaryRoot:roots.secondary,audit,authorizedKeys:expected}),/BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE/);
  }finally{fs.rmSync(roots.base,{recursive:true,force:true});}
}

{
  const roots=makeRoots();
  try{
    const audit=auditFor(roots.primary,roots.secondary),frozen=inventory(roots.primary)[0];
    write(path.join(roots.primary,frozen.path),Buffer.from('tampered'));
    assert.throws(()=>validator.validateNamespaceAdditions({primaryRoot:roots.primary,secondaryRoot:roots.secondary,audit}),/BLOCKED_STAGE3E_AMENDMENT_EVIDENCE/);
  }finally{fs.rmSync(roots.base,{recursive:true,force:true});}
}

{
  const roots=makeRoots();
  try{
    const audit=auditFor(roots.primary,roots.secondary);
    write(path.join(roots.primary,'generation-2/search-v1/low/low-ledger.json'),Buffer.from('primary'));
    write(path.join(roots.secondary,'generation-2/search-v1/low/low-ledger.json'),Buffer.from('secondary'));
    assert.throws(()=>validator.validateNamespaceAdditions({primaryRoot:roots.primary,secondaryRoot:roots.secondary,audit}),/BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE/);
  }finally{fs.rmSync(roots.base,{recursive:true,force:true});}
}

{
  const expectedCells=[{key:'cell-a',pitch:36},{key:'cell-b',pitch:39}];
  const genesis={generation:2,executionId:'generation-2',phase:'low-screen',authorizedCellCount:2,identity:{id:'fixed'},accounting:{renderCalls:0},
    cells:Object.fromEntries(expectedCells.map(cell=>[cell.key,{state:'PENDING',identity:cell,relativePath:`cells/${cell.key}.json`,sha256:null}]))};
  const genesisBytes=Buffer.from(JSON.stringify(genesis));
  const current=JSON.parse(JSON.stringify(genesis));current.cells['cell-a'].state='COMPLETE';current.cells['cell-a'].sha256='f'.repeat(64);current.accounting.renderCalls=1;
  const currentBytes=Buffer.from(JSON.stringify(current)),genesisSha=validator.sha256(genesisBytes),currentSha=validator.sha256(currentBytes);
  const bindings={manifestSha256:'a'.repeat(64),proofSha256:'b'.repeat(64),compatibilitySha256:'c'.repeat(64)};
  const first={sequence:1,previousLedgerSha256:genesisSha,nextLedgerSha256:'d'.repeat(64),cellKey:'cell-a',cellIdentity:expectedCells[0],oldState:'PENDING',newState:'IN_PROGRESS',previousRenderCount:0,newRenderCount:0,capturedCellSha256:null,...bindings};
  const second={sequence:2,previousLedgerSha256:first.nextLedgerSha256,nextLedgerSha256:currentSha,cellKey:'cell-a',cellIdentity:expectedCells[0],oldState:'IN_PROGRESS',newState:'COMPLETE',previousRenderCount:0,newRenderCount:1,capturedCellSha256:'f'.repeat(64),...bindings};
  second.renderStartMarkerSha256='9'.repeat(64);
  const marker={schemaVersion:1,kind:'STAGE3E_RENDER_START',sequence:1,cellKey:'cell-a',cellIdentity:expectedCells[0],
    ledgerSha256:first.nextLedgerSha256,transitionSequence:1,transitionSha256:validator.sha256(validator.jsonBytes(first)),
    manifestSha256:bindings.manifestSha256,proofSha256:bindings.proofSha256,compatibilitySha256:bindings.compatibilitySha256,
    renderCallIndex:1,_sha256:second.renderStartMarkerSha256};
  const accepted=validator.validateLedgerTransitions({genesisLedgerBytes:genesisBytes,currentLedgerBytes:currentBytes,transitionEntries:[first,second],renderStartEntries:[marker],expectedCells,bindings});
  assert.deepEqual({pending:accepted.pending,inProgress:accepted.inProgress,complete:accepted.complete,renderCalls:accepted.renderCalls},{pending:1,inProgress:0,complete:1,renderCalls:1});
  assert.throws(()=>validator.validateLedgerTransitions({genesisLedgerBytes:genesisBytes,currentLedgerBytes:currentBytes,transitionEntries:[first,{...second,newRenderCount:2}],renderStartEntries:[marker],expectedCells,bindings}),/BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE/);
  assert.throws(()=>validator.validateLedgerTransitions({genesisLedgerBytes:genesisBytes,currentLedgerBytes:currentBytes,transitionEntries:[first,second],expectedCells,bindings}),/missing or mismatched durable render-start marker/);
  assert.throws(()=>validator.validateLedgerTransitions({genesisLedgerBytes:genesisBytes,currentLedgerBytes:currentBytes,transitionEntries:[first,second],renderStartEntries:[marker],expectedCells,bindings:{...bindings,proofSha256:'e'.repeat(64)}}),/BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE/);
}

{
  const cell={key:'low-screen-L1-M1-H0-midi-036-v110',pitch:36,velocity:14,response:{low:1,mid:1,bassHardness:0}};
  const genesis={generation:2,executionId:'generation-2',phase:'low',authorizedCellCount:1,identity:{id:'fixed'},accounting:{renderCalls:0},
    cells:{[cell.key]:{state:'PENDING',identity:cell,relativePath:`cells/${cell.key}.json`,sha256:null}}};
  const genesisBytes=Buffer.from(JSON.stringify(genesis)),genesisSha=validator.sha256(genesisBytes);
  const inProgress=JSON.parse(JSON.stringify(genesis));inProgress.cells[cell.key].state='IN_PROGRESS';inProgress.cells[cell.key].startedAt='old-run';
  const inProgressBytes=Buffer.from(JSON.stringify(inProgress)),inProgressSha=validator.sha256(inProgressBytes);
  const requeued=JSON.parse(JSON.stringify(inProgress));requeued.cells[cell.key].state='PENDING';delete requeued.cells[cell.key].startedAt;
  const requeuedBytes=Buffer.from(JSON.stringify(requeued)),requeuedSha=validator.sha256(requeuedBytes);
  const v2='2'.repeat(64),v3='3'.repeat(64),abort='4'.repeat(64),authorization='5'.repeat(64),recoveryResult='8'.repeat(64),oldCode='6'.repeat(64),newCode='7'.repeat(64);
  const common={manifestSha256:'a'.repeat(64),proofSha256:'b'.repeat(64)};
  const first={sequence:1,previousLedgerSha256:genesisSha,nextLedgerSha256:inProgressSha,cellKey:cell.key,cellIdentity:cell,
    oldState:'PENDING',newState:'IN_PROGRESS',previousRenderCount:0,newRenderCount:0,capturedCellSha256:null,compatibilitySha256:v2,...common};
  const aborted={sequence:2,previousLedgerSha256:inProgressSha,nextLedgerSha256:inProgressSha,cellKey:cell.key,cellIdentity:cell,
    oldState:'IN_PROGRESS',newState:'IN_PROGRESS',previousRenderCount:0,newRenderCount:0,capturedCellSha256:null,
    eventType:'ABORTED_BEFORE_RENDER',compatibilitySha256:v3,recoveryAuthorizationSha256:authorization,recoveryResultSha256:recoveryResult,abortEvidenceSha256:abort,
    attemptIndex:1,abortedBeforeRenderCalls:0,oldCodeSha256:oldCode,newCodeSha256:newCode,...common};
  const requeue={sequence:3,previousLedgerSha256:inProgressSha,nextLedgerSha256:requeuedSha,cellKey:cell.key,cellIdentity:cell,
    oldState:'IN_PROGRESS',newState:'PENDING',previousRenderCount:0,newRenderCount:0,capturedCellSha256:null,
    eventType:'REQUEUE_AUTHORIZED',compatibilitySha256:v3,recoveryAuthorizationSha256:authorization,recoveryResultSha256:recoveryResult,abortEvidenceSha256:abort,
    attemptIndex:1,abortedBeforeRenderCalls:0,oldCodeSha256:oldCode,newCodeSha256:newCode,...common};
  const accepted=validator.validateLedgerTransitions({genesisLedgerBytes:genesisBytes,currentLedgerBytes:requeuedBytes,
    transitionEntries:[first,aborted,requeue],expectedCells:[cell],bindings:{...common,compatibilitySha256:v3,
      acceptedCompatibilitySha256s:[v2],recoveryCompatibilitySha256:v3}});
  assert.deepEqual({pending:accepted.pending,inProgress:accepted.inProgress,complete:accepted.complete,renderCalls:accepted.renderCalls},
    {pending:1,inProgress:0,complete:0,renderCalls:0});
  assert.throws(()=>validator.validateLedgerTransitions({genesisLedgerBytes:genesisBytes,currentLedgerBytes:requeuedBytes,
    transitionEntries:[first,aborted,requeue,requeue],expectedCells:[cell],bindings:{...common,compatibilitySha256:v3,
      acceptedCompatibilitySha256s:[v2],recoveryCompatibilitySha256:v3}}),/BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE/);
}
console.log('PASS Stage3E frozen inventory, append-only namespace, dual-copy, and ledger transition validation');
