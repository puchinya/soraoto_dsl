'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const metrics=require('./stage3-direct-reference-metrics.cjs');

const ROOT=path.resolve(__dirname,'../../../../../../');
const ISSUE=7,EPOCH='current-build-v2/treble-hardness-v1',NAMESPACE='treble-hardness-v2';
const R9_SHA256='14a5b051436b3266ae30b2d847bd70e96a4506b8a01f46fdb09f802f39764ac9';
const OLD_CALLS=2857,MAX_CALLS=4978,SCREEN_GAIN_OFFSET_DB=15.7420375;
const EQUIVALENCE=Object.freeze([[66,40],[78,45],[90,49],[96,77],[99,101],[108,117]].map(([pitch,velocity])=>Object.freeze({pitch,velocity})));
const SCREEN_T=Object.freeze([0.5,1.0,1.5,2.0]);
const SCREEN_PITCHES=Object.freeze([66,72,78,84,90,93,96,99,102,108]);
const SCREEN_VELOCITIES=Object.freeze([14,31,36,61,124]);
const STAGES=Object.freeze({equivalence:12,screen:200,stage3:486,stage4:1423});
const MUST_HAVE_DIRS=Object.freeze(['runtime-revisions','equivalence','screen','stage3','stage4','journal','artifacts']);

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function inside(parent,target){const r=path.relative(parent,target);return r===''||(!r.startsWith(`..${path.sep}`)&&r!=='..'&&!path.isAbsolute(r));}
function assertNoSymlink(base,target){
  const anchor=path.resolve(base),absolute=path.resolve(target);if(!inside(anchor,absolute))throw new Error('BLOCKED_V2_ROOT_ESCAPE');
  let at=anchor;for(const part of path.relative(anchor,absolute).split(path.sep).filter(Boolean)){at=path.join(at,part);try{const st=fs.lstatSync(at);if(st.isSymbolicLink())throw new Error(`BLOCKED_V2_SYMLINK: ${at}`);if(at!==absolute&&!st.isDirectory())throw new Error(`BLOCKED_V2_PATH: ${at}`);}catch(e){if(e.code==='ENOENT')break;throw e;}}
  if(fs.existsSync(absolute)&&fs.realpathSync(absolute)!==absolute)throw new Error(`BLOCKED_V2_SYMLINK: ${absolute}`);return absolute;
}
function resolveRoots(root=ROOT,home=os.homedir(),commonDirectory){
  const repo=fs.realpathSync(path.resolve(root)),common=fs.realpathSync(path.resolve(commonDirectory||execFileSync('rtk',['git','rev-parse','--path-format=absolute','--git-common-dir'],{cwd:repo,encoding:'utf8'}).trim())),homePath=fs.realpathSync(path.resolve(home));
  const repository=path.basename(repo),baseA=path.join(common,'soraoto-agent-state',String(ISSUE),NAMESPACE),baseB=path.join(homePath,'.soraoto-agent-archive',repository,String(ISSUE),NAMESPACE);
  const suffix=EPOCH.split('/');const primary=path.join(baseA,...suffix),secondary=path.join(baseB,...suffix);
  assertNoSymlink(common,primary);assertNoSymlink(homePath,secondary);
  if(inside(primary,secondary)||inside(secondary,primary))throw new Error('BLOCKED_V2_ROOT_OVERLAP');
  return {primary,secondary,baseA,baseB,commonDirectory:common,home:homePath,repository,epoch:EPOCH};
}
function ensureDir(base,target){
  const basePath=path.resolve(base),absolute=path.resolve(target);if(!inside(basePath,absolute))throw new Error('BLOCKED_V2_ROOT_ESCAPE');
  let anchor=basePath;while(!fs.existsSync(anchor)){const parent=path.dirname(anchor);if(parent===anchor)throw new Error('BLOCKED_V2_ROOT_ANCHOR');anchor=parent;}
  if(fs.realpathSync(anchor)!==anchor)throw new Error(`BLOCKED_V2_SYMLINK: ${anchor}`);
  let at=anchor;for(const part of path.relative(anchor,absolute).split(path.sep).filter(Boolean)){at=path.join(at,part);try{const st=fs.lstatSync(at);if(st.isSymbolicLink()||!st.isDirectory())throw new Error(`BLOCKED_V2_UNSAFE_DIRECTORY: ${at}`);}catch(e){if(e.code!=='ENOENT')throw e;fs.mkdirSync(at,{mode:0o700});}}
  return absolute;
}
function dualPath(roots,relative){if(!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))throw new Error('BLOCKED_V2_RELATIVE_PATH');return {a:assertNoSymlink(roots.primary,path.join(roots.primary,relative)),b:assertNoSymlink(roots.secondary,path.join(roots.secondary,relative))};}
function readDual(roots,relative){
  const {a,b}=dualPath(roots,relative),ea=fs.existsSync(a),eb=fs.existsSync(b);if(ea!==eb)throw new Error(`BLOCKED_V2_PARTIAL_DUAL_COPY: ${relative}`);if(!ea)return null;
  const x=fs.readFileSync(a),y=fs.readFileSync(b);if(!x.equals(y))throw new Error(`BLOCKED_V2_DIVERGENT_DUAL_COPY: ${relative}`);return {bytes:x,sha256:sha256(x),size:x.length};
}
function writeFileExclusive(file,bytes,base){ensureDir(base,path.dirname(file));let fd;try{fd=fs.openSync(file,'wx',0o600);let n=0;while(n<bytes.length)n+=fs.writeSync(fd,bytes,n,bytes.length-n);fs.fsyncSync(fd);}catch(e){if(e.code!=='EEXIST')throw e;const old=fs.readFileSync(file);if(!old.equals(bytes))throw new Error(`BLOCKED_V2_IMMUTABLE_CONFLICT: ${file}`);}finally{if(fd!==undefined)fs.closeSync(fd);}}
function writeImmutableDual(roots,relative,data){const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);const {a,b}=dualPath(roots,relative),old=readDual(roots,relative);if(old){if(!old.bytes.equals(bytes))throw new Error(`BLOCKED_V2_IMMUTABLE_CONFLICT: ${relative}`);return old;}writeFileExclusive(a,bytes,roots.primary);writeFileExclusive(b,bytes,roots.secondary);const read=readDual(roots,relative);if(!read.bytes.equals(bytes))throw new Error(`BLOCKED_V2_READBACK: ${relative}`);return read;}
function writeMutableDual(roots,relative,data){
  const bytes=Buffer.isBuffer(data)?data:Buffer.from(data),{a,b}=dualPath(roots,relative),old=readDual(roots,relative);if(old?.bytes.equals(bytes))return old;
  for(const [file,base] of [[a,roots.primary],[b,roots.secondary]]){ensureDir(base,path.dirname(file));const tmp=`${file}.tmp-${process.pid}-${crypto.randomUUID()}`;const fd=fs.openSync(tmp,'wx',0o600);try{let n=0;while(n<bytes.length)n+=fs.writeSync(fd,bytes,n,bytes.length-n);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);}
  const read=readDual(roots,relative);if(!read.bytes.equals(bytes))throw new Error(`BLOCKED_V2_READBACK: ${relative}`);return read;
}
function readJson(roots,relative,required=true){const file=readDual(roots,relative);if(!file){if(required)throw new Error(`BLOCKED_V2_MISSING: ${relative}`);return null;}return JSON.parse(file.bytes.toString('utf8'));}
function writeJson(roots,relative,value,immutable=false){const bytes=jsonBytes(value);return immutable?writeImmutableDual(roots,relative,bytes):writeMutableDual(roots,relative,bytes);}
function exactCells(cells,count,label){if(!Array.isArray(cells)||cells.length!==count)throw new Error(`BLOCKED_V2_PLAN_COUNT: ${label}`);if(cells.some(c=>!Number.isFinite(c.pitch)||!Number.isFinite(c.velocity)||(c.T!==undefined&&!SCREEN_T.includes(c.T))))throw new Error(`BLOCKED_V2_PLAN_CELL_INVALID: ${label}`);const keys=cells.map(cellKey);if(keys.some(k=>!k)||new Set(keys).size!==count)throw new Error(`BLOCKED_V2_PLAN_DUPLICATE: ${label}`);return cells;}
function cellKey(cell){return `${String(cell.kind||'cell')}:${Number(cell.pitch)}:${Number(cell.velocity)}${cell.T===undefined?'':`:${Number(cell.T)}`}`;}
function makeEquivalenceCells(){return EQUIVALENCE.flatMap(cell=>['production','diagnostic'].map(binary=>({...cell,kind:binary})));}
function makeScreenCells(){return SCREEN_T.flatMap(T=>SCREEN_PITCHES.flatMap(pitch=>SCREEN_VELOCITIES.map(velocity=>({kind:'screen',T,pitch,velocity}))));}
function canonicalStage3Cells(evaluator){return evaluator.CELL_SPECS.map(cell=>({...cell,kind:cell.kind||'direct'}));}
function canonicalStage4Cells(capture){return capture.LIFECYCLE_CELLS.map(cell=>({...cell,kind:'lifecycle'})).concat(capture.REPEAT_CELLS.map(cell=>({...cell,kind:'repeat'})));}
function makePlan(stage,{identity,cells,createdAt=new Date().toISOString()}={}){
  const count=STAGES[stage];if(!count)throw new Error(`BLOCKED_V2_STAGE: ${stage}`);exactCells(cells,count,stage);
  return {schemaVersion:1,issue:ISSUE,epoch:EPOCH,stage,createdAt,identity,cells};
}
function freshLedger(plan){const items={};for(const cell of plan.cells){const key=cellKey(cell);items[key]={state:'PENDING',cell,marker:`start-markers/${encodeURIComponent(key)}.json`,result:`cells/${encodeURIComponent(key)}.json`,sha256:null};}return {schemaVersion:1,stage:plan.stage,planSha256:sha256(jsonBytes(plan)),identity:plan.identity,authorizedCellCount:plan.cells.length,accounting:{charged:0},cells:items};}
function counts(ledger){return Object.fromEntries(['PENDING','IN_PROGRESS','COMPLETE','AMBIGUOUS'].map(state=>[state,Object.values(ledger.cells).filter(c=>c.state===state).length]));}
function saveLedger(roots,ledger){return writeJson(roots,`${ledger.stage}/ledger.json`,ledger,false);}
function assertLedger(roots,plan,ledger){
  if(ledger.planSha256!==sha256(jsonBytes(plan))||!same(ledger.identity,plan.identity)||ledger.authorizedCellCount!==plan.cells.length||Object.keys(ledger.cells||{}).length!==plan.cells.length)throw new Error('BLOCKED_V2_LEDGER_IDENTITY');
  const history=journalRows(roots).eventsById;
  for(const cell of plan.cells){const id=cellKey(cell),item=ledger.cells[id];if(!item||!same(item.cell,cell)||item.result!==`cells/${encodeURIComponent(id)}.json`||item.marker!==`start-markers/${encodeURIComponent(id)}.json`)throw new Error(`BLOCKED_V2_LEDGER_CELL_IDENTITY: ${id}`);}
  for(const [id,item] of Object.entries(ledger.cells)){const marker=readDual(roots,`${plan.stage}/${item.marker}`),result=readDual(roots,`${plan.stage}/${item.result}`);
    const start=history.get(`start:${plan.stage}:${id}`),complete=history.get(`complete:${plan.stage}:${id}`);
    if(item.state==='PENDING'&&(marker||result||start||complete))throw new Error(`BLOCKED_V2_ORPHAN_CELL_EVIDENCE: ${id}`);
    if(item.state==='IN_PROGRESS'||item.state==='AMBIGUOUS')throw new Error(`BLOCKED_V2_AMBIGUOUS_CELL: ${id}`);
    if(item.state==='COMPLETE'&&(!marker||!result||result.sha256!==item.sha256||start?.type!=='render-start'||!same(start.cell,item.cell)||complete?.type!=='cell-complete'||!same(complete.cell,item.cell)||complete.sha256!==item.sha256))throw new Error(`BLOCKED_V2_CELL_BINDING: ${id}`);
    if(!['PENDING','IN_PROGRESS','COMPLETE','AMBIGUOUS'].includes(item.state))throw new Error(`BLOCKED_V2_CELL_STATE: ${id}`);
  }
  if(ledger.accounting?.charged!==counts(ledger).COMPLETE+counts(ledger).IN_PROGRESS+counts(ledger).AMBIGUOUS)throw new Error('BLOCKED_V2_ACCOUNTING');return counts(ledger);
}
function startCell(roots,plan,ledger,cell,{now=()=>new Date().toISOString(),ownerId}={}){
  const id=cellKey(cell),item=ledger.cells[id];if(!item||!same(item.cell,cell))throw new Error(`BLOCKED_V2_UNPLANNED_CELL: ${id}`);if(item.state!=='PENDING')throw new Error(`BLOCKED_V2_NO_RERENDER: ${id}:${item.state}`);
  if(OLD_CALLS+ledger.accounting.charged+1>MAX_CALLS)throw new Error('BLOCKED_V2_BUDGET');
  const marker={schemaVersion:1,stage:plan.stage,cell,ownerId,pid:process.pid,hostname:os.hostname(),startedAt:now(),charge:1};
  writeImmutableDual(roots,`${plan.stage}/${item.marker}`,jsonBytes(marker));item.state='IN_PROGRESS';item.startedAt=marker.startedAt;ledger.accounting.charged++;saveLedger(roots,ledger);appendJournal(roots,{eventId:`start:${plan.stage}:${id}`,type:'render-start',stage:plan.stage,cell,ownerId,at:marker.startedAt});
  return item;
}
function completeCell(roots,plan,ledger,cell,row,{now=()=>new Date().toISOString()}={}){
  const id=cellKey(cell),item=ledger.cells[id];if(!item||item.state!=='IN_PROGRESS')throw new Error(`BLOCKED_V2_CELL_NOT_STARTED: ${id}`);
  const data={schemaVersion:1,stage:plan.stage,cell,identity:plan.identity,row,capturedAt:now()},stored=writeImmutableDual(roots,`${plan.stage}/${item.result}`,jsonBytes(data));
  item.state='COMPLETE';item.sha256=stored.sha256;item.completedAt=data.capturedAt;saveLedger(roots,ledger);appendJournal(roots,{eventId:`complete:${plan.stage}:${id}`,type:'cell-complete',stage:plan.stage,cell,sha256:stored.sha256,at:item.completedAt});return stored;
}
function appendJournal(roots,event){
  const rel='journal/transitions.jsonl',{a,b}=dualPath(roots,rel),prior=readDual(roots,rel);const text=Buffer.from(JSON.stringify(event)+'\n');if(prior){for(const line of prior.bytes.toString('utf8').trimEnd().split('\n')){const old=JSON.parse(line);if(old.eventId===event.eventId)throw new Error(`BLOCKED_V2_DUPLICATE_EVENT: ${event.eventId}`);}}
  for(const [file,base] of [[a,roots.primary],[b,roots.secondary]]){ensureDir(base,path.dirname(file));const fd=fs.openSync(file,'a',0o600);try{fs.writeSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  const result=readDual(roots,rel);if(!result.bytes.toString('utf8').endsWith(text.toString('utf8')))throw new Error('BLOCKED_V2_JOURNAL_READBACK');return result;
}
function journalRows(roots){const file=readDual(roots,'journal/transitions.jsonl');if(!file)return {events:[],eventsById:new Map(),sha256:null};const seen=new Set(),events=[];for(const line of file.bytes.toString('utf8').split('\n').filter(Boolean)){const event=JSON.parse(line);if(!event.eventId||seen.has(event.eventId))throw new Error('BLOCKED_V2_JOURNAL_DUPLICATE_OR_INVALID');seen.add(event.eventId);events.push(event);}return {events,eventsById:new Map(events.map(event=>[event.eventId,event])),sha256:file.sha256};}
function ensureJournalEvent(roots,event){const history=journalRows(roots),existing=history.eventsById.get(event.eventId);if(existing){if(!same(existing,event))throw new Error(`BLOCKED_V2_JOURNAL_EVENT_CONFLICT: ${event.eventId}`);return history.sha256;}return appendJournal(roots,event).sha256;}
function validateJournal(roots){const history=journalRows(roots);return {events:history.events.length,sha256:history.sha256};}
function compareValue(a,b,tolerance=1e-6,pathName='$'){
  if(typeof a==='number'&&typeof b==='number'){if(Number.isInteger(a)&&Number.isInteger(b))return a===b?null:{path:pathName,a,b};return Math.abs(a-b)<=tolerance?null:{path:pathName,a,b,delta:Math.abs(a-b)};}
  if(a===b)return null;if(a===null||b===null||typeof a!==typeof b)return {path:pathName,a,b};
  if(Array.isArray(a)||Array.isArray(b)){if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return {path:pathName,aLength:a?.length,bLength:b?.length};for(let i=0;i<a.length;i++){const error=compareValue(a[i],b[i],tolerance,`${pathName}[${i}]`);if(error)return error;}return null;}
  if(typeof a==='object'){const ak=Object.keys(a).sort(),bk=Object.keys(b||{}).sort();if(!same(ak,bk))return {path:pathName,aKeys:ak,bKeys:bk};for(const key of ak){const error=compareValue(a[key],b[key],tolerance,`${pathName}.${key}`);if(error)return error;}return null;}return {path:pathName,a,b};
}
function compareMetrics(a,b,tolerance=1e-6){return compareValue(a,b,tolerance);}
function evaluateScreenCandidate(T,referenceCells,measuredCells){
  if(!SCREEN_T.includes(T))throw new Error('BLOCKED_V2_SCREEN_T');if(measuredCells.length!==50)throw new Error('BLOCKED_V2_SCREEN_COVERAGE');
  const refs=new Map(referenceCells.map(c=>[`${c.pitch}:${c.velocity}`,c.metrics||c]));const actual=new Map(measuredCells.map(c=>[`${c.pitch}:${c.velocity}`,c.metrics||c]));const rows=[];
  for(const pitch of SCREEN_PITCHES)for(const velocity of SCREEN_VELOCITIES){const key=`${pitch}:${velocity}`,r=refs.get(key),m=actual.get(key);if(!r||!m)throw new Error(`BLOCKED_V2_SCREEN_MISSING: ${key}`);
    const envelopeValid=Array.isArray(m.envelopeDbfs)&&m.envelopeDbfs.length>=5&&m.envelopeDbfs.every(Number.isFinite),referenceValid=Array.isArray(r.envelopeDbfs)&&r.envelopeDbfs.length>=5&&r.envelopeDbfs.every(Number.isFinite),metricsValid=envelopeValid&&referenceValid&&Number.isFinite(m.spectralCentroidHz)&&m.spectralCentroidHz>0&&Number.isFinite(r.spectralCentroidHz)&&r.spectralCentroidHz>0&&Number.isFinite(m.above2kPowerRatio)&&m.above2kPowerRatio>=0&&Number.isFinite(r.above2kPowerRatio)&&r.above2kPowerRatio>=0;
    const levelErrorDb=metricsValid?m.envelopeDbfs[3]+SCREEN_GAIN_OFFSET_DB-r.envelopeDbfs[3]:NaN,centroidRatio=metricsValid?Math.max(m.spectralCentroidHz/r.spectralCentroidHz,r.spectralCentroidHz/m.spectralCentroidHz):NaN,above2kDelta=metricsValid?Math.abs(m.above2kPowerRatio-r.above2kPowerRatio):NaN,centroidComparable=metricsValid&&Math.max(m.above2kPowerRatio,r.above2kPowerRatio)>=metrics.LIMITS.centroidEnergyFloor,shape=metricsValid?metrics.postAttackShapeErrorDb(m,r):NaN,failures=[];
    if(m.finite!==true||!metricsValid)failures.push('finite');if(!Number.isFinite(m.peakDbfs)||m.peakDbfs>=0||!Number.isFinite(m.fullRenderPeakDbfs)||m.fullRenderPeakDbfs>=0)failures.push('peak');if(!Number.isInteger(m.outputGuardHits)||m.outputGuardHits!==0)failures.push('guard');if(!Number.isFinite(levelErrorDb)||Math.abs(levelErrorDb)>20)failures.push('directLevel');if(centroidComparable&&(!Number.isFinite(centroidRatio)||centroidRatio>8))failures.push('centroid');if(!Number.isFinite(above2kDelta)||above2kDelta>1)failures.push('above2k');if(!Number.isFinite(shape)||shape>10)failures.push('postAttack');if(measuredCells.some(c=>c.pitch===pitch&&c.velocity===velocity&&c.T!==undefined&&c.T!==T))failures.push('TIdentity');rows.push({pitch,velocity,levelErrorDb,centroidRatio,centroidComparable,above2kDelta,postAttackShapeErrorDb:shape,failures});}
  const pitchResults=[];for(const pitch of SCREEN_PITCHES){const byVelocity=Object.fromEntries(measuredCells.filter(c=>c.pitch===pitch).map(c=>[c.velocity,c.metrics||c]));const refByVelocity=Object.fromEntries(referenceCells.filter(c=>c.pitch===pitch).map(c=>[c.velocity,c.metrics||c]));const span=metrics.dynamicSpanMetrics([byVelocity[14].envelopeDbfs[3],byVelocity[124].envelopeDbfs[3]],[refByVelocity[14].envelopeDbfs[3],refByVelocity[124].envelopeDbfs[3]]);const direction=metrics.brightnessDirectionMetrics(byVelocity[14],byVelocity[124],refByVelocity[14],refByVelocity[124]);const failures=[];if(span.violationDb>0)failures.push('dynamicSpan');if(direction.fails)failures.push('brightnessDirection');pitchResults.push({pitch,...span,...direction,failures});}
  const residuals=rows.map(row=>Math.abs(row.levelErrorDb));return {schemaVersion:1,T,decision:rows.some(r=>r.failures.length)||pitchResults.some(r=>r.failures.length)?'SCREEN_FAIL':'SCREEN_PASS',coverage:rows.length,rows,pitchResults,score:{maxAbsoluteResidualDb:Math.max(...residuals),sumSquares:residuals.reduce((s,x)=>s+x*x,0),distanceFromOne:Math.abs(T-1),T}};
}
function selectScreenCandidate(results){const passing=results.filter(x=>x.decision==='SCREEN_PASS');passing.sort((a,b)=>a.score.maxAbsoluteResidualDb-b.score.maxAbsoluteResidualDb||a.score.sumSquares-b.score.sumSquares||a.score.distanceFromOne-b.score.distanceFromOne||a.T-b.T);return passing[0]||null;}
function assertSafety(row){const m=row?.metrics||row;if(m?.finite!==true||m.outputGuardHits!==0||!Number.isFinite(m.peakDbfs)||m.peakDbfs>=0||!Number.isFinite(m.fullRenderPeakDbfs)||m.fullRenderPeakDbfs>=0)throw new Error('BLOCKED_V2_UNSAFE_RENDER');return true;}
function revisionPaths(n){return [`runtime-revisions/R${n}.json`,`runtime-revisions/R${n}.accepted.json`,`runtime-revisions/R${n}.master-event.json`];}
function recordRuntimeRevision(roots,n,record){if(![10,11].includes(n))throw new Error('BLOCKED_V2_RUNTIME_REVISION_NUMBER');const [pathRecord,pathAccepted,pathMaster]=revisionPaths(n),existing=readDual(roots,pathRecord);if(existing&&!same(JSON.parse(existing.bytes.toString('utf8')),record))throw new Error(`BLOCKED_V2_RUNTIME_REVISION_CONFLICT: R${n}`);
  const stored=existing||writeImmutableDual(roots,pathRecord,jsonBytes(record)),accepted={schemaVersion:1,revisionNumber:n,runtimeRevisionSha256:stored.sha256,acceptedAt:record.createdAt},acceptedStored=writeImmutableDual(roots,pathAccepted,jsonBytes(accepted)),master={schemaVersion:1,eventId:`runtime-accepted-R${n}`,revisionNumber:n,runtimeRevisionSha256:stored.sha256,acceptanceSha256:acceptedStored.sha256,acceptedAt:accepted.acceptedAt},masterStored=writeImmutableDual(roots,pathMaster,jsonBytes(master));const journalEvent={schemaVersion:1,eventId:`runtime-accepted-R${n}`,type:'runtime-accepted',revisionNumber:n,runtimeRevisionSha256:stored.sha256,acceptanceSha256:acceptedStored.sha256,masterEventSha256:masterStored.sha256,at:accepted.acceptedAt};ensureJournalEvent(roots,journalEvent);return {runtimeRevisionSha256:stored.sha256,acceptanceSha256:acceptedStored.sha256,masterEventSha256:masterStored.sha256};}
function verifyRuntimeRevision(roots,n,expectedPrevious){const [r,a,m]=revisionPaths(n),record=readJson(roots,r),acceptance=readJson(roots,a),master=readJson(roots,m);const recordSha=sha256(jsonBytes(record)),acceptanceSha=sha256(jsonBytes(acceptance)),masterStored=readDual(roots,m),journalEvent={schemaVersion:1,eventId:`runtime-accepted-R${n}`,type:'runtime-accepted',revisionNumber:n,runtimeRevisionSha256:recordSha,acceptanceSha256:acceptanceSha,masterEventSha256:masterStored.sha256,at:acceptance.acceptedAt};if(record.revisionNumber!==n||record.previousRuntimeRevisionSha256!==expectedPrevious||acceptance.runtimeRevisionSha256!==recordSha||acceptance.revisionNumber!==n||master.runtimeRevisionSha256!==recordSha||master.acceptanceSha256!==acceptanceSha||master.eventId!==`runtime-accepted-R${n}`||!same(journalRows(roots).eventsById.get(journalEvent.eventId),journalEvent))throw new Error(`BLOCKED_V2_RUNTIME_LINEAGE_R${n}`);return {record,sha256:recordSha,acceptanceSha256:acceptanceSha,masterEvent:master};}
function acquireLocks(roots,ownerId){const files=[path.join(roots.primary,'journal/master.lock'),path.join(roots.secondary,'journal/master.lock')],token=crypto.randomUUID(),owner=jsonBytes({schemaVersion:1,epoch:EPOCH,ownerId,token,pid:process.pid,hostname:os.hostname(),createdAt:new Date().toISOString()});const held=[];try{for(let i=0;i<files.length;i++){const file=files[i],base=i===0?roots.primary:roots.secondary;writeFileExclusive(file,owner,base);held.push(file);const read=fs.readFileSync(file);if(!read.equals(owner))throw new Error('BLOCKED_V2_LOCK_READBACK');}return {token,release(){for(const file of held){const current=JSON.parse(fs.readFileSync(file,'utf8'));if(current.token!==token)throw new Error('BLOCKED_V2_LOCK_OWNER_CHANGED');fs.unlinkSync(file);}}};}catch(e){for(const file of held){try{if(JSON.parse(fs.readFileSync(file,'utf8')).token===token)fs.unlinkSync(file);}catch{}}throw new Error(`BLOCKED_V2_MASTER_LOCK: ${e.message}`);}}
function fileTreeSnapshot(root){if(!fs.existsSync(root))return null;const out=[];function walk(dir,rel=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,entry.name),name=rel?`${rel}/${entry.name}`:entry.name,st=fs.lstatSync(file);if(st.isSymbolicLink())throw new Error(`BLOCKED_V2_SYMLINK: ${file}`);out.push({path:name,type:entry.isDirectory()?'dir':'file',size:Number(st.size),mtimeNs:String(st.mtimeNs??BigInt(Math.round(st.mtimeMs*1e6))),sha256:entry.isFile()?sha256(fs.readFileSync(file)):null});if(entry.isDirectory())walk(file,name);}}walk(root);return out;}
function readOnlySnapshot(roots,fn){const before={primary:fileTreeSnapshot(roots.primary),secondary:fileTreeSnapshot(roots.secondary)};const result=fn();const after={primary:fileTreeSnapshot(roots.primary),secondary:fileTreeSnapshot(roots.secondary)};if(!same(before,after))throw new Error('BLOCKED_V2_READ_ONLY_MUTATION');return {result,before,after,builds:0,renders:0,writes:0,acousticRenders:0};}
function accountTotal(ledgers){return OLD_CALLS+ledgers.reduce((n,l)=>n+(l?.accounting?.charged||0),0);}
function validateJournalAndBudget(roots,ledgers){const journal=validateJournal(roots),total=accountTotal(ledgers);if(total>MAX_CALLS)throw new Error('BLOCKED_V2_BUDGET');return {journal,total,limit:MAX_CALLS,remaining:MAX_CALLS-total};}
function trebleGate(pitch,start,end){if(!(end>start))throw new Error('invalid treble zone');const key=Math.max(0,Math.min(1,(pitch-21)/87));const t=Math.max(0,Math.min(1,(key-start)/(end-start)));return t*t*(3-2*t);}

module.exports={ROOT,ISSUE,EPOCH,NAMESPACE,R9_SHA256,OLD_CALLS,MAX_CALLS,SCREEN_GAIN_OFFSET_DB,EQUIVALENCE,SCREEN_T,SCREEN_PITCHES,SCREEN_VELOCITIES,STAGES,MUST_HAVE_DIRS,
  sha256,jsonBytes,stable,same,inside,resolveRoots,assertNoSymlink,ensureDir,dualPath,readDual,writeImmutableDual,writeMutableDual,readJson,writeJson,exactCells,cellKey,makeEquivalenceCells,makeScreenCells,canonicalStage3Cells,canonicalStage4Cells,makePlan,freshLedger,counts,saveLedger,assertLedger,startCell,completeCell,appendJournal,validateJournal,compareValue,compareMetrics,evaluateScreenCandidate,selectScreenCandidate,assertSafety,revisionPaths,recordRuntimeRevision,verifyRuntimeRevision,acquireLocks,fileTreeSnapshot,readOnlySnapshot,accountTotal,validateJournalAndBudget,trebleGate};
