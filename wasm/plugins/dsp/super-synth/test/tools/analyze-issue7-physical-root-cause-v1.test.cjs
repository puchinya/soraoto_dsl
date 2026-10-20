'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const analysis = require('./analyze-issue7-physical-root-cause-v1.cjs');
const reviewCore = require('./issue7-physical-fit-v5-review-core.cjs');
const {postAttackResiduals} = require('./stage3-direct-reference-metrics.cjs');
const v4core = require('./issue7-physical-fit-v4-core.cjs');

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const serial = value => Buffer.from(JSON.stringify(value, null, 2)+'\n');
const CELLS = v4core.STRESS_CELLS;
function sample(early, late) {
  const actual = {envelopeDbfs:[0,0,early,0,late]};
  const reference = {envelopeDbfs:[0,0,0,0,0]};
  return postAttackResiduals(actual,reference);
}
function fakeTable({dominant = 'LATE'} = {}) {
  const recomputed = [], saved = [], officialEvaluations = new Map();
  for(let i=0;i<20;i++){
    const source=i===0?'immutable-v3-p1-baseline':i<8?'immutable-v3-p1-candidate':'v4';
    const id=source+'-fake-'+i;
    const cells = CELLS.map(cell=>{
      const [early,late] = dominant==='LATE'?[1,-8]:dominant==='EARLY'?[-8,1]:[2,2];
      return {...cell,...sample(early,late),hardFailures:[],finite:true,guardHits:0,peakDbfs:-10};
    });
    const rows=CELLS.map((cell,j)=>({pitch:cell.pitch,velocity:cell.velocity,
      metadataSha256:'a'.repeat(64),wavSha256:'b'.repeat(64)}));
    const observation={id,source,sourceSha256:null,values:[1.05,0.5,0.018],
      officialViolation:0.1,familyLoss:1+i,pass:false,metrics:cells,rows};
    recomputed.push(observation); saved.push(JSON.parse(JSON.stringify(observation)));
    officialEvaluations.set(id,{id,source,sourceSha256:null,values:observation.values,rows,
      official:{cells:cells.map(cell=>({pitch:cell.pitch,velocity:cell.velocity,
        levelErrorDb:i/10,directLevelViolationDb:i/10-20,
        postAttackShapeErrorDb:cell.postAttackShapeErrorDb,hardFailures:cell.hardFailures,
        finite:cell.finite,peakDbfs:cell.peakDbfs,guardHits:cell.guardHits})),
      velocity:[{pitch:96,actualSpanDb:55,referenceSpanDb:50,errorDb:5,violationDb:-3,failures:[]}] }});
  }
  return {recomputed,saved,officialEvaluations};
}
function buildTable(data) {
  return analysis.buildResidualTable(data.recomputed,data.saved,CELLS,data.officialEvaluations);
}
function buildReport(table) {
  return analysis.buildReport({head:'a'.repeat(40),
    parent:{p5:{runtimeSha256:'b'.repeat(64),terminalSha256:'c'.repeat(64),
      diagnosticsSha256:'d'.repeat(64),historySha256:'e'.repeat(64)},
      report:{model:{bestId:table.observations[0].id,rank:3,conditionNumber:1.2,looErrorDb:0.5}}},
    recomputed:{},table,parents:{v3:{},v4:{}}});
}
function tempRoots(t) {
  const base=fs.mkdtempSync(path.join('/private/tmp','physical-root-cause-test-'));
  const primary=path.join(base,'primary'),secondary=path.join(base,'secondary');
  fs.mkdirSync(primary);fs.mkdirSync(secondary);
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  return {primary,secondary,epoch:analysis.EPOCH};
}
function publishFixture(roots,report,markdown,{manifestPaths,identityChanges={}}={}) {
  const files=[['reports/root-cause.json',serial(report)],
    ['reports/root-cause.md',Buffer.from(markdown)],
    ['runtime-revisions/root-cause-v1.json',null]];
  const identity={schemaVersion:1,epoch:analysis.EPOCH,creatorHead:report.currentHead,
    contractSha256:analysis.CONTRACT_SHA256,sourceHashes:report.sourceHashes,
    inputIdentities:report.inputIdentities,reportSha256:sha(files[0][1]),markdownSha256:sha(files[1][1]),
    ...identityChanges};
  files[2][1]=serial(identity);
  const entryNames=manifestPaths||files.map(([name])=>name);
  const entries=entryNames.map(name=>{
    const file=files.find(([candidate])=>candidate===name);
    return {path:name,sha256:sha(file[1]),size:file[1].length};
  });
  const manifest=serial({schemaVersion:1,epoch:analysis.EPOCH,creatorHead:report.currentHead,files:entries});
  for(const [name,bytes] of files)reviewCore.writeImmutableDual(roots,name,bytes);
  reviewCore.writeImmutableDual(roots,'evidence-manifest.json',manifest);
  reviewCore.writeImmutableDual(roots,'evidence-manifest.sha256',Buffer.from(sha(manifest)+'\n'));
}

test('T01: 20x7 historical measurements retain v3/v4 lineage, ordering, WAV and metadata identity',()=>{
  const data=fakeTable(), result=buildTable(data);
  assert.deepEqual(result.counts,{v3:8,v4:12,vectors:20,acousticCells:140});
  assert.equal(Object.keys(result.byCell).length,7);
  assert.equal(result.byCell['96:124'].length,20);
  assert.equal(result.byCell['96:124'][0].wavSha256,'b'.repeat(64));
  assert.deepEqual(result.observations.map(x=>x.id),data.recomputed.map(x=>x.id));
  assert.equal(result.observations[0].source,'immutable-v3-p1-baseline');
  assert.equal(result.observations[0].provenance,'v3');
  assert.equal(result.observations[8].source,'v4');
  assert.equal(result.byCell['96:124'][0].directLevelErrorDb,0);
  assert.equal(result.observations[0].officialGates.dynamicSpan.status,'STRESS_SUBSET_EVALUATED');
  assert.deepEqual(result.observations[0].officialGates.dynamicSpan.missingFullStage3VelocityLayers,[61]);
});
test('T02: official post-attack computation preserves EARLY/LATE signs and max(abs) gate',()=>{
  assert.equal(sample(8,-9).dominantResidual,'LATE');
  assert.equal(sample(8,-9).postAttackShapeErrorDb,9);
  assert.equal(sample(-8,1).dominantResidual,'EARLY');
  assert.equal(sample(-8,1).earlyResidualDb,-8);
  assert.equal(sample(1,-1).dominantResidual,'TIE');
  assert.deepEqual(analysis.shapeFromOfficial({
    renderEarlyRelDb:8,referenceEarlyRelDb:3,
    renderLateRelDb:-4,referenceLateRelDb:2,
    earlyResidualDb:5,lateResidualDb:-6,postAttackShapeErrorDb:6}),
    {...sample(5,-6),renderEarlyRelDb:8,referenceEarlyRelDb:3,renderLateRelDb:-4,referenceLateRelDb:2});
});
test('T03: historical and present acoustic lineages cannot be conflated',()=>{
  const report=buildReport(buildTable(fakeTable()));
  assert.equal(report.legacyStage3.lineage,'historical-pre-P5-stage3');
  assert.equal(report.legacyStage3.currentCandidateComparable,false);
  assert.equal(report.legacyStage3.comparison,'NOT_COMPARABLE');
  assert.deepEqual(report.legacyStage3.entries.map(row=>row.velocity),[31,36]);
  assert.equal(report.hypothesis.confirmed,false);
  assert.ok(!JSON.stringify(report.hypothesis).includes('MODEL_CAUSE_CONFIRMED'));
});
test('T04: late, early and tie become hypotheses, not confirmed causes',()=>{
  for(const [early,late,expected] of [[1,-8,'TERMINATION_PRIORITY_HYPOTHESIS'],
    [-8,1,'HAMMER_EARLY_PRIORITY_HYPOTHESIS'],[2,-2,'MIXED_OR_UNRESOLVED']]){
    const rows=Array.from({length:20},(_,i)=>({id:'row'+i,
      earlyResidualDb:early,lateResidualDb:late,postAttackShapeErrorDb:Math.max(Math.abs(early),Math.abs(late)),
      dominantResidual:Math.abs(early)===Math.abs(late)?'TIE':Math.abs(early)>Math.abs(late)?'EARLY':'LATE'}));
    const result=analysis.classifyHypothesis(rows,'row0');
    assert.equal(result.label,expected);
    assert.equal(result.confirmed,false);
    assert.match(result.falsifiablePrediction,/approved|source|experiment|identity/);
  }
});
test('T05: missing/altered real evidence is not repaired or silently substituted',()=>{
  const data=fakeTable();
  data.saved[10].rows[0].wavSha256='f'.repeat(64);
  assert.throws(()=>buildTable(data),/BLOCKED_ROOT_CAUSE_INPUT_INTEGRITY/);
  const other=fakeTable();
  other.saved[0].metrics[0].lateResidualDb+=1e-5;
  assert.throws(()=>buildTable(other),/BLOCKED_ROOT_CAUSE_METRIC_RECOMPUTE/);
});
test('T06: source, count, ID, tuple and cell-order mismatches block before report',()=>{
  const wrongCount=fakeTable();
  assert.throws(()=>analysis.buildResidualTable(wrongCount.recomputed.slice(1),wrongCount.saved,CELLS,wrongCount.officialEvaluations),/BLOCKED_ROOT_CAUSE_COVERAGE/);
  const wrongTuple=fakeTable();wrongTuple.saved[0].values=[1.02,0.5,0.018];
  assert.throws(()=>buildTable(wrongTuple),/BLOCKED_ROOT_CAUSE_INPUT_INTEGRITY/);
  const wrongCell=fakeTable();wrongCell.saved[0].metrics[0].pitch=21;
  assert.throws(()=>analysis.buildResidualTable(wrongCell.recomputed,wrongCell.saved,CELLS,wrongCell.officialEvaluations),/BLOCKED_ROOT_CAUSE_CELL_ORDER/);
  const unknownSource=fakeTable();
  unknownSource.recomputed[0].source='unrecognized-v99';
  unknownSource.saved[0].source='unrecognized-v99';
  assert.throws(()=>buildTable(unknownSource),/BLOCKED_ROOT_CAUSE_SOURCE/);
});
test('T07: private namespace, source list and modes are fixed',()=>{
  assert.equal(analysis.EPOCH,'physical-root-cause-v1/analysis-01');
  assert.equal(analysis.SOURCE_PATHS.length,4);
  assert.equal(analysis.parseMode(['--analyze']),'--analyze');
  assert.equal(analysis.parseMode(['--verify']),'--verify');
  assert.equal(analysis.parseMode(['--publish']),'--publish');
  assert.throws(()=>analysis.parseMode(['--run-all']),/BLOCKED_ROOT_CAUSE_MODE/);
  assert.throws(()=>analysis.assertSourceIdentity({expectedHead:'a',currentHead:'b',committed:{x:'1'},working:{x:'1'}}),/BLOCKED_ROOT_CAUSE_STALE_HEAD/);
  assert.throws(()=>analysis.assertSourceIdentity({expectedHead:'a',currentHead:'a',committed:{x:'1'},working:{x:'2'}}),/BLOCKED_ROOT_CAUSE_SOURCE_SHA/);
  const pr={state:'OPEN',headRefName:'codex/issue-7-supersynth-v9',headRefOid:'a'};
  const remoteCommit={sha:'a',commit:{tree:{sha:'tree'}}};
  assert.equal(analysis.assertPrHeadReadback({head:'a',pr,remoteCommit,localTreeSha:'tree'}).head,'a');
  assert.throws(()=>analysis.assertPrHeadReadback({head:'a',pr:{...pr,headRefOid:'b'},remoteCommit,localTreeSha:'tree'}),/BLOCKED_ROOT_CAUSE_REMOTE_HEAD/);
  assert.throws(()=>analysis.assertPrHeadReadback({head:'a',pr,remoteCommit,localTreeSha:'other'}),/BLOCKED_ROOT_CAUSE_REMOTE_COMMIT/);
});
test('T08: verification without publication is read-only and reports NOT_PUBLISHED',t=>{
  const roots=tempRoots(t);
  const report={currentHead:'a'.repeat(40)};
  const before=reviewCore.snapshotTree(roots.primary);
  assert.deepEqual(analysis.verifyPublished({report,markdown:'# mock\n',roots}),{decision:'NOT_PUBLISHED',writes:0});
  assert.deepEqual(reviewCore.snapshotTree(roots.primary),before);
  assert.deepEqual(reviewCore.snapshotTree(roots.secondary),before);
});
test('T09: partial publication, symlink escape and stale lock fail closed',t=>{
  const partial=tempRoots(t),partialReport={currentHead:'a'.repeat(40)};
  reviewCore.writeImmutableDual(partial,'reports/root-cause.json',serial(partialReport));
  assert.throws(()=>analysis.verifyPublished({report:partialReport,markdown:'# partial\n',roots:partial}),/BLOCKED_ROOT_CAUSE_PARTIAL_PUBLISH/);
  const oneSided=tempRoots(t),oneSidedPath=path.join(oneSided.primary,'reports','root-cause.json');
  fs.mkdirSync(path.dirname(oneSidedPath),{recursive:true});
  fs.writeFileSync(oneSidedPath,serial(partialReport));
  assert.throws(()=>analysis.verifyPublished({report:partialReport,markdown:'# partial\n',roots:oneSided}),/BLOCKED_ROOT_CAUSE_PARTIAL_PUBLISH/);
  const locked=tempRoots(t);
  reviewCore.writeImmutableDual(locked,'locks/root-cause-publish.lock',serial({owner:'stale'}));
  assert.throws(()=>analysis.assertPublishLockFree(locked),/BLOCKED_ROOT_CAUSE_LOCKED/);
  const base=fs.mkdtempSync(path.join('/private/tmp','physical-root-cause-symlink-'));
  const repo=path.join(base,'repo'),home=path.join(base,'home'),common=path.join(base,'common'),outside=path.join(base,'outside');
  for(const dir of [repo,home,common,outside])fs.mkdirSync(dir);
  fs.symlinkSync(outside,path.join(common,'soraoto-agent-state'),'dir');
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  assert.throws(()=>analysis.resolveReportRoots({root:repo,home,commonDirectory:common}),/BLOCKED_REVIEW_SYMLINK/);
});
test('T10: manifest requires unique exact members and runtime identity binds report inputs',t=>{
  const report={currentHead:'a'.repeat(40),sourceHashes:{source:'b'.repeat(64)},inputIdentities:{parent:'c'.repeat(64)}};
  const md='# Synthetic summary only\n';
  const duplicate=tempRoots(t);
  publishFixture(duplicate,report,md,{manifestPaths:['reports/root-cause.json','reports/root-cause.json','runtime-revisions/root-cause-v1.json']});
  assert.throws(()=>analysis.verifyPublished({report,markdown:md,roots:duplicate}),/BLOCKED_ROOT_CAUSE_MANIFEST/);
  const staleIdentity=tempRoots(t);
  publishFixture(staleIdentity,report,md,{identityChanges:{sourceHashes:{source:'d'.repeat(64)}}});
  assert.throws(()=>analysis.verifyPublished({report,markdown:md,roots:staleIdentity}),/BLOCKED_ROOT_CAUSE_RUNTIME_IDENTITY/);
  const staleInputs=tempRoots(t);
  publishFixture(staleInputs,report,md,{identityChanges:{inputIdentities:{parent:'e'.repeat(64)}}});
  assert.throws(()=>analysis.verifyPublished({report,markdown:md,roots:staleInputs}),/BLOCKED_ROOT_CAUSE_RUNTIME_IDENTITY/);
});
test('T11: immutable dual-copy publication verifies exact identity, reuses, and rejects forged copies',t=>{
  const roots=tempRoots(t);
  const report={currentHead:'a'.repeat(40),sourceHashes:{source:'b'.repeat(64)},inputIdentities:{parent:'c'.repeat(64)}};
  const md='# Synthetic summary only\n';
  publishFixture(roots,report,md);
  const before=reviewCore.snapshotTree(roots.primary);
  assert.equal(analysis.verifyPublished({report,markdown:md,roots}).decision,'PUBLISHED_VERIFIED');
  for(const [name,b] of [['reports/root-cause.json',serial(report)],['reports/root-cause.md',Buffer.from(md)]])
    assert.equal(reviewCore.writeImmutableDual(roots,name,b).reused,true);
  assert.deepEqual(reviewCore.snapshotTree(roots.primary),before);
  const file=reviewCore.dualPaths(roots,'reports/root-cause.md');
  fs.writeFileSync(file.secondary,'not a matching report');
  assert.throws(()=>analysis.verifyPublished({report,markdown:md,roots}));
});
test('T12: parent evidence mutation between analysis and publication is rejected',()=>{
  const analyzed={v3:{primary:[{path:'a',sha256:'a',size:1,mtimeMs:10}]},v4:{primary:[{path:'b',sha256:'b',size:1,mtimeMs:20}]}};
  const beforePublication=JSON.parse(JSON.stringify(analyzed));
  beforePublication.v4.primary[0].mtimeMs+=1;
  assert.throws(()=>analysis.assertParentSnapshotMatch(analyzed,beforePublication,'before-publication'),
    /BLOCKED_ROOT_CAUSE_PARENT_EVIDENCE_DRIFT/);
  assert.equal(analysis.assertParentSnapshotMatch(analyzed,JSON.parse(JSON.stringify(analyzed)),'before-publication'),true);
});
test('T13: runtime report postconditions remain hypothesis-only and keep downstream stages NOT RUN',()=>{
  const report=buildReport(buildTable(fakeTable()));
  assert.equal(report.terminalDecision,'ROOT_CAUSE_HYPOTHESIS_REPORTED');
  assert.equal(report.acousticAcceptance,'BLOCKED_PHYSICAL_ACCEPTANCE');
  assert.equal(report.work.acousticCalls,0);
  assert.equal(report.work.builds,0);
  assert.equal(report.downstream.stage3,'NOT RUN');
  assert.equal(report.downstream.stage4,'NOT RUN');
  assert.equal(report.officialGateCoverage.fullStage3DynamicSpan,'NOT EVALUATED');
  assert.equal(report.officialGateCoverage.dynamicSpan,'STRESS_SUBSET_ONLY');
});
test('T14: private P5 140-WAV remeasurement remains isolated from synthetic fixtures',t=>{
  if(process.env.ISSUE7_ROOT_CAUSE_PRIVATE_EVIDENCE !== '1') {
    t.skip('NOT RUN: set ISSUE7_ROOT_CAUSE_PRIVATE_EVIDENCE=1 only on the authorized evidence host');
    return;
  }
  const input=analysis.verifySourcesAndInputs();
  assert.equal(input.table.counts.acousticCells,140);
  assert.equal(input.parent.report.summary.eligibleCount,0);
  const report=analysis.buildReport(input);
  assert.equal(report.work.acousticCalls,0);
  assert.equal(report.acousticAcceptance,'BLOCKED_PHYSICAL_ACCEPTANCE');
});
