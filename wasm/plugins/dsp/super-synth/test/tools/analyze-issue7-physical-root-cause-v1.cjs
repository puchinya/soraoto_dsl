#!/usr/bin/env node
'use strict';

// Issue #7: source-bound, zero-render diagnosis. NEVER import a renderer or call collect/runAll.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const frozen = require('./run-issue7-physical-fit-v5.cjs');
const frozenCore = require('./issue7-physical-fit-v5-core.cjs');
const review = require('./run-issue7-physical-fit-v5-review.cjs');
const reviewCore = require('./issue7-physical-fit-v5-review-core.cjs');
const local = require('./physical-fit-v5-local-model.cjs');
const {postAttackResiduals} = require('./stage3-direct-reference-metrics.cjs');

const ROOT = path.resolve(__dirname, '../../../../../../');
const REPOSITORY = 'puchinya/soraoto_dsl';
const PR_NUMBER = 8;
const ISSUE_NUMBER = 7;
const CONTRACT_SHA256 = '5031773c8cf3326a5b0cf495d1fa09e6561b55b03afc380e03b2073c20c785c0';
const EPOCH = 'physical-root-cause-v1/analysis-01';
const FROZEN_HEAD = '7ab88ce5b857423ec1d278e8741e963f4e33cd56';
const P5_SHA256 = '90cf96c243f298cc6f91b8eba350f904c9581cd1924d53e272e422450d377307';
const P5_TERMINAL_SHA256 = '346a61a21e3c6fb46c97ee45c74616c523f8a180d63a032f30643532e73243ed';
const HISTORICAL_CALLS = 3251;
const MAX_CALLS = 5255;
const TOLERANCE_DB = 1e-6;
const SOURCE_PATHS = Object.freeze([
  'docs/specs/plugins/dsp/super-synth/physical-fit-root-cause-readonly-v1-amendment.md',
  'docs/design/plugins/dsp/super-synth/physical-fit-root-cause-readonly-v1-design.md',
  'wasm/plugins/dsp/super-synth/test/tools/analyze-issue7-physical-root-cause-v1.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/analyze-issue7-physical-root-cause-v1.test.cjs'
]);

function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function jsonBytes(value) { return Buffer.from(JSON.stringify(value, null, 2) + '\n'); }
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function fail(code, detail = '') { throw new Error(code + (detail ? ': ' + detail : '')); }
function finite(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('BLOCKED_ROOT_CAUSE_NONFINITE', field);
  return value;
}
function runRtk(args) { return execFileSync('rtk', args, {cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024}).trim(); }
function commitHead() { return runRtk(['git', 'rev-parse', 'HEAD']); }
function hashes(paths = SOURCE_PATHS) {
  return Object.fromEntries(paths.map(name => [name, sha(fs.readFileSync(path.join(ROOT, name)))]));
}
function compareDb(a, b, field) {
  if (Math.abs(finite(a, field) - finite(b, field)) > TOLERANCE_DB) {
    fail('BLOCKED_ROOT_CAUSE_METRIC_RECOMPUTE', field + ': difference ' + Math.abs(a - b));
  }
}
function shapeFromOfficial(cell) {
  // These four independent relative envelope values are produced by the official
  // 140-WAV remeasurement; compute the residual by the unchanged official helper.
  const actual = {envelopeDbfs: [0, 0, finite(cell.renderEarlyRelDb, 'renderEarly'), 0,
    finite(cell.renderLateRelDb, 'renderLate')]};
  const reference = {envelopeDbfs: [0, 0, finite(cell.referenceEarlyRelDb, 'referenceEarly'), 0,
    finite(cell.referenceLateRelDb, 'referenceLate')]};
  const result = postAttackResiduals(actual, reference);
  compareDb(result.earlyResidualDb, cell.earlyResidualDb, 'official early');
  compareDb(result.lateResidualDb, cell.lateResidualDb, 'official late');
  compareDb(result.postAttackShapeErrorDb, cell.postAttackShapeErrorDb, 'official shape');
  return result;
}
function buildResidualTable(recomputed, recorded, expectedCells) {
  if (!Array.isArray(recomputed) || recomputed.length !== 20
      || !Array.isArray(recorded) || recorded.length !== 20
      || !Array.isArray(expectedCells) || expectedCells.length !== 7) fail('BLOCKED_ROOT_CAUSE_COVERAGE');
  const seen = new Set(), observations = [], byCell = {};
  for (const cell of expectedCells) byCell[cell.pitch + ':' + cell.velocity] = [];
  for (let index = 0; index < 20; index++) {
    const fresh = recomputed[index], prior = recorded[index];
    if (!fresh || !prior || fresh.id !== prior.id || seen.has(fresh.id)
        || !equal(fresh.values, prior.values) || fresh.source !== prior.source
        || !equal(fresh.rows, prior.rows)
        || fresh.sourceSha256 !== prior.sourceSha256
        || !Array.isArray(fresh.metrics) || fresh.metrics.length !== 7
        || !Array.isArray(prior.metrics) || prior.metrics.length !== 7) {
      fail('BLOCKED_ROOT_CAUSE_INPUT_INTEGRITY', 'observation index ' + index);
    }
    seen.add(fresh.id);
    const source = fresh.source;
    if (source !== 'v3' && source !== 'v4') fail('BLOCKED_ROOT_CAUSE_SOURCE', source);
    const official = fresh.metrics.map((cell, cellIndex) => {
      const recordedCell = prior.metrics[cellIndex];
      const expected = expectedCells[cellIndex];
      if (!recordedCell || cell.pitch !== expected.pitch || cell.velocity !== expected.velocity
          || recordedCell.pitch !== cell.pitch || recordedCell.velocity !== cell.velocity) {
        fail('BLOCKED_ROOT_CAUSE_CELL_ORDER', fresh.id + '/' + cellIndex);
      }
      const signed = {earlyResidualDb: finite(cell.earlyResidualDb, 'early'), lateResidualDb: finite(cell.lateResidualDb, 'late'),
        postAttackShapeErrorDb: finite(cell.postAttackShapeErrorDb, 'shape')};
      for (const [name, value] of Object.entries(signed)) compareDb(value, recordedCell[name], fresh.id + ':' + name);
      const magnitude = Math.max(Math.abs(signed.earlyResidualDb), Math.abs(signed.lateResidualDb));
      compareDb(magnitude, signed.postAttackShapeErrorDb, 'max(abs) shape');
      const dominantResidual = Math.abs(signed.earlyResidualDb) > Math.abs(signed.lateResidualDb)
        ? 'EARLY' : Math.abs(signed.lateResidualDb) > Math.abs(signed.earlyResidualDb) ? 'LATE' : 'TIE';
      if (dominantResidual !== cell.dominantResidual || dominantResidual !== recordedCell.dominantResidual
          || !equal(cell.hardFailures, recordedCell.hardFailures)) fail('BLOCKED_ROOT_CAUSE_METRIC_RECOMPUTE', 'dominant/failure');
      const row = {id: fresh.id, source, pitch: cell.pitch, velocity: cell.velocity, ...signed,
        dominantResidual, hardFailures: cell.hardFailures, finite: cell.finite,
        guardHits: cell.guardHits, peakDbfs: cell.peakDbfs,
        wavSha256: fresh.rows[cellIndex].wavSha256, metadataSha256: fresh.rows[cellIndex].metadataSha256};
      byCell[cell.pitch + ':' + cell.velocity].push(row);
      return row;
    });
    observations.push({id: fresh.id, source, sourceSha256: fresh.sourceSha256, values: fresh.values,
      officialViolation: fresh.officialViolation, familyLoss: fresh.familyLoss, pass: fresh.pass,
      cells: official});
  }
  const count3 = observations.filter(item => item.source === 'v3').length;
  const count4 = observations.filter(item => item.source === 'v4').length;
  if (count3 !== 8 || count4 !== 12 || Object.values(byCell).some(rows => rows.length !== 20)
      || !byCell['96:124']) fail('BLOCKED_ROOT_CAUSE_COVERAGE', 'v3/v4 totals or required cell');
  return {observations, byCell, counts: {v3: count3, v4: count4, vectors: 20, acousticCells: 140}};
}
function classifyHypothesis(criticalRows, bestId) {
  if (!Array.isArray(criticalRows) || criticalRows.length !== 20) fail('BLOCKED_ROOT_CAUSE_COVERAGE', 'critical');
  const best = criticalRows.find(row => row.id === bestId);
  if (!best) fail('BLOCKED_ROOT_CAUSE_BEST_MISSING');
  const dominant = best.dominantResidual;
  const num = type => criticalRows.filter(row => row.dominantResidual === type).length;
  const label = dominant === 'LATE' ? 'TERMINATION_PRIORITY_HYPOTHESIS'
    : dominant === 'EARLY' ? 'HAMMER_EARLY_PRIORITY_HYPOTHESIS' : 'MIXED_OR_UNRESOLVED';
  const predictions = {
    TERMINATION_PRIORITY_HYPOTHESIS: 'A separately approved matched-identity change in passive agraffe/bridge loss should change signed LATE more consistently than signed EARLY without a new direct-level violation.',
    HAMMER_EARLY_PRIORITY_HYPOTHESIS: 'A separately approved matched-identity contact/launch diagnostic should alter signed EARLY most strongly before passive held-decay is changed.',
    MIXED_OR_UNRESOLVED: 'A separately approved phase/component isolation experiment should produce a reproducible causal difference with source, capture, preset and binary identities held constant.'
  };
  return {label, confirmed: false, bestId, dominant, sign: {
    early: Math.sign(best.earlyResidualDb), late: Math.sign(best.lateResidualDb)},
    bestSigned: {earlyResidualDb: best.earlyResidualDb, lateResidualDb: best.lateResidualDb,
      postAttackShapeErrorDb: best.postAttackShapeErrorDb}, all20: criticalRows,
    dominanceCounts: {EARLY: num('EARLY'), LATE: num('LATE'), TIE: num('TIE')},
    supportingEvidence: 'The selected measured best has a verified signed ' + dominant + ' shape component.',
    limitations: 'Dominance is not causal identification. Prior 2026-09-30 controlled data have unverified build/capture/fixture identity for this candidate.',
    falsifiablePrediction: predictions[label]};
}
function resolveReportRoots({root = ROOT, home = os.homedir(), commonDirectory} = {}) {
  const repo = fs.realpathSync(root);
  const common = fs.realpathSync(commonDirectory || runRtk(['git','rev-parse','--path-format=absolute','--git-common-dir']));
  const h = fs.realpathSync(home);
  const primary = path.join(common, 'soraoto-agent-state', '7', 'physical-root-cause-v1', 'analysis-01');
  const secondary = path.join(h, '.soraoto-agent-archive', 'soraoto_dsl', '7', 'physical-root-cause-v1', 'analysis-01');
  reviewCore.assertNoSymlink(common, primary);
  reviewCore.assertNoSymlink(h, secondary);
  if (reviewCore.inside(primary, secondary) || reviewCore.inside(secondary, primary)) fail('BLOCKED_ROOT_CAUSE_ROOT_OVERLAP');
  return {repo, common, home: h, primary, secondary, epoch: EPOCH};
}
function parentSnapshots() {
  const roots = frozenCore.resolveRoots(ROOT);
  const historical = ['v3','v4','v5','review-01','review-02'];
  const common = runRtk(['git','rev-parse','--path-format=absolute','--git-common-dir']);
  const home = os.homedir();
  const existing = {
    v3: require('./issue7-physical-identification-v1-core.cjs').resolveRoots(ROOT),
    v4: require('./issue7-physical-fit-v4-core.cjs').resolveRoots(ROOT),
    v5: roots
  };
  const results = {};
  for (const name of historical) {
    const paths = existing[name];
    const primary = paths ? (paths.primary || paths.a) : path.join(common,'soraoto-agent-state','7','physical-fit-v5-review',
      name === 'review-01' ? 'continuation-01' : 'continuation-02');
    const secondary = paths ? (paths.secondary || paths.b) : path.join(home,'.soraoto-agent-archive','soraoto_dsl','7',
      'physical-fit-v5-review', name === 'review-01' ? 'continuation-01' : 'continuation-02');
    const left = reviewCore.snapshotTree(primary), right = reviewCore.snapshotTree(secondary);
    results[name] = {primary: reviewCore.inventorySummary(left,left), secondary: reviewCore.inventorySummary(right,right),
      entriesPrimary: left, entriesSecondary: right};
    if (!equal(left.map(({mtimeMs, ...rest})=>rest),right.map(({mtimeMs,...rest})=>rest))) {
      fail('BLOCKED_ROOT_CAUSE_PARENT_DUAL_MISMATCH', name);
    }
  }
  return results;
}
function summarizeParents(snapshots) {
  return Object.fromEntries(Object.entries(snapshots).map(([name, record]) =>
    [name,{primary:record.primary,secondary:record.secondary}]));
}
function verifySourcesAndInputs() {
  const head = commitHead();
  const before = parentSnapshots();
  let parent, recomputed;
  try {
    parent = review.verifyFrozenP5Parent({root: ROOT, verifyRemote: false, currentHead: head});
    recomputed = frozen.readOnlyDiagnosis();
  } catch (error) {
    fail('BLOCKED_INPUT_UNAVAILABLE', String(error.message).replaceAll(os.homedir(), '$HOME').replaceAll(ROOT, '$REPO'));
  }
  if (parent.p5.runtimeSha256 !== P5_SHA256 || parent.p5.terminalSha256 !== P5_TERMINAL_SHA256
      || parent.report.summary.eligibleCount !== 0 || parent.report.model.observationCount !== 20) {
    fail('BLOCKED_ROOT_CAUSE_FROZEN_P5');
  }
  const stored = frozen.preparedPayload(frozenCore.resolveRoots(ROOT));
  const historyFile = frozenCore.readJson(frozenCore.resolveRoots(ROOT), frozen.HISTORY_REL);
  const cells = require('./issue7-physical-fit-v4-core.cjs').STRESS_CELLS;
  const table = buildResidualTable(recomputed.history, historyFile.observations, cells);
  const after = parentSnapshots();
  if (!equal(before, after)) fail('BLOCKED_ROOT_CAUSE_PARENT_MUTATED');
  return {head, parent, stored, recomputed, table, parents:summarizeParents(before)};
}
function buildReport(input) {
  const {head, parent, recomputed, table, parents} = input;
  const ranked = [...table.observations].map(row => ({id:row.id,values:row.values,
    violation:finite(row.officialViolation,'violation'),loss:finite(row.familyLoss,'loss')})).sort(local.compareScores);
  if (ranked[0].id !== parent.report.model.bestId) fail('BLOCKED_ROOT_CAUSE_BEST_MISMATCH');
  const hypothesis = classifyHypothesis(table.byCell['96:124'], ranked[0].id);
  const notes = {
    termination: {candidate:'string/agraffe/bridge termination decay',
      basis: '2026-09-30 separate-source damping control moved a coherent treble late-residual group by >2.5 dB; not proved comparable to current P5.',
      disconfirmation: 'If matched-source passive-loss perturbations do not move LATE preferentially, reject this mechanism.'},
    hammer: {candidate:'hammer/felt launch and early contact',
      basis: 'An EARLY-dominant candidate would support investigation of excitation before changing passive decay.',
      disconfirmation: 'If matched-source contact/launch perturbations leave EARLY invariant, reject as primary source.'},
    bridgeOrBoard: {candidate:'bridge transport / board feedback and radiation',
      basis: 'Existing older radiation-bypass result was small in its own lineage but not necessarily current.',
      disconfirmation: 'A matched-source component bypass showing negligible residual movement weakens radiation attribution.'}
  };
  const report = {
    schemaVersion: 1, issue: ISSUE_NUMBER, currentHead: head, frozenHead: FROZEN_HEAD,
    epoch: EPOCH, contractSha256: CONTRACT_SHA256, sourceHashes: hashes(),
    inputIdentities: {p5RuntimeSha256: parent.p5.runtimeSha256, p5TerminalSha256: parent.p5.terminalSha256,
      p5DiagnosticsSha256:parent.p5.diagnosticsSha256,p5HistorySha256:parent.p5.historySha256,
      parentInventories:parents},
    work: {builds:0,renders:0,acousticCalls:0,sourceEdits:0},
    observationCounts:table.counts, observations:table.observations, byCell:table.byCell,
    critical96v124: {bestId:ranked[0].id,values:ranked[0].values,...hypothesis},
    legacyStage3: {lineage:'historical-pre-P5-stage3', currentCandidateComparable:false,
      comparison:'NOT_COMPARABLE',entries:[
        {pitch:96,velocity:31,directLevelResidualDb:22.4910715},
        {pitch:96,velocity:36,directLevelResidualDb:20.1684955}
      ],reason:'Distinct previously instrumented acoustic build/epoch: cannot transfer individual hard failures to a v3/v4 candidate.'},
    historicalDampingEvidence: {date:'2026-09-30',observation:'9/90 old-center failures late-dominant; old treble damping movement >2.5 dB; radiation bypass <0.4 dB.',
      status:'HISTORICAL_CAUSAL_EVIDENCE_NOT_COMPARABLE',
      reason:'No independently matched original old-experiment source/binary/preset/capture/fixture/windows verified against the current P5 history.'},
    candidateModelLimits: {rank:parent.report.model.rank,conditionNumber:parent.report.model.conditionNumber,
      looErrorDb:parent.report.model.looErrorDb,eligibleCandidates:0,gridSize:729,
      predictedUpperBoundLimitDb:9.95,officialShapeLimitDb:10,usedAcousticCalls:HISTORICAL_CALLS,maxAcousticCalls:MAX_CALLS},
    hypothesis:{...hypothesis,alternatives:notes,modelCauseConfirmed:false},
    unavailableEvidence:['Comparable complete 2026-09-30 raw controlled-experiment provenance/binary/preset/window identity.',
      'Independent current-build controlled perturbation isolating cause; not authorized.'],
    proposedSingleNextExperiment:{authorized:false,acousticCalls:0,requiresNewApprovedDesign:true,
      proposal:hypothesis.falsifiablePrediction,
      rule:'Match exact source/fixture/build/cell/window and require approved budget before any render.'},
    downstream:{confirmation:'NOT RUN',headroom:'NOT RUN',p6:'NOT RUN',releaseEquivalence:'NOT RUN',
      stage3:'NOT RUN',stage4:'NOT RUN',webPlayer:'NOT RUN',manualListening:'NOT RUN'},
    terminalDecision:'ROOT_CAUSE_HYPOTHESIS_REPORTED',
    acousticAcceptance:'BLOCKED_PHYSICAL_ACCEPTANCE',
    reviewerChecklist:{sourceAndParentIntegrity:'CHECKED',savedWavRecompute:'CHECKED',
      historyComparison:'CHECKED',historicalCausality:'NOT COMPARABLE',realAcousticAcceptance:'NOT RUN'},
    verification:{officialMetricToleranceDb:TOLERANCE_DB,reportDeterministic:true,
      realAcousticTests:'NOT RUN',privateReportPublication:'NOT RUN'}
  };
  return report;
}
function renderMarkdown(report) {
  const c = report.critical96v124, rows = c.all20.map(row =>
    '| '+[row.id,row.source,row.earlyResidualDb,row.lateResidualDb,row.postAttackShapeErrorDb,row.dominantResidual].join(' | ')+' |');
  return ['# Issue #7 — Physical root-cause read-only analysis','',
    'HEAD: \`'+report.currentHead+'\`  ',
    'Frozen P5: \`'+report.frozenHead+'\`  ',
    'Decision: **'+report.terminalDecision+'** (hypothesis only; acoustic acceptance BLOCKED).','',
    '## MIDI 96 / velocity 124','',
    'Best measured ID: \`'+c.bestId+'\`; leading component: **'+c.dominant+'**.',
    'Hypothesis: **'+c.label+'**. Not causally confirmed.','',
    '| Observation | Lineage | Signed EARLY dB | Signed LATE dB | Shape dB | Dominant |',
    '|---|---|---:|---:|---:|---|', ...rows,'',
    '## Attribution limits','',
    '- Historical Stage3 MIDI96 v31/v36 direct-level errors are from another lineage and are NOT COMPARABLE to the present candidate.',
    '- September 30 damping evidence: '+report.historicalDampingEvidence.status+'.',
    '- Falsifiable next diagnostic (authorization required): '+report.proposedSingleNextExperiment.proposal,'',
    '## Execution', '', '- New renders: 0; builds: 0; acoustic calls: 0.',
    '- Cumulative: '+HISTORICAL_CALLS+' / '+MAX_CALLS+' unchanged.',
    '- Confirmation, headroom, P6, release, Stage3, Stage4, listening: NOT RUN.',
    '- Parent v3/v4/v5/review source and evidence preserved.', ''].join('\n');
}
function reportRootsSnapshot(roots) {
  return {primary:reviewCore.snapshotTree(roots.primary),secondary:reviewCore.snapshotTree(roots.secondary)};
}
function prepareReport() {
  const input = verifySourcesAndInputs();
  const report = buildReport(input);
  return {report, markdown:renderMarkdown(report), input};
}
function loadPublished(roots) {
  const files=['reports/root-cause.json','reports/root-cause.md','runtime-revisions/root-cause-v1.json','evidence-manifest.json','evidence-manifest.sha256'];
  const present=files.map(name=> {
    const paths=reviewCore.dualPaths(roots,name);
    return fs.existsSync(paths.primary) || fs.existsSync(paths.secondary);
  });
  if (!present.some(Boolean)) return null;
  if (present.some(value=>!value)) fail('BLOCKED_ROOT_CAUSE_PARTIAL_PUBLISH');
  return Object.fromEntries(files.map(name=>[name,reviewCore.readDual(roots,name)]));
}
function verifyPublished({report, markdown, roots = resolveReportRoots()} = {}) {
  const stored = loadPublished(roots);
  if (!stored) return {decision:'NOT_PUBLISHED',writes:0};
  const json = jsonBytes(report), md = Buffer.from(markdown);
  if (!stored['reports/root-cause.json'].bytes.equals(json) || !stored['reports/root-cause.md'].bytes.equals(md)) {
    fail('BLOCKED_ROOT_CAUSE_PUBLISHED_DRIFT');
  }
  const identity=JSON.parse(stored['runtime-revisions/root-cause-v1.json'].bytes.toString('utf8'));
  if (identity.creatorHead !== report.currentHead || identity.contractSha256 !== CONTRACT_SHA256 ||
      identity.reportSha256 !== sha(json) || identity.markdownSha256 !== sha(md)) {
    fail('BLOCKED_ROOT_CAUSE_RUNTIME_IDENTITY');
  }
  const files=JSON.parse(stored['evidence-manifest.json'].bytes.toString('utf8'));
  const manifestPath='evidence-manifest.sha256';
  if (stored[manifestPath].bytes.toString('utf8') !== stored['evidence-manifest.json'].sha256+'\n'
      || !Array.isArray(files.files) || files.files.length!==3) fail('BLOCKED_ROOT_CAUSE_MANIFEST');
  for(const file of files.files) {
    const record=stored[file.path];
    if(!record || record.sha256!==file.sha256 || record.size!==file.size) fail('BLOCKED_ROOT_CAUSE_MANIFEST_ENTRY');
  }
  return {decision:'PUBLISHED_VERIFIED',writes:0,reportSha256:sha(json),
    manifestSha256:stored['evidence-manifest.json'].sha256};
}
function assertRemoteAndApproval(head) {
  for(const relative of SOURCE_PATHS) {
    if (!runRtk(['git','ls-files',relative])) fail('BLOCKED_ROOT_CAUSE_UNCOMMITTED_SOURCE',relative);
    runRtk(['git','diff','--quiet','HEAD','--',relative]);
    const committed=runRtk(['git','show','HEAD:'+relative]);
    if (sha(Buffer.from(committed+'\n')) !== hashes([relative])[relative]) {
      // git show strips one newline; allow exact byte-compare through git hash-object instead.
      const gitDigest=runRtk(['git','hash-object',relative]);
      const headDigest=runRtk(['git','rev-parse','HEAD:'+relative]);
      if(gitDigest!==headDigest)fail('BLOCKED_ROOT_CAUSE_UNCOMMITTED_SOURCE',relative);
    }
  }
  const issue = JSON.parse(runRtk(['gh','issue','view','7','--repo',REPOSITORY,'--json','body,state,labels']));
  if (issue.state !== 'OPEN' || !issue.body.includes(CONTRACT_SHA256)
      || !issue.labels.some(row=>row.name==='blocked')) fail('BLOCKED_ROOT_CAUSE_APPROVAL');
  const pr = JSON.parse(runRtk(['gh','pr','view','8','--repo',REPOSITORY,'--json','state,headRefOid,headRefName']));
  if(pr.state!=='OPEN'||pr.headRefOid!==head)fail('BLOCKED_ROOT_CAUSE_REMOTE_HEAD');
  const remote=JSON.parse(runRtk(['gh','api','repos/'+REPOSITORY+'/commits/'+head]));
  if(remote.sha!==head || remote.commit?.tree?.sha !== runRtk(['git','rev-parse','HEAD^{tree}']))
    fail('BLOCKED_ROOT_CAUSE_REMOTE_COMMIT');
  return {pullRequest:'https://github.com/'+REPOSITORY+'/pull/8',head};
}
function acquireLock(roots) {
  const relative='locks/root-cause-publish.lock';
  const paths=reviewCore.dualPaths(roots,relative);
  if (fs.existsSync(paths.primary) || fs.existsSync(paths.secondary)) fail('BLOCKED_ROOT_CAUSE_LOCKED');
  const owner=crypto.randomUUID();
  const data=jsonBytes({owner,epoch:EPOCH,head:commitHead()});
  try {reviewCore.writeImmutableDual(roots,relative,data);}
  catch(e) {fail('BLOCKED_ROOT_CAUSE_LOCKED',e.message);}
  return {owner,paths,data};
}
function releaseLock(lock) {
  for (const file of [lock.paths.primary,lock.paths.secondary]) {
    if(!fs.readFileSync(file).equals(lock.data)) fail('BLOCKED_ROOT_CAUSE_LOCK_OWNERSHIP');
  }
  fs.unlinkSync(lock.paths.primary);fs.unlinkSync(lock.paths.secondary);
}
function publish(options = {}) {
  const {report,markdown,input}=prepareReport();
  const roots=resolveReportRoots(options);
  assertRemoteAndApproval(report.currentHead);
  const pre=parentSnapshots();
  const lock=acquireLock(roots);
  try {
    const existing=loadPublished(roots);
    if(existing) return {...verifyPublished({report,markdown,roots}),reused:true};
    const record=jsonBytes(report), summary=Buffer.from(markdown);
    const identity={schemaVersion:1,epoch:EPOCH,creatorHead:report.currentHead,contractSha256:CONTRACT_SHA256,
      sourceHashes:report.sourceHashes, inputIdentities:report.inputIdentities,
      reportSha256:sha(record),markdownSha256:sha(summary)};
    const idBytes=jsonBytes(identity);
    const items=[['reports/root-cause.json',record],['reports/root-cause.md',summary],
      ['runtime-revisions/root-cause-v1.json',idBytes]];
    for(const [name,bytes] of items)reviewCore.writeImmutableDual(roots,name,bytes);
    const manifest={schemaVersion:1,epoch:EPOCH,creatorHead:report.currentHead,
      files:items.map(([name,bytes])=>({path:name,sha256:sha(bytes),size:bytes.length}))};
    const manifestBytes=jsonBytes(manifest);
    reviewCore.writeImmutableDual(roots,'evidence-manifest.json',manifestBytes);
    reviewCore.writeImmutableDual(roots,'evidence-manifest.sha256',Buffer.from(sha(manifestBytes)+'\n'));
    const verified=verifyPublished({report,markdown,roots});
    if(!equal(pre,parentSnapshots()))fail('BLOCKED_ROOT_CAUSE_PARENT_MUTATED');
    return {...verified,reused:false,decision:'ROOT_CAUSE_HYPOTHESIS_REPORTED',acousticCalls:0,builds:0};
  } finally {releaseLock(lock);}
}
function verify() {
  const before=parentSnapshots();
  const {report,markdown}=prepareReport();
  const roots=resolveReportRoots();
  const beforeReports=reportRootsSnapshot(roots);
  const result=verifyPublished({report,markdown,roots});
  if(!equal(before,parentSnapshots()) || !equal(beforeReports,reportRootsSnapshot(roots)))
    fail('BLOCKED_ROOT_CAUSE_READONLY_MUTATION');
  return {...result,inputDecision:'ROOT_CAUSE_HYPOTHESIS_REPORTED',work:report.work,
    frozenDecision:'BLOCKED_V5_NO_PREDICTED_FEASIBLE_POINT'};
}
function parseMode(args=process.argv.slice(2)) {
  if(args.length!==1 || !['--analyze','--verify','--publish'].includes(args[0])) {
    fail('BLOCKED_ROOT_CAUSE_MODE','choose exactly --analyze, --verify or --publish');
  }
  return args[0];
}
function main(args=process.argv.slice(2)) {
  const mode=parseMode(args);
  const result=mode==='--analyze'?prepareReport().report:mode==='--verify'?verify():publish();
  process.stdout.write(JSON.stringify(result)+'\n');
  return result;
}
if(require.main===module) {
  try {main();}catch(error) {
    process.stderr.write(String(error.message).replaceAll(os.homedir(),'$HOME').replaceAll(ROOT,'$REPO')+'\n');
    process.exitCode=2;
  }
}
module.exports={ROOT,EPOCH,CONTRACT_SHA256,FROZEN_HEAD,SOURCE_PATHS,TOLERANCE_DB,
  verifySourcesAndInputs,buildResidualTable,classifyHypothesis,buildReport,renderMarkdown,
  resolveReportRoots,verifyPublished,publish,verify,parseMode,main,shapeFromOfficial,prepareReport};
