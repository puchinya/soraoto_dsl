'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {resolveStage3eEvidencePaths,lowLedgerPath,resolvePhaseRoots,resolveMid055DiagnosticRoots,resolveVerificationCheckpointRoots}=require('./stage3e-evidence-paths.cjs');

function fixture(){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-paths-'));
  const roots={primary:path.join(base,'primary'),secondary:path.join(base,'secondary')};
  for(const root of Object.values(roots))fs.mkdirSync(root,{recursive:true});
  const manifest={schemaVersion:1,generation:2,executionId:'generation-2',searchEpoch:'search-v1',
    identity:{generation:2,executionId:'generation-2',searchEpoch:'search-v1'}};
  return {base,roots,manifest};
}

{
  const x=fixture();
  try{
    const paths=resolveStage3eEvidencePaths(x.roots,x.manifest);
    assert.equal(path.relative(x.roots.primary,paths.primary.journalRoot),'ledger-transition-journal');
    assert.equal(path.relative(x.roots.primary,paths.primary.genesisLedger),'ledger-transition-journal/genesis-ledger.json');
    assert.equal(path.relative(x.roots.primary,paths.primary.lowLedger),'low/low-ledger.json');
    assert.equal(path.relative(x.roots.primary,lowLedgerPath(x.roots.primary)),'low/low-ledger.json');
    assert.notEqual(path.relative(x.roots.primary,lowLedgerPath(x.roots.primary)),'low-ledger.json');
    assert.equal(path.relative(x.roots.primary,resolvePhaseRoots(x.roots,'low').primary),'low');
    assert.equal(path.relative(x.roots.primary,resolvePhaseRoots(x.roots,'mid').primary),'mid');
    assert.equal(path.relative(x.roots.primary,resolvePhaseRoots(x.roots,'low-full-candidate-01').primary),
      path.join('low','validations','low-full-candidate-01'));
    assert.equal(path.relative(x.roots.primary,resolveVerificationCheckpointRoots(x.roots,'low').primary),
      path.join('low','verification-checkpoints'));
    assert.equal(path.relative(x.roots.primary,resolveVerificationCheckpointRoots(x.roots,'low-full-candidate-01').primary),
      path.join('low','validations','low-full-candidate-01','verification-checkpoints'));
    assert.equal(path.relative(x.roots.secondary,paths.secondary.genesisRecord),'ledger-transition-journal/genesis.json');
  }finally{fs.rmSync(x.base,{recursive:true,force:true});}
}

{
  const x=fixture();
  try{
    assert.throws(()=>resolveStage3eEvidencePaths(x.roots,{...x.manifest,searchEpoch:'other'}),/saved Generation-2 search-v1 manifest/);
    assert.throws(()=>resolveStage3eEvidencePaths({...x.roots,secondary:x.roots.primary},x.manifest),/roots overlap/);
    assert.throws(()=>resolvePhaseRoots(x.roots,'../low'),/unsupported phase/);
    const outside=path.join(x.base,'outside');fs.mkdirSync(outside);
    fs.symlinkSync(outside,path.join(x.roots.primary,'low'));
    assert.throws(()=>resolveStage3eEvidencePaths(x.roots,x.manifest),/symlink escapes root/);
  }finally{fs.rmSync(x.base,{recursive:true,force:true});}
}

{
  const x=fixture();
  try{
    const resolved=resolveMid055DiagnosticRoots(x.roots);
    const expected=path.join('generation-2','diagnostics','mid-0.55-screen-v1');
    assert.equal(resolved.relative,expected);
    assert.equal(path.relative(x.roots.primary,resolved.primary),expected);
    assert.equal(path.relative(x.roots.secondary,resolved.secondary),expected);
    assert.equal(fs.existsSync(resolved.primary),false,'read-only resolution does not create the namespace');
    assert.equal(path.relative(x.roots.primary,resolvePhaseRoots(x.roots,'mid').primary),'mid',
      'the historic phase resolver remains unchanged');
    assert.throws(()=>resolveMid055DiagnosticRoots({...x.roots,secondary:x.roots.primary}),/roots overlap/);

    const outside=path.join(x.base,'outside');fs.mkdirSync(outside);
    fs.mkdirSync(path.dirname(resolved.primary),{recursive:true});
    fs.symlinkSync(outside,resolved.primary);
    assert.throws(()=>resolveMid055DiagnosticRoots(x.roots),/diagnostic namespace contains a symlink/);
  }finally{fs.rmSync(x.base,{recursive:true,force:true});}
}

{
  const x=fixture();
  try{
    const resolved=resolveMid055DiagnosticRoots(x.roots);
    fs.mkdirSync(resolved.primary,{recursive:true});
    fs.mkdirSync(resolved.secondary,{recursive:true});
    const bad=path.join(x.base,'bad');fs.writeFileSync(bad,'not a directory');
    fs.rmSync(path.join(x.roots.primary,'generation-2'),{recursive:true,force:true});
    fs.symlinkSync(bad,path.join(x.roots.primary,'generation-2'));
    assert.throws(()=>resolveMid055DiagnosticRoots(x.roots),/diagnostic namespace contains a symlink/);
  }finally{fs.rmSync(x.base,{recursive:true,force:true});}
}

console.log('PASS Stage3E evidence paths resolve from the saved search manifest and reject root escape');
