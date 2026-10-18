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
  const recomputed = [], saved = [];
  for(let i=0;i<20;i++){
    const source=i<8?'v3':'v4';
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
  }
  return {recomputed,saved};
}
function tempRoots(t) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'physical-root-cause-test-'));
  const primary=path.join(base,'primary'),secondary=path.join(base,'secondary');
  fs.mkdirSync(primary);fs.mkdirSync(secondary);
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  return {primary,secondary,epoch:analysis.EPOCH};
}

test('T01: 20x7 historical measurements retain v3/v4 lineage, ordering, WAV and metadata identity',()=>{
  const {recomputed,saved}=fakeTable();
  const result=analysis.buildResidualTable(recomputed,saved,CELLS);
  assert.deepEqual(result.counts,{v3:8,v4:12,vectors:20,acousticCells:140});
  assert.equal(Object.keys(result.byCell).length,7);
  assert.equal(result.byCell['96:124'].length,20);
  assert.equal(result.byCell['96:124'][0].wavSha256,'b'.repeat(64));
  assert.deepEqual(result.observations.map(x=>x.id),recomputed.map(x=>x.id));
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
    {...sample(5,-6),renderEarlyRelDb:5,referenceEarlyRelDb:0,renderLateRelDb:-6,referenceLateRelDb:0});
});
test('T03: historical and present acoustic lineages cannot be conflated',()=>{
  const testRow={id:'x',source:'v3',pitch:96,velocity:124,earlyResidualDb:1,lateResidualDb:-8,
    postAttackShapeErrorDb:8,dominantResidual:'LATE'};
  const result=analysis.classifyHypothesis(Array.from({length:20},(_,index)=>({...testRow,id:'x'+index})), 'x0');
  assert.equal(result.confirmed,false);
  assert.equal(result.bestId,'x0');
  assert.ok(!JSON.stringify(result).includes('MODEL_CAUSE_CONFIRMED'));
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
  const {recomputed,saved}=fakeTable();
  saved[10].rows[0].wavSha256='f'.repeat(64);
  assert.throws(()=>analysis.buildResidualTable(recomputed,saved,CELLS),/BLOCKED_ROOT_CAUSE_INPUT_INTEGRITY/);
  const other=fakeTable();
  other.saved[0].metrics[0].lateResidualDb+=1e-5;
  assert.throws(()=>analysis.buildResidualTable(other.recomputed,other.saved,CELLS),/BLOCKED_ROOT_CAUSE_METRIC_RECOMPUTE/);
});
test('T06: source, count, ID, tuple and cell-order mismatches block before report',()=>{
  const wrongCount=fakeTable();
  assert.throws(()=>analysis.buildResidualTable(wrongCount.recomputed.slice(1),wrongCount.saved,CELLS),/BLOCKED_ROOT_CAUSE_COVERAGE/);
  const wrongTuple=fakeTable();wrongTuple.saved[0].values=[1.02,0.5,0.018];
  assert.throws(()=>analysis.buildResidualTable(wrongTuple.recomputed,wrongTuple.saved,CELLS),/BLOCKED_ROOT_CAUSE_INPUT_INTEGRITY/);
  const wrongCell=fakeTable();wrongCell.saved[0].metrics[0].pitch=21;
  assert.throws(()=>analysis.buildResidualTable(wrongCell.recomputed,wrongCell.saved,CELLS),/BLOCKED_ROOT_CAUSE_CELL_ORDER/);
});
test('T07: private namespace, source list and modes are fixed',()=>{
  assert.equal(analysis.EPOCH,'physical-root-cause-v1/analysis-01');
  assert.equal(analysis.SOURCE_PATHS.length,4);
  assert.equal(analysis.parseMode(['--analyze']),'--analyze');
  assert.equal(analysis.parseMode(['--verify']),'--verify');
  assert.equal(analysis.parseMode(['--publish']),'--publish');
  assert.throws(()=>analysis.parseMode(['--run-all']),/BLOCKED_ROOT_CAUSE_MODE/);
});
test('T08: verification without publication is read-only and reports NOT_PUBLISHED',t=>{
  const roots=tempRoots(t);
  const report={currentHead:'a'.repeat(40)};
  const before=reviewCore.snapshotTree(roots.primary);
  assert.deepEqual(analysis.verifyPublished({report,markdown:'# mock\n',roots}),{decision:'NOT_PUBLISHED',writes:0});
  assert.deepEqual(reviewCore.snapshotTree(roots.primary),before);
  assert.deepEqual(reviewCore.snapshotTree(roots.secondary),before);
});
test('T09: immutable dual-copy publication can verify, reuse, and reject forged copies',t=>{
  const roots=tempRoots(t);
  const report={currentHead:'a'.repeat(40)};
  const md='# Synthetic summary only\n',bytes=serial(report),mdBytes=Buffer.from(md);
  const entries=[['reports/root-cause.json',bytes],['reports/root-cause.md',mdBytes]];
  const identity={creatorHead:report.currentHead,contractSha256:analysis.CONTRACT_SHA256,
    reportSha256:sha(bytes),markdownSha256:sha(mdBytes)};
  entries.push(['runtime-revisions/root-cause-v1.json',serial(identity)]);
  const manifestBytes=serial({files:entries.map(([name,b])=>({path:name,sha256:sha(b),size:b.length}))});
  for(const [name,bytes] of entries)reviewCore.writeImmutableDual(roots,name,bytes);
  reviewCore.writeImmutableDual(roots,'evidence-manifest.json',manifestBytes);
  reviewCore.writeImmutableDual(roots,'evidence-manifest.sha256',Buffer.from(sha(manifestBytes)+'\n'));
  const before=reviewCore.snapshotTree(roots.primary);
  assert.equal(analysis.verifyPublished({report,markdown:md,roots}).decision,'PUBLISHED_VERIFIED');
  for(const [name,b] of entries)assert.equal(reviewCore.writeImmutableDual(roots,name,b).reused,true);
  assert.deepEqual(reviewCore.snapshotTree(roots.primary),before);
  const file=reviewCore.dualPaths(roots,'reports/root-cause.md');
  fs.writeFileSync(file.secondary,'not a matching report');
  assert.throws(()=>analysis.verifyPublished({report,markdown:md,roots}));
});
test('T10: the final report explicitly stays in BLOCKED physical acceptance',()=>{
  const source=fs.readFileSync(path.join(__dirname,'analyze-issue7-physical-root-cause-v1.cjs'),'utf8');
  assert.match(source,/BLOCKED_PHYSICAL_ACCEPTANCE/);
  assert.match(source,/stage3:'NOT RUN'/);
  assert.match(source,/stage4:'NOT RUN'/);
  assert.match(source,/acousticCalls:0/);
});
test('T11: real P5 140-WAV remeasurement requires private evidence (not replaced by mock)',t=>{
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
