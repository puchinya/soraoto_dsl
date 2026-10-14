'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const durable=require('./durable-evidence.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const ISSUE=7;
const EPOCH='current-build-v1';
const CONTRACT_SHA256='6aa448801d983d2ba4ef5a65b02900db4e1cb1ef5c2f904d2f2a4ed5bb5583c2';
const APPROVER_LOGIN='puchinya';
const REPOSITORY='puchinya/soraoto_dsl';
const STAGES=Object.freeze(['stage3e','stage3','stage4']);
const PHASES=Object.freeze(['baseline','midi51-diagnostic','low-screen','midi51-candidate-diagnostic','low-full','mid-screen','midi51-final-diagnostic','mid-full','stage3','stage4']);

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
function canonicalBytes(value){return Buffer.from(JSON.stringify(stable(value),null,2)+'\n');}
function same(a,b){return canonicalBytes(a).equals(canonicalBytes(b));}
function safePart(value,name='path component'){
  const text=String(value??'');
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)||text==='.'||text==='..')throw new Error(`invalid ${name}`);
  return text;
}
function inside(parent,target){const rel=path.relative(parent,target);return rel===''||(!rel.startsWith(`..${path.sep}`)&&rel!=='..'&&!path.isAbsolute(rel));}
function assertNoSymlinkComponents(base,target){
  const anchor=path.resolve(base),absolute=path.resolve(target);
  if(!inside(anchor,absolute))throw new Error('BLOCKED_EVIDENCE_ROOT_ESCAPE: path is outside its canonical parent');
  let current=anchor;
  const rel=path.relative(anchor,absolute);
  for(const part of rel?rel.split(path.sep):[]){
    current=path.join(current,part);
    try{
      const stat=fs.lstatSync(current);
      if(stat.isSymbolicLink())throw new Error(`BLOCKED_EVIDENCE_SYMLINK: ${current}`);
      if(!stat.isDirectory()&&current!==absolute)throw new Error(`BLOCKED_EVIDENCE_PATH: non-directory parent ${current}`);
    }catch(error){if(error.code==='ENOENT')break;throw error;}
  }
  if(fs.existsSync(absolute)&&fs.realpathSync(absolute)!==absolute)throw new Error('BLOCKED_EVIDENCE_SYMLINK: non-canonical path');
  return absolute;
}
function makeDirChain(base,target){
  const anchor=fs.realpathSync(path.resolve(base)),absolute=path.resolve(target);
  if(!inside(anchor,absolute))throw new Error('BLOCKED_EVIDENCE_ROOT_ESCAPE: directory is outside its canonical parent');
  let current=anchor;
  for(const part of path.relative(anchor,absolute).split(path.sep).filter(Boolean)){
    current=path.join(current,part);
    try{
      const stat=fs.lstatSync(current);
      if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error(`BLOCKED_EVIDENCE_PATH: unsafe directory ${current}`);
    }catch(error){
      if(error.code!=='ENOENT')throw error;
      try{fs.mkdirSync(current,{mode:0o700});}catch(createError){if(createError.code!=='EEXIST')throw createError;}
      const stat=fs.lstatSync(current);
      if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error(`BLOCKED_EVIDENCE_PATH: unsafe directory ${current}`);
    }
  }
  if(fs.realpathSync(absolute)!==absolute)throw new Error('BLOCKED_EVIDENCE_SYMLINK: non-canonical directory');
  return absolute;
}
function canonicalAnchor(file){
  let current=path.resolve(file);
  while(!fs.existsSync(current)){
    const parent=path.dirname(current);
    if(parent===current)throw new Error('unable to locate existing filesystem anchor');
    current=parent;
  }
  const real=fs.realpathSync(current);
  if(real!==current)throw new Error(`BLOCKED_EVIDENCE_SYMLINK: non-canonical anchor ${current}`);
  return real;
}
function resolveRoots(root=ROOT,stage='stage3e',epoch=EPOCH,{home=os.homedir(),commonDirectory}={}){
  if(!STAGES.includes(stage))throw new Error(`invalid Issue #7 stage: ${stage}`);
  if(epoch!==EPOCH)throw new Error(`BLOCKED_EPOCH: only ${EPOCH} is permitted`);
  const repositoryRoot=fs.realpathSync(path.resolve(root));
  const commonRaw=commonDirectory||execFileSync('rtk',['git','rev-parse','--path-format=absolute','--git-common-dir'],{cwd:repositoryRoot,encoding:'utf8'}).trim();
  const common=fs.realpathSync(path.resolve(commonRaw));
  const homePath=fs.realpathSync(path.resolve(home));
  const repository=path.basename(repositoryRoot);
  const primary=path.join(common,'soraoto-agent-state',String(ISSUE),stage,epoch);
  const secondary=path.join(homePath,'.soraoto-agent-archive',repository,String(ISSUE),stage,epoch);
  assertNoSymlinkComponents(common,primary);
  assertNoSymlinkComponents(homePath,secondary);
  if(primary===secondary||inside(primary,secondary)||inside(secondary,primary))throw new Error('BLOCKED_EVIDENCE_ROOT_OVERLAP');
  return {primary,secondary,commonDirectory:common,home:homePath,repository,stage,epoch};
}
function checkedRelative(relative){
  const text=String(relative??'');
  if(!text||path.isAbsolute(text)||text.includes('\\'))throw new Error('invalid evidence relative path');
  const parts=text.split('/');
  if(parts.some(part=>!part||part==='.'||part==='..'))throw new Error('invalid evidence relative path');
  return parts.join(path.sep);
}
function dualPaths(roots,relative){
  const rel=checkedRelative(relative);
  const primary=path.resolve(roots.primary,rel),secondary=path.resolve(roots.secondary,rel);
  if(!inside(roots.primary,primary)||!inside(roots.secondary,secondary))throw new Error('BLOCKED_EVIDENCE_ROOT_ESCAPE');
  assertNoSymlinkComponents(roots.primary,primary);
  assertNoSymlinkComponents(roots.secondary,secondary);
  return {primary,secondary,relative:rel};
}
function writeImmutableFile(file,bytes,base){
  const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  const absolute=path.resolve(file),anchor=fs.realpathSync(base);
  if(!inside(anchor,absolute))throw new Error('BLOCKED_EVIDENCE_ROOT_ESCAPE');
  makeDirChain(anchor,path.dirname(absolute));
  try{
    const fd=fs.openSync(absolute,'wx',0o600);
    try{let offset=0;while(offset<data.length)offset+=fs.writeSync(fd,data,offset,data.length-offset);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }catch(error){
    if(error.code!=='EEXIST')throw error;
    const existing=fs.readFileSync(absolute);
    if(!existing.equals(data))throw new Error(`BLOCKED_EVIDENCE_IMMUTABLE: existing bytes differ at ${absolute}`);
  }
  const stored=fs.readFileSync(absolute);
  if(!stored.equals(data))throw new Error('BLOCKED_EVIDENCE_READBACK: immutable bytes differ');
  return {sizeBytes:stored.length,sha256:sha256(stored)};
}
function writeImmutableDual(roots,relative,bytes,{write=writeImmutableFile}={}){
  const paths=dualPaths(roots,relative),data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  write(paths.primary,data,roots.commonDirectory);
  write(paths.secondary,data,roots.home);
  const stored=durable.verifyDualCopy(paths.primary,paths.secondary);
  if(!stored.bytes.equals(data))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: immutable readback differs');
  return {sizeBytes:stored.sizeBytes,sha256:stored.sha256};
}
function writeMutableFile(file,bytes,base){
  const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes),absolute=path.resolve(file),anchor=fs.realpathSync(base);
  if(!inside(anchor,absolute))throw new Error('BLOCKED_EVIDENCE_ROOT_ESCAPE');
  makeDirChain(anchor,path.dirname(absolute));
  try{if(fs.lstatSync(absolute).isSymbolicLink())throw new Error('BLOCKED_EVIDENCE_SYMLINK');}catch(error){if(error.code!=='ENOENT')throw error;}
  const temp=path.join(path.dirname(absolute),`.${path.basename(absolute)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let fd;
  try{
    fd=fs.openSync(temp,'wx',0o600);let offset=0;
    while(offset<data.length)offset+=fs.writeSync(fd,data,offset,data.length-offset);
    fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    fs.renameSync(temp,absolute);
    const dir=fs.openSync(path.dirname(absolute),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
  }catch(error){if(fd!==undefined)try{fs.closeSync(fd);}catch{}try{fs.unlinkSync(temp);}catch{}throw error;}
  const stored=fs.readFileSync(absolute);
  if(!stored.equals(data))throw new Error('BLOCKED_EVIDENCE_READBACK: mutable bytes differ');
  return {sizeBytes:stored.length,sha256:sha256(stored)};
}
function writeMutableDual(roots,relative,bytes,{write=writeMutableFile}={}){
  const paths=dualPaths(roots,relative),data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  try{write(paths.primary,data,roots.commonDirectory);}catch(error){throw new Error(`BLOCKED_EVIDENCE_PRIMARY_PERSISTENCE: ${error.message}`);}
  try{write(paths.secondary,data,roots.home);}catch(error){throw new Error(`BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: ${error.message}`);}
  const stored=durable.verifyDualCopy(paths.primary,paths.secondary);
  if(!stored.bytes.equals(data))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: mutable readback differs');
  return {sizeBytes:stored.sizeBytes,sha256:stored.sha256};
}
function readDualBytes(roots,relative){const paths=dualPaths(roots,relative);return durable.verifyDualCopy(paths.primary,paths.secondary);}
function readDualJson(roots,relative){return JSON.parse(readDualBytes(roots,relative).bytes.toString('utf8'));}
function inputPath(root,relative){
  const rel=checkedRelative(relative),absolute=path.resolve(root,rel);
  if(!inside(path.resolve(root),absolute))throw new Error('BLOCKED_CURRENT_BUILD_IDENTITY_DRIFT: input escaped repository root');
  assertNoSymlinkComponents(fs.realpathSync(root),absolute);
  if(!fs.statSync(absolute).isFile())throw new Error(`BLOCKED_CURRENT_BUILD_IDENTITY_DRIFT: input is not a file: ${rel}`);
  return absolute;
}
function parseCache(cacheBytes){
  const values={};
  for(const line of cacheBytes.toString('utf8').split(/\r?\n/)){
    const m=line.match(/^([^:#]+):[^=]+=([\s\S]*)$/);if(m)values[m[1]]=m[2];
  }
  return values;
}
function hashInputs(root=ROOT,builds){
  const repositoryRoot=fs.realpathSync(path.resolve(root));
  const identityRelative='docs/status/plugins/dsp/super-synth/current-build-v1/build-identity.json';
  const identityBytes=fs.readFileSync(inputPath(repositoryRoot,identityRelative));
  const storedRecord=JSON.parse(identityBytes.toString('utf8'));
  const record=builds||storedRecord;
  if(!same(record,storedRecord))throw new Error('BLOCKED_CURRENT_BUILD_IDENTITY_DRIFT: build-identity.json differs from the supplied record');
  if(record.epoch!==EPOCH||record.issue!==ISSUE)throw new Error('BLOCKED_CURRENT_BUILD_IDENTITY_DRIFT: wrong issue or epoch');
  const toolchainFile=record.toolchain?.toolchainFile,toolchainSha256=record.toolchain?.toolchainFileSha256;
  if(!toolchainFile||!/^[a-f0-9]{64}$/.test(toolchainSha256||''))
    throw new Error('BLOCKED_CURRENT_BUILD_IDENTITY_DRIFT: toolchain file path or SHA-256 is missing');
  const actualToolchainSha256=sha256(fs.readFileSync(inputPath(repositoryRoot,toolchainFile)));
  if(actualToolchainSha256!==toolchainSha256)
    throw new Error(`BLOCKED_CURRENT_BUILD_IDENTITY_DRIFT: ${toolchainFile}`);
  const inputs={};
  for(const [key,entry] of Object.entries(record.inputs||{})){
    if(!entry?.path||!entry?.sha256)throw new Error(`BLOCKED_CURRENT_BUILD_IDENTITY_DRIFT: incomplete input ${key}`);
    const bytes=fs.readFileSync(inputPath(repositoryRoot,entry.path)),actual=sha256(bytes);
    inputs[key]={path:entry.path,sha256:actual};
    if(actual!==entry.sha256)throw new Error(`BLOCKED_CURRENT_BUILD_IDENTITY_DRIFT: ${entry.path}`);
  }
  const buildResults={};
  for(const [role,build] of Object.entries(record.builds||{})){
    const directory=inputPath(repositoryRoot,`${build.buildDirectory}/CMakeCache.txt`);
    const cache=fs.readFileSync(directory),cacheSha=sha256(cache);
    if(cacheSha!==build.cmakeCacheSha256)throw new Error(`BLOCKED_CURRENT_BUILD_IDENTITY_DRIFT: ${role} CMakeCache`);
    const cacheValues=parseCache(cache);
    for(const [name,expected] of Object.entries(build.flags||{})){
      const normalized=String(expected).replace(/\s*\(repository default\)$/,'');
      if(cacheValues[`SORAOTO_SUPERSYNTH_${name}`]!==normalized)throw new Error(`BLOCKED_CURRENT_BUILD_IDENTITY_DRIFT: ${role} flag ${name}`);
    }
    const wasmBytes=fs.readFileSync(inputPath(repositoryRoot,`${build.buildDirectory}/${build.wasm.path}`));
    const wasmSha=sha256(wasmBytes);
    if(wasmSha!==build.wasm.sha256)throw new Error(`BLOCKED_CURRENT_BUILD_IDENTITY_DRIFT: ${role} WASM`);
    for(const [relative,expected] of [
      [`${build.buildDirectory}/generated/super-synth_descriptor.cbor`,record.metadataOutputs.descriptorCborSha256],
      [`${build.buildDirectory}/generated/super-synth_descriptor.h`,record.metadataOutputs.descriptorHeaderSha256]
    ])if(sha256(fs.readFileSync(inputPath(repositoryRoot,relative)))!==expected)throw new Error(`BLOCKED_CURRENT_BUILD_IDENTITY_DRIFT: ${role} generated metadata`);
    buildResults[role]={cmakeCacheSha256:cacheSha,wasmSha256:wasmSha,flags:cacheValues};
  }
  return {issue:ISSUE,epoch:EPOCH,sourceCommit:record.sourceCommit,buildIdentitySha256:sha256(identityBytes),toolchain:record.toolchain,inputs,builds:buildResults};
}
function checkFrozenIdentity(expected,actual){
  if(!expected||!actual||!same(expected,actual))throw new Error('BLOCKED_CURRENT_BUILD_IDENTITY_DRIFT: frozen input hash mismatch');
  return true;
}
function phaseRelative(phase,relative){
  if(!PHASES.includes(phase))throw new Error(`invalid phase: ${phase}`);
  return `phases/${phase}/${checkedRelative(relative).split(path.sep).join('/')}`;
}
function readPhaseLedger(roots,phase){
  const manifestRel=phaseRelative(phase,'manifest.json'),ledgerRel=phaseRelative(phase,'ledger.json');
  const pManifest=dualPaths(roots,manifestRel),pLedger=dualPaths(roots,ledgerRel);
  const any=[pManifest.primary,pManifest.secondary,pLedger.primary,pLedger.secondary].some(fs.existsSync);
  if(!any)return null;
  if(![pManifest.primary,pManifest.secondary,pLedger.primary,pLedger.secondary].every(fs.existsSync))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: partial phase manifest or ledger');
  const manifest=readDualJson(roots,manifestRel),ledger=readDualJson(roots,ledgerRel);
  if(manifest.issue!==ISSUE||manifest.epoch!==EPOCH||manifest.phase!==phase||ledger.phase!==phase||ledger.manifestSha256!==sha256(canonicalBytes(manifest)))throw new Error('BLOCKED_EVIDENCE_MANIFEST_IMMUTABLE: phase identity mismatch');
  return {manifest,ledger};
}
function initializePhase({roots,phase,manifest,cells,renderBudget,now=()=>new Date().toISOString(),write=writeImmutableFile}={}){
  if(!Array.isArray(cells)||!cells.length)throw new Error('a phase requires an explicit non-empty cell list');
  const keys=cells.map(cell=>String(cell.key));
  if(new Set(keys).size!==keys.length)throw new Error('duplicate authorized cell key');
  for(const key of keys)safePart(key,'cell key');
  if(!manifest||manifest.issue!==ISSUE||manifest.epoch!==EPOCH||manifest.stage!==roots.stage||manifest.phase!==phase)throw new Error('BLOCKED_EVIDENCE_MANIFEST_IMMUTABLE: invalid phase manifest');
  if(!/^[a-f0-9]{64}$/.test(manifest.authorizationSha256||''))throw new Error('AUTHORIZATION_REQUIRED: authorization hash is missing');
  if(!Number.isSafeInteger(renderBudget)||renderBudget<keys.length)throw new Error('invalid render budget');
  const relativeManifest=phaseRelative(phase,'manifest.json'),relativeLedger=phaseRelative(phase,'ledger.json');
  const existing=readPhaseLedger(roots,phase);
  const canonicalManifest={...stable(manifest),authorizedCellKeys:keys,renderBudget,createdAt:manifest.createdAt||now()};
  if(existing){
    if(!same(existing.manifest,canonicalManifest))throw new Error('BLOCKED_EVIDENCE_MANIFEST_IMMUTABLE: authorized phase changed');
    return existing;
  }
  const ledger={schemaVersion:1,stage:roots.stage,epoch:EPOCH,phase,manifestSha256:sha256(canonicalBytes(canonicalManifest)),renderCount:0,decision:'IN_PROGRESS',cells:Object.fromEntries(keys.map(key=>[key,{state:'PENDING'}]))};
  writeImmutableDual(roots,relativeManifest,canonicalBytes(canonicalManifest),{write});
  writeImmutableDual(roots,relativeLedger,canonicalBytes(ledger),{write});
  return {manifest:canonicalManifest,ledger};
}
function stateForCell(roots,phase,cellKey,{ledgerState}={}){
  safePart(cellKey,'cell key');
  const cell=ledgerState.ledger.cells[cellKey];
  if(!cell)throw new Error(`BLOCKED_UNAUTHORIZED_CELL: ${cellKey}`);
  const base=phaseRelative(phase,`cells/${cellKey}`),markerRel=`${base}/render-start.json`,resultRel=`${base}/observation.json`;
  const markerPaths=dualPaths(roots,markerRel),resultPaths=dualPaths(roots,resultRel);
  const markerExists=[markerPaths.primary,markerPaths.secondary].some(fs.existsSync),resultExists=[resultPaths.primary,resultPaths.secondary].some(fs.existsSync);
  if(cell.state==='PENDING'){
    if(markerExists||resultExists)throw new Error(`BLOCKED_CELL_AMBIGUOUS: pending cell has durable artifacts: ${cellKey}`);
    return {cell,marker:null,observation:null};
  }
  if(!markerExists)throw new Error(`BLOCKED_CELL_AMBIGUOUS: marker is missing: ${cellKey}`);
  const marker=readDualJson(roots,markerRel);
  if(cell.markerSha256&&sha256(canonicalBytes(marker))!==cell.markerSha256)throw new Error(`BLOCKED_CELL_AMBIGUOUS: marker hash mismatch: ${cellKey}`);
  if(cell.state==='IN_PROGRESS'||cell.state==='AMBIGUOUS')return {cell,marker,observation:null};
  if(cell.state!=='COMPLETE')throw new Error(`BLOCKED_CELL_STATE: ${cell.state}`);
  if(!resultExists)throw new Error(`BLOCKED_CELL_AMBIGUOUS: completed cell result missing: ${cellKey}`);
  const stored=readDualBytes(roots,resultRel);
  if(stored.sha256!==cell.resultSha256)throw new Error(`BLOCKED_CELL_RESULT_HASH: ${cellKey}`);
  return {cell,marker,observation:JSON.parse(stored.bytes.toString('utf8')),resultBytes:stored.bytes};
}
function readCell(roots,phase,cellKey){
  const state=readPhaseLedger(roots,phase);
  if(!state)throw new Error('BLOCKED_PHASE_NOT_STARTED');
  return stateForCell(roots,phase,cellKey,{ledgerState:state});
}
function writeLedger(roots,phase,ledger,{write=writeMutableFile}={}){return writeMutableDual(roots,phaseRelative(phase,'ledger.json'),canonicalBytes(ledger),{write});}
function startCell({roots,phase,cellKey,cell,identity,identityNow,now=()=>new Date().toISOString(),writeImmutable=writeImmutableFile,writeMutable=writeMutableFile}={}){
  const state=readPhaseLedger(roots,phase);
  if(!state)throw new Error('BLOCKED_PHASE_NOT_STARTED');
  const current=stateForCell(roots,phase,cellKey,{ledgerState:state});
  if(current.cell.state==='COMPLETE')return {state:'COMPLETE',skipped:true,observation:current.observation,resultSha256:current.cell.resultSha256};
  if(current.cell.state!=='PENDING')throw new Error(`BLOCKED_CELL_AMBIGUOUS: ${cellKey} is ${current.cell.state}; rerender is forbidden`);
  if(typeof identityNow!=='function')throw new Error('identityNow callback is required before rendering');
  checkFrozenIdentity(identity,identityNow());
  const marker={schemaVersion:1,issue:ISSUE,epoch:EPOCH,stage:roots.stage,phase,cellKey,cell,identitySha256:sha256(canonicalBytes(identity)),authorizationSha256:state.manifest.authorizationSha256,startedAt:now()};
  const markerRel=phaseRelative(phase,`cells/${cellKey}/render-start.json`),markerHash=writeImmutableDual(roots,markerRel,canonicalBytes(marker),{write:writeImmutable});
  try{checkFrozenIdentity(identity,identityNow());}catch(error){
    const ledger=state.ledger;ledger.cells[cellKey]={state:'AMBIGUOUS',markerSha256:markerHash.sha256,reason:'identity drift after marker',updatedAt:now()};ledger.decision='AMBIGUOUS';
    try{writeLedger(roots,phase,ledger,{write:writeMutable});}catch{}
    throw new Error(`BLOCKED_POST_MARKER_IDENTITY_DRIFT: ${error.message}`);
  }
  const ledger=state.ledger;ledger.renderCount+=1;ledger.cells[cellKey]={state:'IN_PROGRESS',markerSha256:markerHash.sha256,startedAt:marker.startedAt};
  writeLedger(roots,phase,ledger,{write:writeMutable});
  return {state:'IN_PROGRESS',marker,markerSha256:markerHash.sha256};
}
function normalizeObserved(value){
  if(typeof value==='number'&&!Number.isFinite(value))return {$nonFinite:Number.isNaN(value)?'NaN':value>0?'Infinity':'-Infinity'};
  if(typeof value==='bigint')return {$bigint:String(value)};
  if(Buffer.isBuffer(value))return {$bufferBase64:value.toString('base64')};
  if(Array.isArray(value))return value.map(normalizeObserved);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalizeObserved(value[key])]));
  if(value===undefined)return {$undefined:true};
  return value;
}
function assessSafety(value){
  const reasons=[];
  function walk(node,key=''){
    if(typeof node==='number'){
      if(!Number.isFinite(node))reasons.push(`${key||'value'} is non-finite`);
      if(/peakdbfs|outputpeakdbfs/i.test(key)&&node>=0)reasons.push(`${key} is not below 0 dBFS`);
      if(/guard.*hits?|outputguardhits/i.test(key)&&node>0)reasons.push(`${key} is non-zero`);
      return;
    }
    if(node&&typeof node==='object'){
      if(node.$nonFinite)reasons.push(`${key||'value'} is ${node.$nonFinite}`);
      for(const [child,value] of Object.entries(node))walk(value,child);
      return;
    }
    if(key==='finite'&&node!==true)reasons.push('finite flag is not true');
    if(/safe|guard|finite/i.test(key)&&node===false)reasons.push(`${key} is false`);
  }
  walk(value);
  return {decision:reasons.length?'FAIL':'PASS',reasons:[...new Set(reasons)]};
}
function completeCell({roots,phase,cellKey,observation,now=()=>new Date().toISOString(),writeImmutable=writeImmutableFile,writeMutable=writeMutableFile}={}){
  const state=readPhaseLedger(roots,phase);
  if(!state)throw new Error('BLOCKED_PHASE_NOT_STARTED');
  const current=stateForCell(roots,phase,cellKey,{ledgerState:state});
  if(current.cell.state==='COMPLETE'){
    const candidate=canonicalBytes(current.observation.observation);
    if(!candidate.equals(canonicalBytes(normalizeObserved(observation))))throw new Error(`BLOCKED_CELL_RESULT_IMMUTABLE: ${cellKey}`);
    return {state:'COMPLETE',decision:current.observation.decision,sha256:current.cell.resultSha256,skipped:true};
  }
  if(current.cell.state!=='IN_PROGRESS')throw new Error(`BLOCKED_CELL_STATE: ${cellKey} is ${current.cell.state}`);
  const assessment=assessSafety(observation);
  const envelope={schemaVersion:1,cellKey,observedAt:now(),syntheticTest:observation?.syntheticTest===true,decision:assessment.decision,reasons:assessment.reasons,observation:normalizeObserved(observation)};
  const relative=phaseRelative(phase,`cells/${cellKey}/observation.json`),result=writeImmutableDual(roots,relative,canonicalBytes(envelope),{write:writeImmutable});
  const ledger=state.ledger;ledger.cells[cellKey]={...ledger.cells[cellKey],state:'COMPLETE',resultSha256:result.sha256,decision:assessment.decision,completedAt:envelope.observedAt};
  if(assessment.decision==='FAIL')ledger.decision=`BLOCKED_UNSAFE_OBSERVATION:${cellKey}`;
  writeLedger(roots,phase,ledger,{write:writeMutable});
  return {state:'COMPLETE',decision:assessment.decision,reasons:assessment.reasons,sha256:result.sha256};
}
function markAmbiguous({roots,phase,cellKey,reason,now=()=>new Date().toISOString(),write=writeMutableFile}={}){
  const state=readPhaseLedger(roots,phase);if(!state)throw new Error('BLOCKED_PHASE_NOT_STARTED');
  const current=stateForCell(roots,phase,cellKey,{ledgerState:state});
  if(current.cell.state==='COMPLETE')throw new Error('cannot mark a complete cell ambiguous');
  state.ledger.cells[cellKey]={...current.cell,state:'AMBIGUOUS',reason:String(reason||'unknown error'),updatedAt:now()};
  state.ledger.decision=`AMBIGUOUS:${cellKey}`;writeLedger(roots,phase,state.ledger,{write});
  return state.ledger.cells[cellKey];
}
function finalizePhase({roots,phase,decision,summary={},now=()=>new Date().toISOString()}={}){
  const state=readPhaseLedger(roots,phase);if(!state)throw new Error('BLOCKED_PHASE_NOT_STARTED');
  const resultRel=phaseRelative(phase,'phase-result.json');
  const resultPaths=dualPaths(roots,resultRel);
  if([resultPaths.primary,resultPaths.secondary].some(fs.existsSync))return readFinal(roots,phase);
  const rows=[];
  for(const key of state.manifest.authorizedCellKeys){
    const row=stateForCell(roots,phase,key,{ledgerState:state});
    if(row.cell.state!=='COMPLETE')throw new Error(`BLOCKED_PHASE_INCOMPLETE: ${key} is ${row.cell.state}`);
    rows.push({cellKey:key,state:row.cell.state,decision:row.cell.decision,resultSha256:row.cell.resultSha256,observation:row.observation});
  }
  const computed=rows.every(row=>row.decision==='PASS')?'PASS':'FAIL';
  const finalDecision=decision||computed;
  if(computed==='FAIL'&&finalDecision==='PASS')throw new Error('BLOCKED_PHASE_DECISION: failed observations cannot finalize as PASS');
  const result={schemaVersion:1,issue:ISSUE,epoch:EPOCH,stage:roots.stage,phase,identity:state.manifest.identity,authorizationSha256:state.manifest.authorizationSha256,renderCount:state.ledger.renderCount,decision:finalDecision,summary,rows,finalizedAt:now()};
  const written=writeImmutableDual(roots,resultRel,canonicalBytes(result));
  const phaseRootPrimary=path.join(roots.primary,'phases',phase),phaseRootSecondary=path.join(roots.secondary,'phases',phase);
  const metadata={creatorRevision:state.manifest.creatorCommit,executionId:state.manifest.candidateId,generation:EPOCH,runnerSha256:state.manifest.runnerSha256,helperSha256:state.manifest.captureHelperSha256,wasmSha256:state.manifest.primaryWasmSha256||state.manifest.wasmSha256,startedAt:state.manifest.createdAt,finalizedAt:result.finalizedAt,decision:finalDecision,phaseResultSha256:written.sha256,authorizationSha256:state.manifest.authorizationSha256};
  durable.writeFinalizedManifest({primaryRoot:phaseRootPrimary,secondaryRoot:phaseRootSecondary,metadata,artifactRoles:{'phase-result.json':'phase-result','manifest.json':'phase-manifest','ledger.json':'phase-ledger'},now});
  const archive=durable.createPhaseArchive({primaryRoot:phaseRootPrimary,secondaryRoot:phaseRootSecondary,phase});
  return {result,sha256:written.sha256,archiveSha256:archive.sha256};
}
function readFinal(roots,phase){
  const result=readDualBytes(roots,phaseRelative(phase,'phase-result.json'));
  const primary=path.join(roots.primary,'phases',phase),secondary=path.join(roots.secondary,'phases',phase);
  const manifest=durable.verifyDualCopy(path.join(primary,'evidence-manifest.json'),path.join(secondary,'evidence-manifest.json'));
  const manifestHash=manifest.sha256+'\n';
  if(fs.readFileSync(path.join(primary,'evidence-manifest.sha256'),'utf8')!==manifestHash||fs.readFileSync(path.join(secondary,'evidence-manifest.sha256'),'utf8')!==manifestHash)throw new Error('BLOCKED_EVIDENCE_MANIFEST_IMMUTABLE: manifest checksum mismatch');
  const parsed=JSON.parse(manifest.bytes.toString('utf8'));
  if(parsed.phaseResultSha256!==result.sha256)throw new Error('BLOCKED_EVIDENCE_MANIFEST_IMMUTABLE: phase result hash mismatch');
  const archive=durable.verifyDualCopy(path.join(primary,'archives',`${phase}.tar.gz`),path.join(secondary,'archives',`${phase}.tar.gz`));
  return {result:JSON.parse(result.bytes.toString('utf8')),sha256:result.sha256,manifest:parsed,manifestSha256:manifest.sha256,archiveSha256:archive.sha256};
}
function readAuthorization(root=ROOT,{path:overridePath}={}){
  const file=overridePath||path.join(root,'.agent-state/issues/7/current-build-v1/authorization.json');
  if(!fs.existsSync(file))return null;
  const resolved=path.resolve(file);assertNoSymlinkComponents(fs.realpathSync(root),resolved);
  if(fs.lstatSync(resolved).isSymbolicLink())throw new Error('BLOCKED_AUTHORIZATION: symlink authorization file');
  const bytes=fs.readFileSync(resolved);
  return {authorization:JSON.parse(bytes.toString('utf8')),bytes,sha256:sha256(bytes),path:resolved};
}
function commentIdFromUrl(url){
  const match=String(url||'').match(/^https:\/\/github\.com\/puchinya\/soraoto_dsl\/issues\/7#issuecomment-(\d+)$/);
  if(!match)throw new Error('AUTHORIZATION_REQUIRED: approval must link to an exact Issue #7 comment');
  return match[1];
}
function cellSetSha256(cells){return sha256(Buffer.from([...cells].map(String).sort().join('\n'),'utf8'));}
function executionIdentityProjection(value){
  if(Array.isArray(value))return value.map(executionIdentityProjection);
  if(value&&typeof value==='object'){
    const buildArtifact=typeof value.cmakeCacheSha256==='string'&&typeof value.wasmSha256==='string';
    return Object.fromEntries(Object.keys(value).sort().filter(key=>!(buildArtifact&&key==='flags'))
      .map(key=>[key,executionIdentityProjection(value[key])]));
  }
  return value;
}
function makeExecutionIdentity({stage,phase,cells,renderBudget,prHeadSha,identity}={}){
  const validStagePhase=(stage==='stage3e'&&PHASES.includes(phase)&&!['stage3','stage4'].includes(phase))
    ||(stage==='stage3'&&phase==='stage3')||(stage==='stage4'&&phase==='stage4');
  if(!validStagePhase||!Array.isArray(cells)||!Number.isSafeInteger(renderBudget)
    ||renderBudget<=0||renderBudget!==cells.length||!identity||typeof identity!=='object'||Array.isArray(identity))
    throw new Error('AUTHORIZATION_REQUIRED: complete execution identity inputs are required');
  if(!/^[a-f0-9]{40}$/.test(prHeadSha||''))throw new Error('AUTHORIZATION_REQUIRED: exact PR HEAD SHA is required');
  return stable({schemaVersion:1,issue:ISSUE,epoch:EPOCH,stage,phase,prHeadSha,contractSha256:CONTRACT_SHA256,
    cellSetSha256:cellSetSha256(cells),renderBudget,identity:executionIdentityProjection(identity)});
}
function executionIdentitySha256(identity){return sha256(canonicalBytes(identity));}
function executionIdentityMarker(identity){return `<!-- issue7-execution-identity-v1:${canonicalBytes(identity).toString('base64url')} -->`;}
function readExecutionIdentityPlan(planBody){
  const markers=[...String(planBody||'').matchAll(/<!-- issue7-execution-identity-v1:([A-Za-z0-9_-]+) -->/g)];
  if(markers.length!==1)throw new Error('AUTHORIZATION_REQUIRED: plan must contain exactly one canonical execution identity');
  let bytes,identity;
  try{bytes=Buffer.from(markers[0][1],'base64url');identity=JSON.parse(bytes.toString('utf8'));}
  catch{throw new Error('AUTHORIZATION_REQUIRED: plan execution identity is not valid canonical JSON');}
  if(bytes.toString('base64url')!==markers[0][1]||!bytes.equals(canonicalBytes(identity)))
    throw new Error('AUTHORIZATION_REQUIRED: plan execution identity encoding is not canonical');
  return identity;
}
function gitHead(root=ROOT){return execFileSync('rtk',['git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}
function expectedApprovalStatement({stage,phase,cells,renderBudget,planCommentId,executionIdentitySha256:identitySha}={}){
  if(!/^\d+$/.test(String(planCommentId||''))||! /^[a-f0-9]{64}$/.test(identitySha||''))
    throw new Error('AUTHORIZATION_REQUIRED: exact plan comment ID and execution identity digest are required');
  return `APPROVED: Issue #7 ${EPOCH} ${stage}/${phase}; planCommentId=${planCommentId}; executionIdentitySha256=${identitySha}; budget=${renderBudget}; cellSetSha256=${cellSetSha256(cells)}; contractSha256=${CONTRACT_SHA256}`;
}
function readGitHubApproval({root=ROOT,planCommentUrl,approvalCommentUrl}={}){
  const runGh=args=>execFileSync('rtk',['gh',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  try{
    const authenticatedLogin=JSON.parse(runGh(['api','user'])).login;
    const ids=[...new Set([commentIdFromUrl(planCommentUrl),commentIdFromUrl(approvalCommentUrl)])];
    const comments={};
    for(const id of ids)comments[id]=JSON.parse(runGh(['api',`repos/${REPOSITORY}/issues/comments/${id}`]));
    return {authenticatedLogin,comments};
  }catch(error){
    throw new Error(`AUTHORIZATION_REQUIRED: GitHub approval readback failed: ${error.message}`);
  }
}
function validateAuthorization(authorization,{stage,phase,cells,renderBudget,allowSynthetic=false}={}){
  if(!authorization)throw new Error('AUTHORIZATION_REQUIRED: no Issue #7 approval record is present');
  if(authorization.synthetic===true){
    if(!allowSynthetic||authorization.label!=='SYNTHETIC TEST')throw new Error('AUTHORIZATION_REQUIRED: synthetic test approval is not valid for execution');
    if(authorization.issue!==ISSUE||authorization.epoch!==EPOCH||authorization.stage!==stage||authorization.phase!==phase)throw new Error('AUTHORIZATION_REQUIRED: synthetic test scope mismatch');
    return {sha256:sha256(canonicalBytes(authorization)),syntheticTest:true};
  }
  if(authorization.issue!==ISSUE||authorization.epoch!==EPOCH||authorization.contractSha256!==CONTRACT_SHA256||authorization.stage!==stage||authorization.phase!==phase)throw new Error('AUTHORIZATION_REQUIRED: approval scope does not match Issue #7 phase');
  commentIdFromUrl(authorization.approvalCommentUrl);
  commentIdFromUrl(authorization.planCommentUrl);
  if(!/^[a-f0-9]{64}$/.test(authorization.planCommentSha256||''))throw new Error('AUTHORIZATION_REQUIRED: plan comment SHA-256 is missing');
  if(!/^[a-f0-9]{64}$/.test(authorization.approvalCommentSha256||''))throw new Error('AUTHORIZATION_REQUIRED: approval comment SHA-256 is missing');
  if(!/^[a-f0-9]{64}$/.test(authorization.executionIdentitySha256||''))throw new Error('AUTHORIZATION_REQUIRED: approved execution identity SHA-256 is missing');
  if(!Array.isArray(authorization.authorizedCellKeys)||!Array.isArray(cells))throw new Error('AUTHORIZATION_REQUIRED: approved cells are missing');
  if(!same(authorization.authorizedCellKeys,[...cells].sort())||authorization.maxCalls!==renderBudget||renderBudget!==cells.length)throw new Error('AUTHORIZATION_REQUIRED: authorized coordinates or exact call budget differ');
  if(!Number.isSafeInteger(authorization.approvedAtEpochMs)||authorization.approvedAtEpochMs<=0)throw new Error('AUTHORIZATION_REQUIRED: approval timestamp is missing');
  return {sha256:sha256(canonicalBytes(authorization)),syntheticTest:false};
}
function verifyAndPersistAuthorization(authorization,{roots,stage,phase,cells,renderBudget,executionIdentity,executionIdentityNow,
  readback=readGitHubApproval,now=()=>new Date().toISOString()}={}){
  const validated=validateAuthorization(authorization,{stage,phase,cells,renderBudget,allowSynthetic:true});
  if(validated.syntheticTest)return validated;
  if(!roots)throw new Error('AUTHORIZATION_REQUIRED: canonical evidence roots are required before execution');
  if(!executionIdentity||typeof executionIdentityNow!=='function')
    throw new Error('AUTHORIZATION_REQUIRED: actual execution identity and readback-time identity verifier are required');
  const expectedExecutionIdentity=makeExecutionIdentity({stage,phase,cells,renderBudget,
    prHeadSha:executionIdentity.prHeadSha,identity:executionIdentity.identity});
  if(!same(expectedExecutionIdentity,executionIdentity))throw new Error('AUTHORIZATION_REQUIRED: execution identity scope is not canonical');
  const expectedIdentitySha=executionIdentitySha256(expectedExecutionIdentity);
  if(authorization.executionIdentitySha256!==expectedIdentitySha)
    throw new Error('AUTHORIZATION_REQUIRED: authorization does not bind the actual execution identity digest');
  const planId=commentIdFromUrl(authorization.planCommentUrl),approvalId=commentIdFromUrl(authorization.approvalCommentUrl);
  let data;
  try{data=readback({root:ROOT,planCommentUrl:authorization.planCommentUrl,approvalCommentUrl:authorization.approvalCommentUrl});}
  catch(error){throw new Error(`AUTHORIZATION_REQUIRED: ${error.message}`);}
  const plan=data?.comments?.[planId],approval=data?.comments?.[approvalId],login=data?.authenticatedLogin;
  const validComment=(comment,url)=>comment&&comment.html_url===url&&comment.issue_url===`https://api.github.com/repos/${REPOSITORY}/issues/7`
    &&comment.updated_at===comment.created_at&&comment.user?.login===APPROVER_LOGIN&&comment.user.login===login;
  if(login!==APPROVER_LOGIN||!validComment(plan,authorization.planCommentUrl)||!validComment(approval,authorization.approvalCommentUrl))
    throw new Error('AUTHORIZATION_REQUIRED: GitHub approval author, issue, URL, or immutable timestamp does not match');
  const planBody=typeof plan.body==='string'?plan.body:'',approvalBody=typeof approval.body==='string'?approval.body:'';
  const planSha=sha256(Buffer.from(planBody,'utf8')),approvalSha=sha256(Buffer.from(approvalBody,'utf8'));
  let currentExecutionIdentity;
  try{currentExecutionIdentity=executionIdentityNow();}
  catch(error){throw new Error(`AUTHORIZATION_REQUIRED: execution identity changed or became unavailable during GitHub readback: ${error.message}`);}
  if(!same(currentExecutionIdentity,expectedExecutionIdentity))
    throw new Error('AUTHORIZATION_REQUIRED: current execution identity changed during GitHub readback');
  const planIdentity=readExecutionIdentityPlan(planBody),expectedCellSha=cellSetSha256(cells);
  const expectedStatement=expectedApprovalStatement({stage,phase,cells,renderBudget,planCommentId:planId,executionIdentitySha256:expectedIdentitySha});
  if(planSha!==authorization.planCommentSha256||!same(planIdentity,expectedExecutionIdentity)
    ||!planBody.includes(`cellSetSha256=${expectedCellSha}`)||!planBody.includes(`executionIdentitySha256=${expectedIdentitySha}`))
    throw new Error('AUTHORIZATION_REQUIRED: immutable plan does not bind the exact execution identity and authorized cell set');
  if(approvalSha!==authorization.approvalCommentSha256||!approvalBody.includes(expectedStatement))
    throw new Error('AUTHORIZATION_REQUIRED: approval comment body or SHA does not match the exact plan comment, execution identity, phase, budget, and cell set');
  const createdAt=Date.parse(approval.created_at),planCreatedAt=Date.parse(plan.created_at),approvedAt=authorization.approvedAtEpochMs;
  if(!Number.isFinite(createdAt)||!Number.isFinite(planCreatedAt)||createdAt<planCreatedAt||createdAt!==approvedAt)
    throw new Error('AUTHORIZATION_REQUIRED: approval timestamp is absent, stale, or does not match GitHub');
  const attestationBase={schemaVersion:1,issue:ISSUE,epoch:EPOCH,contractSha256:CONTRACT_SHA256,stage,phase,
    approverLogin:login,authenticatedLogin:login,planCommentUrl:authorization.planCommentUrl,planCommentSha256:planSha,
    approvalCommentUrl:authorization.approvalCommentUrl,approvalCommentSha256:approvalSha,approvalStatement:expectedStatement,
    planCommentId:planId,executionIdentitySha256:expectedIdentitySha,executionIdentity:expectedExecutionIdentity,
    authorizedCellKeys:[...cells].sort(),cellSetSha256:expectedCellSha,renderBudget,approvedAtEpochMs:createdAt,
    planCreatedAt:plan.created_at,approvalCreatedAt:approval.created_at};
  const relative=`authorizations/${stage}-${phase}.attestation.json`,paths=dualPaths(roots,relative);
  const any=[paths.primary,paths.secondary].some(fs.existsSync);
  let stored,attestation,bytes;
  if(any){
    stored=readDualBytes(roots,relative);
    const prior=JSON.parse(stored.bytes.toString('utf8')),{verifiedAt,...priorBase}=prior;
    if(!same(priorBase,attestationBase)||typeof verifiedAt!=='string'||!Number.isFinite(Date.parse(verifiedAt)))
      throw new Error('AUTHORIZATION_REQUIRED: immutable approval attestation differs from GitHub readback');
    attestation={...attestationBase,verifiedAt};bytes=stored.bytes;
  }else{
    attestation={...attestationBase,verifiedAt:now()};bytes=canonicalBytes(attestation);
    stored=writeImmutableDual(roots,relative,bytes);
  }
  return {sha256:stored.sha256,syntheticTest:false,attestation,attestationSha256:stored.sha256,executionIdentitySha256:expectedIdentitySha};
}
function lockPath(commonDirectory,epoch=EPOCH){
  if(epoch!==EPOCH)throw new Error('BLOCKED_EPOCH');
  return path.join(commonDirectory,'soraoto-agent-state',String(ISSUE),'locks',`${epoch}.writer.lock`);
}
function withWriterLock({commonDirectory,ownerId=crypto.randomUUID(),now=()=>new Date().toISOString(),hostname=os.hostname()}={},action){
  if(typeof action!=='function')throw new Error('writer lock action is required');
  const common=fs.realpathSync(commonDirectory),file=lockPath(common),owner={schemaVersion:1,issue:ISSUE,epoch:EPOCH,ownerId:String(ownerId),token:crypto.randomUUID(),pid:process.pid,hostname,createdAt:now()};
  makeDirChain(common,path.dirname(file));
  let fd;
  try{fd=fs.openSync(file,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw new Error('BLOCKED_WRITER_LOCK: another worktree owns the Issue #7 current-build-v1 writer lock');throw error;}
  try{fs.writeSync(fd,canonicalBytes(owner));fs.fsyncSync(fd);}finally{fs.closeSync(fd);fd=undefined;}
  try{
    const result=action(owner);
    if(result&&typeof result.then==='function')throw new Error('writer lock action must be synchronous');
    return result;
  }finally{
    const current=JSON.parse(fs.readFileSync(file,'utf8'));
    if(current.token!==owner.token||current.ownerId!==owner.ownerId)throw new Error('BLOCKED_WRITER_LOCK_OWNER: lock owner changed; refusing to release');
    fs.unlinkSync(file);
  }
}

module.exports={ROOT,ISSUE,EPOCH,CONTRACT_SHA256,STAGES,PHASES,sha256,stable,canonicalBytes,same,safePart,inside,
  assertNoSymlinkComponents,makeDirChain,resolveRoots,checkedRelative,dualPaths,writeImmutableFile,writeImmutableDual,
  writeMutableFile,writeMutableDual,readDualBytes,readDualJson,parseCache,hashInputs,checkFrozenIdentity,
  phaseRelative,initializePhase,readPhaseLedger,readCell,startCell,completeCell,markAmbiguous,normalizeObserved,
  assessSafety,finalizePhase,readFinal,readAuthorization,commentIdFromUrl,cellSetSha256,executionIdentityProjection,makeExecutionIdentity,
  executionIdentitySha256,executionIdentityMarker,readExecutionIdentityPlan,gitHead,expectedApprovalStatement,
  readGitHubApproval,validateAuthorization,verifyAndPersistAuthorization,lockPath,withWriterLock};
