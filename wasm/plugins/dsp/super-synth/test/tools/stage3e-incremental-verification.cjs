'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const durable=require('./durable-evidence.cjs');
const evidencePaths=require('./stage3e-evidence-paths.cjs');

const CHECKPOINT_DIR='verification-checkpoints';
const CHECKPOINT_PREFIX='checkpoint-';
const CHECKPOINT_PATTERN=/^checkpoint-([0-9]{6})\.json$/;

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function jsonBytes(value){return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function safeRelative(value){return typeof value==='string'&&value.length>0&&!path.posix.isAbsolute(value)&&!value.includes('\\')&&!value.split('/').some(part=>!part||part==='.'||part==='..');}
function deltaKey(entry){return `${entry.type}:${entry.path}`;}
function compareDelta(a,b){return deltaKey(a).localeCompare(deltaKey(b));}

function fail(message){throw new Error(`BLOCKED_STAGE3E_VERIFICATION_CHECKPOINT: ${message}`);}

function resolveEvidencePath(root,relative){
  if(!safeRelative(relative))fail(`unsafe evidence path ${relative}`);
  const absolute=path.resolve(root,...relative.split('/'));
  const base=path.resolve(root);
  if(absolute!==base&&!absolute.startsWith(base+path.sep))fail(`evidence path escaped root ${relative}`);
  let current=base;
  for(const part of relative.split('/')){
    current=path.join(current,part);
    let stat;
    try{stat=fs.lstatSync(current);}catch(error){if(error.code==='ENOENT')fail(`missing evidence ${relative}`);throw error;}
    if(stat.isSymbolicLink())fail(`symlink evidence ${relative}`);
  }
  return absolute;
}

function verifyDeltaEntries({entries,phase,phaseRootRelative=phase,journalRootRelative='ledger-transition-journal',searchPrimary,searchSecondary,fromSequence,throughSequence,expectedCellCount}){
  if(!Array.isArray(entries))fail('deltaEvidenceEntries is not an array');
  const keys=new Set();let prior=null;const cellIds=new Set(),transitionSequences=[];
  for(const entry of entries){
    if(!entry||!['cell','journal'].includes(entry.type)||!safeRelative(entry.path)||
       !/^[0-9a-f]{64}$/.test(entry.sha256||'')||!Number.isSafeInteger(entry.sizeBytes)||entry.sizeBytes<0)
      fail('invalid delta entry schema');
    if(prior&&compareDelta(prior,entry)>=0)fail('delta entries are not in unique type:path order');
    prior=entry;const key=deltaKey(entry);if(keys.has(key))fail(`duplicate delta entry ${key}`);keys.add(key);
    if(entry.type==='cell'){
      const cellPrefix=`${phaseRootRelative}/cells/`,cellLeaf=entry.path.startsWith(cellPrefix)?entry.path.slice(cellPrefix.length):'';
      const match=cellLeaf.match(/^([A-Za-z0-9._-]+)\.json$/);
      if(!match||match[1]!==entry.cellId||entry.sequence!==undefined)fail(`invalid cell delta path ${entry.path}`);
      if(cellIds.has(entry.cellId))fail(`duplicate cell ${entry.cellId}`);cellIds.add(entry.cellId);
    }else{
      const journalPrefix=`${journalRootRelative}/`,leaf=entry.path.startsWith(journalPrefix)?entry.path.slice(journalPrefix.length):'';
      const transition=leaf.match(/^transition-([0-9]{6})\.json$/);
      const marker=leaf.match(/^render-start-([0-9]{6})\.json$/);
      if((!transition&&!marker)||!Number.isSafeInteger(entry.sequence)||entry.cellId!==undefined)
        fail(`invalid journal delta path ${entry.path}`);
      if(transition){const sequence=Number(transition[1]);if(entry.sequence!==sequence)fail(`transition sequence/path mismatch ${entry.path}`);transitionSequences.push(sequence);}
    }
    const p=resolveEvidencePath(searchPrimary,entry.path),s=resolveEvidencePath(searchSecondary,entry.path);
    const stored=durable.verifyDualCopy(p,s,entry.sha256);
    if(stored.sha256!==entry.sha256)fail(`delta SHA-256 mismatch ${entry.path}`);
    if(stored.bytes.length!==entry.sizeBytes)fail(`delta size mismatch ${entry.path}`);
    if(entry.type==='journal'&&entry.path.includes('/render-start-')){
      const marker=JSON.parse(stored.bytes.toString('utf8'));
      const markerPath=entry.path.match(/render-start-([0-9]{6})\.json$/);
      if(marker.transitionSequence!==entry.sequence||Number(markerPath?.[1])!==marker.sequence)fail(`render-start sequence mismatch ${entry.path}`);
    }
  }
  if(cellIds.size!==expectedCellCount)fail(`cell delta count ${cellIds.size} != ${expectedCellCount}`);
  transitionSequences.sort((a,b)=>a-b);
  if(transitionSequences.length){
    if(transitionSequences[0]!==fromSequence+1||transitionSequences.at(-1)!==throughSequence||
       transitionSequences.length!==throughSequence-fromSequence)
      fail('transition sequence range is discontinuous');
    for(let i=1;i<transitionSequences.length;i++)if(transitionSequences[i]!==transitionSequences[i-1]+1)fail('transition sequence gap');
  }else if(throughSequence!==fromSequence)fail('checkpoint sequence advanced without transition evidence');
  const expectedDigest=sha256(Buffer.from(JSON.stringify(entries),'utf8'));
  return {deltaEvidenceDigestSha256:expectedDigest,cellIds,transitionSequences};
}

function listCheckpointNames(phaseRootPrimary,phaseRootSecondary){
  const pDir=path.join(phaseRootPrimary,CHECKPOINT_DIR),sDir=path.join(phaseRootSecondary,CHECKPOINT_DIR);
  const pExists=fs.existsSync(pDir),sExists=fs.existsSync(sDir);
  if(pExists!==sExists)fail('checkpoint directory exists in only one store');
  if(!pExists)return [];
  if(!fs.lstatSync(pDir).isDirectory()||fs.lstatSync(pDir).isSymbolicLink()||!fs.lstatSync(sDir).isDirectory()||fs.lstatSync(sDir).isSymbolicLink())fail('checkpoint namespace is not a regular directory');
  const p=fs.readdirSync(pDir).sort(),s=fs.readdirSync(sDir).sort();
  if(!same(p,s))fail('checkpoint names differ between stores');
  for(const name of p)if(!CHECKPOINT_PATTERN.test(name))fail(`unrecognized checkpoint file ${name}`);
  return p;
}

function validateCheckpointChain({phase,executionId,searchRoots,phaseRoots,phaseRootRelative,journalRootRelative}={}){
  if(typeof phase!=='string'||!phase||typeof executionId!=='string'||!executionId||!searchRoots?.primary||!searchRoots?.secondary||!phaseRoots?.primary||!phaseRoots?.secondary)
    fail('checkpoint chain inputs missing');
  phaseRootRelative=phaseRootRelative||path.relative(searchRoots.primary,phaseRoots.primary).split(path.sep).join('/');
  journalRootRelative=journalRootRelative||(phase==='low'?'ledger-transition-journal':`${phaseRootRelative}/ledger-transition-journal`);
  const names=listCheckpointNames(phaseRoots.primary,phaseRoots.secondary),chain=[];
  let previousSha=null,previousSequence=null,previousComplete=null,initialAudit=null,previousResume=null;
  for(let index=0;index<names.length;index++){
    const match=names[index].match(CHECKPOINT_PATTERN),checkpointIndex=Number(match[1]);
    if(checkpointIndex!==index+1)fail('checkpoint index gap or duplicate');
    const stored=durable.verifyDualCopy(path.join(phaseRoots.primary,CHECKPOINT_DIR,names[index]),path.join(phaseRoots.secondary,CHECKPOINT_DIR,names[index]));
    const checkpoint=JSON.parse(stored.bytes.toString('utf8'));
    if(checkpoint.schemaVersion!==1||checkpoint.kind!=='STAGE3E_INCREMENTAL_VERIFICATION_CHECKPOINT'||checkpoint.phase!==phase||
       checkpoint.executionId!==executionId||checkpoint.checkpointIndex!==checkpointIndex||checkpoint.previousCheckpointSha256!==previousSha)
      fail(`checkpoint identity/chain mismatch ${names[index]}`);
    for(const key of ['initialFullAuditSha256','resumeFullAuditSha256','ledgerSha256PrimaryAndSecondary','journalTipSha256PrimaryAndSecondary'])
      if(!/^[0-9a-f]{64}$/.test(checkpoint[key]||''))fail(`invalid ${key} in ${names[index]}`);
    if(index===0)initialAudit=checkpoint.initialFullAuditSha256;
    if(checkpoint.initialFullAuditSha256!==initialAudit)fail('initial audit binding changed');
    if(previousResume&&checkpoint.resumeFullAuditSha256===previousResume){} // Equal audit digests are valid for an unchanged evidence snapshot.
    if(!Number.isSafeInteger(checkpoint.fromJournalSequenceExclusive)||!Number.isSafeInteger(checkpoint.throughJournalSequenceInclusive)||
       checkpoint.fromJournalSequenceExclusive<0||checkpoint.throughJournalSequenceInclusive<checkpoint.fromJournalSequenceExclusive||
       !Number.isSafeInteger(checkpoint.newlyCompletedCellCount)||checkpoint.newlyCompletedCellCount<=0||
       !Number.isSafeInteger(checkpoint.baseComplete)||checkpoint.baseComplete<0||checkpoint.baseComplete%64!==0||
       !Number.isSafeInteger(checkpoint.cumulativeComplete)||!Number.isSafeInteger(checkpoint.cumulativeAcousticRenderCalls))
      fail(`invalid checkpoint accounting ${names[index]}`);
    if(index===0&&checkpoint.cumulativeComplete!==checkpoint.baseComplete+checkpoint.newlyCompletedCellCount)
      fail('first checkpoint cumulative count does not match its audited baseline and delta');
    if(index>0&&(checkpoint.fromJournalSequenceExclusive!==previousSequence||checkpoint.baseComplete!==previousComplete||
       checkpoint.cumulativeComplete!==checkpoint.baseComplete+checkpoint.newlyCompletedCellCount))
      fail('checkpoint ranges/accounting are not continuous');
    const result=verifyDeltaEntries({entries:checkpoint.deltaEvidenceEntries,phase,phaseRootRelative,journalRootRelative,
      searchPrimary:searchRoots.primary,searchSecondary:searchRoots.secondary,
      fromSequence:checkpoint.fromJournalSequenceExclusive,throughSequence:checkpoint.throughJournalSequenceInclusive,
      expectedCellCount:checkpoint.newlyCompletedCellCount});
    if(result.deltaEvidenceDigestSha256!==checkpoint.deltaEvidenceDigestSha256)fail(`delta digest mismatch ${names[index]}`);
    const tipPrefix=`${journalRootRelative}/transition-`;
    const tipEntry=checkpoint.deltaEvidenceEntries.filter(entry=>entry.type==='journal'&&entry.path.startsWith(tipPrefix)).at(-1);
    if(tipEntry&&tipEntry.sha256!==checkpoint.journalTipSha256PrimaryAndSecondary)fail('checkpoint journal tip hash mismatch');
    if(!tipEntry&&checkpoint.throughJournalSequenceInclusive!==checkpoint.fromJournalSequenceExclusive)fail('checkpoint journal tip is absent');
    if(checkpoint.cumulativeAcousticRenderCalls!==checkpoint.cumulativeComplete)fail('checkpoint render accounting differs from completed count');
    previousSha=stored.sha256;previousSequence=checkpoint.throughJournalSequenceInclusive;previousComplete=checkpoint.cumulativeComplete;
    previousResume=checkpoint.resumeFullAuditSha256;chain.push({checkpoint,sha256:stored.sha256,bytes:stored.bytes,path:names[index]});
  }
  return chain;
}

function checkpointEntriesForResume({phase,phaseRootRelative=phase,journalRootRelative='ledger-transition-journal',searchRoots,transitionEntries,renderStartEntries,ledger,fromSequence}={}){
  const result=[],authorizedKeys=new Set(Object.keys(ledger.cells||{}));
  const later=(transitionEntries||[]).filter(entry=>entry.sequence>fromSequence&&authorizedKeys.has(entry.cellKey));
  const completed=new Map(later.filter(entry=>entry.newState==='COMPLETE').map(entry=>[entry.cellKey,entry]));
  for(const [cellId,state] of completed){
    const cellPath=`${phaseRootRelative}/${state.relativePath||`cells/${cellId}.json`}`;
    const stored=durable.verifyDualCopy(path.join(searchRoots.primary,cellPath),path.join(searchRoots.secondary,cellPath),state.capturedCellSha256);
    result.push({type:'cell',path:cellPath,sha256:stored.sha256,sizeBytes:stored.bytes.length,cellId});
  }
  for(const entry of later){
    const relative=`${journalRootRelative}/transition-${String(entry.sequence).padStart(6,'0')}.json`;
    const stored=durable.verifyDualCopy(path.join(searchRoots.primary,relative),path.join(searchRoots.secondary,relative));
    result.push({type:'journal',path:relative,sha256:stored.sha256,sizeBytes:stored.bytes.length,sequence:entry.sequence});
  }
  for(const marker of renderStartEntries||[]){
    if(marker.transitionSequence<=fromSequence||!authorizedKeys.has(marker.cellKey))continue;
    const relative=`${journalRootRelative}/render-start-${String(marker.sequence).padStart(6,'0')}.json`;
    const stored=durable.verifyDualCopy(path.join(searchRoots.primary,relative),path.join(searchRoots.secondary,relative));
    result.push({type:'journal',path:relative,sha256:stored.sha256,sizeBytes:stored.bytes.length,sequence:marker.transitionSequence});
  }
  const unique=new Map(result.map(entry=>[deltaKey(entry),entry]));
  if(unique.size!==result.length)fail('duplicate pre-checkpoint evidence during resume');
  return [...unique.values()].sort(compareDelta);
}

function createPhaseVerificationContext({phase,executionId,identity,searchRoots,phaseRoots,journalRoots,phaseRootRelative,journalRootRelative,ledger,ledgerSha256,
  transitionEntries=[],renderStartEntries=[],manifestSha256,proofSha256,compatibilitySha256,fullAudit,readCurrentState,now=()=>new Date().toISOString()}={}){
  if(typeof fullAudit!=='function'||typeof readCurrentState!=='function'||!ledger||!Array.isArray(transitionEntries)||!Array.isArray(renderStartEntries))
    fail('phase context input schema');
  phaseRootRelative=phaseRootRelative||path.relative(searchRoots.primary,phaseRoots.primary).split(path.sep).join('/');
  journalRootRelative=journalRootRelative||(phase==='low'?'ledger-transition-journal':`${phaseRootRelative}/ledger-transition-journal`);
  const chain=validateCheckpointChain({phase,executionId,searchRoots,phaseRoots,phaseRootRelative,journalRootRelative});
  const latest=chain.at(-1),phaseKeys=new Set(Object.keys(ledger.cells||{}));
  const firstPhaseTransition=transitionEntries.find(entry=>phaseKeys.has(entry.cellKey)&&entry.oldState==='PENDING'&&entry.newState==='IN_PROGRESS'&&!entry.eventType);
  const phaseSequence=transitionEntries.at(-1)?.sequence||0;
  if(latest&&latest.checkpoint.throughJournalSequenceInclusive>phaseSequence)fail('checkpoint is ahead of the live journal');
  const completeCount=Object.values(ledger.cells||{}).filter(state=>state.state==='COMPLETE').length;
  let baseComplete,baselineSequence;
  if(latest){
    baseComplete=latest.checkpoint.cumulativeComplete;
    if(completeCount<baseComplete)fail('live ledger complete count precedes last checkpoint');
    baselineSequence=latest.checkpoint.throughJournalSequenceInclusive;
  }else{
    // A phase-entry full audit is the trust boundary for history created before
    // incremental checkpoints existed. Reconstruct only the tail after the last
    // cumulative 64-cell boundary; the first new checkpoint still lands at 64,
    // 128, ... without treating already audited history as new process work.
    baseComplete=Math.floor(completeCount/64)*64;
    const completedTransitions=transitionEntries.filter(entry=>phaseKeys.has(entry.cellKey)&&entry.newState==='COMPLETE');
    const completedKeys=new Set(completedTransitions.map(entry=>entry.cellKey));
    if(completedTransitions.length!==completeCount||completedKeys.size!==completeCount)
      fail('audited completed-cell history does not match the live ledger');
    baselineSequence=baseComplete>0?completedTransitions[baseComplete-1].sequence:
      (firstPhaseTransition?firstPhaseTransition.sequence-1:phaseSequence);
  }
  const delta=checkpointEntriesForResume({phase,phaseRootRelative,journalRootRelative,searchRoots,transitionEntries,renderStartEntries,ledger,fromSequence:baselineSequence});
  const deltaCompleteCount=delta.filter(entry=>entry.type==='cell').length;
  if(completeCount-baseComplete!==deltaCompleteCount)fail('uncheckpointed COMPLETE rows cannot be reconstructed exactly');
  const baseSequence=baselineSequence;
  const genesisSha256=transitionEntries.at(0)?.previousLedgerSha256||ledgerSha256;
  const context={phase,executionId,identity,searchRoots,phaseRoots,journalRoots,phaseRootRelative,journalRootRelative,ledger,manifestSha256,proofSha256,compatibilitySha256,
    transitionEntries:[...transitionEntries],renderStartEntries:[...renderStartEntries],ledgerSha256,genesisSha256,
    checkpointIndex:chain.length+1,previousCheckpointSha256:latest?.sha256||null,
    initialFullAuditSha256:latest?.checkpoint.initialFullAuditSha256||null,
    previousSequence:baseSequence,baseComplete,deltaEvidenceEntries:delta,completedSinceCheckpoint:deltaCompleteCount,
    lastAuditSha256:null,checkpointElapsedMs:0,startedAt:now(),
    hasRenderStart(cellKey){return this.renderStartEntries.some(item=>item.cellKey===cellKey);},
    assertLedgerSha(sha){if(sha!==this.ledgerSha256)fail('live ledger differs from cached verified tip');},
    recordTransition({entry,stored,previousLedgerSha256,nextLedgerSha256}){
      if(!entry||!stored||entry.sequence!==(this.transitionEntries.at(-1)?.sequence||0)+1||entry.previousLedgerSha256!==this.ledgerSha256||
         previousLedgerSha256!==this.ledgerSha256||entry.nextLedgerSha256!==nextLedgerSha256)
        fail('new transition does not extend the verified tip');
      const name=`transition-${String(entry.sequence).padStart(6,'0')}.json`,relative=`${this.journalRootRelative}/${name}`;
      this.transitionEntries.push(entry);this.ledgerSha256=nextLedgerSha256;
      this.deltaEvidenceEntries.push({type:'journal',path:relative,sha256:stored.sha256,sizeBytes:stored.sizeBytes,sequence:entry.sequence});
    },
    recordRenderStart({stored,marker}){
      if(!stored||!marker||marker.sequence!==this.renderStartEntries.length+1||marker.transitionSequence!==this.transitionEntries.at(-1)?.sequence)
        fail('new render-start marker does not extend the verified tip');
      const name=`render-start-${String(marker.sequence).padStart(6,'0')}.json`;
      this.renderStartEntries.push({...marker,_sha256:stored.sha256});
      this.deltaEvidenceEntries.push({type:'journal',path:`${this.journalRootRelative}/${name}`,sha256:stored.sha256,sizeBytes:stored.sizeBytes,sequence:marker.transitionSequence});
    },
    recordCell({cell,state,stored}){
      if(!cell||!state||!stored||state.relativePath!==`cells/${cell.key}.json`)fail('new cell evidence path mismatch');
      const relative=`${this.phaseRootRelative}/${state.relativePath}`;
      this.deltaEvidenceEntries.push({type:'cell',path:relative,sha256:stored.sha256,sizeBytes:stored.sizeBytes,cellId:cell.key});
    },
    auditSha(stage){
      const observed=fullAudit();
      if(!same(observed,identity))fail(`runtime identity changed at ${stage}`);
      const live=readCurrentState();
      const expectedComplete=Object.values(this.ledger.cells||{}).filter(state=>state.state==='COMPLETE').length;
      if(live.ledgerSha256!==this.ledgerSha256||live.journalTipSequence!==(this.transitionEntries.at(-1)?.sequence||0)||
         live.completeCount!==expectedComplete||live.renderCalls!==this.ledger.accounting.renderCalls)
        fail(`live state differs from verified context at ${stage}`);
      const digest=sha256(Buffer.from(JSON.stringify({schemaVersion:1,phase,executionId,stage,
        identitySha256:sha256(Buffer.from(JSON.stringify(stable(identity)))),ledgerSha256:live.ledgerSha256,
        journalTipSequence:live.journalTipSequence,journalTipSha256:live.journalTipSha256,completeCount:live.completeCount,
        renderCalls:live.renderCalls,manifestSha256,proofSha256,compatibilitySha256}),'utf8'));
      if(!this.initialFullAuditSha256)this.initialFullAuditSha256=digest;
      this.lastAuditSha256=digest;return digest;
    },
    beforeCell(){if(!this.lastAuditSha256)this.auditSha('phase-entry');return identity;},
    addCompletedCell({ledger:currentLedger}){
      this.completedSinceCheckpoint++;const complete=Object.values(currentLedger.cells||{}).filter(state=>state.state==='COMPLETE').length;
      if(complete!==this.baseComplete+this.deltaEvidenceEntries.filter(entry=>entry.type==='cell').length)
        fail('COMPLETE accounting does not match checkpoint delta');
      if(complete>0&&complete%64===0){this.auditSha('checkpoint-64');this.writeCheckpoint(currentLedger);}
      if(this.completedSinceCheckpoint>=64&&complete%64!==0)fail('cumulative checkpoint boundary was skipped');
    },
    writeCheckpoint(currentLedger){
      if(!this.deltaEvidenceEntries.length)return null;
      const checkpointStarted=process.hrtime.bigint();
      const entries=[...this.deltaEvidenceEntries].sort(compareDelta),from=this.previousSequence;
      const state=readCurrentState(),through=state.journalTipSequence;
      if(state.ledgerSha256!==this.ledgerSha256||state.renderCalls!==currentLedger.accounting.renderCalls)
        fail('checkpoint live ledger/accounting mismatch');
      const verified=verifyDeltaEntries({entries,phase,phaseRootRelative:this.phaseRootRelative,journalRootRelative:this.journalRootRelative,
        searchPrimary:searchRoots.primary,searchSecondary:searchRoots.secondary,
        fromSequence:from,throughSequence:through,expectedCellCount:entries.filter(entry=>entry.type==='cell').length});
      const checkpoint={schemaVersion:1,kind:'STAGE3E_INCREMENTAL_VERIFICATION_CHECKPOINT',phase,executionId,
        checkpointIndex:this.checkpointIndex,previousCheckpointSha256:this.previousCheckpointSha256,
        initialFullAuditSha256:this.initialFullAuditSha256,resumeFullAuditSha256:this.lastAuditSha256,
        fromJournalSequenceExclusive:from,throughJournalSequenceInclusive:through,
        baseComplete:this.baseComplete,
        newlyCompletedCellCount:entries.filter(entry=>entry.type==='cell').length,
        cumulativeComplete:state.completeCount,cumulativeAcousticRenderCalls:state.renderCalls,
        ledgerSha256PrimaryAndSecondary:state.ledgerSha256,journalTipSha256PrimaryAndSecondary:state.journalTipSha256,
        deltaEvidenceDigestSha256:verified.deltaEvidenceDigestSha256,deltaEvidenceEntries:entries};
      const name=`${CHECKPOINT_PREFIX}${String(this.checkpointIndex).padStart(6,'0')}.json`;
      const checkpointRoots=evidencePaths.resolveVerificationCheckpointRoots(searchRoots,phase),p=path.join(checkpointRoots.primary,name),s=path.join(checkpointRoots.secondary,name);
      if(fs.existsSync(p)||fs.existsSync(s))fail(`checkpoint identity already exists ${name}`);
      const stored=durable.writeDualCopy(p,s,jsonBytes(checkpoint));
      const verifiedChain=validateCheckpointChain({phase,executionId,searchRoots,phaseRoots,phaseRootRelative:this.phaseRootRelative,journalRootRelative:this.journalRootRelative});
      if(verifiedChain.at(-1)?.sha256!==stored.sha256)fail('new checkpoint failed post-write chain validation');
      this.checkpointElapsedMs+=Number(process.hrtime.bigint()-checkpointStarted)/1e6;
      this.previousCheckpointSha256=stored.sha256;this.checkpointIndex++;this.previousSequence=through;
      this.baseComplete=state.completeCount;this.deltaEvidenceEntries=[];this.completedSinceCheckpoint=0;
      return stored.sha256;
    },
    finish(currentLedger){
      this.auditSha('phase-exit');
      if(this.deltaEvidenceEntries.length)this.writeCheckpoint(currentLedger);
      this.auditSha('phase-exit-checkpoint-verified');
      return {initialFullAuditSha256:this.initialFullAuditSha256,resumeFullAuditSha256:this.lastAuditSha256,
        checkpointCount:this.checkpointIndex-1,checkpointElapsedMs:this.checkpointElapsedMs,
        ledgerSha256:this.ledgerSha256,journalTipSequence:this.transitionEntries.at(-1)?.sequence||0};
    }
  };
  if(delta.length){
    context.deltaEvidenceEntries=delta;
    context.completedSinceCheckpoint=deltaCompleteCount;
    if(deltaCompleteCount>=64)fail('uncheckpointed completion count reached or exceeded a checkpoint boundary');
  }
  return context;
}

module.exports={CHECKPOINT_DIR,CHECKPOINT_PATTERN,sha256,jsonBytes,safeRelative,verifyDeltaEntries,validateCheckpointChain,createPhaseVerificationContext};
