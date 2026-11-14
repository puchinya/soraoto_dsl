'use strict';

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const durable=require('./durable-evidence.cjs');
const runner=require('./run-stage3e-generation2.cjs');
const validator=require('./stage3e-evidence-validator.cjs');
const preflight=require('./stage3e-preflight.cjs');

function sizeOf(value,encoding){return Buffer.isBuffer(value)?value.length:Buffer.byteLength(String(value),encoding||'utf8');}
function instrument(phase){
  const metrics={reads:0,readBytes:0,hashBytes:0,opens:0,readdirs:0,ledgerWrites:0,ledgerBytes:0};
  const saved={readFileSync:fs.readFileSync,readdirSync:fs.readdirSync,openSync:fs.openSync,createHash:crypto.createHash,writeDualCopy:durable.writeDualCopy};
  fs.readFileSync=function(file,...args){const value=saved.readFileSync.call(fs,file,...args);metrics.reads++;metrics.readBytes+=sizeOf(value,args[0]?.encoding);return value;};
  fs.readdirSync=function(...args){metrics.readdirs++;return saved.readdirSync.apply(fs,args);};
  fs.openSync=function(...args){metrics.opens++;return saved.openSync.apply(fs,args);};
  crypto.createHash=function(...args){const hash=saved.createHash.apply(crypto,args),update=hash.update.bind(hash);hash.update=(value,encoding)=>{metrics.hashBytes+=sizeOf(value,encoding);return update(value,encoding);};return hash;};
  durable.writeDualCopy=function(primary,secondary,bytes,...args){
    if(path.basename(primary)===`${phase}-ledger.json`){metrics.ledgerWrites++;metrics.ledgerBytes+=sizeOf(bytes)*2;}
    return saved.writeDualCopy.call(durable,primary,secondary,bytes,...args);
  };
  return {metrics,restore(){fs.readFileSync=saved.readFileSync;fs.readdirSync=saved.readdirSync;fs.openSync=saved.openSync;crypto.createHash=saved.createHash;durable.writeDualCopy=saved.writeDualCopy;}};
}

function runOne(mode,count){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stage3e-incremental-bench-'));
  const primary=path.join(temp,'primary'),secondary=path.join(temp,'secondary');
  const generationRoots={primary:path.join(primary,'generation-2'),secondary:path.join(secondary,'generation-2')};
  const searchRoots={primary:path.join(generationRoots.primary,'search-v1'),secondary:path.join(generationRoots.secondary,'search-v1')};
  fs.mkdirSync(searchRoots.primary,{recursive:true});fs.mkdirSync(searchRoots.secondary,{recursive:true});
  const phase='low',phaseRoots=runner.phaseRoots(searchRoots,phase);
  fs.mkdirSync(phaseRoots.primary,{recursive:true});fs.mkdirSync(phaseRoots.secondary,{recursive:true});
  for(const root of [primary,secondary])for(let index=0;index<35;index++){
    const file=path.join(root,'frozen',`${String(index).padStart(2,'0')}.json`);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.from(`frozen-${index}`));
  }
  const audit={immutablePreexistingFileInventory:{primary:{files:validator.walkFiles(primary)},secondary:{files:validator.walkFiles(secondary)}}};
  const baseIdentity={schemaVersion:1,generation:2,executionId:'generation-2',creatorRevision:'bench',candidateId:'bench-candidate',protectedIdentity:{},
    referenceSetSha256:'a'.repeat(64),captureHelperSha256:'b'.repeat(64),runnerSha256:'c'.repeat(64),coreSha256:'d'.repeat(64),searchEpoch:'search-v1',
    midi41AmendmentResultSha256:'e'.repeat(64),historicalGeneration2ManifestSha256:'f'.repeat(64),activeSearchCaptureIdentity:{}};
  const identity={...baseIdentity,phase,authorizedGrid:[],screenCoordinates:[]};
  const rawCells=Array.from({length:count},(_,index)=>({phase:'mid-screen',pitch:36+(index%88),velocity:14+(index%112),
    response:{low:1,mid:1,bassHardness:0}}));
  const cells=runner.cellSpecs('low',rawCells),ledger=runner.freshCellLedger(phase,identity,cells);
  runner.writeCellState(phaseRoots,ledger);
  const journalRoots=runner.ledgerJournalRoots(searchRoots),compatibilitySha256='1'.repeat(64),
    proofSha256=preflight.PROOF_SHA256,manifestSha256=preflight.MANIFEST_SHA256;
  const genesisBytes=runner.jsonBytes(ledger),genesisLedgerSha256=runner.sha256(genesisBytes);
  durable.writeDualCopy(path.join(journalRoots.primary,'genesis-ledger.json'),path.join(journalRoots.secondary,'genesis-ledger.json'),genesisBytes);
  runner.immutableDualJson(journalRoots,'genesis.json',{schemaVersion:1,decision:'STAGE3E_SEARCH_LEDGER_GENESIS',phase,
    genesisLedgerSha256,manifestSha256,proofSha256,compatibilitySha256,identity,
    authorizedCellCount:ledger.authorizedCellCount,renderCalls:0});
  const capture={DEFAULT_RESPONSE:{}};
  let fullAuditCalls=0;
  const fullAudit=()=>{
    fullAuditCalls++;
    validator.validateNamespaceAdditions({primaryRoot:primary,secondaryRoot:secondary,audit,authorizedKeys:cells.map(cell=>cell.key)});
    runner.transitionEntries(journalRoots);runner.renderStartEntries(journalRoots);
    return baseIdentity;
  };
  const now=()=>new Date().toISOString();
  const render=cell=>({pitch:cell.pitch,velocity:cell.velocity,velocityNormalized:cell.velocity/127,kind:'search',metrics:{finite:true,peakDbfs:-1}});
  const monitor=instrument(phase),started=process.hrtime.bigint();
  try{
    let finalLedger=ledger,checkpointElapsedMs=0;
    if(mode==='before'){
      runner.capturePhaseRows({roots:phaseRoots,ledger,cells,identity,capture,render,identityNow:fullAudit,now,
        journalContext:{journalRoots,manifestSha256,proofSha256,compatibilitySha256}});
      runner.readCompletedRows(phaseRoots,ledger,cells);fullAudit();
    }else{
      const result=runner.screenLedgerRows(searchRoots,phase,identity,cells,capture,null,fullAudit,now,render,compatibilitySha256);
      finalLedger=result.ledger;checkpointElapsedMs=result.verification.checkpointElapsedMs;
    }
    const elapsedMs=Number(process.hrtime.bigint()-started)/1e6;
    return {mode,cells:count,elapsedMs,checkpointElapsedMs,fullAuditCalls,...monitor.metrics,renderCalls:finalLedger.accounting.renderCalls};
  }finally{monitor.restore();fs.rmSync(temp,{recursive:true,force:true});}
}

function main(){
  const results=[];
  for(const count of [64,256])for(const mode of ['before','after'])for(let repetition=1;repetition<=3;repetition++){
    const result={...runOne(mode,count),repetition,fileOpensEstimate:0};
    result.fileOpensEstimate=result.reads+result.opens;
    results.push(result);
    process.stderr.write(`bench ${mode} ${count} repetition ${repetition} complete: ${result.elapsedMs.toFixed(1)} ms\n`);
  }
  process.stdout.write(JSON.stringify({schemaVersion:1,acousticRenders:0,storage:'temporary fixture only',environment:{platform:process.platform,arch:process.arch,node:process.version},results})+'\n');
}
if(require.main===module){try{main();}catch(error){process.stderr.write(`${error.stack||error.message}\n`);process.exitCode=1;}}
module.exports={runOne};
