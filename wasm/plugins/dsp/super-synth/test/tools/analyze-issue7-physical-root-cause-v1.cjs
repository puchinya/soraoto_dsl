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
const v4 = require('./run-issue7-physical-fit-v4.cjs');

const ROOT = path.resolve(__dirname, '../../../../../../');
const REPOSITORY = 'puchinya/soraoto_dsl';
const PR_NUMBER = 8;
const PR_BRANCH = 'codex/issue-7-supersynth-v9';
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
const PROVENANCE_BY_SOURCE = Object.freeze({
  'immutable-v3-p1-baseline': 'v3',
  'immutable-v3-p1-candidate': 'v3',
  v4: 'v4'
});
const FULL_STAGE3_VELOCITIES = Object.freeze([14, 31, 36, 61, 124]);

function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function jsonBytes(value) { return Buffer.from(JSON.stringify(value, null, 2) + '\n'); }
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function fail(code, detail = '') { throw new Error(code + (detail ? ': ' + detail : '')); }
function finite(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('BLOCKED_ROOT_CAUSE_NONFINITE', field);
  return value;
}
function provenanceFor(source) {
  if (!Object.hasOwn(PROVENANCE_BY_SOURCE, source)) fail('BLOCKED_ROOT_CAUSE_SOURCE', source);
  return PROVENANCE_BY_SOURCE[source];
}
function assertSourceIdentity({expectedHead, currentHead, committed, working} = {}) {
  if (expectedHead !== currentHead) fail('BLOCKED_ROOT_CAUSE_STALE_HEAD');
  if (!equal(committed, working)) fail('BLOCKED_ROOT_CAUSE_SOURCE_SHA');
  return true;
}
function assertParentSnapshotMatch(expected, current, phase) {
  if (!expected || !current || !equal(expected, current)) {
    fail('BLOCKED_ROOT_CAUSE_PARENT_EVIDENCE_DRIFT', phase || 'snapshot');
  }
  return true;
}
function readOnlyDiagnosisWithOfficialEvaluations() {
  const evaluations = new Map();
  const originalHistorical = v4.loadHistoricalObservations;
  const originalScore = v4.scoreObservation;
  const remember = score => {
    if (!score || typeof score.id !== 'string' || evaluations.has(score.id)) {
      fail('BLOCKED_ROOT_CAUSE_OFFICIAL_EVALUATION', 'missing or duplicate observation');
    }
    evaluations.set(score.id, score);
    return score;
  };
  // Observe the exact official score objects while the frozen reader remeasures
  // stored WAVs; restore both exports even if the read-only diagnosis blocks.
  v4.loadHistoricalObservations = (...args) => originalHistorical(...args).map(remember);
  v4.scoreObservation = (...args) => remember(originalScore(...args));
  try {
    const diagnosis = frozen.readOnlyDiagnosis();
    if (evaluations.size !== 20) fail('BLOCKED_ROOT_CAUSE_OFFICIAL_EVALUATION', 'expected 20 scores');
    return {diagnosis, evaluations};
  } finally {
    v4.loadHistoricalObservations = originalHistorical;
    v4.scoreObservation = originalScore;
  }
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
function buildResidualTable(recomputed, recorded, expectedCells, officialEvaluations) {
  if (!Array.isArray(recomputed) || recomputed.length !== 20
      || !Array.isArray(recorded) || recorded.length !== 20
      || !Array.isArray(expectedCells) || expectedCells.length !== 7
      || !(officialEvaluations instanceof Map) || officialEvaluations.size !== 20) fail('BLOCKED_ROOT_CAUSE_COVERAGE');
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
    const provenance = provenanceFor(source);
    const officialScore = officialEvaluations.get(fresh.id);
    if (!officialScore || officialScore.id !== fresh.id || officialScore.source !== source
        || officialScore.sourceSha256 !== fresh.sourceSha256 || !equal(officialScore.values, fresh.values)
        || !equal(officialScore.rows, fresh.rows) || !officialScore.official
        || !Array.isArray(officialScore.official.cells) || officialScore.official.cells.length !== 7
        || !Array.isArray(officialScore.official.velocity)) {
      fail('BLOCKED_ROOT_CAUSE_OFFICIAL_EVALUATION', fresh.id);
    }
    compareDb(fresh.officialViolation, prior.officialViolation, fresh.id + ':violation');
    compareDb(fresh.familyLoss, prior.familyLoss, fresh.id + ':loss');
    if (fresh.pass !== prior.pass) fail('BLOCKED_ROOT_CAUSE_INPUT_INTEGRITY', fresh.id + ':pass');
    const official = fresh.metrics.map((cell, cellIndex) => {
      const recordedCell = prior.metrics[cellIndex];
      const expected = expectedCells[cellIndex];
      if (!recordedCell || cell.pitch !== expected.pitch || cell.velocity !== expected.velocity
          || recordedCell.pitch !== cell.pitch || recordedCell.velocity !== cell.velocity) {
        fail('BLOCKED_ROOT_CAUSE_CELL_ORDER', fresh.id + '/' + cellIndex);
      }
      const officialCell = officialScore.official.cells[cellIndex];
      if (!officialCell || officialCell.pitch !== cell.pitch || officialCell.velocity !== cell.velocity
          || !equal(officialCell.hardFailures, cell.hardFailures)
          || officialCell.finite !== cell.finite || officialCell.guardHits !== cell.guardHits) {
        fail('BLOCKED_ROOT_CAUSE_OFFICIAL_EVALUATION', fresh.id + '/' + cellIndex);
      }
      const signed = {earlyResidualDb: finite(cell.earlyResidualDb, 'early'), lateResidualDb: finite(cell.lateResidualDb, 'late'),
        postAttackShapeErrorDb: finite(cell.postAttackShapeErrorDb, 'shape')};
      for (const [name, value] of Object.entries(signed)) compareDb(value, recordedCell[name], fresh.id + ':' + name);
      compareDb(officialCell.postAttackShapeErrorDb, signed.postAttackShapeErrorDb, fresh.id + ':officialShape');
      const directLevelErrorDb = finite(officialCell.levelErrorDb, fresh.id + ':directLevelErrorDb');
      const directLevelViolationDb = finite(officialCell.directLevelViolationDb, fresh.id + ':directLevelViolationDb');
      const magnitude = Math.max(Math.abs(signed.earlyResidualDb), Math.abs(signed.lateResidualDb));
      compareDb(magnitude, signed.postAttackShapeErrorDb, 'max(abs) shape');
      const dominantResidual = Math.abs(signed.earlyResidualDb) > Math.abs(signed.lateResidualDb)
        ? 'EARLY' : Math.abs(signed.lateResidualDb) > Math.abs(signed.earlyResidualDb) ? 'LATE' : 'TIE';
      if (dominantResidual !== cell.dominantResidual || dominantResidual !== recordedCell.dominantResidual
          || !equal(cell.hardFailures, recordedCell.hardFailures)
          || cell.finite !== recordedCell.finite || cell.guardHits !== recordedCell.guardHits) {
        fail('BLOCKED_ROOT_CAUSE_METRIC_RECOMPUTE', fresh.id + ':safety/dominant/failure');
      }
      compareDb(cell.peakDbfs, recordedCell.peakDbfs, fresh.id + ':peakDbfs');
      compareDb(officialCell.peakDbfs, cell.peakDbfs, fresh.id + ':officialPeakDbfs');
      const row = {id: fresh.id, source, provenance, pitch: cell.pitch, velocity: cell.velocity, ...signed,
        directLevelErrorDb, directLevelViolationDb, directLevelPass: directLevelViolationDb <= 0,
        dominantResidual, hardFailures: cell.hardFailures, finite: cell.finite,
        guardHits: cell.guardHits, peakDbfs: cell.peakDbfs,
        wavSha256: fresh.rows[cellIndex].wavSha256, metadataSha256: fresh.rows[cellIndex].metadataSha256};
      byCell[cell.pitch + ':' + cell.velocity].push(row);
      return row;
    });
    const dynamicSpanRows = officialScore.official.velocity.map(row => {
      if (!Array.isArray(row.failures)) fail('BLOCKED_ROOT_CAUSE_OFFICIAL_EVALUATION', fresh.id + ':dynamicSpanFailures');
      return {
        pitch: row.pitch,
        actualSpanDb: finite(row.actualSpanDb, fresh.id + ':actualSpanDb'),
        referenceSpanDb: finite(row.referenceSpanDb, fresh.id + ':referenceSpanDb'),
        errorDb: finite(row.errorDb, fresh.id + ':dynamicSpanErrorDb'),
        violationDb: finite(row.violationDb, fresh.id + ':dynamicSpanViolationDb'),
        failures: row.failures
      };
    });
    const dynamicSpan = {
      status: dynamicSpanRows.length ? 'STRESS_SUBSET_EVALUATED' : 'NO_COMPLETE_STRESS_LAYER',
      fullStage3Gate: 'NOT_EVALUATED',
      missingFullStage3VelocityLayers: FULL_STAGE3_VELOCITIES.filter(velocity =>
        !expectedCells.some(cell => cell.pitch === 96 && cell.velocity === velocity)),
      rows: dynamicSpanRows
    };
    observations.push({id: fresh.id, source, provenance, sourceSha256: fresh.sourceSha256, values: fresh.values,
      officialViolation: fresh.officialViolation, familyLoss: fresh.familyLoss, pass: fresh.pass,
      officialGates: {
        directLevelFailures: official.filter(row => row.hardFailures.includes('directLevel')).length,
        postAttackShapeFailures: official.filter(row => row.hardFailures.includes('postAttackShape')).length,
        safetyFailures: official.filter(row => !row.finite || row.guardHits !== 0 || row.peakDbfs >= 0).length,
        jointFailingCells: official.filter(row => row.hardFailures.length > 0).length,
        dynamicSpanFailures: dynamicSpanRows.filter(row => row.failures.includes('dynamicSpan')).length,
        dynamicSpan
      },
      cells: official});
  }
  const count3 = observations.filter(item => item.provenance === 'v3').length;
  const count4 = observations.filter(item => item.provenance === 'v4').length;
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
  let parent, recomputed, officialEvaluations;
  try {
    parent = review.verifyFrozenP5Parent({root: ROOT, verifyRemote: false, currentHead: head});
    const captured = readOnlyDiagnosisWithOfficialEvaluations();
    recomputed = captured.diagnosis;
    officialEvaluations = captured.evaluations;
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
  const table = buildResidualTable(recomputed.history, historyFile.observations, cells, officialEvaluations);
  const after = parentSnapshots();
  assertParentSnapshotMatch(before, after, 'during-analysis');
  return {head, parent, stored, recomputed, table, parents:summarizeParents(before), parentSnapshot:before};
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
    officialGateCoverage: {
      directLevel: 'EVALUATED_PER_STRESS_CELL',
      postAttackShape: 'EVALUATED_PER_STRESS_CELL',
      safety: 'EVALUATED_PER_STRESS_CELL',
      dynamicSpan: 'STRESS_SUBSET_ONLY',
      fullStage3DynamicSpan: 'NOT EVALUATED',
      fullStage3RequiredVelocities: FULL_STAGE3_VELOCITIES,
      missingFullStage3VelocityLayers: FULL_STAGE3_VELOCITIES.filter(velocity =>
        !require('./issue7-physical-fit-v4-core.cjs').STRESS_CELLS.some(cell => cell.pitch === 96 && cell.velocity === velocity))
    },
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
    '| '+[row.id,row.provenance,row.source,row.earlyResidualDb,row.lateResidualDb,row.directLevelErrorDb,
      row.postAttackShapeErrorDb,row.dominantResidual].join(' | ')+' |');
  const gateRows=report.observations.map(observation=>{
    const gates=observation.officialGates;
    const span=gates.dynamicSpan.rows.map(row=>'pitch '+row.pitch+': error '+row.errorDb+
      ' dB, violation '+row.violationDb+' dB').join('; ') || gates.dynamicSpan.status;
    return '| '+[observation.id,observation.provenance,gates.directLevelFailures,gates.postAttackShapeFailures,
      gates.safetyFailures,gates.dynamicSpanFailures,gates.jointFailingCells,span].join(' | ')+' |';
  });
  return ['# Issue #7 — Physical root-cause read-only analysis','',
    'HEAD: \`'+report.currentHead+'\`  ',
    'Frozen P5: \`'+report.frozenHead+'\`  ',
    'Decision: **'+report.terminalDecision+'** (hypothesis only; acoustic acceptance BLOCKED).','',
    '## MIDI 96 / velocity 124','',
    'Best measured ID: \`'+c.bestId+'\`; leading component: **'+c.dominant+'**.',
    'Hypothesis: **'+c.label+'**. Not causally confirmed.','',
    '| Observation | Provenance class | Source tag | Signed EARLY dB | Signed LATE dB | Direct-level error dB | Shape dB | Dominant |',
    '|---|---|---|---:|---:|---:|---:|---|', ...rows,'',
    '## Official seven-cell gate evidence','',
    '| Observation | Provenance | Direct-level fails | Shape fails | Safety fails | Dynamic-span fails | Joint failing cells | Dynamic-span evidence |',
    '|---|---|---:|---:|---:|---:|---:|---|', ...gateRows,'',
    'Dynamic span is evaluated only on velocity layers present in the seven-cell stress subset; this is not the full Stage3 velocity gate.',
    'Full Stage3 dynamic-span evaluation remains NOT RUN. Missing full-matrix layers: '+report.officialGateCoverage.missingFullStage3VelocityLayers.join(', ')+'.','',
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
function verifyPublished({report, markdown, roots = resolveReportRoots(), lockOwner = null} = {}) {
  const stored = loadPublished(roots);
  if (!stored) {
    if(reviewCore.snapshotTree(roots.primary).length || reviewCore.snapshotTree(roots.secondary).length) {
      fail('BLOCKED_ROOT_CAUSE_UNEXPECTED_PARTIAL_FILES');
    }
    return {decision:'NOT_PUBLISHED',writes:0};
  }
  const requiredPaths = ['reports/root-cause.json','reports/root-cause.md',
    'runtime-revisions/root-cause-v1.json','evidence-manifest.json','evidence-manifest.sha256'];
  const lockPath = 'locks/root-cause-publish.lock';
  const allowedPaths = new Set([...requiredPaths,lockPath]);
  const primary = reviewCore.snapshotTree(roots.primary);
  const secondary = reviewCore.snapshotTree(roots.secondary);
  const primaryPaths = primary.map(row=>row.path), secondaryPaths = secondary.map(row=>row.path);
  const completeSnapshot = paths => requiredPaths.every(name=>paths.includes(name))
    && paths.every(name=>allowedPaths.has(name));
  if (!completeSnapshot(primaryPaths) || !completeSnapshot(secondaryPaths)
      || !equal(primary.map(({mtimeMs,...rest})=>rest),secondary.map(({mtimeMs,...rest})=>rest))) {
    fail('BLOCKED_ROOT_CAUSE_EXTRA_OR_DIVERGENT_FILES');
  }
  const lockPresent = primaryPaths.includes(lockPath) || secondaryPaths.includes(lockPath);
  if (lockPresent) {
    const lock = lockOwner && reviewCore.readDual(roots,lockPath);
    if (!lockOwner || !lock || !lock.bytes.equals(lockOwner.data)) fail('BLOCKED_ROOT_CAUSE_LOCKED');
  }
  const json = jsonBytes(report), md = Buffer.from(markdown);
  if (!stored['reports/root-cause.json'].bytes.equals(json) || !stored['reports/root-cause.md'].bytes.equals(md)) {
    fail('BLOCKED_ROOT_CAUSE_PUBLISHED_DRIFT');
  }
  const identity=JSON.parse(stored['runtime-revisions/root-cause-v1.json'].bytes.toString('utf8'));
  if (identity.schemaVersion !== 1 || identity.epoch !== EPOCH
      || identity.creatorHead !== report.currentHead || identity.contractSha256 !== CONTRACT_SHA256
      || identity.reportSha256 !== sha(json) || identity.markdownSha256 !== sha(md)
      || !equal(identity.sourceHashes,report.sourceHashes)
      || !equal(identity.inputIdentities,report.inputIdentities)) {
    fail('BLOCKED_ROOT_CAUSE_RUNTIME_IDENTITY');
  }
  const files=JSON.parse(stored['evidence-manifest.json'].bytes.toString('utf8'));
  const manifestPath='evidence-manifest.sha256';
  if (stored[manifestPath].bytes.toString('utf8') !== stored['evidence-manifest.json'].sha256+'\n'
      || files.schemaVersion !== 1 || files.epoch !== EPOCH || files.creatorHead !== report.currentHead
      || !Array.isArray(files.files) || files.files.length!==3) fail('BLOCKED_ROOT_CAUSE_MANIFEST');
  const manifestPaths=files.files.map(file=>file.path);
  const manifestSet=new Set(manifestPaths);
  const requiredManifestPaths=['reports/root-cause.json','reports/root-cause.md','runtime-revisions/root-cause-v1.json'];
  if (manifestSet.size!==manifestPaths.length || manifestSet.size!==requiredManifestPaths.length
      || requiredManifestPaths.some(name=>!manifestSet.has(name))) fail('BLOCKED_ROOT_CAUSE_MANIFEST');
  for(const file of files.files) {
    const record=stored[file.path];
    if(!record || record.sha256!==file.sha256 || record.size!==file.size) fail('BLOCKED_ROOT_CAUSE_MANIFEST_ENTRY');
  }
  return {decision:'PUBLISHED_VERIFIED',writes:0,reportSha256:sha(json),
    manifestSha256:stored['evidence-manifest.json'].sha256};
}
function assertPublishLockFree(roots) {
  const paths=reviewCore.dualPaths(roots,'locks/root-cause-publish.lock');
  if(fs.existsSync(paths.primary)||fs.existsSync(paths.secondary)) fail('BLOCKED_ROOT_CAUSE_LOCKED');
  return paths;
}
function assertPrHeadReadback({head, pr, remoteCommit, localTreeSha} = {}) {
  if (!pr || pr.state !== 'OPEN' || pr.headRefName !== PR_BRANCH || pr.headRefOid !== head) {
    fail('BLOCKED_ROOT_CAUSE_REMOTE_HEAD');
  }
  if (!remoteCommit || remoteCommit.sha !== head || remoteCommit.commit?.tree?.sha !== localTreeSha) {
    fail('BLOCKED_ROOT_CAUSE_REMOTE_COMMIT');
  }
  return {pullRequest: 'https://github.com/' + REPOSITORY + '/pull/' + PR_NUMBER, head};
}
function assertRemoteAndApproval(head) {
  const currentHead = commitHead();
  const committed = {}, working = {};
  for(const relative of SOURCE_PATHS) {
    if (!runRtk(['git','ls-files',relative])) fail('BLOCKED_ROOT_CAUSE_UNCOMMITTED_SOURCE',relative);
    committed[relative] = runRtk(['git','rev-parse','HEAD:'+relative]);
    working[relative] = runRtk(['git','hash-object',relative]);
  }
  assertSourceIdentity({expectedHead:head,currentHead,committed,working});
  const issue = JSON.parse(runRtk(['gh','issue','view','7','--repo',REPOSITORY,'--json','body,state,labels']));
  if (issue.state !== 'OPEN' || !issue.body.includes(CONTRACT_SHA256)
      || !issue.labels.some(row=>row.name==='blocked')) fail('BLOCKED_ROOT_CAUSE_APPROVAL');
  const pr = JSON.parse(runRtk(['gh','pr','view',String(PR_NUMBER),'--repo',REPOSITORY,'--json','state,headRefOid,headRefName']));
  const remote = JSON.parse(runRtk(['proxy','gh','api','repos/'+REPOSITORY+'/commits/'+head]));
  return assertPrHeadReadback({head,pr,remoteCommit:remote,
    localTreeSha:runRtk(['git','rev-parse','HEAD^{tree}'])});
}
function acquireLock(roots) {
  const paths=assertPublishLockFree(roots);
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
  const lock=acquireLock(roots);
  try {
    const existing=loadPublished(roots);
    const pre=parentSnapshots();
    assertParentSnapshotMatch(input.parentSnapshot,pre,'before-publication');
    if(existing) {
      const verified=verifyPublished({report,markdown,roots,lockOwner:lock});
      assertParentSnapshotMatch(input.parentSnapshot,parentSnapshots(),'after-reuse');
      return {...verified,reused:true};
    }
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
    const verified=verifyPublished({report,markdown,roots,lockOwner:lock});
    assertParentSnapshotMatch(input.parentSnapshot,parentSnapshots(),'after-publication');
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
  verifySourcesAndInputs,readOnlyDiagnosisWithOfficialEvaluations,buildResidualTable,classifyHypothesis,
  buildReport,renderMarkdown,resolveReportRoots,verifyPublished,assertPublishLockFree,
  assertSourceIdentity,assertParentSnapshotMatch,assertPrHeadReadback,publish,verify,parseMode,main,
  shapeFromOfficial,prepareReport};
