'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function commonDir(root){
  return execFileSync('rtk',['git','rev-parse','--path-format=absolute','--git-common-dir'],{cwd:root,encoding:'utf8'}).trim();
}
function safePart(value,name){
  const part=String(value||'');
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)||part==='.'||part==='..')throw new Error(`invalid ${name}`);
  return part;
}
function resolveRoots({root,issue,task,executionId,home=process.env.HOME,commonDirectory}={}){
  if(!root||!home)throw new Error('repository root and home are required');
  const issuePart=safePart(issue,'issue');
  const taskPart=safePart(task,'task');
  const executionPart=safePart(executionId,'execution ID');
  const common=path.resolve(commonDirectory||commonDir(root));
  const repository=path.basename(path.resolve(root));
  const primary=path.join(common,'soraoto-agent-state',issuePart,taskPart,executionPart);
  const secondary=path.join(path.resolve(home),'.soraoto-agent-archive',repository,issuePart,taskPart,executionPart);
  if(primary===secondary||primary.startsWith(secondary+path.sep)||secondary.startsWith(primary+path.sep))throw new Error('durable evidence roots overlap');
  return {primary,secondary,commonDirectory:common,repository};
}
function atomicWrite(file,bytes){
  const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temporary=path.join(path.dirname(file),`.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let descriptor;
  try{
    descriptor=fs.openSync(temporary,'wx',0o600);
    let offset=0;
    while(offset<data.length)offset+=fs.writeSync(descriptor,data,offset,data.length-offset);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);descriptor=undefined;
    fs.renameSync(temporary,file);
    try{const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}catch{}
  }catch(error){
    if(descriptor!==undefined)try{fs.closeSync(descriptor);}catch{}
    try{fs.unlinkSync(temporary);}catch{}
    throw error;
  }
  return {sizeBytes:data.length,sha256:sha256(data)};
}
function writeDualCopy(primaryPath,secondaryPath,bytes,{write=atomicWrite}={}){
  const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  let primary;
  try{primary=write(primaryPath,data);}catch(error){throw new Error(`BLOCKED_EVIDENCE_PRIMARY_PERSISTENCE: ${error.message}`);}
  const primaryStored=fs.readFileSync(primaryPath);
  const primarySha=sha256(primaryStored);
  if(primarySha!==primary.sha256||!primaryStored.equals(data))throw new Error('BLOCKED_EVIDENCE_PRIMARY_PERSISTENCE: stored primary bytes differ');
  try{write(secondaryPath,data);}catch(error){throw new Error(`BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: ${error.message}`);}
  const secondaryStored=fs.readFileSync(secondaryPath);
  const secondarySha=sha256(secondaryStored);
  if(secondarySha!==primarySha||!secondaryStored.equals(primaryStored))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: primary/secondary SHA-256 mismatch');
  return {sizeBytes:data.length,sha256:primarySha};
}
function verifyDualCopy(primaryPath,secondaryPath){
  let primary,secondary;
  try{primary=fs.readFileSync(primaryPath);secondary=fs.readFileSync(secondaryPath);}catch(error){throw new Error(`BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: missing durable copy: ${error.message}`);}
  const primarySha=sha256(primary),secondarySha=sha256(secondary);
  if(primarySha!==secondarySha||!primary.equals(secondary))throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: primary/secondary SHA-256 mismatch');
  return {sizeBytes:primary.length,sha256:primarySha,bytes:primary};
}
function listEvidenceFiles(root,relative=''){
  if(!fs.existsSync(root))throw new Error(`evidence root is missing: ${root}`);
  const result=[];
  for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const child=path.join(relative,entry.name);
    if(entry.isDirectory()){
      if(entry.name==='archives')continue;
      result.push(...listEvidenceFiles(root,child));
    }else if(entry.isFile()&&!['evidence-manifest.json','evidence-manifest.sha256'].includes(child)&&!entry.name.endsWith('.tmp'))result.push(child.split(path.sep).join('/'));
  }
  return result;
}
function inventory(root,roles={}){
  return listEvidenceFiles(root).map(relativePath=>{
    const file=path.join(root,...relativePath.split('/'));
    const bytes=fs.readFileSync(file);
    return {relativePath,sizeBytes:bytes.length,sha256:sha256(bytes),artifactRole:roles[relativePath]||'evidence',firstObservedAt:fs.statSync(file).birthtime.toISOString()};
  });
}
function assertMatchingInventory(primaryRoot,secondaryRoot,roles={}){
  const primary=inventory(primaryRoot,roles),secondary=inventory(secondaryRoot,roles);
  if(JSON.stringify(primary.map(({relativePath,sizeBytes,sha256,artifactRole})=>({relativePath,sizeBytes,sha256,artifactRole})))!==
     JSON.stringify(secondary.map(({relativePath,sizeBytes,sha256,artifactRole})=>({relativePath,sizeBytes,sha256,artifactRole}))))
    throw new Error('BLOCKED_EVIDENCE_SECONDARY_PERSISTENCE: durable roots contain different file inventories');
  return primary;
}
function writeFinalizedManifest({primaryRoot,secondaryRoot,metadata,artifactRoles={},now=()=>new Date().toISOString()}={}){
  const manifestPath='evidence-manifest.json',hashPath='evidence-manifest.sha256';
  const primaryManifest=path.join(primaryRoot,manifestPath),secondaryManifest=path.join(secondaryRoot,manifestPath);
  const primaryHash=path.join(primaryRoot,hashPath),secondaryHash=path.join(secondaryRoot,hashPath);
  const existing=[primaryManifest,secondaryManifest,primaryHash,secondaryHash].some(file=>fs.existsSync(file));
  const files=assertMatchingInventory(primaryRoot,secondaryRoot,artifactRoles);
  if(existing){
    if(![primaryManifest,secondaryManifest,primaryHash,secondaryHash].every(file=>fs.existsSync(file)))throw new Error('BLOCKED_EVIDENCE_MANIFEST_IMMUTABLE: partial finalized manifest');
    const stored=verifyDualCopy(primaryManifest,secondaryManifest);
    const expectedHash=stored.sha256+'\n';
    if(fs.readFileSync(primaryHash,'utf8')!==expectedHash||fs.readFileSync(secondaryHash,'utf8')!==expectedHash)throw new Error('BLOCKED_EVIDENCE_MANIFEST_IMMUTABLE: manifest hash file mismatch');
    const parsed=JSON.parse(stored.bytes.toString('utf8'));
    if(JSON.stringify(parsed.files)!==JSON.stringify(files))throw new Error('BLOCKED_EVIDENCE_MANIFEST_IMMUTABLE: evidence inventory changed after finalization');
    for(const key of ['creatorRevision','executionId','generation','runnerSha256','helperSha256','wasmSha256','decision'])
      if(metadata[key]!==undefined&&parsed[key]!==metadata[key])throw new Error(`BLOCKED_EVIDENCE_MANIFEST_IMMUTABLE: ${key} changed`);
    const hashBytes=Buffer.from(expectedHash);
    verifyDualCopy(primaryHash,secondaryHash);
    return {manifest:parsed,sha256:stored.sha256,sizeBytes:stored.sizeBytes};
  }
  const timestamp=now();
  const required=['creatorRevision','executionId','generation','runnerSha256','helperSha256','wasmSha256','startedAt','finalizedAt','decision'];
  const missing=required.filter(key=>metadata?.[key]===undefined||metadata[key]===null);
  if(missing.length)throw new Error(`manifest metadata missing: ${missing.join(', ')}`);
  const manifest={schemaVersion:1,state:'FINALIZED',...metadata,files};
  const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  const written=writeDualCopy(primaryManifest,secondaryManifest,bytes);
  const hashBytes=Buffer.from(written.sha256+'\n');
  writeDualCopy(primaryHash,secondaryHash,hashBytes);
  return {manifest,sha256:written.sha256,sizeBytes:written.sizeBytes};
}
function createPhaseArchive({primaryRoot,secondaryRoot,phase}={}){
  const name=`${safePart(phase,'phase')}.tar.gz`;
  const primaryPath=path.join(primaryRoot,'archives',name),secondaryPath=path.join(secondaryRoot,'archives',name);
  const existsPrimary=fs.existsSync(primaryPath),existsSecondary=fs.existsSync(secondaryPath);
  if(existsPrimary||existsSecondary){
    if(!existsPrimary||!existsSecondary)throw new Error('BLOCKED_EVIDENCE_ARCHIVE_IMMUTABLE: one durable archive copy is missing');
    return verifyDualCopy(primaryPath,secondaryPath);
  }
  const inventoryBefore=assertMatchingInventory(primaryRoot,secondaryRoot);
  if(!fs.existsSync(path.join(primaryRoot,'evidence-manifest.json')))throw new Error('BLOCKED_EVIDENCE_ARCHIVE: finalized manifest is required before archive');
  const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'soraoto-evidence-archive-'));
  const tempArchive=path.join(tempDir,name);
  try{
    execFileSync('tar',['-czf',tempArchive,'-C',primaryRoot,'--exclude=./archives','.'],{stdio:'pipe'});
    const after=assertMatchingInventory(primaryRoot,secondaryRoot);
    if(JSON.stringify(inventoryBefore)!==JSON.stringify(after))throw new Error('BLOCKED_EVIDENCE_ARCHIVE: source inventory changed during archive creation');
    const bytes=fs.readFileSync(tempArchive);
    const result=writeDualCopy(primaryPath,secondaryPath,bytes);
    const entries=execFileSync('tar',['-tzf',primaryPath],{encoding:'utf8'}).trim().split(/\r?\n/);
    for(const row of inventoryBefore)if(!entries.includes(`./${row.relativePath}`)&&!entries.includes(row.relativePath))throw new Error(`BLOCKED_EVIDENCE_ARCHIVE: missing ${row.relativePath}`);
    return result;
  }finally{fs.rmSync(tempDir,{recursive:true,force:true});}
}

module.exports={sha256,commonDir,resolveRoots,atomicWrite,writeDualCopy,verifyDualCopy,listEvidenceFiles,inventory,assertMatchingInventory,writeFinalizedManifest,createPhaseArchive};
