'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const durable=require('./durable-evidence.cjs');
const incrementalVerification=require('./stage3e-incremental-verification.cjs');
const search=require('./stage3e-search-core.cjs');

const SOURCE_AUDIT_SHA256='eda9e25c490162e4b46e8e72e98da25e84bfd4980afe16c1df773d9020c53560';
const SEARCH_MANIFEST_SHA256='27bdbee7735e32a468370a1166d4901d12fa3a9ca0774bc66943a79ed1718095';
const LOW_GENESIS_SHA256='d8b2b7e299174b605c1cdcb576ab70645ec725cbfa03d76c003abe92854e754d';
const AMENDMENT='generation-2/midi41-derivative-amendment-v1/';
const SEARCH='generation-2/search-v1/';
const RECOVERY_V2=SEARCH+'recovery-reconciliation-v2/';

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function safeRelative(value){
  return typeof value==='string'&&value.length>0&&!path.posix.isAbsolute(value)&&
    !value.includes('\\')&&!value.split('/').some(part=>!part||part==='.'||part==='..');
}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}

function walkFiles(root){
  const files=[];
  function walk(dir){
    for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const file=path.join(dir,entry.name);
      const relative=path.relative(root,file).split(path.sep).join('/');
      if(entry.isSymbolicLink())throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: symlink '+relative);
      if(entry.isDirectory()){walk(file);continue;}
      if(!entry.isFile())throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: non-file '+relative);
      const bytes=fs.readFileSync(file),stat=fs.statSync(file,{bigint:true});
      files.push({path:relative,sizeBytes:bytes.length,sha256:sha256(bytes),mtimeNs:stat.mtimeNs.toString()});
    }
  }
  walk(root);
  return files.sort((a,b)=>a.path.localeCompare(b.path));
}

function validateFrozenSide(root,expected,side){
  if(!Array.isArray(expected)||expected.length!==35)throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: '+side+' frozen inventory schema');
  const actual=walkFiles(root),map=new Map(actual.map(item=>[item.path,item]));
  const paths=new Set();
  for(const item of expected){
    if(!item||!safeRelative(item.path)||paths.has(item.path)||!Number.isInteger(item.sizeBytes)||
       !/^[0-9a-f]{64}$/.test(item.sha256))throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: '+side+' frozen inventory entry');
    paths.add(item.path);
    const found=map.get(item.path);
    if(!found||found.sizeBytes!==item.sizeBytes||found.sha256!==item.sha256||
       (item.mtimeNs!==undefined&&found.mtimeNs!==item.mtimeNs))
      throw new Error('BLOCKED_STAGE3E_AMENDMENT_EVIDENCE: frozen '+side+' file changed: '+item.path);
  }
  return {actual,extras:actual.filter(item=>!paths.has(item.path))};
}

function isAmendmentAddition(relative){
  const exact=new Set([
    AMENDMENT+'source-evidence-audit.json',
    AMENDMENT+'pre-amendment-identity-proof.json',
    AMENDMENT+'authorization.json',
    AMENDMENT+'capture-identity.json',
    AMENDMENT+'ledger.json',
    AMENDMENT+'amendment-result.json',
    AMENDMENT+'evidence-manifest.json',
    AMENDMENT+'evidence-manifest.sha256',
    AMENDMENT+'archives/midi41-derivative-amendment.tar.gz',
    SEARCH+'generation-2-manifest.json',
    SEARCH+'verifier-compatibility-v1.json',
    SEARCH+'verifier-compatibility-v2.json',
    SEARCH+'verifier-compatibility-v2.sha256',
    SEARCH+'archives/verifier-compatibility-v2.tar.gz',
    SEARCH+'archives/verifier-compatibility-v2.tar.gz.sha256',
    SEARCH+'verifier-compatibility-v3.json',
    SEARCH+'verifier-compatibility-v3.sha256',
    SEARCH+'archives/verifier-compatibility-v3.tar.gz',
    SEARCH+'archives/verifier-compatibility-v3.tar.gz.sha256',
    SEARCH+'pre-render-abort-recovery-v1/pre-abort-low-ledger.json',
    SEARCH+'pre-render-abort-recovery-v1/forensic-evidence.json',
    SEARCH+'pre-render-abort-recovery-v1/recovery-authorization.json',
    SEARCH+'pre-render-abort-recovery-v1/recovery-result.json',
    SEARCH+'pre-render-abort-recovery-v1/evidence-manifest.json',
    SEARCH+'pre-render-abort-recovery-v1/evidence-manifest.sha256',
    SEARCH+'pre-render-abort-recovery-v1/archives/pre-render-abort-recovery-v1.tar.gz',
    SEARCH+'ledger-transition-journal/genesis.json',
    SEARCH+'ledger-transition-journal/genesis-ledger.json'
  ]);
  if(exact.has(relative))return true;
  if(!relative.startsWith(AMENDMENT+'cells/'))return false;
  return /^generation-2\/midi41-derivative-amendment-v1\/cells\/generation2-midi-041-v(?:250|550|900)\.json$/.test(relative);
}

function readValidationCellBindings(primaryRoot,secondaryRoot,validationPhase,manifestSha256=SEARCH_MANIFEST_SHA256){
  const parentPhase=validationPhase.startsWith('low-full-')?'low':validationPhase.startsWith('mid-full-')?'mid':null;
  if(!parentPhase)throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: invalid full-validation phase');
  const relative=`${SEARCH}${parentPhase}/validations/${validationPhase}/${validationPhase}-ledger.json`;
  let stored,ledger;
  try{
    stored=durable.verifyDualCopy(path.join(primaryRoot,relative),path.join(secondaryRoot,relative));
    ledger=JSON.parse(stored.bytes.toString('utf8'));
  }catch(error){
    throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: full-validation ledger is unavailable or inconsistent: '+error.message);
  }
  let manifestStored,manifest;
  try{
    const manifestRelative=SEARCH+'generation-2-manifest.json';
    manifestStored=durable.verifyDualCopy(path.join(primaryRoot,manifestRelative),path.join(secondaryRoot,manifestRelative));
    if(manifestStored.sha256!==manifestSha256)throw new Error('fixed search manifest SHA mismatch');
    manifest=JSON.parse(manifestStored.bytes.toString('utf8'));
  }catch(error){
    throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: full-validation manifest is unavailable or inconsistent: '+error.message);
  }
  if(!ledger||ledger.schemaVersion!==1||ledger.generation!==2||ledger.executionId!=='generation-2'||
     ledger.phase!==validationPhase||!ledger.identity||!ledger.cells||typeof ledger.cells!=='object'||
     !Number.isSafeInteger(ledger.accounting?.renderCalls))
    throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: full-validation ledger schema mismatch');
  const resultBindingField=parentPhase==='low'?'lowScreenResultSha256':'midScreenResultSha256';
  if(manifest.state!=='ACTIVE'||manifest.generation!==2||manifest.searchEpoch!=='search-v1'||!manifest.identity||
     Object.entries(manifest.identity).some(([key,value])=>!same(ledger.identity[key],value))||
     !ledger.identity.response||!['low','mid','bassHardness'].every(key=>Number.isFinite(ledger.identity.response[key]))||
     !/^[0-9a-f]{64}$/.test(ledger.identity[resultBindingField]||''))
    throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: full-validation ledger identity differs from immutable search manifest');
  const bindings=new Map();let complete=0,pending=0,inProgress=0;
  for(const [key,state] of Object.entries(ledger.cells)){
    if(!state||state.identity?.key!==key||state.relativePath!==`cells/${key}.json`)
      throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: full-validation cell identity mismatch '+key);
    if(state.state==='COMPLETE'){
      complete++;
      if(!/^[0-9a-f]{64}$/.test(state.sha256||''))
        throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: COMPLETE full-validation cell has no SHA '+key);
      bindings.set(key,state.sha256);
    }else if(state.state==='PENDING'){
      pending++;
      if(state.sha256!==null)throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: PENDING full-validation cell has a SHA '+key);
    }else if(state.state==='IN_PROGRESS')inProgress++;
    else throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: unknown full-validation cell state '+key);
  }
  if(inProgress!==0||ledger.authorizedCellCount!==Object.keys(ledger.cells).length||ledger.accounting.renderCalls!==complete)
    throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: full-validation ledger accounting is unresolved');
  return {bindings,ledgerSha256:stored.sha256,complete,pending,parentPhase};
}

function readMidScreenCellBindings(primaryRoot,secondaryRoot,manifestSha256=SEARCH_MANIFEST_SHA256){
  const ledgerRelative=SEARCH+'mid/mid-ledger.json';
  let stored,ledger,manifestStored,manifest;
  try{
    stored=durable.verifyDualCopy(path.join(primaryRoot,ledgerRelative),path.join(secondaryRoot,ledgerRelative));
    ledger=JSON.parse(stored.bytes.toString('utf8'));
    const manifestRelative=SEARCH+'generation-2-manifest.json';
    manifestStored=durable.verifyDualCopy(path.join(primaryRoot,manifestRelative),path.join(secondaryRoot,manifestRelative));
    if(manifestStored.sha256!==manifestSha256)throw new Error('fixed search manifest SHA mismatch');
    manifest=JSON.parse(manifestStored.bytes.toString('utf8'));
  }catch(error){
    throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: mid-screen ledger or manifest is unavailable or inconsistent: '+error.message);
  }
  if(!ledger||ledger.schemaVersion!==1||ledger.generation!==2||ledger.executionId!=='generation-2'||ledger.phase!=='mid'||
     !ledger.identity||!ledger.cells||typeof ledger.cells!=='object'||!Number.isSafeInteger(ledger.accounting?.renderCalls))
    throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: mid-screen ledger schema mismatch');
  if(manifest.state!=='ACTIVE'||manifest.generation!==2||manifest.searchEpoch!=='search-v1'||!manifest.identity||
     Object.entries(manifest.identity).some(([key,value])=>!same(ledger.identity[key],value)))
    throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: mid-screen identity differs from immutable search manifest');
  const lowSelection=ledger.identity.lowSelection;
  if(!lowSelection||!Number.isFinite(lowSelection.low)||lowSelection.mid!==1||!Number.isFinite(lowSelection.bassHardness)||
     !Array.isArray(ledger.identity.authorizedGrid)||!Array.isArray(ledger.identity.screenCoordinates)||
     !same(ledger.identity.authorizedGrid,search.midGridTuples(lowSelection))||
     !same(ledger.identity.screenCoordinates,search.midScreenCells()))
    throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: mid-screen grid identity mismatch');
  const expected=search.midGridTuples(lowSelection).flatMap(response=>search.midScreenCells().map(cell=>{
    const identity={...cell,phase:'mid-screen',response};
    return {...identity,key:search.cellId(identity)};
  }));
  if(ledger.authorizedCellCount!==expected.length||Object.keys(ledger.cells).length!==expected.length)
    throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: mid-screen authorized cell count mismatch');
  const bindings=new Map();let complete=0,pending=0,inProgress=0;
  for(const cell of expected){
    const row=ledger.cells[cell.key];
    if(!row||!same(row.identity,cell)||row.relativePath!==`cells/${cell.key}.json`)
      throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: mid-screen cell identity/order mismatch '+cell.key);
    if(row.state==='COMPLETE'){
      complete++;
      if(!/^[0-9a-f]{64}$/.test(row.sha256||''))throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: COMPLETE mid-screen cell has no SHA '+cell.key);
      bindings.set(cell.key,row.sha256);
    }else if(row.state==='PENDING'){
      pending++;
      if(row.sha256!==null)throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: PENDING mid-screen cell has a SHA '+cell.key);
    }else if(row.state==='IN_PROGRESS')inProgress++;
    else throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: unknown mid-screen cell state '+cell.key);
  }
  if(inProgress!==0||ledger.accounting.renderCalls!==complete)
    throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: mid-screen ledger accounting is unresolved');
  return {bindings,ledgerSha256:stored.sha256,complete,pending};
}

function isSearchAddition(relative,{authorizedKeys=[],screenAuthorizedKeys=new Map(),validationAuthorizedKeys=new Map()}={}){
  if(isAmendmentAddition(relative))return true;
  const recoveryV2Files=new Set([
    'source-audit.json','invalid-recovery-disposition.json','authorization-v2.json','transaction-intent.json',
    'transaction-receipt.json','reconciliation-result.json','evidence-manifest.json','evidence-manifest.sha256',
    'recovery-transaction-compatibility-v2.json','recovery-transaction-compatibility-v2.sha256',
    'staging/low-ledger-post.json','staging/transition-000002.json',
    'archives/recovery-transaction-compatibility-v2.tar.gz','archives/recovery-transaction-compatibility-v2.tar.gz.sha256',
    'archives/recovery-reconciliation-v2.tar.gz','verifier-compatibility-v10.json','verifier-compatibility-v10-2.json','verifier-compatibility-v10-3.json',
    'verifier-compatibility-v10-4.json','verifier-compatibility-v10-5.json','verifier-compatibility-v10-6.json',
    'verifier-compatibility-v10-7.json','verifier-compatibility-v10-8.json','verifier-compatibility-v10-9.json','verifier-compatibility-v10-10.json','verifier-compatibility-v10-11.json','verifier-compatibility-v10-12.json'
  ]);
  if(relative.startsWith(RECOVERY_V2)&&recoveryV2Files.has(relative.slice(RECOVERY_V2.length)))return true;
  if(relative===SEARCH+'generation-2-manifest.json'||relative===SEARCH+'verifier-compatibility-v1.json'||
     relative===SEARCH+'verifier-compatibility-v2.json'||relative===SEARCH+'verifier-compatibility-v2.sha256'||
     relative===SEARCH+'performance-verifier-compatibility-v1.json'||
     relative===SEARCH+'performance-verifier-compatibility-v2.json'||
     relative===SEARCH+'performance-verifier-compatibility-v3.json'||
     relative===SEARCH+'performance-verifier-compatibility-v4.json'||
     relative===SEARCH+'performance-verifier-compatibility-v5.json'||
     relative===SEARCH+'performance-verifier-compatibility-v6.json'||
     relative===SEARCH+'performance-verifier-compatibility-v7.json'||
     relative===SEARCH+'performance-verifier-compatibility-v8.json'||
     relative===SEARCH+'performance-verifier-compatibility-v9.json'||
     relative===SEARCH+'performance-verifier-compatibility-v10.json'||
     relative===SEARCH+'performance-verifier-compatibility-v11.json'||
     relative===SEARCH+'performance-verifier-compatibility-v12.json'||
     relative===SEARCH+'archives/verifier-compatibility-v2.tar.gz'||relative===SEARCH+'archives/verifier-compatibility-v2.tar.gz.sha256')return true;
  if(/^generation-2\/search-v1\/(?:low|mid)(?:\/validations\/(?:low|mid)-full-[A-Za-z0-9._-]+)?\/verification-checkpoints\/checkpoint-[0-9]{6}\.json$/.test(relative))return true;
  if(relative.startsWith(SEARCH+'ledger-transition-journal/')){
    const leaf=relative.slice((SEARCH+'ledger-transition-journal/').length);
    return leaf==='genesis.json'||leaf==='genesis-ledger.json'||leaf==='genesis-location-reconciliation-v1.json'||
      /^transition-[0-9]{6}\.json$/.test(leaf)||/^render-start-[0-9]{6}\.json$/.test(leaf);
  }
  if(!relative.startsWith(SEARCH))return false;
  const rest=relative.slice(SEARCH.length);
  const match=rest.match(/^(low|mid|stage3e-selection)\/(.+)$/);
  if(!match)return false;
  const phase=match[1],leaf=match[2];
  if(leaf===phase+'-ledger.json'||leaf===phase+'-result.json'||
     leaf==='evidence-manifest.json'||leaf==='evidence-manifest.sha256')return true;
  if(leaf==='archives/'+phase+'-selection.tar.gz'||leaf==='archives/'+phase+'-validation.tar.gz')return true;
  if(leaf.startsWith('ledger-transition-journal/')){
    const name=leaf.slice('ledger-transition-journal/'.length);
    return name==='genesis.json'||name==='genesis-ledger.json'||name==='genesis-location-reconciliation-v1.json'||
      /^transition-[0-9]{6}\.json$/.test(name)||/^render-start-[0-9]{6}\.json$/.test(name);
  }
  if(leaf.startsWith('cells/')){
    const key=leaf.slice('cells/'.length).replace(/\.json$/,'');
    const phaseBindings=screenAuthorizedKeys.get(phase);
    return leaf==='cells/'+key+'.json'&&(authorizedKeys.includes(key)||Boolean(phaseBindings?.has(key)));
  }
  const validation=leaf.match(/^validations\/(low-full-[A-Za-z0-9.-]+|mid-full-[A-Za-z0-9.-]+)\/(.+)$/);
  if(validation){
    const validationPhase=validation[1];
    const relativeValidation=validation[2];
    if(relativeValidation===`${validationPhase}-ledger.json`||
       relativeValidation===`${validationPhase}-result.json`||
       relativeValidation===`${validationPhase}-validation.json`||
       relativeValidation==='evidence-manifest.json'||relativeValidation==='evidence-manifest.sha256'||
       /^archives\/(?:low-full|mid-full)-[A-Za-z0-9._-]+\.tar\.gz$/.test(relativeValidation)||
       /^ledger-transition-journal\/(?:genesis\.json|genesis-ledger\.json|genesis-location-reconciliation-v1\.json|transition-[0-9]{6}\.json|render-start-[0-9]{6}\.json)$/.test(relativeValidation))return true;
    const validationCell=relativeValidation.match(/^cells\/([A-Za-z0-9._-]+)\.json$/);
    const phaseBindings=validationAuthorizedKeys.get(validationPhase);
    return Boolean(validationCell&&(authorizedKeys.includes(validationCell[1])||phaseBindings?.has(validationCell[1])));
  }
  return false;
}

function validateNamespaceAdditions({primaryRoot,secondaryRoot,audit,authorizedKeys=[],manifestSha256=SEARCH_MANIFEST_SHA256}={}){
  const primaryFrozen=audit&&audit.immutablePreexistingFileInventory&&audit.immutablePreexistingFileInventory.primary&&audit.immutablePreexistingFileInventory.primary.files;
  const secondaryFrozen=audit&&audit.immutablePreexistingFileInventory&&audit.immutablePreexistingFileInventory.secondary&&audit.immutablePreexistingFileInventory.secondary.files;
  const p=validateFrozenSide(primaryRoot,primaryFrozen,'primary');
  const s=validateFrozenSide(secondaryRoot,secondaryFrozen,'secondary');
  const pNames=p.extras.map(item=>item.path),sNames=s.extras.map(item=>item.path);
  if(!same(pNames,sNames))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: addition path sets differ');
  const byPath=new Map(s.extras.map(item=>[item.path,item]));
  const validationBindings=new Map();
  const screenBindings=new Map();
  const primaryByPath=new Map(p.actual.map(item=>[item.path,item]));
  const secondaryByPath=new Map(s.actual.map(item=>[item.path,item]));
  for(const item of p.extras){
    const midCell=item.path.match(/^generation-2\/search-v1\/mid\/cells\/([A-Za-z0-9._-]+)\.json$/);
    if(midCell){
      if(!screenBindings.has('mid')){
        const view=readMidScreenCellBindings(primaryRoot,secondaryRoot,manifestSha256);
        for(const [key,cellSha] of view.bindings){
          const expectedPath=`${SEARCH}mid/cells/${key}.json`;
          const primaryCell=primaryByPath.get(expectedPath),secondaryCell=secondaryByPath.get(expectedPath);
          if(!primaryCell||!secondaryCell||primaryCell.sha256!==cellSha||secondaryCell.sha256!==cellSha)
            throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: COMPLETE mid-screen ledger row has no matching dual-saved cell '+expectedPath);
        }
        screenBindings.set('mid',view.bindings);
      }
      const expectedSha=screenBindings.get('mid').get(midCell[1]);
      if(!expectedSha||expectedSha!==item.sha256)
        throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: mid-screen cell is not a matching COMPLETE ledger row '+item.path);
    }
    const validationCell=item.path.match(/^generation-2\/search-v1\/(low|mid)\/validations\/(low-full-[A-Za-z0-9.-]+|mid-full-[A-Za-z0-9.-]+)\/cells\/([A-Za-z0-9._-]+)\.json$/);
    if(validationCell){
      const phase=validationCell[2],key=validationCell[3];
      if(!validationBindings.has(phase)){
        const view=readValidationCellBindings(primaryRoot,secondaryRoot,phase,manifestSha256);
        for(const [completeKey,completeSha] of view.bindings){
          const expectedPath=`${SEARCH}${view.parentPhase}/validations/${phase}/cells/${completeKey}.json`;
          const primaryCell=primaryByPath.get(expectedPath),secondaryCell=secondaryByPath.get(expectedPath);
          if(!primaryCell||!secondaryCell||primaryCell.sha256!==completeSha||secondaryCell.sha256!==completeSha)
            throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: COMPLETE validation ledger row has no matching dual-saved cell '+expectedPath);
        }
        validationBindings.set(phase,view.bindings);
      }
      const expectedSha=validationBindings.get(phase).get(key);
      if(!expectedSha||expectedSha!==item.sha256)
        throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: validation cell is not a matching COMPLETE ledger row '+item.path);
    }
    if(!isSearchAddition(item.path,{authorizedKeys,screenAuthorizedKeys:screenBindings,validationAuthorizedKeys:validationBindings}))
      throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: '+item.path);
    if(item.path===SEARCH+'performance-verifier-compatibility-v1.json'){
      let record;
      try{record=JSON.parse(fs.readFileSync(path.join(primaryRoot,item.path),'utf8'));}
      catch{throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: invalid performance verifier sidecar JSON');}
      const hashFields=['parentV10_9AttestationSha256','baselineV10_12AttestationSha256','originalSearchManifestSha256',
        'originalSearchCompatibilityV3Sha256','allowedVerifierOnlyDiffSha256','testResultsSha256'];
      if(record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBILITY'||
         record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||record.primarySecondaryIntegrity!=='PASS'||
         !/^[0-9a-f]{40}$/.test(record.originalLocalCommit||'')||!/^[0-9a-f]{40}$/.test(record.acceptedCommit||'')||
         hashFields.some(field=>!/^[0-9a-f]{64}$/.test(record[field]||''))||
         !Array.isArray(record.allowedVerifierOnlyPaths)||!Array.isArray(record.testResults))
        throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: performance verifier sidecar schema mismatch');
    }
    if(item.path===SEARCH+'performance-verifier-compatibility-v2.json'){
      let record;
      try{record=JSON.parse(fs.readFileSync(path.join(primaryRoot,item.path),'utf8'));}
      catch{throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: invalid performance verifier continuation JSON');}
      const hashFields=['parentSha256','allowedVerifierOnlyDiffSha256','testResultsSha256'];
      if(record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_CONTINUATION'||
         record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_CONTINUATION_COMPATIBLE'||record.parentRelative!=='performance-verifier-compatibility-v1.json'||
         record.parentAcceptedCommit!=='96a23a01977f2a58213f2b207f700264bf43171e'||record.primarySecondaryIntegrity!=='PASS'||
         !/^[0-9a-f]{40}$/.test(record.acceptedCommit||'')||hashFields.some(field=>!/^[0-9a-f]{64}$/.test(record[field]||''))||
         !Array.isArray(record.allowedChangedPaths)||!record.allowedChangedPaths.length||
         !record.runtimeVerifierHashes||Object.values(record.runtimeVerifierHashes).some(value=>!/^[0-9a-f]{64}$/.test(value||''))||
         !record.currentPinnedExecutorHashes||!record.stage3eAcousticIdentity||!Array.isArray(record.testResults)||!record.testResults.length||
         record.testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string'))
        throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: performance verifier continuation schema mismatch');
    }
    if(item.path===SEARCH+'performance-verifier-compatibility-v3.json'){
      let record;
      try{record=JSON.parse(fs.readFileSync(path.join(primaryRoot,item.path),'utf8'));}
      catch{throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: invalid performance verifier follow-up JSON');}
      const hashFields=['parentSha256','allowedVerifierOnlyDiffSha256','testResultsSha256'];
      if(record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP'||
         record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||record.parentRelative!=='performance-verifier-compatibility-v2.json'||
         record.parentAcceptedCommit!=='d1ced58e0f1a80e10a0269f7e5b489de1b79e2b3'||record.primarySecondaryIntegrity!=='PASS'||
         !/^[0-9a-f]{40}$/.test(record.acceptedCommit||'')||hashFields.some(field=>!/^[0-9a-f]{64}$/.test(record[field]||''))||
         !Array.isArray(record.allowedChangedPaths)||!record.allowedChangedPaths.length||!record.changedFileSha256||
         Object.values(record.changedFileSha256).some(value=>!/^[0-9a-f]{64}$/.test(value||''))||
         record.stage3eWasmSha256!=='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221'||
         !record.stage3eAcousticIdentity||!Array.isArray(record.testResults)||!record.testResults.length||
         record.testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string')||record.acousticRenders!==0||record.builds!==0)
        throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: performance verifier follow-up schema mismatch');
    }
    if(item.path===SEARCH+'performance-verifier-compatibility-v4.json'){
      let record;
      try{record=JSON.parse(fs.readFileSync(path.join(primaryRoot,item.path),'utf8'));}
      catch{throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: invalid performance verifier v4 follow-up JSON');}
      const hashFields=['parentSha256','allowedVerifierOnlyDiffSha256','testResultsSha256'];
      if(record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP'||
         record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||record.parentRelative!=='performance-verifier-compatibility-v3.json'||
         record.parentSha256!=='f1425e17e25b0338b504cedacf54e45be703581fc87277ede47540e39a02a487'||
         record.parentAcceptedCommit!=='d055c8c3a21b020a89f0a19de8fad1b7055c192e'||record.primarySecondaryIntegrity!=='PASS'||
         !/^[0-9a-f]{40}$/.test(record.acceptedCommit||'')||hashFields.some(field=>!/^[0-9a-f]{64}$/.test(record[field]||''))||
         !Array.isArray(record.allowedChangedPaths)||!record.allowedChangedPaths.length||!record.changedFileSha256||
         Object.values(record.changedFileSha256).some(value=>!/^[0-9a-f]{64}$/.test(value||''))||
         record.stage3eWasmSha256!=='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221'||
         !record.stage3eAcousticIdentity||!Array.isArray(record.testResults)||!record.testResults.length||
         record.testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string'||! /^[0-9a-f]{64}$/.test(item.outputSha256||''))||
         record.testResultsSha256!==sha256(jsonBytes(record.testResults))||record.acousticRenders!==0||record.builds!==0)
        throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: performance verifier v4 follow-up schema mismatch');
    }
    if(item.path===SEARCH+'performance-verifier-compatibility-v5.json'){
      let record;
      try{record=JSON.parse(fs.readFileSync(path.join(primaryRoot,item.path),'utf8'));}
      catch{throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: invalid performance verifier v5 follow-up JSON');}
      const hashFields=['parentSha256','allowedVerifierOnlyDiffSha256','testResultsSha256'];
      if(record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP'||
         record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||record.parentRelative!=='performance-verifier-compatibility-v4.json'||
         record.parentSha256!=='2dbc65caef3ea70d9293cf32aec9a043d533e43423f7024daa263b73a835cc28'||
         record.parentAcceptedCommit!=='f3caae588228cd535ba71aea23ccb4e6138d8147'||record.primarySecondaryIntegrity!=='PASS'||
         !/^[0-9a-f]{40}$/.test(record.acceptedCommit||'')||hashFields.some(field=>!/^[0-9a-f]{64}$/.test(record[field]||''))||
         !Array.isArray(record.allowedChangedPaths)||!record.allowedChangedPaths.length||!record.changedFileSha256||
         Object.values(record.changedFileSha256).some(value=>!/^[0-9a-f]{64}$/.test(value||''))||
         record.stage3eWasmSha256!=='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221'||
         !record.stage3eAcousticIdentity||!Array.isArray(record.testResults)||!record.testResults.length||
         record.testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string'||! /^[0-9a-f]{64}$/.test(item.outputSha256||''))||
         record.testResultsSha256!==sha256(jsonBytes(record.testResults))||record.acousticRenders!==0||record.builds!==0)
        throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: performance verifier v5 follow-up schema mismatch');
    }
    if(item.path===SEARCH+'performance-verifier-compatibility-v6.json'){
      let record;
      try{record=JSON.parse(fs.readFileSync(path.join(primaryRoot,item.path),'utf8'));}
      catch{throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: invalid performance verifier v6 follow-up JSON');}
      const hashFields=['parentSha256','allowedVerifierOnlyDiffSha256','testResultsSha256'];
      if(record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP'||
         record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||record.parentRelative!=='performance-verifier-compatibility-v5.json'||
         record.parentSha256!=='bdfdb267f38dcc5b7430ec96d1f4a19176f80fcd5238c27aae7f7e0adc30307f'||
         record.parentAcceptedCommit!=='672dcd1e18770247af9a924760072a87bf3b4a83'||record.primarySecondaryIntegrity!=='PASS'||
         !/^[0-9a-f]{40}$/.test(record.acceptedCommit||'')||hashFields.some(field=>!/^[0-9a-f]{64}$/.test(record[field]||''))||
         !Array.isArray(record.allowedChangedPaths)||!record.allowedChangedPaths.length||!record.changedFileSha256||
         Object.values(record.changedFileSha256).some(value=>!/^[0-9a-f]{64}$/.test(value||''))||
         record.stage3eWasmSha256!=='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221'||
         !record.stage3eAcousticIdentity||!Array.isArray(record.testResults)||!record.testResults.length||
         record.testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string'||! /^[0-9a-f]{64}$/.test(item.outputSha256||''))||
         record.testResultsSha256!==sha256(jsonBytes(record.testResults))||record.acousticRenders!==0||record.builds!==0)
        throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: performance verifier v6 follow-up schema mismatch');
    }
    if(item.path===SEARCH+'performance-verifier-compatibility-v7.json'){
      let record;
      try{record=JSON.parse(fs.readFileSync(path.join(primaryRoot,item.path),'utf8'));}
      catch{throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: invalid performance verifier v7 follow-up JSON');}
      const hashFields=['parentSha256','allowedVerifierOnlyDiffSha256','testResultsSha256'];
      if(record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP'||
         record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||record.parentRelative!=='performance-verifier-compatibility-v6.json'||
         record.parentSha256!=='963cc8a52a9c8a24eb90f89dbbf393b7dda94ca3ec64560d106f56414be8cf39'||
         record.parentAcceptedCommit!=='3a2e8487ae51ab1952b76e18e65ffca8a51c74b3'||record.primarySecondaryIntegrity!=='PASS'||
         !/^[0-9a-f]{40}$/.test(record.acceptedCommit||'')||hashFields.some(field=>!/^[0-9a-f]{64}$/.test(record[field]||''))||
         !Array.isArray(record.allowedChangedPaths)||!record.allowedChangedPaths.length||!record.changedFileSha256||
         Object.values(record.changedFileSha256).some(value=>!/^[0-9a-f]{64}$/.test(value||''))||
         record.stage3eWasmSha256!=='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221'||
         !record.stage3eAcousticIdentity||!Array.isArray(record.testResults)||!record.testResults.length||
         record.testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string'||! /^[0-9a-f]{64}$/.test(item.outputSha256||''))||
         record.testResultsSha256!==sha256(jsonBytes(record.testResults))||record.acousticRenders!==0||record.builds!==0)
        throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: performance verifier v7 follow-up schema mismatch');
    }
    if(item.path===SEARCH+'performance-verifier-compatibility-v8.json'){
      let record;
      try{record=JSON.parse(fs.readFileSync(path.join(primaryRoot,item.path),'utf8'));}
      catch{throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: invalid performance verifier v8 follow-up JSON');}
      const hashFields=['parentSha256','allowedVerifierOnlyDiffSha256','testResultsSha256'];
      if(record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP'||
         record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||record.parentRelative!=='performance-verifier-compatibility-v7.json'||
         record.parentSha256!=='e055f44c632b5eea57b4a4e1f12fbb9ff09f3d267687cba1c86882e6e587dba1'||
         record.parentAcceptedCommit!=='1f88603e14176e2931afdbd96b29ddfd6b28a27a'||record.primarySecondaryIntegrity!=='PASS'||
         !/^[0-9a-f]{40}$/.test(record.acceptedCommit||'')||hashFields.some(field=>! /^[0-9a-f]{64}$/.test(record[field]||''))||
         !Array.isArray(record.allowedChangedPaths)||!record.allowedChangedPaths.length||!record.changedFileSha256||
         Object.values(record.changedFileSha256).some(value=>! /^[0-9a-f]{64}$/.test(value||''))||
         record.stage3eWasmSha256!=='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221'||
         !record.stage3eAcousticIdentity||!Array.isArray(record.testResults)||!record.testResults.length||
         record.testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string'||! /^[0-9a-f]{64}$/.test(item.outputSha256||''))||
         record.testResultsSha256!==sha256(jsonBytes(record.testResults))||record.acousticRenders!==0||record.builds!==0)
        throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: performance verifier v8 follow-up schema mismatch');
    }
    if(item.path===SEARCH+'performance-verifier-compatibility-v9.json'){
      let record;
      try{record=JSON.parse(fs.readFileSync(path.join(primaryRoot,item.path),'utf8'));}
      catch{throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: invalid performance verifier v9 follow-up JSON');}
      const hashFields=['parentSha256','allowedVerifierOnlyDiffSha256','testResultsSha256'];
      const requiredPaths=[
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.test.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.test.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v9.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v9.test.cjs'
      ].sort();
      if(record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP'||
         record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||record.parentRelative!=='performance-verifier-compatibility-v8.json'||
         record.parentSha256!=='1073fc1b2095a5e0668728f0a707aa4d21518e116a722fdf23a5bf5b82d1155d'||
         record.parentAcceptedCommit!=='0d4a2454b79f78a8ccd4144fffd9ede154229c0f'||record.primarySecondaryIntegrity!=='PASS'||
         !/^[0-9a-f]{40}$/.test(record.acceptedCommit||'')||hashFields.some(field=>! /^[0-9a-f]{64}$/.test(record[field]||''))||
         !same(record.allowedChangedPaths,requiredPaths)||!record.changedFileSha256||
         Object.values(record.changedFileSha256).some(value=>! /^[0-9a-f]{64}$/.test(value||''))||
         record.stage3eWasmSha256!=='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221'||
         !record.stage3eAcousticIdentity||!Array.isArray(record.testResults)||!record.testResults.length||
         record.testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string'||! /^[0-9a-f]{64}$/.test(item.outputSha256||''))||
         record.testResultsSha256!==sha256(jsonBytes(record.testResults))||record.acousticRenders!==0||record.builds!==0)
        throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: performance verifier v9 follow-up schema mismatch');
    }
    if(item.path===SEARCH+'performance-verifier-compatibility-v10.json'){
      let record;
      try{record=JSON.parse(fs.readFileSync(path.join(primaryRoot,item.path),'utf8'));}
      catch{throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: invalid performance verifier v10 follow-up JSON');}
      const hashFields=['parentSha256','allowedVerifierOnlyDiffSha256','testResultsSha256'];
      const requiredPaths=[
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.test.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v10.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v10.test.cjs'
      ].sort();
      if(record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_FOLLOWUP'||
         record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||record.parentRelative!=='performance-verifier-compatibility-v9.json'||
         record.parentSha256!=='e3de969f8a33f2cb42743f8de5ac4cefeae94261d374d4ebf874f9fc16463754'||
         record.parentAcceptedCommit!=='88d111b3fb43a459e5daf23c141d0d837c2a2ebf'||record.primarySecondaryIntegrity!=='PASS'||
         !/^[0-9a-f]{40}$/.test(record.acceptedCommit||'')||hashFields.some(field=>! /^[0-9a-f]{64}$/.test(record[field]||''))||
         !same(record.allowedChangedPaths,requiredPaths)||!record.changedFileSha256||
         Object.keys(record.changedFileSha256).sort().join('\n')!==requiredPaths.join('\n')||
         Object.values(record.changedFileSha256).some(value=>! /^[0-9a-f]{64}$/.test(value||''))||
         record.stage3eWasmSha256!=='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221'||
         !record.stage3eAcousticIdentity||record.stage3eAcousticIdentity.diagnosticWasmSha256!==record.stage3eWasmSha256||
         !Array.isArray(record.testResults)||!record.testResults.length||
         record.testResults.some(item=>!item||item.status!=='PASS'||typeof item.command!=='string'||! /^[0-9a-f]{64}$/.test(item.outputSha256||''))||
         record.testResultsSha256!==sha256(jsonBytes(record.testResults))||record.acousticRenders!==0||record.builds!==0)
        throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: performance verifier v10 follow-up schema mismatch');
    }
    if(item.path===SEARCH+'performance-verifier-compatibility-v11.json'){
      let record;
      try{record=JSON.parse(fs.readFileSync(path.join(primaryRoot,item.path),'utf8'));}
      catch{throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: invalid performance verifier v11 source compatibility JSON');}
      const requiredPaths=[
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v10.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-recovery-reconciliation-v2.test.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v11.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v11.test.cjs'
      ].sort();
      const hashFields=['parentSha256','allowedVerifierOnlyDiffSha256','incrementalVerifierSha256','testResultsSha256'];
      if(record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_SOURCE_COMPATIBILITY'||
         record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||record.parentRelative!=='performance-verifier-compatibility-v10.json'||
         record.parentSha256!=='2784426827df766629cee9dad975d512f5c33be271ba5baf270568a5b5476b45'||
         record.parentAcceptedCommit!=='acffcba3f0810f3f8c9fb589523e01f6d18b8797'||
         record.checkpointFixCommit!=='b40cc7c67c16370b2bcecafb67061a1e254848ca'||
         record.incrementalVerifierPath!=='wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.cjs'||
         record.incrementalVerifierSha256!=='dcf2f297cc3e197df4d84ec7f9acc671aeae80b330ede76618eef2451a1341ca'||
         record.primarySecondaryIntegrity!=='PASS'||! /^[0-9a-f]{40}$/.test(record.acceptedCommit||'')||
         hashFields.some(field=>! /^[0-9a-f]{64}$/.test(record[field]||''))||!same(record.allowedChangedPaths,requiredPaths)||
         !record.verifierFileSha256||Object.keys(record.verifierFileSha256).sort().join('\n')!==requiredPaths.join('\n')||
         Object.values(record.verifierFileSha256).some(value=>! /^[0-9a-f]{64}$/.test(value||''))||
         record.stage3eWasmSha256!=='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221'||
         !record.stage3eAcousticIdentity||record.stage3eAcousticIdentity.diagnosticWasmSha256!==record.stage3eWasmSha256||
         !Array.isArray(record.testResults)||!record.testResults.length||
         record.testResults.some(test=>!test||test.status!=='PASS'||typeof test.command!=='string'||! /^[0-9a-f]{64}$/.test(test.outputSha256||''))||
         record.testResultsSha256!==sha256(Buffer.from(JSON.stringify(record.testResults)+'\n'))||record.acousticRenders!==0||record.builds!==0)
        throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: performance verifier v11 source compatibility schema mismatch');
    }
    if(item.path===SEARCH+'performance-verifier-compatibility-v12.json'){
      let record;
      try{record=JSON.parse(fs.readFileSync(path.join(primaryRoot,item.path),'utf8'));}
      catch{throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: invalid performance verifier v12 source compatibility JSON');}
      const requiredPaths=[
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v11.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-evidence-validator.test.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-preflight.test.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v12.cjs',
        'wasm/plugins/dsp/super-synth/test/tools/stage3e-performance-verifier-continuation-v12.test.cjs'
      ].sort();
      const hashFields=['parentSha256','allowedVerifierOnlyDiffSha256','incrementalVerifierSha256','testResultsSha256'];
      if(record.schemaVersion!==1||record.kind!=='STAGE3E_PERFORMANCE_VERIFIER_SOURCE_COMPATIBILITY_V12'||
         record.decision!=='STAGE3E_PERFORMANCE_VERIFIER_COMPATIBLE'||record.parentRelative!=='performance-verifier-compatibility-v11.json'||
         record.parentSha256!=='e35a9dfa984419e892a6f408c6709f236fee79d273865da5904147d351ccb77d'||
         record.parentAcceptedCommit!=='424b7b3552b566b5e7a78140c3f3819575414cc5'||
         record.checkpointFixCommit!=='b40cc7c67c16370b2bcecafb67061a1e254848ca'||
         record.incrementalVerifierPath!=='wasm/plugins/dsp/super-synth/test/tools/stage3e-incremental-verification.cjs'||
         record.incrementalVerifierSha256!=='dcf2f297cc3e197df4d84ec7f9acc671aeae80b330ede76618eef2451a1341ca'||
         record.primarySecondaryIntegrity!=='PASS'||! /^[0-9a-f]{40}$/.test(record.acceptedCommit||'')||
         hashFields.some(field=>! /^[0-9a-f]{64}$/.test(record[field]||''))||!same(record.allowedChangedPaths,requiredPaths)||
         !record.verifierFileSha256||Object.keys(record.verifierFileSha256).sort().join('\n')!==requiredPaths.join('\n')||
         Object.values(record.verifierFileSha256).some(value=>! /^[0-9a-f]{64}$/.test(value||''))||
         record.stage3eWasmSha256!=='6d8763661f3cf08dbb30b188cfd7a34e043606c7fa09f3bd16b7cebb89c66221'||
         !record.stage3eAcousticIdentity||record.stage3eAcousticIdentity.diagnosticWasmSha256!==record.stage3eWasmSha256||
         !Array.isArray(record.testResults)||!record.testResults.length||
         record.testResults.some(test=>!test||test.status!=='PASS'||typeof test.command!=='string'||! /^[0-9a-f]{64}$/.test(test.outputSha256||''))||
         record.testResultsSha256!==sha256(jsonBytes(record.testResults))||record.acousticRenders!==0||record.builds!==0)
        throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: performance verifier v12 source compatibility schema mismatch');
    }
    const other=byPath.get(item.path);
    if(!other||item.sizeBytes!==other.sizeBytes||item.sha256!==other.sha256)
      throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: addition differs: '+item.path);
  }
  const checkpointPaths=p.extras.map(item=>item.path).filter(relative=>relative.includes('/verification-checkpoints/'));
  const phasePaths=new Set(checkpointPaths.map(relative=>relative.slice((SEARCH).length).split('/verification-checkpoints/')[0]));
  for(const phaseRootRelative of phasePaths){
    const parts=phaseRootRelative.split('/');
    const phase=parts.at(-1);
    if(!/^(?:low|mid|low-full-[A-Za-z0-9._-]+|mid-full-[A-Za-z0-9._-]+)$/.test(phase))
      throw new Error('BLOCKED_STAGE3E_UNAUTHORIZED_EVIDENCE_NAMESPACE: invalid verification checkpoint phase '+phaseRootRelative);
    const searchRoots={primary:path.join(primaryRoot,SEARCH),secondary:path.join(secondaryRoot,SEARCH)};
    const phaseRoots={primary:path.join(searchRoots.primary,phaseRootRelative),secondary:path.join(searchRoots.secondary,phaseRootRelative)};
    const journalRootRelative=phaseRootRelative==='low'?'ledger-transition-journal':`${phaseRootRelative}/ledger-transition-journal`;
    incrementalVerification.validateCheckpointChain({phase,executionId:'generation-2',searchRoots,phaseRoots,phaseRootRelative,journalRootRelative});
  }
  return {frozenCount:primaryFrozen.length,additionCount:p.extras.length,primary:p.extras,secondary:s.extras};
}

function verifyDualFile(primary,secondary,expectedSha256){
  const stored=durable.verifyDualCopy(primary,secondary);
  if(expectedSha256&&stored.sha256!==expectedSha256)throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: fixed SHA mismatch');
  return stored;
}

function validateLowGenesis({manifestBytes,ledgerBytes,expectedCells,expectedLedgerIdentity,manifestSha256=SEARCH_MANIFEST_SHA256,ledgerSha256=LOW_GENESIS_SHA256}={}){
  if(!Buffer.isBuffer(manifestBytes)||sha256(manifestBytes)!==manifestSha256)
    throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: search manifest identity mismatch');
  if(!Buffer.isBuffer(ledgerBytes)||sha256(ledgerBytes)!==ledgerSha256)
    throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: low genesis ledger identity mismatch');
  const manifest=JSON.parse(manifestBytes.toString('utf8')),ledger=JSON.parse(ledgerBytes.toString('utf8'));
  const cells=ledger.cells||{},keys=Object.keys(cells),expectedKeys=expectedCells.map(cell=>cell.key);
  if(manifest.state!=='ACTIVE'||manifest.generation!==2||manifest.searchEpoch!=='search-v1'||
     manifest.authorizedCells?.baselineRowsReused!==12||manifest.authorizedCells?.baselineRenders!==0||
     manifest.authorizedCells?.lowGrid!==126||manifest.authorizedCells?.midGrid!==9||
     ledger.generation!==2||ledger.executionId!=='generation-2'||ledger.phase!=='low'||
     !expectedLedgerIdentity||!same(ledger.identity,expectedLedgerIdentity)||ledger.authorizedCellCount!==1512||
     !same(keys,expectedKeys)||new Set(keys).size!==1512||ledger.accounting?.renderCalls!==0)
    throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: low genesis structure mismatch');
  for(const expected of expectedCells){
    const state=cells[expected.key];
    if(!state||state.state!=='PENDING'||!same(state.identity,expected)||
       state.relativePath!=='cells/'+expected.key+'.json'||state.sha256!==null||
       Object.hasOwn(state,'startedAt')||Object.hasOwn(state,'completedAt'))
      throw new Error('BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: invalid initial cell '+expected.key);
  }
  return {manifest,ledger,manifestSha256,genesisLedgerSha256:ledgerSha256,
    authorizedCellCount:1512,pending:1512,inProgress:0,complete:0,renderCalls:0};
}

function validateLedgerTransitions({genesisLedgerBytes,currentLedgerBytes,transitionEntries=[],renderStartEntries=[],expectedCells,bindings={}}={}){
  const fail=(detail)=>{throw new Error(`BLOCKED_STAGE3E_DIAGNOSTIC_EVIDENCE: ledger transition ${detail}`);};
  if(!Buffer.isBuffer(genesisLedgerBytes)||!Buffer.isBuffer(currentLedgerBytes)||!Array.isArray(transitionEntries)||!Array.isArray(renderStartEntries)||!Array.isArray(expectedCells))fail('input schema');
  const genesisSha256=sha256(genesisLedgerBytes),currentSha256=sha256(currentLedgerBytes);
  const genesis=JSON.parse(genesisLedgerBytes.toString('utf8')),current=JSON.parse(currentLedgerBytes.toString('utf8'));
  const genesisCells=genesis.cells||{},currentCells=current.cells||{},expectedByKey=new Map(expectedCells.map(cell=>[cell.key,cell]));
  if(expectedByKey.size!==expectedCells.length||!same(Object.keys(genesisCells),expectedCells.map(cell=>cell.key)))fail('genesis identities/order');
  if(!same(Object.keys(currentCells),Object.keys(genesisCells))||!same(current.identity,genesis.identity)||current.phase!==genesis.phase||
     current.generation!==genesis.generation||current.executionId!==genesis.executionId||current.authorizedCellCount!==genesis.authorizedCellCount)fail('ledger identity changed');
  const replay=new Map(expectedCells.map(cell=>[cell.key,{state:'PENDING',sha256:null,identity:cell,startTransitionSequence:null,startLedgerSha256:null,aborted:false,requeueCount:0}]));
  const acceptedCompatibility=new Set([bindings.compatibilitySha256,...(bindings.acceptedCompatibilitySha256s||[])].filter(Boolean));
  const markersByTransition=new Map();let markerSequence=0,administrativeRequeues=0;
  for(const marker of renderStartEntries){
    markerSequence++;
    if(!marker||marker.schemaVersion!==1||marker.kind!=='STAGE3E_RENDER_START'||marker.sequence!==markerSequence||
       !expectedByKey.has(marker.cellKey)||!same(marker.cellIdentity,expectedByKey.get(marker.cellKey))||
       !/^[0-9a-f]{64}$/.test(marker._sha256||'')||!Number.isInteger(marker.transitionSequence)||
       markersByTransition.has(marker.transitionSequence))fail(`render-start marker schema/sequence ${markerSequence}`);
    for(const key of ['manifestSha256','proofSha256'])if(bindings[key]!==undefined&&marker[key]!==bindings[key])fail(`render-start ${key} binding ${markerSequence}`);
    if(acceptedCompatibility.size&&!acceptedCompatibility.has(marker.compatibilitySha256))fail(`render-start compatibilitySha256 binding ${markerSequence}`);
    markersByTransition.set(marker.transitionSequence,marker);
  }
  let lastLedgerSha256=genesisSha256,renderCount=0,sequence=0;
  for(const entry of transitionEntries){
    sequence++;
    if(!entry||entry.sequence!==sequence||entry.previousLedgerSha256!==lastLedgerSha256||
       !/^[0-9a-f]{64}$/.test(entry.nextLedgerSha256||'')||!expectedByKey.has(entry.cellKey)||
       !same(entry.cellIdentity,expectedByKey.get(entry.cellKey)))fail(`sequence/hash/identity at ${sequence}`);
    for(const key of ['manifestSha256','proofSha256'])if(bindings[key]!==undefined&&entry[key]!==bindings[key])fail(`${key} binding at ${sequence}`);
    if(acceptedCompatibility.size&&!acceptedCompatibility.has(entry.compatibilitySha256))fail(`compatibilitySha256 binding at ${sequence}`);
    const state=replay.get(entry.cellKey);
    if(entry.oldState!==state.state)fail(`illegal transition at ${sequence}`);
    if(entry.previousRenderCount!==renderCount)fail(`render count predecessor at ${sequence}`);
    if(entry.eventType==='ABORTED_BEFORE_RENDER'){
      if(entry.oldState!=='IN_PROGRESS'||entry.newState!=='IN_PROGRESS'||entry.nextLedgerSha256!==entry.previousLedgerSha256||
         entry.newRenderCount!==renderCount||entry.capturedCellSha256!==null||entry.abortedBeforeRenderCalls!==0||entry.attemptIndex!==1||
         !/^[0-9a-f]{64}$/.test(entry.abortEvidenceSha256||'')||!/^[0-9a-f]{64}$/.test(entry.recoveryAuthorizationSha256||'')||
         !/^[0-9a-f]{64}$/.test(entry.recoveryResultSha256||'')||
         !/^[0-9a-f]{64}$/.test(entry.oldCodeSha256||'')||!/^[0-9a-f]{64}$/.test(entry.newCodeSha256||'')||state.aborted||
         markersByTransition.has(state.startTransitionSequence)||
         (bindings.recoveryCompatibilitySha256!==undefined&&entry.compatibilitySha256!==bindings.recoveryCompatibilitySha256))fail(`invalid pre-render abort event at ${sequence}`);
      state.aborted=true;
    }else if(entry.eventType==='REQUEUE_AUTHORIZED'){
      if(entry.oldState!=='IN_PROGRESS'||entry.newState!=='PENDING'||entry.nextLedgerSha256===entry.previousLedgerSha256||
         entry.newRenderCount!==renderCount||entry.capturedCellSha256!==null||entry.abortedBeforeRenderCalls!==0||entry.attemptIndex!==1||
         !/^[0-9a-f]{64}$/.test(entry.abortEvidenceSha256||'')||!/^[0-9a-f]{64}$/.test(entry.recoveryAuthorizationSha256||'')||
         !/^[0-9a-f]{64}$/.test(entry.recoveryResultSha256||'')||
         !/^[0-9a-f]{64}$/.test(entry.oldCodeSha256||'')||!/^[0-9a-f]{64}$/.test(entry.newCodeSha256||'')||!state.aborted||state.requeueCount!==0||
         markersByTransition.has(state.startTransitionSequence)||
         (bindings.recoveryCompatibilitySha256!==undefined&&entry.compatibilitySha256!==bindings.recoveryCompatibilitySha256))fail(`invalid authorized requeue event at ${sequence}`);
      state.state='PENDING';state.sha256=null;state.startTransitionSequence=null;state.startLedgerSha256=null;state.aborted=false;state.requeueCount++;
    }else if(entry.eventType==='ADMIN_REQUEUE_NO_RENDER'){
      administrativeRequeues++;
      if(administrativeRequeues!==1||entry.cellKey!=='low-screen-L1-M1-H0-midi-036-v110'||
         entry.oldState!=='IN_PROGRESS'||entry.newState!=='PENDING'||entry.nextLedgerSha256===entry.previousLedgerSha256||
         entry.newRenderCount!==renderCount||entry.capturedCellSha256!==null||renderCount!==0||state.requeueCount!==0||
         state.aborted||markersByTransition.has(state.startTransitionSequence)||
         !/^[0-9a-f]{64}$/.test(entry.recoveryAuthorizationSha256||'')||
         !/^[0-9a-f]{64}$/.test(entry.transactionIntentSha256||'')||
         !/^[0-9a-f]{64}$/.test(entry.sourceAuditSha256||'')||
         !/^[0-9a-f]{64}$/.test(entry.invalidRecoveryResultSha256||'')||
         !/^[0-9a-f]{64}$/.test(entry.recoveryReconciliationCompatibilitySha256||'')||
         (bindings.recoveryCompatibilitySha256!==undefined&&entry.compatibilitySha256!==bindings.recoveryCompatibilitySha256)||
         (bindings.recoveryReconciliationCompatibilitySha256!==undefined&&
          entry.recoveryReconciliationCompatibilitySha256!==bindings.recoveryReconciliationCompatibilitySha256))
        fail(`invalid administrative no-render requeue at ${sequence}`);
      state.state='PENDING';state.sha256=null;state.startTransitionSequence=null;state.startLedgerSha256=null;state.aborted=false;state.requeueCount++;
    }else if(entry.oldState==='PENDING'&&entry.newState==='IN_PROGRESS'){
      if(entry.eventType!==undefined)fail(`unexpected event type at ${sequence}`);
      if(entry.newRenderCount!==renderCount||entry.capturedCellSha256!==null)fail(`pre-render accounting at ${sequence}`);
      if(entry.renderStartMarkerSha256!==undefined)fail(`render-start marker attached before it exists at ${sequence}`);
      state.state='IN_PROGRESS';state.startTransitionSequence=sequence;state.startLedgerSha256=entry.nextLedgerSha256;state.aborted=false;
    }else if(entry.oldState==='IN_PROGRESS'&&entry.newState==='COMPLETE'){
      if(entry.eventType!==undefined)fail(`unexpected event type at ${sequence}`);
      if(entry.newRenderCount!==renderCount+1||!/^[0-9a-f]{64}$/.test(entry.capturedCellSha256||''))fail(`completed-cell accounting at ${sequence}`);
      const marker=markersByTransition.get(state.startTransitionSequence);
      if(!marker||marker.cellKey!==entry.cellKey||marker.ledgerSha256!==state.startLedgerSha256||
         entry.renderStartMarkerSha256!==marker._sha256||marker.renderCallIndex!==renderCount+1)
        fail(`missing or mismatched durable render-start marker at ${sequence}`);
      const startEntry=transitionEntries[state.startTransitionSequence-1];
      const expectedTransitionSha=sha256(jsonBytes(startEntry));
      if(marker.transitionSha256!==expectedTransitionSha)fail(`render-start transition SHA at ${sequence}`);
      renderCount++;
      state.state='COMPLETE';state.sha256=entry.capturedCellSha256;
      state.startTransitionSequence=null;state.startLedgerSha256=null;
    }else fail(`illegal transition at ${sequence}`);
    lastLedgerSha256=entry.nextLedgerSha256;
  }
  if(currentSha256!==lastLedgerSha256)fail('current ledger is not the journal tip');
  if(current.accounting?.renderCalls!==renderCount)fail('accounting does not match journal');
  for(const [key,expectedState] of replay){
    const actual=currentCells[key];
    if(!actual||actual.state!==expectedState.state||actual.sha256!==expectedState.sha256||!same(actual.identity,expectedState.identity))fail(`replayed state mismatch for ${key}`);
    if(expectedState.state==='IN_PROGRESS'&&actual.state!=='IN_PROGRESS')fail(`unfinished render state mismatch for ${key}`);
  }
  for(const marker of renderStartEntries){
    const state=replay.get(marker.cellKey);
    if(!state||!['IN_PROGRESS','COMPLETE'].includes(state.state)||marker.transitionSequence>transitionEntries.length||
       transitionEntries[marker.transitionSequence-1]?.newState!=='IN_PROGRESS')
      fail(`orphan render-start marker for ${marker.cellKey}`);
  }
  return {genesisLedgerSha256:genesisSha256,currentLedgerSha256:currentSha256,transitionCount:transitionEntries.length,
    renderCalls:renderCount,pending:[...replay.values()].filter(row=>row.state==='PENDING').length,
    inProgress:[...replay.values()].filter(row=>row.state==='IN_PROGRESS').length,
    complete:[...replay.values()].filter(row=>row.state==='COMPLETE').length};
}

module.exports={
  SOURCE_AUDIT_SHA256,SEARCH_MANIFEST_SHA256,LOW_GENESIS_SHA256,AMENDMENT,SEARCH,RECOVERY_V2,
  sha256,jsonBytes,stable,same,safeRelative,walkFiles,validateFrozenSide,isAmendmentAddition,
  isSearchAddition,validateNamespaceAdditions,verifyDualFile,validateLowGenesis,validateLedgerTransitions
};
