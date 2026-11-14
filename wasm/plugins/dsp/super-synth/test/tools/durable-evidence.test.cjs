'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const evidence=require('./durable-evidence.cjs');

function fixture(){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'soraoto-durable-evidence-test-'));
  const root=path.join(temp,'checkout'),common=path.join(temp,'git-common'),home=path.join(temp,'home');
  fs.mkdirSync(root);fs.mkdirSync(home);
  execFileSync('rtk',['git','init','--quiet','--separate-git-dir',common,root],{cwd:temp});
  const roots=evidence.resolveRoots({root,issue:7,task:'stage3e',executionId:'test-execution',home});
  return {temp,root,common,home,roots};
}
function persistBoth(roots,relative,bytes){
  return evidence.writeDualCopy(path.join(roots.primary,relative),path.join(roots.secondary,relative),Buffer.from(bytes));
}
function manifestMetadata(){
  return {creatorRevision:'revision-a',executionId:'test-execution',generation:2,runnerSha256:'a'.repeat(64),
    helperSha256:'b'.repeat(64),wasmSha256:'c'.repeat(64),startedAt:'2026-01-01T00:00:00.000Z',
    finalizedAt:'2026-01-01T00:01:00.000Z',decision:'PASS'};
}

{
  const f=fixture();
  try{
    const commonReal=fs.realpathSync(f.common),homeResolved=path.resolve(f.home);
    assert.equal(f.roots.commonDirectory,commonReal);
    assert(f.roots.primary.startsWith(commonReal+path.sep));
    assert(f.roots.secondary.startsWith(path.join(homeResolved,'.soraoto-agent-archive',path.basename(f.root))+path.sep));
    assert.notEqual(f.roots.primary,f.roots.secondary);
    assert.throws(()=>evidence.resolveRoots({root:f.root,issue:'../7',task:'stage3e',executionId:'x',home:f.home}),/invalid issue/);
    const bytes=Buffer.from('{"cell":"complete"}\n');
    const result=evidence.writeDualCopy(path.join(f.roots.primary,'cells/one.json'),path.join(f.roots.secondary,'cells/one.json'),bytes);
    assert.equal(result.sha256,evidence.sha256(bytes));
    assert.equal(evidence.verifyDualCopy(path.join(f.roots.primary,'cells/one.json'),path.join(f.roots.secondary,'cells/one.json')).sha256,result.sha256);
    assert.equal(execFileSync('rtk',['git','status','--porcelain'],{cwd:f.root,encoding:'utf8'}).trim(),'','private roots are not staged or visible as worktree changes');
  }finally{fs.rmSync(f.temp,{recursive:true,force:true});}
}

{
  const f=fixture();
  try{
    const primary=path.join(f.roots.primary,'cells/blocked.json'),secondary=path.join(f.roots.secondary,'cells/blocked.json');
    const ledger=Buffer.from('{"state":"IN_PROGRESS"}\n');
    evidence.atomicWrite(path.join(f.roots.primary,'ledger.json'),ledger);
    assert.throws(()=>evidence.writeDualCopy(primary,secondary,Buffer.from('cell'),{write(target,bytes){if(target===secondary)throw new Error('disk unavailable');return evidence.atomicWrite(target,bytes);}}),/BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE/);
    assert.equal(fs.readFileSync(path.join(f.roots.primary,'ledger.json'),'utf8'),'{"state":"IN_PROGRESS"}\n','caller state stays ambiguous until dual persistence succeeds');
    assert(fs.existsSync(primary));assert.equal(fs.existsSync(secondary),false);
    persistBoth(f.roots,'cells/corrupt.json','same bytes');
    fs.writeFileSync(path.join(f.roots.secondary,'cells/corrupt.json'),'corrupted');
    assert.throws(()=>evidence.verifyDualCopy(path.join(f.roots.primary,'cells/corrupt.json'),path.join(f.roots.secondary,'cells/corrupt.json')),/BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE/);
  }finally{fs.rmSync(f.temp,{recursive:true,force:true});}
}

{
  const f=fixture();
  try{
    persistBoth(f.roots,'ledger.json','{"cells":1}\n');
    persistBoth(f.roots,'cells/one.json','{"pitch":60}\n');
    const first=evidence.writeFinalizedManifest({primaryRoot:f.roots.primary,secondaryRoot:f.roots.secondary,metadata:manifestMetadata(),artifactRoles:{'ledger.json':'ledger','cells/one.json':'cell'}});
    assert.equal(first.manifest.state,'FINALIZED');
    assert.deepEqual(first.manifest.files.map(item=>item.relativePath),['cells/one.json','ledger.json']);
    assert.deepEqual(first.manifest.files.map(item=>item.artifactRole),['cell','ledger']);
    assert.equal(fs.readFileSync(path.join(f.roots.primary,'evidence-manifest.sha256'),'utf8'),`${first.sha256}\n`);
    const replay=evidence.writeFinalizedManifest({primaryRoot:f.roots.primary,secondaryRoot:f.roots.secondary,metadata:manifestMetadata(),artifactRoles:{'ledger.json':'ledger','cells/one.json':'cell'},now:()=>{throw new Error('must reuse immutable manifest');}});
    assert.equal(replay.sha256,first.sha256);
    persistBoth(f.roots,'late.json','new evidence');
    assert.throws(()=>evidence.writeFinalizedManifest({primaryRoot:f.roots.primary,secondaryRoot:f.roots.secondary,metadata:manifestMetadata()}),/BLOCKED_EVIDENCE_MANIFEST_IMMUTABLE/);
  }finally{fs.rmSync(f.temp,{recursive:true,force:true});}
}

{
  const f=fixture();
  try{
    persistBoth(f.roots,'ledger.json','{}\n');
    persistBoth(f.roots,'cells/one.json','{"pitch":36}\n');
    evidence.writeFinalizedManifest({primaryRoot:f.roots.primary,secondaryRoot:f.roots.secondary,metadata:manifestMetadata()});
    const archive=evidence.createPhaseArchive({primaryRoot:f.roots.primary,secondaryRoot:f.roots.secondary,phase:'generation2-baseline'});
    const primaryArchive=path.join(f.roots.primary,'archives/generation2-baseline.tar.gz');
    const names=execFileSync('tar',['-tzf',primaryArchive],{encoding:'utf8'}).trim().split(/\r?\n/);
    for(const name of ['./ledger.json','./cells/one.json','./evidence-manifest.json','./evidence-manifest.sha256'])assert(names.includes(name),`archive misses ${name}`);
    assert.equal(evidence.verifyDualCopy(primaryArchive,path.join(f.roots.secondary,'archives/generation2-baseline.tar.gz')).sha256,archive.sha256);
    assert.equal(evidence.createPhaseArchive({primaryRoot:f.roots.primary,secondaryRoot:f.roots.secondary,phase:'generation2-baseline'}).sha256,archive.sha256);
    fs.rmSync(f.root,{recursive:true,force:true});
    assert(fs.existsSync(path.join(f.roots.primary,'ledger.json')),'worktree removal preserves common-dir evidence');
    assert(fs.existsSync(path.join(f.roots.secondary,'ledger.json')),'worktree removal preserves secondary evidence');
  }finally{fs.rmSync(f.temp,{recursive:true,force:true});}
}

console.log('PASS durable dual-copy evidence, immutable manifests, phase archives, and worktree survival');
