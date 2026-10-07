'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const runner=require('./run-stage3e-velocity-response.cjs');

function tempGitRoot(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-generation2-'));
  execFileSync('rtk',['git','init','--quiet'],{cwd:root});
  const tombstonePath=runner.generation1TombstonePath(root);
  fs.mkdirSync(path.dirname(tombstonePath),{recursive:true});
  fs.writeFileSync(tombstonePath,JSON.stringify({
    state:'ABANDONED_STAGE3E_WORKTREE_LOSS',
    executionId:runner.GENERATION_1_EXECUTION_ID,
    reportedLedgerSha256:runner.GENERATION_1_LEDGER_SHA256,
    historicalStage3eWasmSha256:runner.GENERATION_1_WASM_SHA256,
    baselineAcousticCalls:12,
    failedSearchCalls:0,
    reusableRows:0,
  }));
  return root;
}

{
  const root=tempGitRoot();
  try{
    const result=runner.assertGeneration1Abandoned(root);
    assert.equal(result.record.state,'ABANDONED_STAGE3E_WORKTREE_LOSS');
    assert.equal(result.record.baselineAcousticCalls,12);
    assert.throws(()=>runner.assertGeneration2Ledger({generation:1,executionId:runner.GENERATION_1_EXECUTION_ID}),/BLOCKED_STAGE3E_GENERATION1_ABANDONED/);
    assert.equal(runner.assertGeneration2Ledger({generation:2,executionId:'fresh-generation-2'}).generation,2);
    const changed=JSON.parse(fs.readFileSync(result.path,'utf8'));
    changed.reusableRows=1;
    fs.writeFileSync(result.path,JSON.stringify(changed));
    assert.throws(()=>runner.assertGeneration1Abandoned(root),/BLOCKED_STAGE3E_GENERATION1_TOMBSTONE_IDENTITY/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

{
  const root=tempGitRoot();
  try{
    const common=runner.gitCommonDir(root);
    const expected=path.join(common,'soraoto-agent-state/issues/7/stage3e/generation-2');
    assert.equal(runner.generation2EvidenceRoot(root,expected),expected);
    assert.throws(()=>runner.generation2EvidenceRoot(root,path.join(root,'generation-2')),/BLOCKED_STAGE3E_EVIDENCE_ROOT_IDENTITY/);
    const priorBuild=process.env.SORAOTO_WASM_BUILD_DIR;
    process.env.SORAOTO_WASM_BUILD_DIR=expected;
    try{assert.throws(()=>runner.generation2EvidenceRoot(root,expected),/BLOCKED_STAGE3E_EVIDENCE_ROOT_INSIDE_WORKTREE_OR_BUILD/);}
    finally{if(priorBuild===undefined)delete process.env.SORAOTO_WASM_BUILD_DIR;else process.env.SORAOTO_WASM_BUILD_DIR=priorBuild;}
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

{
  const root=tempGitRoot();
  try{
    const paths=runner.historicalBaselinePaths(runner.gitCommonDir(root));
    assert.deepEqual(Object.keys(paths),runner.BASELINE_EVIDENCE_RELATIVE_PATHS);
    assert(paths['calibration-optuna/stage3/direct-capture.json'].endsWith('/calibration-optuna/stage3/direct-capture.json'));
    assert.throws(()=>runner.assertHistoricalBaselineEvidence(paths),error=>{
      assert.match(error.message,/BLOCKED_STAGE3E_BASELINE_EVIDENCE_MISSING/);
      return Object.values(paths).every(file=>error.message.includes(file));
    });
    for(const file of Object.values(paths)){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'historical evidence fixture');}
    const accepted=runner.assertHistoricalBaselineEvidence(paths);
    assert.equal(Object.keys(accepted).length,4);
    for(const item of Object.values(accepted))assert.match(item.sha256,/^[0-9a-f]{64}$/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

{
  const root=tempGitRoot();
  try{
    let preflightCalled=0;
    assert.throws(()=>runner.run({root,mode:'--dry-run',preflight(){preflightCalled++;}}),/BLOCKED_STAGE3E_BASELINE_EVIDENCE_MISSING/);
    assert.equal(preflightCalled,1,'capability preflight runs before historical evidence validation');
    assert.deepEqual(fs.readdirSync(root),['.git']);
    const common=runner.gitCommonDir(root);
    assert.equal(fs.existsSync(path.join(common,'soraoto-agent-state/issues/7/stage3e/generation-2')),false,
      'blocked dry-run must not create Generation 2 ledger/evidence state');
    assert.throws(()=>runner.run({root,mode:'--execute',preflight(){},evidenceRoot:path.join(root,'generation-2')}),/BLOCKED_STAGE3E_EVIDENCE_ROOT_IDENTITY/);
    assert.throws(()=>runner.run({root,mode:'--unsupported',preflight(){throw new Error('must not run');}}),/explicit mode required/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

{
  assert.deepEqual(runner.LAUNCH_GRID,[1,.95,.90,.85,.80,.75,.70,.65,.60,.55,.50,.45,.40,.35]);
  assert.deepEqual(runner.BASS_HARDNESS_GRID,[0,.25,.50,.75,1,1.25,1.50,1.75,2]);
  assert.deepEqual(runner.MID_GRID,[1,.95,.90,.85,.80,.75,.70,.65,.60]);
  assert.equal(runner.BASELINE_EQUIVALENCE_CELLS.length+runner.MIDI41_NORMALIZED.length,12);
  assert.equal(runner.lowGridTuples().length,14*9);
  assert.deepEqual(runner.lowGridTuples()[0],{low:1,mid:1,bassHardness:0});
  assert.equal(runner.lowScreenCells().length,12);assert.equal(runner.lowFullCells().length,83);
  assert.equal(runner.midScreenCells().length,12);assert.equal(runner.midFullCells().length,64);
  const lowBase={safetyPass:true,midi41Derivatives:[1,2,3],spanErrorsByPitch:{36:[1,0,0],39:[0,1,0],42:[0,0,1]}};
  const low=runner.rankLowCandidates([
    {...lowBase,low:.8,bassHardness:1.5},
    {...lowBase,low:.9,bassHardness:1,spanErrorsByPitch:{36:[.5,0,0],39:[0,.5,0],42:[0,0,.5]}},
    {...lowBase,low:.7,bassHardness:0,midi41Derivatives:[1,1,3]},
  ]);
  assert.equal(low.length,2);assert.equal(low[0].low,.9);assert.equal(runner.topFive(Array.from({length:8},(_,i)=>i)).length,5);
  const mid=runner.rankMidCandidates([
    {mid:.8,safetyPass:true,spanErrorsByPitch:{48:[1,0,0],51:[0,1,0],54:[0,0,1],57:[0,0,0]}},
    {mid:.9,safetyPass:true,spanErrorsByPitch:{48:[.5,0,0],51:[0,.5,0],54:[0,0,.5],57:[0,0,0]}},
  ]);
  assert.equal(mid[0].mid,.9);
  for(const p of [33,42,48,57])assert.equal(runner.registerGate(p,p===33||p===42?33:48,p===33||p===42?36:51,p===33||p===42?39:54,p===33||p===42?42:57),0);
  assert.equal(runner.registerGate(36,33,36,39,42),1);assert.equal(runner.registerGate(39,33,36,39,42),1);
  assert.equal(runner.registerGate(51,48,51,54,57),1);assert.equal(runner.registerGate(54,48,51,54,57),1);
  assert.equal(runner.registerGate(39,36,39,42,45),1);assert.equal(runner.registerGate(42,36,39,42,45),1);
  const legacy=runner.stage3eResponse(36,.25,1,1,1,.5);assert.deepEqual(legacy,{launchVelocity:.25,hardnessAmount:.5});
  const shifted=runner.stage3eResponse(36,.25,.5,1,1,.5);assert(shifted.launchVelocity>.25);
  assert.equal(runner.stage3eResponse(39,.5,1,1,0,.5).hardnessAmount,0);
}
console.log('PASS Stage3E Generation-1 tombstone and Generation-2 evidence gate');
