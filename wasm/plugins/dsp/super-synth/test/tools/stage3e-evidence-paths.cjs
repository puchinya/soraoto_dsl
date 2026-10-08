'use strict';

const fs=require('node:fs');
const path=require('node:path');

const RELATIVE=Object.freeze({
  manifest:'generation-2-manifest.json',
  lowRoot:'low',
  lowLedger:'low/low-ledger.json',
  lowCells:'low/cells',
  journalRoot:'ledger-transition-journal',
  genesisLedger:'ledger-transition-journal/genesis-ledger.json',
  genesisRecord:'ledger-transition-journal/genesis.json',
});

function inside(root,candidate){
  const relative=path.relative(root,candidate);
  return relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith(`..${path.sep}`));
}
function canonicalRoot(value,label){
  if(typeof value!=='string'||!path.isAbsolute(value)||!fs.existsSync(value))
    throw new Error(`BLOCKED_STAGE3E_EVIDENCE_PATH: ${label} root must exist as an absolute path`);
  const resolved=path.resolve(value),real=fs.realpathSync(resolved);
  if(!fs.statSync(real).isDirectory())throw new Error(`BLOCKED_STAGE3E_EVIDENCE_PATH: ${label} root is not a directory`);
  return {resolved,real};
}
function safeChild(root,relative,label){
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).some(part=>part===''||part==='.'||part==='..'))
    throw new Error(`BLOCKED_STAGE3E_EVIDENCE_PATH: unsafe ${label} relative path`);
  const candidate=path.resolve(root.resolved,relative);
  if(!inside(root.resolved,candidate))throw new Error(`BLOCKED_STAGE3E_EVIDENCE_PATH: ${label} escapes root`);
  let existing=candidate;
  while(!fs.existsSync(existing)){
    const parent=path.dirname(existing);
    if(parent===existing)throw new Error(`BLOCKED_STAGE3E_EVIDENCE_PATH: no existing ancestor for ${label}`);
    existing=parent;
  }
  const realExisting=fs.realpathSync(existing);
  if(!inside(root.real,realExisting))throw new Error(`BLOCKED_STAGE3E_EVIDENCE_PATH: symlink escapes root for ${label}`);
  return candidate;
}
function resolveStage3eEvidencePaths(root,manifest){
  if(!root||typeof root!=='object')throw new Error('BLOCKED_STAGE3E_EVIDENCE_PATH: primary and secondary roots are required');
  if(!manifest||manifest.schemaVersion!==1||manifest.generation!==2||manifest.executionId!=='generation-2'||manifest.searchEpoch!=='search-v1'||
     !manifest.identity||manifest.identity.generation!==2||manifest.identity.executionId!=='generation-2'||manifest.identity.searchEpoch!=='search-v1')
    throw new Error('BLOCKED_STAGE3E_EVIDENCE_PATH: saved Generation-2 search-v1 manifest is required');
  const primary=canonicalRoot(root.primary,'primary'),secondary=canonicalRoot(root.secondary,'secondary');
  if(primary.real===secondary.real||inside(primary.real,secondary.real)||inside(secondary.real,primary.real))
    throw new Error('BLOCKED_STAGE3E_EVIDENCE_PATH: primary and secondary roots overlap');
  const p={},s={};
  for(const [name,relative] of Object.entries(RELATIVE)){
    p[name]=safeChild(primary,relative,`primary ${name}`);
    s[name]=safeChild(secondary,relative,`secondary ${name}`);
    if(path.relative(primary.resolved,p[name])!==path.relative(secondary.resolved,s[name]))
      throw new Error(`BLOCKED_STAGE3E_EVIDENCE_PATH: primary/secondary relative path mismatch for ${name}`);
  }
  return {primary:p,secondary:s,relative:RELATIVE};
}

module.exports={RELATIVE,resolveStage3eEvidencePaths};
