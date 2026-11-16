#!/usr/bin/env node
'use strict';

// Independent, append-only owner for Issue #7's approved contact-loss epoch.
// This file intentionally does not import the v3/v4/v5 experiment runners.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const {execFileSync, spawnSync} = require('node:child_process');
const core = require('./issue7-contact-loss-v1-core.cjs');

const ROOT = path.resolve(__dirname, '../../../../../../');
const REPOSITORY = 'puchinya/soraoto_dsl';
const PR_NUMBER = 8;
const PR_BRANCH = 'codex/issue-7-supersynth-v9';
const LOCAL_WORKTREE_BRANCH = 'codex/issue-7-pr8-root-cause-review';
const PR_URL = `https://github.com/${REPOSITORY}/pull/${PR_NUMBER}`;
const ISSUE_APPROVAL_MARKER = 'ISSUE7_CONTACT_LOSS_V1_GATE3_6_APPROVED';
const SUCCESSOR_APPROVAL_MARKER = 'ISSUE7_CONTACT_LOSS_V1_EXPERIMENT_02_APPROVED';
const CTEST_ORDER_APPROVAL_MARKER = 'ISSUE7_CONTACT_LOSS_CTEST_ORDER_AMENDMENT_APPROVED';
const PREPARE_RECOVERY_APPROVAL_MARKER = 'ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_APPROVED';
const PREPARE_RECOVERY_CONTINUATION_02_APPROVAL_MARKER = 'ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_02_APPROVED';
const PREPARE_RECOVERY_ANALYSIS21_AMENDMENT_APPROVAL_MARKER = 'ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_ANALYSIS21_AMENDMENT_APPROVED';
const CONTRACT_SHA256 = '54838dfea9832f6da358a1c620567b09246a54fdd26fb807bc74d4ceeb6dc4aa';
const SUCCESSOR_CONTRACT_SHA256 = '681eb29ca7f3e8dbd5c7d5fa1b4aaec7abe1686ac8f176ebc360a39cf78c19d7';
const CTEST_ORDER_CONTRACT_SHA256 = '106f22061781a2826a77d3ca0f83b85c79a7e03de4187c3407138090ae6d4ae3';
const PREPARE_RECOVERY_LEGACY_CONTRACT_SHA256 = '20241190b844ba47f3d317891776ba523ced0fa517c05207be9fa75e8ebd7be0';
const PREPARE_RECOVERY_CONTRACT_SHA256 = '8ef2b7eef8c904c65348d646ae60710f519df003d7ac4c95890e120d9e1deba9';
const CTEST_ORDER_CONTRACT_REL = 'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-ctest-order-contract.md';
const PREPARE_RECOVERY_CONTRACT_REL = 'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-prepare-recovery-contract.md';
const PREPARE_RECOVERY_CONTINUATION_02_DESIGN_SHA256 = 'ebcabaa5835a7f1987fa1bcc1a3a269392889252643c73ea93ee134d223feb58';
const PREPARE_RECOVERY_CONTINUATION_02_OFFLINE_EPOCH = 'physical-root-cause-offline-v1/analysis-21';
const PREPARE_RECOVERY_CONTINUATION_02_REL = 'prepare-recovery-continuation-02.json';
const PREPARE_RECOVERY_CONTINUATION_03_APPROVAL_MARKER = 'ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_ANALYSIS22_AMENDMENT_APPROVED';
const PREPARE_RECOVERY_CONTINUATION_03_DESIGN_SHA256 = '7fc787b69b662201e2f80278075c9ec387f857bf27bbc65649701d4b33fd9331';
const PREPARE_RECOVERY_CONTINUATION_03_OFFLINE_EPOCH = 'physical-root-cause-offline-v1/analysis-22';
const PREPARE_RECOVERY_CONTINUATION_03_REL = 'prepare-recovery-continuation-03.json';
const RECOVERY_CONTINUATION_03_EXECUTION_HEAD = '3cde7239219e20e5366e0ee9174a9bfbb76c23cd';
const RECOVERY_CONTINUATION_03_PREFLIGHT_SHA256 = 'a09b226809b839c0d56ee0327030fa80b2e88fe4d73dcce98bc24082a07b6f03';
const RECOVERY_CONTINUATION_03_RECEIPT_SHA256 = '64d087ea8861d55de24ef157386612eee920614fbe1fc7f38c17b1f0632c95ed';
const PREPARE_RECOVERY_CONTINUATION_04_APPROVAL_MARKER = 'ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_ANALYSIS23_AMENDMENT_APPROVED';
const PREPARE_RECOVERY_CONTINUATION_04_DESIGN_SHA256 = 'ebf0d65e31a4e0ce3e53ee88e300c4a55fe66954201f1e33c65acbf9aa5780bd';
const PREPARE_RECOVERY_CONTINUATION_04_OFFLINE_EPOCH = 'physical-root-cause-offline-v1/analysis-23';
const PREPARE_RECOVERY_CONTINUATION_04_REL = 'prepare-recovery-continuation-04.json';
const PREPARE_RECOVERY_CONTINUATION_05_APPROVAL_MARKER = 'ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_05_APPROVED';
const PREPARE_RECOVERY_CONTINUATION_05_DESIGN_SHA256 = '55d4d3f2481821310778733ec092aa3354f0c9e477672d4f3027d247824de173';
const PREPARE_RECOVERY_CONTINUATION_05_OFFLINE_EPOCH = 'physical-root-cause-offline-v1/analysis-24';
const PREPARE_RECOVERY_CONTINUATION_05_REL = 'prepare-recovery-continuation-05.json';
const PREPARE_RECOVERY_CONTINUATION_05_CONTRACT_REL = 'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-continuation-05-recovery-contract.md';
const PREPARE_RECOVERY_CONTINUATION_06_APPROVAL_MARKER = 'ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_06_APPROVED';
const PREPARE_RECOVERY_CONTINUATION_06_DESIGN_SHA256 = 'cd735bc1d262811927c28c5b2921cb34ee73ffea0ba70bb8530cffaf52addec6';
const PREPARE_RECOVERY_CONTINUATION_06_OFFLINE_EPOCH = 'physical-root-cause-offline-v1/analysis-25';
const PREPARE_RECOVERY_CONTINUATION_06_REL = 'prepare-recovery-continuation-06.json';
const PREPARE_RECOVERY_CONTINUATION_06_CONTRACT_REL = 'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-continuation-06-recovery-contract.md';
const PREPARE_RECOVERY_CONTINUATION_07_APPROVAL_MARKER = 'ISSUE7_CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_07_APPROVED';
const PREPARE_RECOVERY_CONTINUATION_07_CONTRACT_SHA256 = '0ac392630ebc956c1f5085067394bc372f7338c7d34e1fa2069ccedbe5bbd9ef';
const PREPARE_RECOVERY_CONTINUATION_07_DESIGN_SHA256 = PREPARE_RECOVERY_CONTINUATION_07_CONTRACT_SHA256;
const PREPARE_RECOVERY_CONTINUATION_07_OFFLINE_EPOCH = 'physical-root-cause-offline-v1/analysis-26';
const PREPARE_RECOVERY_CONTINUATION_07_REL = 'prepare-recovery-continuation-07.json';
const PREPARE_RECOVERY_CONTINUATION_07_CONTRACT_REL = 'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-continuation-07-recovery-contract.md';
const RECOVERY_ANALYSIS20_REPORT_SHA256 = 'af12be8d5cb0c03bbf8d5bba8085c7b848000d19f44c55c2e08b2bef72283120';
const RECOVERY_ANALYSIS20_MANIFEST_SHA256 = '48b5443923727fc56b3c2ecde468e201036f4411e100e11fc600db17b7a4b6e7';
const RECOVERY_ANALYSIS21_REPORT_SHA256 = '17f29d647d9b7422b50bc71e5c14551c331e6e3c284644b8199911378b2d213b';
const RECOVERY_ANALYSIS21_MANIFEST_SHA256 = '5946457acc8543d6b1bb247a621af70f82d543991d080d360882a6c3731127fd';
const RECOVERY_ANALYSIS22_REPORT_SHA256 = '70a0eda931a3db48a847d4b4c1600cd93aa796fdcf07828c01b95a5bc69b30bf';
const RECOVERY_ANALYSIS22_MANIFEST_SHA256 = '2794806e2100e9911152bf39667ae718fae727a3cd7169426b7aa518b567df8f';
const RECOVERY_ANALYSIS24_REPORT_SHA256 = '54b0673bb2a8d375b6109ba67768a355ad0d1c0ddac7aac44485fdcda9d21759';
const RECOVERY_ANALYSIS24_MANIFEST_SHA256 = '2a3456a69d09628d3afcc5e951b00222373289bc7198a3fe7156cf7b901b70b1';
const RECOVERY_ANALYSIS25_REPORT_SHA256 = 'f3fed67b45accb4b97f98effc3a06ce384b3708de59daff246ba876008ac0e63';
const RECOVERY_ANALYSIS25_MANIFEST_SHA256 = 'd9fa85b7782a8cf54cec48d39c52357db0cb8f2251ae38e243a1120e72406cdd';
const RECOVERY_PRIOR_ATTEMPT_REPORT_SHA256 = '49f1ae88d8583322cfc889d4c1bb03c02f43db5b74afbdebe524256734695048';
const RECOVERY_PRIOR_ATTEMPT_MANIFEST_SHA256 = '8ec1084e70f96ca0212d48ef328d075941efafc3dd8a0e8dcf2ac381acc22e1e';
const RECOVERY_FROZEN_BASE_LATEST_ANALYSIS = 17;
const RECOVERY_FROZEN_PINNED_IDENTITIES = Object.freeze({
  'analysis-18': Object.freeze({reportSha256: RECOVERY_PRIOR_ATTEMPT_REPORT_SHA256,
    manifestSha256: RECOVERY_PRIOR_ATTEMPT_MANIFEST_SHA256}),
  'analysis-20': Object.freeze({reportSha256: RECOVERY_ANALYSIS20_REPORT_SHA256,
    manifestSha256: RECOVERY_ANALYSIS20_MANIFEST_SHA256}),
  'analysis-21': Object.freeze({reportSha256: RECOVERY_ANALYSIS21_REPORT_SHA256,
    manifestSha256: RECOVERY_ANALYSIS21_MANIFEST_SHA256}),
  'analysis-22': Object.freeze({reportSha256: RECOVERY_ANALYSIS22_REPORT_SHA256,
    manifestSha256: RECOVERY_ANALYSIS22_MANIFEST_SHA256}),
  'analysis-24': Object.freeze({reportSha256: RECOVERY_ANALYSIS24_REPORT_SHA256,
    manifestSha256: RECOVERY_ANALYSIS24_MANIFEST_SHA256}),
  'analysis-25': Object.freeze({reportSha256: RECOVERY_ANALYSIS25_REPORT_SHA256,
    manifestSha256: RECOVERY_ANALYSIS25_MANIFEST_SHA256})
});
const RECOVERY_CONTINUATION_04_PREFLIGHT_SHA256 = '65cdc8b22ffc4d7ee5bd9e5f84fe9ea4953dd54959b28918fec6d6ca4e4d858d';
const RECOVERY_CONTINUATION_04_RECEIPT_SHA256 = '96d24196e6e7b585675a790b26f9a926c435556085255b2ec54ccf518b1ddc2c';
const RECOVERY_CONTINUATION_04_EXECUTION_HEAD = 'be2d89ca21e2286954196b426a97995cb3b9540a';
const RECOVERY_CONTINUATION_02_PREFLIGHT_SHA256 = 'ee5dd614522c3e3064efab5baaeac1deef9bce333600d4c498e6f35e1f8a6d86';
const RECOVERY_CONTINUATION_02_RECEIPT_SHA256 = '2a3dbcab25a699a38856a9e9c412aa2cda1c411b4c365ceb019683df932aae28';
const RECOVERY_CONTINUATION_02_EXECUTION_HEAD = '643862423efbb6a5790100289e2a9c358776e6f0';
const RECOVERY_ORIGINAL_HEAD = '7f7fd1074be24bada371a517468f1ff4366ef1fc';
const RECOVERY_ORIGINAL_PREPARE_SHA256 = '37b1d47a1329a48298feea6bc93f6bf540e50b30853abe10bc7b40fcac9bd8fd';
const RECOVERY_ORIGINAL_PLAN_SHA256 = '0eaa7f377420d893acb6692f08aa0a6fa0b9035f26422c7d284a15d5fa08f52a';
const RECOVERY_ORIGINAL_GATE3_SHA256 = 'df8fd945bc2936e99c51c082b4ad92d31921321b5a8332643d1e56227c93fcc2';
const RECOVERY_ORIGINAL_PREFLIGHT_SHA256 = '07a26cee19ba84b588d33f6e5967be5b3913ce11daf1eb0e6039c350894f3cb1';
const RECOVERY_ORIGINAL_APPROVAL_MARKER = 'ISSUE7_CONTACT_LOSS_V1_GATE3_6_APPROVED';
const RECOVERY_CURRENT_OFFLINE_EPOCH = 'physical-root-cause-offline-v1/analysis-19';
const RECOVERY_FIRST_EXECUTION_HEAD = 'e0a59dbf13d4910f2a342bf50fe2d846464c2b27';
const RECOVERY_FIRST_PREFLIGHT_SHA256 = 'b33563252befb268797189c5135babb7c6718c4d4e4a4f6b3eed2a90bbb7e138';
const RECOVERY_FIRST_RECEIPT_SHA256 = '0a212cfdb5a243056efe8206d327a42c526d643a6b55c71b2edf5d8ad277c539';
const BASELINE_HEAD = '3e3e3ba91b768767f38574b1dac9c65af75bbc23';
const BASELINE_PRODUCTION_WASM_SHA256 = 'f36b18c705a4ac1c965f10712ae2ebde86106c6048b3f5f6a59036e721163fd3';
const BASELINE_PRODUCTION_REPORT_SHA256 = '9f0e33296134825b9dc0e86f097e4648763fcae5378452bf85e4491a56df8de0';
const BASELINE_AUDIO_ERROR = 'field-wind-over-lumeria: true peak -32.387194396613445';
const BASELINE_STAGE4_INPUT_ERROR = 'persisted Stage4 lifecycle matrix is required; the Stage4 runner owns all acoustic renders';
const BASELINE_CTEST_FAILURES = Object.freeze([
  'wasm.audio-quality-regression',
  'wasm.dsp.super-synth.supersynth-v9-full-range-calibration',
  'wasm.dsp.super-synth.supersynth-v9-production-lifecycle'
]);
const ACTIVE_EPOCH = 'experiment-02';
const PARENT_EPOCH = 'experiment-01';
const PARENT_PREPARE_SHA256 = 'c49362c8db61ec223f78e7a326fb34eb6c49dd24f06bf48ea90bcc6d4624a24e';
const PARENT_PLAN_SHA256 = '7d80f490439baa0ca022c2372c1bcbb8236ba5315d8dd31784cd7673cb9f639b';
const PARENT_GATE3_SHA256 = '5b406ba0921e87fa8df3c0177fb2f8fc0f239eb611ed37f47c650d7220d39636';
const PARENT_HEAD = 'ebc63ea6a32fa20ed531fa5cc9a517dd7693b38c';
const PARENT_ROOT_MEMBERS = Object.freeze(['gate3-analysis.json', 'plan.json', 'prepare.json']);
const SUCCESSOR_CONTRACT_REL = 'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-contract.md';
const OFFLINE_EPOCH_PREFIX = 'physical-root-cause-offline-v1/analysis-';
const OFFLINE_FILES = Object.freeze(['report.json', 'manifest.json']);
const SOURCE_FILES = Object.freeze([
  'docs/specs/plugins/dsp/super-synth/physical-contact-loss-v1-amendment.md',
  'docs/specs/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-amendment.md',
  'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-design.md',
  'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-design.md',
  'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-contract.md',
  PREPARE_RECOVERY_CONTINUATION_07_CONTRACT_REL,
  CTEST_ORDER_CONTRACT_REL,
  PREPARE_RECOVERY_CONTRACT_REL,
  'wasm/CMakeLists.txt',
  'wasm/cmake/wasm_plugin.cmake',
  'wasm/cmake/wasm32-clang.cmake',
  'wasm/cmake/generate_plugin_metadata.py',
  'wasm/cmake/super_synth_metadata.py',
  'wasm/plugins/dsp/super-synth/src/plugin.c',
  'wasm/plugins/dsp/super-synth/presets.json',
  'wasm/shared/generated/super-synth_grand_profiles.h',
  'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json',
  'wasm/test/helpers/plugin-harness.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage3-direct-reference-metrics.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/physical-fit-v4-loss.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/analyze-issue7-physical-identification.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/issue7-physical-root-cause-offline-v1-core.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-stage4-lifecycle.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/stage4-full-range-evaluator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage3-current-build.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-stage4-current-build.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-stage3-production-recovery.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/issue7-current-build-core.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/salamander-metrics.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/piano-pitch-estimator.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/capture-supersynth-matrix.cjs',
  'wasm/plugins/dsp/super-synth/test/supersynth-v9-full-range-calibration.test.js',
  'wasm/plugins/dsp/super-synth/test/tools/issue7-contact-loss-v1-core.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/issue7-contact-loss-v1-core.test.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.test.cjs'
]);
const RECOVERY_ALLOWED_SOURCE_DELTA = Object.freeze([
  'docs/specs/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-amendment.md',
  'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-design.md',
  PREPARE_RECOVERY_CONTRACT_REL,
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.test.cjs'
]);
const RECOVERY_CONTINUATION_07_ALLOWED_SOURCE_DELTA = Object.freeze([
  ...RECOVERY_ALLOWED_SOURCE_DELTA, PREPARE_RECOVERY_CONTINUATION_07_CONTRACT_REL
]);
const EXPERIMENT_REL = 'experiment';
const DIAGNOSTIC_BUILD_REL = process.env.ISSUE7_CONTACT_LOSS_BUILD_DIR || 'build/wasm-contact-loss';
const WASM_REL = 'plugins/dsp/super-synth/plugin.wasm';
const P3_PINNED_SOURCE_COUNT = 13;
const P1_DIAGNOSTIC_WASM_REL = 'build/issue7-physical-identification-v1/diagnostic/plugins/dsp/super-synth/plugin.wasm';
const P1_DIAGNOSTIC_WASM_SHA256 = '1028c5a77b533ba97066d116f77aab80e5e91b45ef043394875614ee3efab99a';
const SAMPLE_RATE = 48000;
const RENDER_FRAMES = 24000;
const BLOCK_FRAMES = 128;
const ACCEPTANCE_ROOT = 'acceptance';
const CONFIRMATION_LAYERS = Object.freeze([14, 31, 36, 61, 124]);
const RELEASE_BUILD_REL = process.env.ISSUE7_CONTACT_LOSS_RELEASE_BUILD_DIR || 'build/wasm-contact-loss-release';

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function jsonBytes(value) { return Buffer.from(`${JSON.stringify(stable(value), null, 2)}\n`); }
function inside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function assertSafe(base, candidate) {
  const anchor = path.resolve(base), absolute = path.resolve(candidate);
  if (!inside(anchor, absolute)) throw new Error('BLOCKED_CONTACT_LOSS_PATH_ESCAPE');
  let cursor = anchor;
  try {
    const rootStat = fs.lstatSync(cursor);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || fs.realpathSync(cursor) !== cursor) {
      throw new Error('BLOCKED_CONTACT_LOSS_ROOT_UNSAFE');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const part of path.relative(anchor, absolute).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error('BLOCKED_CONTACT_LOSS_SYMLINK');
      if (cursor !== absolute && !stat.isDirectory()) throw new Error('BLOCKED_CONTACT_LOSS_PATH_NOT_DIRECTORY');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return absolute;
}
function resolveRoots({root = ROOT, home = os.homedir(), commonDirectory, epoch = ACTIVE_EPOCH} = {}) {
  if (![PARENT_EPOCH, ACTIVE_EPOCH].includes(epoch)) throw new Error('BLOCKED_CONTACT_LOSS_EPOCH');
  const repo = fs.realpathSync(path.resolve(root)), homePath = fs.realpathSync(path.resolve(home));
  const common = fs.realpathSync(path.resolve(commonDirectory || execFileSync('rtk',
    ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], {cwd: repo, encoding: 'utf8'}).trim()));
  const suffix = path.join('soraoto-agent-state', '7', 'physical-contact-loss-v1', epoch);
  const archiveSuffix = path.join('.soraoto-agent-archive', 'soraoto_dsl', '7', 'physical-contact-loss-v1', epoch);
  const roots = {repo, home: homePath, commonDirectory: common, epoch,
    primary: path.join(common, suffix), secondary: path.join(homePath, archiveSuffix)};
  assertSafe(common, roots.primary);
  assertSafe(homePath, roots.secondary);
  return roots;
}
function relativeFile(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)
      || relative.split(/[\\/]/).some(part => part === '..' || part === '.')) {
    throw new Error('BLOCKED_CONTACT_LOSS_RELATIVE_PATH');
  }
  return assertSafe(root, path.join(root, relative));
}
function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function readDual(roots, relative, {required = false} = {}) {
  const files = [relativeFile(roots.primary, relative), relativeFile(roots.secondary, relative)];
  const exists = files.map(file => {
    try { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('BLOCKED_CONTACT_LOSS_NONREGULAR_FILE'); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  });
  if (!exists[0] && !exists[1]) {
    if (required) throw new Error(`BLOCKED_CONTACT_LOSS_MISSING:${relative}`);
    return null;
  }
  if (exists[0] !== exists[1]) throw new Error(`BLOCKED_CONTACT_LOSS_DUAL_COPY_MISSING:${relative}`);
  const a = fs.readFileSync(files[0]), b = fs.readFileSync(files[1]);
  if (!a.equals(b)) throw new Error(`BLOCKED_CONTACT_LOSS_DUAL_COPY_DIVERGED:${relative}`);
  return {bytes: a, sha256: sha256(a)};
}
function mkdirSafe(root, directory) {
  const target = assertSafe(root, directory);
  const missing = [];
  let cursor = target;
  while (!fs.existsSync(cursor)) { missing.push(cursor); cursor = path.dirname(cursor); }
  for (const item of missing.reverse()) {
    fs.mkdirSync(item);
    const stat = fs.lstatSync(item);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('BLOCKED_CONTACT_LOSS_DIRECTORY_CREATE');
  }
  assertSafe(root, target);
  return target;
}
function createImmutable(root, relative, bytes) {
  const file = relativeFile(root, relative), directory = path.dirname(file);
  mkdirSafe(root, directory);
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fsyncDirectory(directory);
  return file;
}
function writeDualImmutable(roots, relative, bytes) {
  const value = Buffer.from(bytes), prior = readDual(roots, relative);
  if (prior) {
    if (!prior.bytes.equals(value)) throw new Error(`BLOCKED_CONTACT_LOSS_IMMUTABLE_CONFLICT:${relative}`);
    return {status: 'REUSED', sha256: prior.sha256, bytes: value.length};
  }
  // Each side is created exclusively. If either creation fails, preserve the partial
  // state so readback blocks automatic repair or overwrite on a later invocation.
  createImmutable(roots.primary, relative, value);
  createImmutable(roots.secondary, relative, value);
  const check = readDual(roots, relative, {required: true});
  if (!check.bytes.equals(value)) throw new Error(`BLOCKED_CONTACT_LOSS_READBACK:${relative}`);
  return {status: 'CREATED', sha256: check.sha256, bytes: value.length};
}
function readJsonDual(roots, relative, options) {
  const stored = readDual(roots, relative, options);
  if (!stored) return null;
  let value;
  try { value = JSON.parse(stored.bytes.toString('utf8')); } catch { throw new Error(`BLOCKED_CONTACT_LOSS_JSON:${relative}`); }
  if (!jsonBytes(value).equals(stored.bytes)) throw new Error(`BLOCKED_CONTACT_LOSS_NONCANONICAL_JSON:${relative}`);
  return {value, ...stored};
}
function syncReadSha(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('BLOCKED_CONTACT_LOSS_ARTIFACT_TYPE');
  const before = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
  const bytes = fs.readFileSync(file), afterStat = fs.lstatSync(file);
  const after = [afterStat.dev, afterStat.ino, afterStat.size, afterStat.mtimeMs, afterStat.ctimeMs].join(':');
  if (before !== after || bytes.length !== stat.size) throw new Error('BLOCKED_CONTACT_LOSS_ARTIFACT_CHANGED_DURING_READ');
  return {bytes, size: bytes.length, sha256: sha256(bytes), mtimeMs: stat.mtimeMs};
}
function git(root, args) {
  return execFileSync('rtk', ['git', ...args], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
}
function gitBytes(root, args) {
  return execFileSync('rtk', ['proxy', 'git', ...args], {cwd: root, stdio: ['ignore', 'pipe', 'ignore']});
}
function github(args, {cwd = ROOT} = {}) {
  const result = spawnSync('rtk', ['gh', ...args], {cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
  if (result.error || result.status !== 0) throw new Error('BLOCKED_CONTACT_LOSS_GITHUB_READBACK');
  return result.stdout.trim();
}
function currentIdentity(root = ROOT) {
  const status = git(root, ['status', '--porcelain=v2', '--branch', '--untracked-files=all']);
  const lines = status.split(/\r?\n/), oid = lines.find(line => line.startsWith('# branch.oid '))?.slice('# branch.oid '.length);
  const branch = lines.find(line => line.startsWith('# branch.head '))?.slice('# branch.head '.length);
  if (!oid || !/^[a-f0-9]{40}$/.test(oid) || !branch || lines.some(line => line && !line.startsWith('# '))) {
    throw new Error('BLOCKED_CONTACT_LOSS_DIRTY_OR_UNIDENTIFIED_WORKTREE');
  }
  return {head: oid, branch};
}
function verifiedPullRequest(root, expectedHead) {
  const pr = JSON.parse(github(['pr', 'view', String(PR_NUMBER), '--repo', REPOSITORY,
    '--json', 'state,number,headRefName,headRefOid,baseRefName,url'], {cwd: root}));
  if (pr.state !== 'OPEN' || pr.number !== PR_NUMBER || pr.headRefName !== PR_BRANCH
      || pr.headRefOid !== expectedHead || pr.baseRefName !== 'main' || pr.url !== PR_URL) {
    throw new Error('BLOCKED_CONTACT_LOSS_PR_HEAD_OR_BRANCH');
  }
  return pr;
}
function verifyIssueApproval(root = ROOT) {
  const issue = JSON.parse(github(['issue', 'view', '7', '--repo', REPOSITORY, '--json', 'state,body,labels'], {cwd: root}));
  if (issue.state !== 'OPEN') throw new Error('BLOCKED_CONTACT_LOSS_ISSUE_CLOSED');
  const labels = (issue.labels || []).map(row => row.name);
  if (!labels.includes('phase:implementation')) throw new Error('BLOCKED_CONTACT_LOSS_ISSUE_PHASE');
  const body = String(issue.body || '');
  if (!body.includes(SUCCESSOR_APPROVAL_MARKER) || !body.includes(SUCCESSOR_CONTRACT_SHA256)
      || !body.includes(CTEST_ORDER_APPROVAL_MARKER) || !body.includes(CTEST_ORDER_CONTRACT_SHA256)
      || !body.includes(PREPARE_RECOVERY_APPROVAL_MARKER) || !body.includes(PREPARE_RECOVERY_CONTRACT_SHA256)) {
    throw new Error('BLOCKED_CONTACT_LOSS_CTEST_ORDER_APPROVAL_MISSING');
  }
  const contractBytes = fs.readFileSync(path.join(root, SUCCESSOR_CONTRACT_REL));
  if (sha256(contractBytes) !== SUCCESSOR_CONTRACT_SHA256) throw new Error('BLOCKED_CONTACT_LOSS_SUCCESSOR_CONTRACT_SHA');
  const ctestContractBytes = fs.readFileSync(path.join(root, CTEST_ORDER_CONTRACT_REL));
  if (sha256(ctestContractBytes) !== CTEST_ORDER_CONTRACT_SHA256) throw new Error('BLOCKED_CONTACT_LOSS_CTEST_ORDER_CONTRACT_SHA');
  const recoveryContractBytes = fs.readFileSync(path.join(root, PREPARE_RECOVERY_CONTRACT_REL));
  if (sha256(recoveryContractBytes) !== PREPARE_RECOVERY_CONTRACT_SHA256) throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_RECOVERY_CONTRACT_SHA');
  if (body.includes(ISSUE_APPROVAL_MARKER)) return true;
  const comments = JSON.parse(github(['api', `repos/${REPOSITORY}/issues/7/comments?per_page=100`], {cwd: root}));
  if (!Array.isArray(comments) || !comments.some(row => String(row.body || '').includes(ISSUE_APPROVAL_MARKER))) {
    throw new Error('BLOCKED_CONTACT_LOSS_ISSUE_APPROVAL_MISSING');
  }
  return true;
}
function verifyPrepareRecoveryContinuation02Approval(root = ROOT) {
  const issue = JSON.parse(github(['issue', 'view', '7', '--repo', REPOSITORY,
    '--json', 'state,body,labels'], {cwd: root}));
  if (issue.state !== 'OPEN' || !(issue.labels || []).some(row => row.name === 'phase:implementation')
      || !String(issue.body || '').includes(PREPARE_RECOVERY_CONTINUATION_02_APPROVAL_MARKER)
      || !String(issue.body || '').includes(PREPARE_RECOVERY_ANALYSIS21_AMENDMENT_APPROVAL_MARKER)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_APPROVAL');
  }
  if (!String(issue.body || '').includes(PREPARE_RECOVERY_CONTINUATION_02_DESIGN_SHA256)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_DESIGN_SHA');
  }
  return true;
}
function verifyPrepareRecoveryContinuation03Approval(root = ROOT) {
  const issue = JSON.parse(github(['issue', 'view', '7', '--repo', REPOSITORY,
    '--json', 'state,body,labels'], {cwd: root}));
  if (issue.state !== 'OPEN' || !(issue.labels || []).some(row => row.name === 'phase:implementation')
      || !String(issue.body || '').includes(PREPARE_RECOVERY_CONTINUATION_03_APPROVAL_MARKER)
      || !String(issue.body || '').includes(PREPARE_RECOVERY_CONTINUATION_03_DESIGN_SHA256)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_APPROVAL');
  }
  // The current design is append-only and now includes continuation-04. The
  // immutable continuation-03 record and Issue body retain its historical SHA.
  return true;
}
function verifyPrepareRecoveryContinuation04Approval(root = ROOT) {
  const issue = JSON.parse(github(['issue', 'view', '7', '--repo', REPOSITORY,
    '--json', 'state,body,labels'], {cwd: root}));
  if (issue.state !== 'OPEN' || !(issue.labels || []).some(row => row.name === 'phase:implementation')
      || !String(issue.body || '').includes(PREPARE_RECOVERY_CONTINUATION_04_APPROVAL_MARKER)
      || !String(issue.body || '').includes(PREPARE_RECOVERY_CONTINUATION_04_DESIGN_SHA256)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_APPROVAL');
  }
  const design = fs.readFileSync(path.join(root,
    'docs/design/plugins/dsp/super-synth/physical-contact-loss-v1-experiment-02-design.md'));
  if (sha256(design) !== PREPARE_RECOVERY_CONTINUATION_04_DESIGN_SHA256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_DESIGN_SHA');
  }
  return true;
}
function verifyPrepareRecoveryContinuation05Approval(root = ROOT) {
  const issue = JSON.parse(github(['issue', 'view', '7', '--repo', REPOSITORY,
    '--json', 'state,body,labels'], {cwd: root}));
  if (issue.state !== 'OPEN' || !(issue.labels || []).some(row => row.name === 'phase:implementation')
      || !String(issue.body || '').includes(PREPARE_RECOVERY_CONTINUATION_05_APPROVAL_MARKER)
      || !String(issue.body || '').includes(PREPARE_RECOVERY_CONTINUATION_05_DESIGN_SHA256)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_APPROVAL');
  }
  const contract = fs.readFileSync(path.join(root, PREPARE_RECOVERY_CONTINUATION_05_CONTRACT_REL));
  if (sha256(contract) !== PREPARE_RECOVERY_CONTINUATION_05_DESIGN_SHA256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_CONTRACT_SHA');
  }
  return true;
}
function verifyPrepareRecoveryContinuation06Approval(root = ROOT) {
  const issue = JSON.parse(github(['issue', 'view', '7', '--repo', REPOSITORY,
    '--json', 'state,body,labels'], {cwd: root}));
  if (issue.state !== 'OPEN' || !(issue.labels || []).some(row => row.name === 'phase:implementation')
      || !String(issue.body || '').includes(PREPARE_RECOVERY_CONTINUATION_06_APPROVAL_MARKER)
      || !String(issue.body || '').includes(PREPARE_RECOVERY_CONTINUATION_06_DESIGN_SHA256)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_APPROVAL');
  }
  const contract = fs.readFileSync(path.join(root, PREPARE_RECOVERY_CONTINUATION_06_CONTRACT_REL));
  if (sha256(contract) !== PREPARE_RECOVERY_CONTINUATION_06_DESIGN_SHA256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_CONTRACT_SHA');
  }
  return true;
}
function verifyPrepareRecoveryContinuation07Approval(root = ROOT) {
  const issue = JSON.parse(github(['issue', 'view', '7', '--repo', REPOSITORY,
    '--json', 'state,body,labels'], {cwd: root}));
  if (issue.state !== 'OPEN' || !(issue.labels || []).some(row => row.name === 'phase:implementation')
      || !String(issue.body || '').includes(PREPARE_RECOVERY_CONTINUATION_07_APPROVAL_MARKER)
      || !String(issue.body || '').includes(PREPARE_RECOVERY_CONTINUATION_07_CONTRACT_SHA256)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_APPROVAL');
  }
  const contract = fs.readFileSync(path.join(root, PREPARE_RECOVERY_CONTINUATION_07_CONTRACT_REL));
  if (sha256(contract) !== PREPARE_RECOVERY_CONTINUATION_07_CONTRACT_SHA256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_CONTRACT_SHA');
  }
  return true;
}
function preflightFileName(head) {
  if (!/^[a-f0-9]{40}$/.test(head || '')) throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_HEAD');
  return `preflight-${head}.json`;
}
function extractJsonBlock(output, testName) {
  const marker = String(output).indexOf(testName);
  if (marker < 0) throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_CTEST_TEST_MISSING');
  const start = String(output).indexOf('{', marker);
  if (start < 0) throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_CTEST_JSON_MISSING');
  let depth = 0, inString = false, escaped = false;
  for (let index = start; index < output.length; index++) {
    const character = output[index];
    if (escaped) { escaped = false; continue; }
    if (inString && character === '\\') { escaped = true; continue; }
    if (character === '"') { inString = !inString; continue; }
    if (!inString) {
      if (character === '{') depth++;
      else if (character === '}' && --depth === 0) {
        try { return JSON.parse(output.slice(start, index + 1)); }
        catch { throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_CTEST_JSON_INVALID'); }
      }
    }
  }
  throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_CTEST_JSON_TRUNCATED');
}
function ctestSkippedCount(output) {
  return [...String(output).matchAll(/\*\*\*Skipped|\*\*\*Not Run/g)].length;
}
function nodeTestSummary(output) {
  const text = String(output);
  const pick = (name) => {
    const match = text.match(new RegExp(`(?:#|ℹ)\\s*${name}\\s+(\\d+)`, 'i'));
    return match ? Number(match[1]) : null;
  };
  const tests = pick('tests'), passed = pick('pass'), failed = pick('fail'), skipped = pick('skipped');
  if (![tests, passed, failed, skipped].every(Number.isSafeInteger)) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_NODE_SUMMARY');
  }
  return {tests, passed, failed, skipped};
}
function assertPreflightReceiptShape(report, expectedHead) {
  if (report.schemaVersion !== 1 || report.kind !== 'CONTACT_LOSS_PREPARE_PREFLIGHT'
      || report.decision !== 'PREPARE_PREFLIGHT_READY' || report.epoch !== ACTIVE_EPOCH
      || report.head !== expectedHead || report.branch !== PR_BRANCH
      || report.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
      || report.ctestOrderContractSha256 !== CTEST_ORDER_CONTRACT_SHA256
      || report.issueApprovalMarker !== ISSUE_APPROVAL_MARKER
      || report.successorApprovalMarker !== SUCCESSOR_APPROVAL_MARKER
      || report.ctestOrderApprovalMarker !== CTEST_ORDER_APPROVAL_MARKER
      || !/^[a-f0-9]{64}$/.test(report.gate3?.analysisSha256 || '')
      || !/^[a-f0-9]{64}$/.test(report.frozenSnapshotSha256 || '')
      || !report.parentProof || report.parentProof.epoch !== PARENT_EPOCH
      || report.parentProof.head !== PARENT_HEAD || report.parentProof.charged !== 0
      || report.parentProof.completed !== 0 || report.parentProof.ambiguous !== 0
      || report.baselineInputs?.baselineHead !== BASELINE_HEAD
      || !sameJson(report.baselineInputs?.unchangedPaths, [...BASELINE_INPUT_PATHS])
      || !sameJson(report.baselineInputs?.sourceHashes, BASELINE_TEST_SOURCE_HASHES)
      || report.frozenSnapshotSha256 !== frozenSnapshotSha256(report.frozenEvidenceSnapshot)
      || !report.source || report.builds?.diagnostic?.pass !== true || report.builds?.production?.pass !== true
      || !/^[a-f0-9]{64}$/.test(report.builds?.diagnostic?.wasm?.sha256 || '')
      || !/^[a-f0-9]{64}$/.test(report.builds?.production?.wasm?.sha256 || '')) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_RECEIPT_IDENTITY');
  }
  const {checks} = report;
  const p3Context = checks?.offlineFrozen?.sourceContext;
  if (p3Context?.kind !== 'P3_PINNED_TEMP_WORKTREE' || p3Context.head !== expectedHead
      || !/^[a-f0-9]{40}$/.test(p3Context.p3CreatorCommit || '')
      || !/^[a-f0-9]{64}$/.test(p3Context.p3RecordSha256 || '')
      || p3Context.p3SourceCount !== P3_PINNED_SOURCE_COUNT
      || !/^[a-f0-9]{64}$/.test(p3Context.p3SourceManifestSha256 || '')
      || p3Context.originalP1WasmSha256 !== P1_DIAGNOSTIC_WASM_SHA256
      || !Number.isSafeInteger(p3Context.originalP1WasmSize) || p3Context.originalP1WasmSize < 1
      || p3Context.upstreamVerified !== true || p3Context.worktreeRemoved !== true
      || p3Context.branchRemoved !== true) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_P3_CONTEXT');
  }
  for (const name of ['focusedNode', 'focusedCTest', 'offlineFrozen']) {
    const check = checks?.[name];
    if (!check || check.tests < 1 || check.passed !== check.tests || check.failed !== 0 || check.skipped !== 0
        || !/^[a-f0-9]{64}$/.test(check.stdoutSha256 || '')
        || !/^[a-f0-9]{64}$/.test(check.stderrSha256 || '')) {
      throw new Error(`BLOCKED_CONTACT_LOSS_PREFLIGHT_CHECK:${name}`);
    }
  }
  if (checks.focusedCTest.tests !== 2 || checks.focusedCTest.passed !== 2
      || checks.fullCTest?.decision !== 'BASELINE_FAILURES_DISCLOSED'
      || checks.fullCTest.baselineHead !== BASELINE_HEAD || checks.fullCTest.exitCode !== 8
      || checks.fullCTest.testCount !== 50 || checks.fullCTest.failedCount !== 3
      || checks.fullCTest.skippedCount !== 0
      || !sameJson(checks.fullCTest.failureNames, [...BASELINE_CTEST_FAILURES].sort())
      || checks.fullCTest.signatures?.audioQuality !== BASELINE_AUDIO_ERROR
      || checks.fullCTest.signatures?.productionLifecycleReportSha256 !== BASELINE_PRODUCTION_REPORT_SHA256
      || checks.fullCTest.signatures?.productionWasmSha256 !== BASELINE_PRODUCTION_WASM_SHA256
      || checks.fullCTest.signatures?.stage4Input !== BASELINE_STAGE4_INPUT_ERROR
      || !/^[a-f0-9]{64}$/.test(checks.fullCTest.stdoutSha256 || '')
      || !/^[a-f0-9]{64}$/.test(checks.fullCTest.stderrSha256 || '')) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_FULL_CTEST');
  }
  return report;
}
function assertRecoveryPreflightReceiptShape(report, expectedHead) {
  if (report?.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_PREFLIGHT') {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_PREFLIGHT_KIND');
  }
  assertPreflightReceiptShape({...report, kind: 'CONTACT_LOSS_PREPARE_PREFLIGHT'}, expectedHead);
  const recovery = report.recovery;
  if (recovery?.approvalMarker !== PREPARE_RECOVERY_APPROVAL_MARKER
      || recovery.contractSha256 !== PREPARE_RECOVERY_LEGACY_CONTRACT_SHA256
      || recovery.originalHead !== RECOVERY_ORIGINAL_HEAD
      || recovery.originalPrepareSha256 !== RECOVERY_ORIGINAL_PREPARE_SHA256
      || recovery.originalPlanSha256 !== RECOVERY_ORIGINAL_PLAN_SHA256
      || recovery.originalGate3Sha256 !== RECOVERY_ORIGINAL_GATE3_SHA256
      || recovery.originalPreflightFile !== preflightFileName(RECOVERY_ORIGINAL_HEAD)
      || recovery.originalPreflightSha256 !== RECOVERY_ORIGINAL_PREFLIGHT_SHA256
      || recovery.recoveryHead !== expectedHead
      || recovery.recoveryPreflightFile !== recoveryPreflightFileName(expectedHead)
      || !/^[a-f0-9]{64}$/.test(recovery.recoveryGate3AnalysisSha256 || '')
      || recovery.recoveryGate3AnalysisSha256 !== sha256(jsonBytes(recovery.gate3Analysis))
      || recovery.recoveryGate3AnalysisSha256 !== report.gate3?.analysisSha256
      || recovery.gate3Analysis?.head !== expectedHead
      || recovery.gate3Analysis?.offlineEpoch !== RECOVERY_CURRENT_OFFLINE_EPOCH
      || recovery.gate3Analysis?.status !== 'GATE3_ANALYSIS_PASS'
      || recovery.gate3Analysis?.cellCount !== 140 || recovery.gate3Analysis?.observationCount !== 20
      || !sameJson(Object.keys(recovery.sourceDelta || {}).sort(), [...RECOVERY_ALLOWED_SOURCE_DELTA].sort())) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_PREFLIGHT_IDENTITY');
  }
  return report;
}
function assertRecoveryContinuation02PreflightReceiptShape(report, expectedHead) {
  if (report?.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_02_PREFLIGHT') {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PREFLIGHT_KIND');
  }
  assertPreflightReceiptShape({...report, kind: 'CONTACT_LOSS_PREPARE_PREFLIGHT'}, expectedHead);
  const continuation = report.continuation02;
  if (continuation?.approvalMarker !== PREPARE_RECOVERY_CONTINUATION_02_APPROVAL_MARKER
      || continuation.amendmentApprovalMarker !== PREPARE_RECOVERY_ANALYSIS21_AMENDMENT_APPROVAL_MARKER
      || continuation.designSha256 !== PREPARE_RECOVERY_CONTINUATION_02_DESIGN_SHA256
      || continuation.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_02_OFFLINE_EPOCH
      || continuation.executionHead !== expectedHead
      || continuation.preflightFile !== recoveryPreflightFileName(expectedHead)
      || continuation.previousExecutionHead !== RECOVERY_FIRST_EXECUTION_HEAD
      || continuation.previousRecoveryPreflightSha256 !== RECOVERY_FIRST_PREFLIGHT_SHA256
      || continuation.previousRecoveryReceiptSha256 !== RECOVERY_FIRST_RECEIPT_SHA256
      || continuation.originalPrepareSha256 !== RECOVERY_ORIGINAL_PREPARE_SHA256
      || continuation.originalPlanSha256 !== RECOVERY_ORIGINAL_PLAN_SHA256
      || continuation.originalGate3Sha256 !== RECOVERY_ORIGINAL_GATE3_SHA256
      || continuation.originalPreflightSha256 !== RECOVERY_ORIGINAL_PREFLIGHT_SHA256
      || !/^[a-f0-9]{64}$/.test(continuation.offlineReportSha256 || '')
      || !/^[a-f0-9]{64}$/.test(continuation.offlineManifestSha256 || '')
      || continuation.gate3AnalysisSha256 !== report.gate3?.analysisSha256
      || continuation.gate3AnalysisSha256 !== sha256(jsonBytes(continuation.gate3Analysis))
      || continuation.gate3Analysis?.head !== expectedHead
      || continuation.gate3Analysis?.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_02_OFFLINE_EPOCH
      || continuation.gate3Analysis?.status !== 'GATE3_ANALYSIS_PASS'
      || continuation.gate3Analysis?.cellCount !== 140 || continuation.gate3Analysis?.observationCount !== 20
      || !sameJson(Object.keys(continuation.sourceDelta || {}).sort(), [...RECOVERY_ALLOWED_SOURCE_DELTA].sort())
      || !continuation.previousRootSnapshot) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PREFLIGHT_IDENTITY');
  }
  assertRecoveryContinuation02PriorRootSnapshot(continuation.previousRootSnapshot);
  return report;
}
function assertRecoveryContinuation02PriorRootSnapshot(snapshot) {
  const names = ['gate3-analysis.json', 'plan.json', 'prepare.json',
    preflightFileName(RECOVERY_ORIGINAL_HEAD),
    recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD), 'prepare-recovery.json'].sort();
  if (!snapshot?.primary || !snapshot?.secondary
      || !sameJson(Object.keys(snapshot.primary).sort(), names)
      || !sameJson(Object.keys(snapshot.secondary).sort(), names)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PREFIX_SET');
  }
  const expected = {'gate3-analysis.json': RECOVERY_ORIGINAL_GATE3_SHA256,
    'plan.json': RECOVERY_ORIGINAL_PLAN_SHA256, 'prepare.json': RECOVERY_ORIGINAL_PREPARE_SHA256,
    [preflightFileName(RECOVERY_ORIGINAL_HEAD)]: RECOVERY_ORIGINAL_PREFLIGHT_SHA256,
    [recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD)]: RECOVERY_FIRST_PREFLIGHT_SHA256,
    'prepare-recovery.json': RECOVERY_FIRST_RECEIPT_SHA256};
  for (const name of names) {
    const primary = snapshot.primary[name], secondary = snapshot.secondary[name];
    if (!sameBytesSnapshot(primary, secondary) || primary.sha256 !== expected[name]
        || !Number.isFinite(primary.mtimeMs) || !Number.isFinite(secondary.mtimeMs)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PREFIX_IDENTITY');
    }
  }
  return true;
}
function assertRecoveryContinuation03PriorRootSnapshot(snapshot) {
  const names = ['gate3-analysis.json', 'plan.json', 'prepare.json',
    preflightFileName(RECOVERY_ORIGINAL_HEAD),
    recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD), 'prepare-recovery.json',
    recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD),
    PREPARE_RECOVERY_CONTINUATION_02_REL].sort();
  if (!snapshot?.primary || !snapshot?.secondary
      || !sameJson(Object.keys(snapshot.primary).sort(), names)
      || !sameJson(Object.keys(snapshot.secondary).sort(), names)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_PREFIX_SET');
  }
  const expected = {'gate3-analysis.json': RECOVERY_ORIGINAL_GATE3_SHA256,
    'plan.json': RECOVERY_ORIGINAL_PLAN_SHA256, 'prepare.json': RECOVERY_ORIGINAL_PREPARE_SHA256,
    [preflightFileName(RECOVERY_ORIGINAL_HEAD)]: RECOVERY_ORIGINAL_PREFLIGHT_SHA256,
    [recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD)]: RECOVERY_FIRST_PREFLIGHT_SHA256,
    'prepare-recovery.json': RECOVERY_FIRST_RECEIPT_SHA256,
    [recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD)]: RECOVERY_CONTINUATION_02_PREFLIGHT_SHA256,
    [PREPARE_RECOVERY_CONTINUATION_02_REL]: RECOVERY_CONTINUATION_02_RECEIPT_SHA256};
  for (const name of names) {
    const primary = snapshot.primary[name], secondary = snapshot.secondary[name];
    if (!sameBytesSnapshot(primary, secondary) || primary.sha256 !== expected[name]
        || !Number.isFinite(primary.mtimeMs) || !Number.isFinite(secondary.mtimeMs)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_PREFIX_IDENTITY');
    }
  }
  return true;
}
function assertPrepareRecoveryContinuation02ReceiptShape(report) {
  if (report?.schemaVersion !== 1 || report.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_02'
      || report.issue !== 7 || report.pr !== PR_NUMBER || report.epoch !== ACTIVE_EPOCH
      || report.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
      || report.approvalMarker !== PREPARE_RECOVERY_CONTINUATION_02_APPROVAL_MARKER
      || report.amendmentApprovalMarker !== PREPARE_RECOVERY_ANALYSIS21_AMENDMENT_APPROVAL_MARKER
      || report.designSha256 !== PREPARE_RECOVERY_CONTINUATION_02_DESIGN_SHA256
      || report.previousExecutionHead !== RECOVERY_FIRST_EXECUTION_HEAD
      || report.previousRecoveryPreflightSha256 !== RECOVERY_FIRST_PREFLIGHT_SHA256
      || report.previousRecoveryReceiptSha256 !== RECOVERY_FIRST_RECEIPT_SHA256
      || report.original?.head !== RECOVERY_ORIGINAL_HEAD
      || report.original?.prepareSha256 !== RECOVERY_ORIGINAL_PREPARE_SHA256
      || report.original?.planSha256 !== RECOVERY_ORIGINAL_PLAN_SHA256
      || report.original?.gate3Sha256 !== RECOVERY_ORIGINAL_GATE3_SHA256
      || report.original?.preflightSha256 !== RECOVERY_ORIGINAL_PREFLIGHT_SHA256
      || !/^[a-f0-9]{40}$/.test(report.executionHead || '')
      || report.recovery?.head !== report.executionHead
      || report.recovery?.preflightFile !== recoveryPreflightFileName(report.executionHead)
      || !/^[a-f0-9]{64}$/.test(report.recovery?.preflightSha256 || '')
      || report.recovery?.gate3Analysis?.head !== report.executionHead
      || report.recovery?.gate3Analysis?.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_02_OFFLINE_EPOCH
      || report.recovery?.gate3Analysis?.status !== 'GATE3_ANALYSIS_PASS'
      || report.recovery?.gate3Analysis?.cellCount !== 140
      || report.recovery?.gate3Analysis?.observationCount !== 20
      || report.recovery?.gate3AnalysisSha256 !== sha256(jsonBytes(report.recovery?.gate3Analysis))
      || !/^[a-f0-9]{64}$/.test(report.recovery?.offlineReportSha256 || '')
      || !/^[a-f0-9]{64}$/.test(report.recovery?.offlineManifestSha256 || '')
      || report.recovery?.gate3Analysis?.offlineReportSha256 !== report.recovery.offlineReportSha256
      || report.recovery?.frozenSnapshotSha256 !== frozenSnapshotSha256(report.recovery?.frozenEvidenceSnapshot)
      || !report.recovery?.source || !report.recovery?.sourceDelta
      || !sameJson(Object.keys(report.recovery.sourceDelta).sort(), [...RECOVERY_ALLOWED_SOURCE_DELTA].sort())
      || !sameJson(report.calls, {started: 0, completed: 0, ambiguous: 0})
      || !sameJson(report.budget, core.accounting())
      || !report.parentProof || report.parentProof.epoch !== PARENT_EPOCH
      || report.parentProof.head !== PARENT_HEAD || report.parentProof.charged !== 0
      || report.parentProof.completed !== 0 || report.parentProof.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_RECEIPT_IDENTITY');
  }
  assertRecoveryContinuation02PriorRootSnapshot(report.previousRootSnapshot);
  return report;
}
function assertRecoveryContinuation03PreflightReceiptShape(report, expectedHead) {
  if (report?.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_03_PREFLIGHT') {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_PREFLIGHT_KIND');
  }
  assertPreflightReceiptShape({...report, kind: 'CONTACT_LOSS_PREPARE_PREFLIGHT'}, expectedHead);
  const continuation = report.continuation03;
  if (continuation?.approvalMarker !== PREPARE_RECOVERY_CONTINUATION_03_APPROVAL_MARKER
      || continuation.designSha256 !== PREPARE_RECOVERY_CONTINUATION_03_DESIGN_SHA256
      || continuation.executionHead !== expectedHead
      || continuation.preflightFile !== recoveryPreflightFileName(expectedHead)
      || continuation.previousExecutionHead !== RECOVERY_CONTINUATION_02_EXECUTION_HEAD
      || continuation.previousRecoveryPreflightSha256 !== RECOVERY_CONTINUATION_02_PREFLIGHT_SHA256
      || continuation.previousRecoveryReceiptSha256 !== RECOVERY_CONTINUATION_02_RECEIPT_SHA256
      || continuation.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_03_OFFLINE_EPOCH
      || continuation.originalPrepareSha256 !== RECOVERY_ORIGINAL_PREPARE_SHA256
      || continuation.originalPlanSha256 !== RECOVERY_ORIGINAL_PLAN_SHA256
      || continuation.originalGate3Sha256 !== RECOVERY_ORIGINAL_GATE3_SHA256
      || continuation.originalPreflightSha256 !== RECOVERY_ORIGINAL_PREFLIGHT_SHA256
      || continuation.gate3AnalysisSha256 !== report.gate3?.analysisSha256
      || continuation.gate3AnalysisSha256 !== sha256(jsonBytes(continuation.gate3Analysis))
      || continuation.gate3Analysis?.head !== expectedHead
      || continuation.gate3Analysis?.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_03_OFFLINE_EPOCH
      || continuation.gate3Analysis?.status !== 'GATE3_ANALYSIS_PASS'
      || continuation.gate3Analysis?.cellCount !== 140 || continuation.gate3Analysis?.observationCount !== 20
      || continuation.offlineReportSha256 !== continuation.gate3Analysis?.offlineReportSha256
      || !/^[a-f0-9]{64}$/.test(continuation.offlineManifestSha256 || '')
      || !sameJson(continuation.offlineHistory, {analysis20: {reportSha256: RECOVERY_ANALYSIS20_REPORT_SHA256,
        manifestSha256: RECOVERY_ANALYSIS20_MANIFEST_SHA256},
        analysis21: {reportSha256: RECOVERY_ANALYSIS21_REPORT_SHA256,
          manifestSha256: RECOVERY_ANALYSIS21_MANIFEST_SHA256},
        analysis22: {reportSha256: continuation.offlineReportSha256,
          manifestSha256: continuation.offlineManifestSha256}})
      || !sameJson(Object.keys(continuation.sourceDelta || {}).sort(), [...RECOVERY_ALLOWED_SOURCE_DELTA].sort())) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_PREFLIGHT_IDENTITY');
  }
  assertRecoveryContinuation03PriorRootSnapshot(continuation.previousRootSnapshot);
  return report;
}
function assertPrepareRecoveryContinuation03ReceiptShape(report) {
  if (report?.schemaVersion !== 1 || report.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_03'
      || report.issue !== 7 || report.pr !== PR_NUMBER || report.epoch !== ACTIVE_EPOCH
      || report.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
      || report.approvalMarker !== PREPARE_RECOVERY_CONTINUATION_03_APPROVAL_MARKER
      || report.designSha256 !== PREPARE_RECOVERY_CONTINUATION_03_DESIGN_SHA256
      || report.previousExecutionHead !== RECOVERY_CONTINUATION_02_EXECUTION_HEAD
      || report.previousRecoveryPreflightSha256 !== RECOVERY_CONTINUATION_02_PREFLIGHT_SHA256
      || report.previousRecoveryReceiptSha256 !== RECOVERY_CONTINUATION_02_RECEIPT_SHA256
      || report.original?.head !== RECOVERY_ORIGINAL_HEAD
      || report.original?.prepareSha256 !== RECOVERY_ORIGINAL_PREPARE_SHA256
      || report.original?.planSha256 !== RECOVERY_ORIGINAL_PLAN_SHA256
      || report.original?.gate3Sha256 !== RECOVERY_ORIGINAL_GATE3_SHA256
      || report.original?.preflightSha256 !== RECOVERY_ORIGINAL_PREFLIGHT_SHA256
      || !/^[a-f0-9]{40}$/.test(report.executionHead || '')
      || report.recovery?.head !== report.executionHead
      || report.recovery?.preflightFile !== recoveryPreflightFileName(report.executionHead)
      || !/^[a-f0-9]{64}$/.test(report.recovery?.preflightSha256 || '')
      || report.recovery?.gate3Analysis?.head !== report.executionHead
      || report.recovery?.gate3Analysis?.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_03_OFFLINE_EPOCH
      || report.recovery?.gate3Analysis?.status !== 'GATE3_ANALYSIS_PASS'
      || report.recovery?.gate3Analysis?.cellCount !== 140
      || report.recovery?.gate3Analysis?.observationCount !== 20
      || report.recovery?.gate3AnalysisSha256 !== sha256(jsonBytes(report.recovery?.gate3Analysis))
      || !/^[a-f0-9]{64}$/.test(report.recovery?.offlineReportSha256 || '')
      || !/^[a-f0-9]{64}$/.test(report.recovery?.offlineManifestSha256 || '')
      || report.recovery?.offlineReportSha256 !== report.recovery?.gate3Analysis?.offlineReportSha256
      || !sameJson(report.recovery?.offlineHistory, {analysis20: {reportSha256: RECOVERY_ANALYSIS20_REPORT_SHA256,
        manifestSha256: RECOVERY_ANALYSIS20_MANIFEST_SHA256},
        analysis21: {reportSha256: RECOVERY_ANALYSIS21_REPORT_SHA256,
          manifestSha256: RECOVERY_ANALYSIS21_MANIFEST_SHA256},
        analysis22: {reportSha256: report.recovery?.offlineReportSha256,
          manifestSha256: report.recovery?.offlineManifestSha256}})
      || report.recovery?.frozenSnapshotSha256 !== frozenSnapshotSha256(report.recovery?.frozenEvidenceSnapshot)
      || !report.recovery?.source || !report.recovery?.sourceDelta
      || !sameJson(Object.keys(report.recovery.sourceDelta).sort(), [...RECOVERY_ALLOWED_SOURCE_DELTA].sort())
      || !sameJson(report.calls, {started: 0, completed: 0, ambiguous: 0})
      || !sameJson(report.budget, core.accounting())
      || !report.parentProof || report.parentProof.epoch !== PARENT_EPOCH
      || report.parentProof.head !== PARENT_HEAD || report.parentProof.charged !== 0
      || report.parentProof.completed !== 0 || report.parentProof.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_RECEIPT_IDENTITY');
  }
  assertRecoveryContinuation03PriorRootSnapshot(report.previousRootSnapshot);
  return report;
}
function assertRecoveryContinuation04PriorRootSnapshot(snapshot) {
  const names = ['gate3-analysis.json', 'plan.json', 'prepare.json',
    preflightFileName(RECOVERY_ORIGINAL_HEAD),
    recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD), 'prepare-recovery.json',
    recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD),
    PREPARE_RECOVERY_CONTINUATION_02_REL,
    recoveryPreflightFileName(RECOVERY_CONTINUATION_03_EXECUTION_HEAD),
    PREPARE_RECOVERY_CONTINUATION_03_REL].sort();
  if (!snapshot?.primary || !snapshot?.secondary
      || !sameJson(Object.keys(snapshot.primary).sort(), names)
      || !sameJson(Object.keys(snapshot.secondary).sort(), names)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_PREFIX_SET');
  }
  const expected = {'gate3-analysis.json': RECOVERY_ORIGINAL_GATE3_SHA256,
    'plan.json': RECOVERY_ORIGINAL_PLAN_SHA256, 'prepare.json': RECOVERY_ORIGINAL_PREPARE_SHA256,
    [preflightFileName(RECOVERY_ORIGINAL_HEAD)]: RECOVERY_ORIGINAL_PREFLIGHT_SHA256,
    [recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD)]: RECOVERY_FIRST_PREFLIGHT_SHA256,
    'prepare-recovery.json': RECOVERY_FIRST_RECEIPT_SHA256,
    [recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD)]: RECOVERY_CONTINUATION_02_PREFLIGHT_SHA256,
    [PREPARE_RECOVERY_CONTINUATION_02_REL]: RECOVERY_CONTINUATION_02_RECEIPT_SHA256,
    [recoveryPreflightFileName(RECOVERY_CONTINUATION_03_EXECUTION_HEAD)]: RECOVERY_CONTINUATION_03_PREFLIGHT_SHA256,
    [PREPARE_RECOVERY_CONTINUATION_03_REL]: RECOVERY_CONTINUATION_03_RECEIPT_SHA256};
  for (const name of names) {
    const primary = snapshot.primary[name], secondary = snapshot.secondary[name];
    if (!sameBytesSnapshot(primary, secondary) || primary.sha256 !== expected[name]
        || !Number.isFinite(primary.mtimeMs) || !Number.isFinite(secondary.mtimeMs)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_PREFIX_IDENTITY');
    }
  }
  return true;
}
function assertRecoveryContinuation04PreflightReceiptShape(report, expectedHead) {
  if (report?.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_04_PREFLIGHT') {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_PREFLIGHT_KIND');
  }
  assertPreflightReceiptShape({...report, kind: 'CONTACT_LOSS_PREPARE_PREFLIGHT'}, expectedHead);
  const continuation = report.continuation04;
  if (continuation?.approvalMarker !== PREPARE_RECOVERY_CONTINUATION_04_APPROVAL_MARKER
      || continuation.designSha256 !== PREPARE_RECOVERY_CONTINUATION_04_DESIGN_SHA256
      || continuation.executionHead !== expectedHead
      || continuation.preflightFile !== recoveryPreflightFileName(expectedHead)
      || continuation.previousExecutionHead !== RECOVERY_CONTINUATION_03_EXECUTION_HEAD
      || continuation.previousRecoveryPreflightSha256 !== RECOVERY_CONTINUATION_03_PREFLIGHT_SHA256
      || continuation.previousRecoveryReceiptSha256 !== RECOVERY_CONTINUATION_03_RECEIPT_SHA256
      || continuation.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_04_OFFLINE_EPOCH
      || continuation.originalPrepareSha256 !== RECOVERY_ORIGINAL_PREPARE_SHA256
      || continuation.originalPlanSha256 !== RECOVERY_ORIGINAL_PLAN_SHA256
      || continuation.originalGate3Sha256 !== RECOVERY_ORIGINAL_GATE3_SHA256
      || continuation.originalPreflightSha256 !== RECOVERY_ORIGINAL_PREFLIGHT_SHA256
      || continuation.gate3AnalysisSha256 !== report.gate3?.analysisSha256
      || continuation.gate3AnalysisSha256 !== sha256(jsonBytes(continuation.gate3Analysis))
      || continuation.gate3Analysis?.head !== expectedHead
      || continuation.gate3Analysis?.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_04_OFFLINE_EPOCH
      || continuation.gate3Analysis?.status !== 'GATE3_ANALYSIS_PASS'
      || continuation.gate3Analysis?.cellCount !== 140 || continuation.gate3Analysis?.observationCount !== 20
      || continuation.offlineReportSha256 !== continuation.gate3Analysis?.offlineReportSha256
      || !/^[a-f0-9]{64}$/.test(continuation.offlineManifestSha256 || '')
      || !sameJson(continuation.offlineHistory, {analysis20: {reportSha256: RECOVERY_ANALYSIS20_REPORT_SHA256,
        manifestSha256: RECOVERY_ANALYSIS20_MANIFEST_SHA256},
        analysis21: {reportSha256: RECOVERY_ANALYSIS21_REPORT_SHA256,
          manifestSha256: RECOVERY_ANALYSIS21_MANIFEST_SHA256},
        analysis22: {reportSha256: RECOVERY_ANALYSIS22_REPORT_SHA256,
          manifestSha256: RECOVERY_ANALYSIS22_MANIFEST_SHA256},
        analysis23: {reportSha256: continuation.offlineReportSha256,
          manifestSha256: continuation.offlineManifestSha256}})
      || !sameJson(Object.keys(continuation.sourceDelta || {}).sort(), [...RECOVERY_ALLOWED_SOURCE_DELTA].sort())) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_PREFLIGHT_IDENTITY');
  }
  assertRecoveryContinuation04PriorRootSnapshot(continuation.previousRootSnapshot);
  return report;
}
function assertPrepareRecoveryContinuation04ReceiptShape(report) {
  if (report?.schemaVersion !== 1 || report.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_04'
      || report.issue !== 7 || report.pr !== PR_NUMBER || report.epoch !== ACTIVE_EPOCH
      || report.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
      || report.approvalMarker !== PREPARE_RECOVERY_CONTINUATION_04_APPROVAL_MARKER
      || report.designSha256 !== PREPARE_RECOVERY_CONTINUATION_04_DESIGN_SHA256
      || report.previousExecutionHead !== RECOVERY_CONTINUATION_03_EXECUTION_HEAD
      || report.previousRecoveryPreflightSha256 !== RECOVERY_CONTINUATION_03_PREFLIGHT_SHA256
      || report.previousRecoveryReceiptSha256 !== RECOVERY_CONTINUATION_03_RECEIPT_SHA256
      || report.original?.head !== RECOVERY_ORIGINAL_HEAD
      || report.original?.prepareSha256 !== RECOVERY_ORIGINAL_PREPARE_SHA256
      || report.original?.planSha256 !== RECOVERY_ORIGINAL_PLAN_SHA256
      || report.original?.gate3Sha256 !== RECOVERY_ORIGINAL_GATE3_SHA256
      || report.original?.preflightSha256 !== RECOVERY_ORIGINAL_PREFLIGHT_SHA256
      || !/^[a-f0-9]{40}$/.test(report.executionHead || '')
      || report.recovery?.head !== report.executionHead
      || report.recovery?.preflightFile !== recoveryPreflightFileName(report.executionHead)
      || !/^[a-f0-9]{64}$/.test(report.recovery?.preflightSha256 || '')
      || report.recovery?.gate3Analysis?.head !== report.executionHead
      || report.recovery?.gate3Analysis?.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_04_OFFLINE_EPOCH
      || report.recovery?.gate3Analysis?.status !== 'GATE3_ANALYSIS_PASS'
      || report.recovery?.gate3Analysis?.cellCount !== 140
      || report.recovery?.gate3Analysis?.observationCount !== 20
      || report.recovery?.gate3AnalysisSha256 !== sha256(jsonBytes(report.recovery?.gate3Analysis))
      || !/^[a-f0-9]{64}$/.test(report.recovery?.offlineReportSha256 || '')
      || !/^[a-f0-9]{64}$/.test(report.recovery?.offlineManifestSha256 || '')
      || report.recovery?.offlineReportSha256 !== report.recovery?.gate3Analysis?.offlineReportSha256
      || !sameJson(report.recovery?.offlineHistory, {analysis20: {reportSha256: RECOVERY_ANALYSIS20_REPORT_SHA256,
        manifestSha256: RECOVERY_ANALYSIS20_MANIFEST_SHA256},
        analysis21: {reportSha256: RECOVERY_ANALYSIS21_REPORT_SHA256,
          manifestSha256: RECOVERY_ANALYSIS21_MANIFEST_SHA256},
        analysis22: {reportSha256: RECOVERY_ANALYSIS22_REPORT_SHA256,
          manifestSha256: RECOVERY_ANALYSIS22_MANIFEST_SHA256},
        analysis23: {reportSha256: report.recovery?.offlineReportSha256,
          manifestSha256: report.recovery?.offlineManifestSha256}})
      || report.recovery?.frozenSnapshotSha256 !== frozenSnapshotSha256(report.recovery?.frozenEvidenceSnapshot)
      || !report.recovery?.source || !report.recovery?.sourceDelta
      || !sameJson(Object.keys(report.recovery.sourceDelta).sort(), [...RECOVERY_ALLOWED_SOURCE_DELTA].sort())
      || !sameJson(report.calls, {started: 0, completed: 0, ambiguous: 0})
      || !sameJson(report.budget, core.accounting())
      || !report.parentProof || report.parentProof.epoch !== PARENT_EPOCH
      || report.parentProof.head !== PARENT_HEAD || report.parentProof.charged !== 0
      || report.parentProof.completed !== 0 || report.parentProof.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_RECEIPT_IDENTITY');
  }
  assertRecoveryContinuation04PriorRootSnapshot(report.previousRootSnapshot);
  return report;
}
function assertRecoveryContinuation05PriorRootSnapshot(snapshot,
  {executionHead, preflightSha256, receiptSha256} = {}) {
  const names = ['gate3-analysis.json', 'plan.json', 'prepare.json',
    preflightFileName(RECOVERY_ORIGINAL_HEAD),
    recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD), 'prepare-recovery.json',
    recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD), PREPARE_RECOVERY_CONTINUATION_02_REL,
    recoveryPreflightFileName(RECOVERY_CONTINUATION_03_EXECUTION_HEAD), PREPARE_RECOVERY_CONTINUATION_03_REL,
    recoveryPreflightFileName(executionHead), PREPARE_RECOVERY_CONTINUATION_04_REL].sort();
  if (!/^[a-f0-9]{40}$/.test(executionHead || '')
      || !/^[a-f0-9]{64}$/.test(preflightSha256 || '')
      || !/^[a-f0-9]{64}$/.test(receiptSha256 || '')
      || !snapshot?.primary || !snapshot?.secondary
      || !sameJson(Object.keys(snapshot.primary).sort(), names)
      || !sameJson(Object.keys(snapshot.secondary).sort(), names)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_PREFIX_SET');
  }
  const expected = {'gate3-analysis.json': RECOVERY_ORIGINAL_GATE3_SHA256,
    'plan.json': RECOVERY_ORIGINAL_PLAN_SHA256, 'prepare.json': RECOVERY_ORIGINAL_PREPARE_SHA256,
    [preflightFileName(RECOVERY_ORIGINAL_HEAD)]: RECOVERY_ORIGINAL_PREFLIGHT_SHA256,
    [recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD)]: RECOVERY_FIRST_PREFLIGHT_SHA256,
    'prepare-recovery.json': RECOVERY_FIRST_RECEIPT_SHA256,
    [recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD)]: RECOVERY_CONTINUATION_02_PREFLIGHT_SHA256,
    [PREPARE_RECOVERY_CONTINUATION_02_REL]: RECOVERY_CONTINUATION_02_RECEIPT_SHA256,
    [recoveryPreflightFileName(RECOVERY_CONTINUATION_03_EXECUTION_HEAD)]: RECOVERY_CONTINUATION_03_PREFLIGHT_SHA256,
    [PREPARE_RECOVERY_CONTINUATION_03_REL]: RECOVERY_CONTINUATION_03_RECEIPT_SHA256,
    [recoveryPreflightFileName(executionHead)]: preflightSha256,
    [PREPARE_RECOVERY_CONTINUATION_04_REL]: receiptSha256};
  for (const name of names) {
    const primary = snapshot.primary[name], secondary = snapshot.secondary[name];
    if (!sameBytesSnapshot(primary, secondary) || primary.sha256 !== expected[name]
        || !Number.isFinite(primary.mtimeMs) || !Number.isFinite(secondary.mtimeMs)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_PREFIX_IDENTITY');
    }
  }
  return true;
}
function assertContinuation05OfflineHistory(history, {includeAnalysis24 = true} = {}) {
  const expectedKeys = ['analysis20', 'analysis21', 'analysis22', 'analysis23',
    ...(includeAnalysis24 ? ['analysis24'] : [])];
  if (!sameJson(Object.keys(history || {}).sort(),
    expectedKeys)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_OFFLINE_HISTORY');
  }
  for (const [epoch, expected] of [['analysis20', RECOVERY_ANALYSIS20_REPORT_SHA256],
    ['analysis21', RECOVERY_ANALYSIS21_REPORT_SHA256], ['analysis22', RECOVERY_ANALYSIS22_REPORT_SHA256]]) {
    if (history[epoch]?.reportSha256 !== expected || !/^[a-f0-9]{64}$/.test(history[epoch]?.manifestSha256 || '')) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_OFFLINE_HISTORY');
    }
  }
  for (const epoch of ['analysis23', ...(includeAnalysis24 ? ['analysis24'] : [])]) {
    if (!/^[a-f0-9]{64}$/.test(history[epoch]?.reportSha256 || '')
        || !/^[a-f0-9]{64}$/.test(history[epoch]?.manifestSha256 || '')) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_OFFLINE_HISTORY');
    }
  }
  return true;
}
function assertContinuation06OfflineHistory(history, {includeAnalysis25 = true} = {}) {
  const expectedKeys = ['analysis20', 'analysis21', 'analysis22', 'analysis23', 'analysis24',
    ...(includeAnalysis25 ? ['analysis25'] : [])];
  if (!sameJson(Object.keys(history || {}).sort(), expectedKeys)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_OFFLINE_HISTORY');
  }
  for (const [epoch, expected] of [['analysis20', RECOVERY_ANALYSIS20_REPORT_SHA256],
    ['analysis21', RECOVERY_ANALYSIS21_REPORT_SHA256], ['analysis22', RECOVERY_ANALYSIS22_REPORT_SHA256]]) {
    if (history[epoch]?.reportSha256 !== expected || !/^[a-f0-9]{64}$/.test(history[epoch]?.manifestSha256 || '')) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_OFFLINE_HISTORY');
    }
  }
  for (const epoch of ['analysis23']) {
    if (!/^[a-f0-9]{64}$/.test(history[epoch]?.reportSha256 || '')
        || !/^[a-f0-9]{64}$/.test(history[epoch]?.manifestSha256 || '')) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_OFFLINE_HISTORY');
    }
  }
  if (history.analysis24?.reportSha256 !== RECOVERY_ANALYSIS24_REPORT_SHA256
      || history.analysis24?.manifestSha256 !== RECOVERY_ANALYSIS24_MANIFEST_SHA256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_ANALYSIS24_IDENTITY');
  }
  if (includeAnalysis25 && (!/^[a-f0-9]{64}$/.test(history.analysis25?.reportSha256 || '')
      || !/^[a-f0-9]{64}$/.test(history.analysis25?.manifestSha256 || ''))) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_OFFLINE_HISTORY');
  }
  return true;
}
function assertRecoveryContinuation05PreflightReceiptShape(report, expectedHead) {
  if (report?.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_05_PREFLIGHT') {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_PREFLIGHT_KIND');
  }
  assertPreflightReceiptShape({...report, kind: 'CONTACT_LOSS_PREPARE_PREFLIGHT'}, expectedHead);
  const continuation = report.continuation05;
  if (continuation?.approvalMarker !== PREPARE_RECOVERY_CONTINUATION_05_APPROVAL_MARKER
      || continuation.designSha256 !== PREPARE_RECOVERY_CONTINUATION_05_DESIGN_SHA256
      || continuation.executionHead !== expectedHead
      || continuation.preflightFile !== recoveryPreflightFileName(expectedHead)
      || !/^[a-f0-9]{40}$/.test(continuation.previousExecutionHead || '')
      || !/^[a-f0-9]{64}$/.test(continuation.previousRecoveryPreflightSha256 || '')
      || !/^[a-f0-9]{64}$/.test(continuation.previousRecoveryReceiptSha256 || '')
      || continuation.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_05_OFFLINE_EPOCH
      || continuation.originalPrepareSha256 !== RECOVERY_ORIGINAL_PREPARE_SHA256
      || continuation.originalPlanSha256 !== RECOVERY_ORIGINAL_PLAN_SHA256
      || continuation.originalGate3Sha256 !== RECOVERY_ORIGINAL_GATE3_SHA256
      || continuation.originalPreflightSha256 !== RECOVERY_ORIGINAL_PREFLIGHT_SHA256
      || continuation.gate3AnalysisSha256 !== report.gate3?.analysisSha256
      || continuation.gate3AnalysisSha256 !== sha256(jsonBytes(continuation.gate3Analysis))
      || continuation.gate3Analysis?.head !== expectedHead
      || continuation.gate3Analysis?.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_05_OFFLINE_EPOCH
      || continuation.gate3Analysis?.status !== 'GATE3_ANALYSIS_PASS'
      || continuation.gate3Analysis?.cellCount !== 140 || continuation.gate3Analysis?.observationCount !== 20
      || continuation.offlineReportSha256 !== continuation.gate3Analysis?.offlineReportSha256
      || !/^[a-f0-9]{64}$/.test(continuation.offlineManifestSha256 || '')
      || !continuation.previousOfflineHistory || !continuation.offlineHistory
      || !sameJson(continuation.offlineHistory.analysis20, continuation.previousOfflineHistory.analysis20)
      || !sameJson(continuation.offlineHistory.analysis21, continuation.previousOfflineHistory.analysis21)
      || !sameJson(continuation.offlineHistory.analysis22, continuation.previousOfflineHistory.analysis22)
      || !sameJson(continuation.offlineHistory.analysis23, continuation.previousOfflineHistory.analysis23)
      || continuation.offlineHistory.analysis24?.reportSha256 !== continuation.offlineReportSha256
      || continuation.offlineHistory.analysis24?.manifestSha256 !== continuation.offlineManifestSha256
      || !sameJson(Object.keys(continuation.sourceDelta || {}).sort(), [...RECOVERY_ALLOWED_SOURCE_DELTA].sort())) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_PREFLIGHT_IDENTITY');
  }
  assertContinuation05OfflineHistory(continuation.previousOfflineHistory, {includeAnalysis24: false});
  assertContinuation05OfflineHistory(continuation.offlineHistory);
  assertRecoveryContinuation05PriorRootSnapshot(continuation.previousRootSnapshot, {
    executionHead: continuation.previousExecutionHead,
    preflightSha256: continuation.previousRecoveryPreflightSha256,
    receiptSha256: continuation.previousRecoveryReceiptSha256});
  return report;
}
function assertPrepareRecoveryContinuation05ReceiptShape(report) {
  if (report?.schemaVersion !== 1 || report.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_05'
      || report.issue !== 7 || report.pr !== PR_NUMBER || report.epoch !== ACTIVE_EPOCH
      || report.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
      || report.approvalMarker !== PREPARE_RECOVERY_CONTINUATION_05_APPROVAL_MARKER
      || report.designSha256 !== PREPARE_RECOVERY_CONTINUATION_05_DESIGN_SHA256
      || !/^[a-f0-9]{40}$/.test(report.previousExecutionHead || '')
      || !/^[a-f0-9]{64}$/.test(report.previousRecoveryPreflightSha256 || '')
      || !/^[a-f0-9]{64}$/.test(report.previousRecoveryReceiptSha256 || '')
      || report.original?.head !== RECOVERY_ORIGINAL_HEAD
      || report.original?.prepareSha256 !== RECOVERY_ORIGINAL_PREPARE_SHA256
      || report.original?.planSha256 !== RECOVERY_ORIGINAL_PLAN_SHA256
      || report.original?.gate3Sha256 !== RECOVERY_ORIGINAL_GATE3_SHA256
      || report.original?.preflightSha256 !== RECOVERY_ORIGINAL_PREFLIGHT_SHA256
      || !/^[a-f0-9]{40}$/.test(report.executionHead || '')
      || report.recovery?.head !== report.executionHead
      || report.recovery?.preflightFile !== recoveryPreflightFileName(report.executionHead)
      || !/^[a-f0-9]{64}$/.test(report.recovery?.preflightSha256 || '')
      || report.recovery?.gate3Analysis?.head !== report.executionHead
      || report.recovery?.gate3Analysis?.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_05_OFFLINE_EPOCH
      || report.recovery?.gate3Analysis?.status !== 'GATE3_ANALYSIS_PASS'
      || report.recovery?.gate3Analysis?.cellCount !== 140
      || report.recovery?.gate3Analysis?.observationCount !== 20
      || report.recovery?.gate3AnalysisSha256 !== sha256(jsonBytes(report.recovery?.gate3Analysis))
      || !/^[a-f0-9]{64}$/.test(report.recovery?.offlineReportSha256 || '')
      || !/^[a-f0-9]{64}$/.test(report.recovery?.offlineManifestSha256 || '')
      || report.recovery?.offlineReportSha256 !== report.recovery?.gate3Analysis?.offlineReportSha256
      || !report.recovery?.offlineHistory || !report.recovery?.previousOfflineHistory
      || !sameJson(report.recovery.offlineHistory.analysis24, {reportSha256: report.recovery.offlineReportSha256,
        manifestSha256: report.recovery.offlineManifestSha256})
      || !sameJson(report.recovery.previousOfflineHistory, {...report.recovery.offlineHistory,
        analysis24: undefined})
      || report.recovery?.frozenSnapshotSha256 !== frozenSnapshotSha256(report.recovery?.frozenEvidenceSnapshot)
      || !report.recovery?.source || !report.recovery?.sourceDelta
      || !sameJson(Object.keys(report.recovery.sourceDelta).sort(), [...RECOVERY_ALLOWED_SOURCE_DELTA].sort())
      || !sameJson(report.calls, {started: 0, completed: 0, ambiguous: 0})
      || !sameJson(report.budget, core.accounting())
      || !report.parentProof || report.parentProof.epoch !== PARENT_EPOCH
      || report.parentProof.head !== PARENT_HEAD || report.parentProof.charged !== 0
      || report.parentProof.completed !== 0 || report.parentProof.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_RECEIPT_IDENTITY');
  }
  assertContinuation05OfflineHistory(report.recovery.previousOfflineHistory, {includeAnalysis24: false});
  assertContinuation05OfflineHistory(report.recovery.offlineHistory);
  assertRecoveryContinuation05PriorRootSnapshot(report.previousRootSnapshot, {
    executionHead: report.previousExecutionHead,
    preflightSha256: report.previousRecoveryPreflightSha256,
    receiptSha256: report.previousRecoveryReceiptSha256});
  return report;
}
function assertRecoveryContinuation06PreflightReceiptShape(report, expectedHead) {
  if (report?.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_06_PREFLIGHT') {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_PREFLIGHT_KIND');
  }
  assertPreflightReceiptShape({...report, kind: 'CONTACT_LOSS_PREPARE_PREFLIGHT'}, expectedHead);
  const continuation = report.continuation06;
  if (continuation?.approvalMarker !== PREPARE_RECOVERY_CONTINUATION_06_APPROVAL_MARKER
      || continuation.designSha256 !== PREPARE_RECOVERY_CONTINUATION_06_DESIGN_SHA256
      || continuation.executionHead !== expectedHead
      || continuation.preflightFile !== recoveryPreflightFileName(expectedHead)
      || continuation.previousExecutionHead !== RECOVERY_CONTINUATION_04_EXECUTION_HEAD
      || continuation.previousRecoveryPreflightSha256 !== RECOVERY_CONTINUATION_04_PREFLIGHT_SHA256
      || continuation.previousRecoveryReceiptSha256 !== RECOVERY_CONTINUATION_04_RECEIPT_SHA256
      || continuation.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_06_OFFLINE_EPOCH
      || continuation.originalPrepareSha256 !== RECOVERY_ORIGINAL_PREPARE_SHA256
      || continuation.originalPlanSha256 !== RECOVERY_ORIGINAL_PLAN_SHA256
      || continuation.originalGate3Sha256 !== RECOVERY_ORIGINAL_GATE3_SHA256
      || continuation.originalPreflightSha256 !== RECOVERY_ORIGINAL_PREFLIGHT_SHA256
      || continuation.gate3AnalysisSha256 !== report.gate3?.analysisSha256
      || continuation.gate3AnalysisSha256 !== sha256(jsonBytes(continuation.gate3Analysis))
      || continuation.gate3Analysis?.head !== expectedHead
      || continuation.gate3Analysis?.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_06_OFFLINE_EPOCH
      || continuation.gate3Analysis?.status !== 'GATE3_ANALYSIS_PASS'
      || continuation.gate3Analysis?.cellCount !== 140 || continuation.gate3Analysis?.observationCount !== 20
      || continuation.offlineReportSha256 !== continuation.gate3Analysis?.offlineReportSha256
      || !/^[a-f0-9]{64}$/.test(continuation.offlineManifestSha256 || '')
      || !continuation.previousOfflineHistory || !continuation.offlineHistory
      || !sameJson(continuation.offlineHistory.analysis20, continuation.previousOfflineHistory.analysis20)
      || !sameJson(continuation.offlineHistory.analysis21, continuation.previousOfflineHistory.analysis21)
      || !sameJson(continuation.offlineHistory.analysis22, continuation.previousOfflineHistory.analysis22)
      || !sameJson(continuation.offlineHistory.analysis23, continuation.previousOfflineHistory.analysis23)
      || !sameJson(continuation.offlineHistory.analysis24, continuation.previousOfflineHistory.analysis24)
      || continuation.offlineHistory.analysis25?.reportSha256 !== continuation.offlineReportSha256
      || continuation.offlineHistory.analysis25?.manifestSha256 !== continuation.offlineManifestSha256
      || !sameJson(Object.keys(continuation.sourceDelta || {}).sort(), [...RECOVERY_ALLOWED_SOURCE_DELTA].sort())) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_PREFLIGHT_IDENTITY');
  }
  assertContinuation06OfflineHistory(continuation.previousOfflineHistory, {includeAnalysis25: false});
  assertContinuation06OfflineHistory(continuation.offlineHistory);
  assertRecoveryContinuation05PriorRootSnapshot(continuation.previousRootSnapshot, {
    executionHead: continuation.previousExecutionHead,
    preflightSha256: continuation.previousRecoveryPreflightSha256,
    receiptSha256: continuation.previousRecoveryReceiptSha256});
  return report;
}
function assertPrepareRecoveryContinuation06ReceiptShape(report) {
  if (report?.schemaVersion !== 1 || report.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_06'
      || report.issue !== 7 || report.pr !== PR_NUMBER || report.epoch !== ACTIVE_EPOCH
      || report.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
      || report.approvalMarker !== PREPARE_RECOVERY_CONTINUATION_06_APPROVAL_MARKER
      || report.designSha256 !== PREPARE_RECOVERY_CONTINUATION_06_DESIGN_SHA256
      || report.previousExecutionHead !== RECOVERY_CONTINUATION_04_EXECUTION_HEAD
      || report.previousRecoveryPreflightSha256 !== RECOVERY_CONTINUATION_04_PREFLIGHT_SHA256
      || report.previousRecoveryReceiptSha256 !== RECOVERY_CONTINUATION_04_RECEIPT_SHA256
      || report.original?.head !== RECOVERY_ORIGINAL_HEAD
      || report.original?.prepareSha256 !== RECOVERY_ORIGINAL_PREPARE_SHA256
      || report.original?.planSha256 !== RECOVERY_ORIGINAL_PLAN_SHA256
      || report.original?.gate3Sha256 !== RECOVERY_ORIGINAL_GATE3_SHA256
      || report.original?.preflightSha256 !== RECOVERY_ORIGINAL_PREFLIGHT_SHA256
      || !/^[a-f0-9]{40}$/.test(report.executionHead || '')
      || report.recovery?.head !== report.executionHead
      || report.recovery?.preflightFile !== recoveryPreflightFileName(report.executionHead)
      || !/^[a-f0-9]{64}$/.test(report.recovery?.preflightSha256 || '')
      || report.recovery?.gate3Analysis?.head !== report.executionHead
      || report.recovery?.gate3Analysis?.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_06_OFFLINE_EPOCH
      || report.recovery?.gate3Analysis?.status !== 'GATE3_ANALYSIS_PASS'
      || report.recovery?.gate3Analysis?.cellCount !== 140 || report.recovery?.gate3Analysis?.observationCount !== 20
      || report.recovery?.gate3AnalysisSha256 !== sha256(jsonBytes(report.recovery?.gate3Analysis))
      || !/^[a-f0-9]{64}$/.test(report.recovery?.offlineReportSha256 || '')
      || !/^[a-f0-9]{64}$/.test(report.recovery?.offlineManifestSha256 || '')
      || report.recovery?.offlineReportSha256 !== report.recovery?.gate3Analysis?.offlineReportSha256
      || !report.recovery?.offlineHistory || !report.recovery?.previousOfflineHistory
      || !sameJson(report.recovery.offlineHistory.analysis25, {reportSha256: report.recovery.offlineReportSha256,
        manifestSha256: report.recovery.offlineManifestSha256})
      || !sameJson(report.recovery.previousOfflineHistory, {...report.recovery.offlineHistory,
        analysis25: undefined})
      || report.recovery?.frozenSnapshotSha256 !== frozenSnapshotSha256(report.recovery?.frozenEvidenceSnapshot)
      || !report.recovery?.source || !report.recovery?.sourceDelta
      || !sameJson(Object.keys(report.recovery.sourceDelta).sort(), [...RECOVERY_ALLOWED_SOURCE_DELTA].sort())
      || !sameJson(report.calls, {started: 0, completed: 0, ambiguous: 0})
      || !sameJson(report.budget, core.accounting())
      || !report.parentProof || report.parentProof.epoch !== PARENT_EPOCH || report.parentProof.head !== PARENT_HEAD
      || report.parentProof.charged !== 0 || report.parentProof.completed !== 0 || report.parentProof.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_RECEIPT_IDENTITY');
  }
  assertContinuation06OfflineHistory(report.recovery.previousOfflineHistory, {includeAnalysis25: false});
  assertContinuation06OfflineHistory(report.recovery.offlineHistory);
  assertRecoveryContinuation05PriorRootSnapshot(report.previousRootSnapshot, {
    executionHead: report.previousExecutionHead,
    preflightSha256: report.previousRecoveryPreflightSha256,
    receiptSha256: report.previousRecoveryReceiptSha256});
  return report;
}
function assertContinuation07OfflineHistory(history, {includeAnalysis26 = true} = {}) {
  const expectedKeys = ['analysis20', 'analysis21', 'analysis22', 'analysis23', 'analysis24', 'analysis25',
    ...(includeAnalysis26 ? ['analysis26'] : [])];
  if (!sameJson(Object.keys(history || {}).sort(), expectedKeys)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_OFFLINE_HISTORY');
  }
  for (const [epoch, reportSha256, manifestSha256] of [
    ['analysis20', RECOVERY_ANALYSIS20_REPORT_SHA256, RECOVERY_ANALYSIS20_MANIFEST_SHA256],
    ['analysis21', RECOVERY_ANALYSIS21_REPORT_SHA256, RECOVERY_ANALYSIS21_MANIFEST_SHA256],
    ['analysis22', RECOVERY_ANALYSIS22_REPORT_SHA256, RECOVERY_ANALYSIS22_MANIFEST_SHA256],
    ['analysis24', RECOVERY_ANALYSIS24_REPORT_SHA256, RECOVERY_ANALYSIS24_MANIFEST_SHA256],
    ['analysis25', RECOVERY_ANALYSIS25_REPORT_SHA256, RECOVERY_ANALYSIS25_MANIFEST_SHA256]
  ]) {
    if (history[epoch]?.reportSha256 !== reportSha256 || history[epoch]?.manifestSha256 !== manifestSha256) {
      throw new Error(`BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_${epoch.toUpperCase()}_IDENTITY`);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(history.analysis23?.reportSha256 || '')
      || !/^[a-f0-9]{64}$/.test(history.analysis23?.manifestSha256 || '')) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_ANALYSIS23_IDENTITY');
  }
  if (includeAnalysis26 && (!/^[a-f0-9]{64}$/.test(history.analysis26?.reportSha256 || '')
      || !/^[a-f0-9]{64}$/.test(history.analysis26?.manifestSha256 || ''))) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_ANALYSIS26_IDENTITY');
  }
  return true;
}
function assertRecoveryContinuation07PreflightReceiptShape(report, expectedHead) {
  if (report?.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_07_PREFLIGHT') {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_PREFLIGHT_KIND');
  }
  assertPreflightReceiptShape({...report, kind: 'CONTACT_LOSS_PREPARE_PREFLIGHT'}, expectedHead);
  const continuation = report.continuation07;
  if (continuation?.approvalMarker !== PREPARE_RECOVERY_CONTINUATION_07_APPROVAL_MARKER
      || continuation.designSha256 !== PREPARE_RECOVERY_CONTINUATION_07_DESIGN_SHA256
      || continuation.executionHead !== expectedHead
      || continuation.preflightFile !== recoveryPreflightFileName(expectedHead)
      || continuation.previousExecutionHead !== RECOVERY_CONTINUATION_04_EXECUTION_HEAD
      || continuation.previousRecoveryPreflightSha256 !== RECOVERY_CONTINUATION_04_PREFLIGHT_SHA256
      || continuation.previousRecoveryReceiptSha256 !== RECOVERY_CONTINUATION_04_RECEIPT_SHA256
      || continuation.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_07_OFFLINE_EPOCH
      || continuation.originalPrepareSha256 !== RECOVERY_ORIGINAL_PREPARE_SHA256
      || continuation.originalPlanSha256 !== RECOVERY_ORIGINAL_PLAN_SHA256
      || continuation.originalGate3Sha256 !== RECOVERY_ORIGINAL_GATE3_SHA256
      || continuation.originalPreflightSha256 !== RECOVERY_ORIGINAL_PREFLIGHT_SHA256
      || continuation.gate3AnalysisSha256 !== report.gate3?.analysisSha256
      || continuation.gate3AnalysisSha256 !== sha256(jsonBytes(continuation.gate3Analysis))
      || continuation.gate3Analysis?.head !== expectedHead
      || continuation.gate3Analysis?.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_07_OFFLINE_EPOCH
      || continuation.gate3Analysis?.status !== 'GATE3_ANALYSIS_PASS'
      || continuation.gate3Analysis?.cellCount !== 140 || continuation.gate3Analysis?.observationCount !== 20
      || continuation.offlineReportSha256 !== continuation.gate3Analysis?.offlineReportSha256
      || !/^[a-f0-9]{64}$/.test(continuation.offlineManifestSha256 || '')
      || !continuation.previousOfflineHistory || !continuation.offlineHistory
      || !sameJson(continuation.offlineHistory.analysis20, continuation.previousOfflineHistory.analysis20)
      || !sameJson(continuation.offlineHistory.analysis21, continuation.previousOfflineHistory.analysis21)
      || !sameJson(continuation.offlineHistory.analysis22, continuation.previousOfflineHistory.analysis22)
      || !sameJson(continuation.offlineHistory.analysis23, continuation.previousOfflineHistory.analysis23)
      || !sameJson(continuation.offlineHistory.analysis24, continuation.previousOfflineHistory.analysis24)
      || !sameJson(continuation.offlineHistory.analysis25, continuation.previousOfflineHistory.analysis25)
      || continuation.offlineHistory.analysis26?.reportSha256 !== continuation.offlineReportSha256
      || continuation.offlineHistory.analysis26?.manifestSha256 !== continuation.offlineManifestSha256
      || !sameJson(Object.keys(continuation.sourceDelta || {}).sort(), [...RECOVERY_CONTINUATION_07_ALLOWED_SOURCE_DELTA].sort())) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_PREFLIGHT_IDENTITY');
  }
  assertContinuation07OfflineHistory(continuation.previousOfflineHistory, {includeAnalysis26: false});
  assertContinuation07OfflineHistory(continuation.offlineHistory);
  assertRecoveryContinuation05PriorRootSnapshot(continuation.previousRootSnapshot, {
    executionHead: continuation.previousExecutionHead,
    preflightSha256: continuation.previousRecoveryPreflightSha256,
    receiptSha256: continuation.previousRecoveryReceiptSha256});
  return report;
}
function assertPrepareRecoveryContinuation07ReceiptShape(report) {
  if (report?.schemaVersion !== 1 || report.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_07'
      || report.issue !== 7 || report.pr !== PR_NUMBER || report.epoch !== ACTIVE_EPOCH
      || report.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
      || report.approvalMarker !== PREPARE_RECOVERY_CONTINUATION_07_APPROVAL_MARKER
      || report.designSha256 !== PREPARE_RECOVERY_CONTINUATION_07_DESIGN_SHA256
      || report.previousExecutionHead !== RECOVERY_CONTINUATION_04_EXECUTION_HEAD
      || report.previousRecoveryPreflightSha256 !== RECOVERY_CONTINUATION_04_PREFLIGHT_SHA256
      || report.previousRecoveryReceiptSha256 !== RECOVERY_CONTINUATION_04_RECEIPT_SHA256
      || report.original?.head !== RECOVERY_ORIGINAL_HEAD
      || report.original?.prepareSha256 !== RECOVERY_ORIGINAL_PREPARE_SHA256
      || report.original?.planSha256 !== RECOVERY_ORIGINAL_PLAN_SHA256
      || report.original?.gate3Sha256 !== RECOVERY_ORIGINAL_GATE3_SHA256
      || report.original?.preflightSha256 !== RECOVERY_ORIGINAL_PREFLIGHT_SHA256
      || !/^[a-f0-9]{40}$/.test(report.executionHead || '')
      || report.recovery?.head !== report.executionHead
      || report.recovery?.preflightFile !== recoveryPreflightFileName(report.executionHead)
      || !/^[a-f0-9]{64}$/.test(report.recovery?.preflightSha256 || '')
      || report.recovery?.gate3Analysis?.head !== report.executionHead
      || report.recovery?.gate3Analysis?.offlineEpoch !== PREPARE_RECOVERY_CONTINUATION_07_OFFLINE_EPOCH
      || report.recovery?.gate3Analysis?.status !== 'GATE3_ANALYSIS_PASS'
      || report.recovery?.gate3Analysis?.cellCount !== 140 || report.recovery?.gate3Analysis?.observationCount !== 20
      || report.recovery?.gate3AnalysisSha256 !== sha256(jsonBytes(report.recovery?.gate3Analysis))
      || !/^[a-f0-9]{64}$/.test(report.recovery?.offlineReportSha256 || '')
      || !/^[a-f0-9]{64}$/.test(report.recovery?.offlineManifestSha256 || '')
      || report.recovery?.offlineReportSha256 !== report.recovery?.gate3Analysis?.offlineReportSha256
      || !report.recovery?.offlineHistory || !report.recovery?.previousOfflineHistory
      || !sameJson(report.recovery.offlineHistory.analysis26, {reportSha256: report.recovery.offlineReportSha256,
        manifestSha256: report.recovery.offlineManifestSha256})
      || !sameJson(report.recovery.previousOfflineHistory, {...report.recovery.offlineHistory,
        analysis26: undefined})
      || report.recovery?.frozenSnapshotSha256 !== frozenSnapshotSha256(report.recovery?.frozenEvidenceSnapshot)
      || !report.recovery?.source || !report.recovery?.sourceDelta
      || !sameJson(Object.keys(report.recovery.sourceDelta).sort(), [...RECOVERY_CONTINUATION_07_ALLOWED_SOURCE_DELTA].sort())
      || !sameJson(report.calls, {started: 0, completed: 0, ambiguous: 0})
      || !sameJson(report.budget, core.accounting())
      || !report.parentProof || report.parentProof.epoch !== PARENT_EPOCH
      || report.parentProof.head !== PARENT_HEAD || report.parentProof.charged !== 0
      || report.parentProof.completed !== 0 || report.parentProof.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_RECEIPT_IDENTITY');
  }
  assertContinuation07OfflineHistory(report.recovery.previousOfflineHistory, {includeAnalysis26: false});
  assertContinuation07OfflineHistory(report.recovery.offlineHistory);
  assertRecoveryContinuation05PriorRootSnapshot(report.previousRootSnapshot, {
    executionHead: report.previousExecutionHead,
    preflightSha256: report.previousRecoveryPreflightSha256,
    receiptSha256: report.previousRecoveryReceiptSha256});
  return report;
}
function assertPrepareRecoveryReceiptShape(report) {
  if (report?.schemaVersion !== 1 || report.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY'
      || report.issue !== 7 || report.pr !== 8 || report.epoch !== ACTIVE_EPOCH
      || report.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
      || report.recoveryContractSha256 !== PREPARE_RECOVERY_LEGACY_CONTRACT_SHA256
      || report.approvalMarker !== PREPARE_RECOVERY_APPROVAL_MARKER
      || report.original?.head !== RECOVERY_ORIGINAL_HEAD
      || report.original?.prepareSha256 !== RECOVERY_ORIGINAL_PREPARE_SHA256
      || report.original?.planSha256 !== RECOVERY_ORIGINAL_PLAN_SHA256
      || report.original?.gate3Sha256 !== RECOVERY_ORIGINAL_GATE3_SHA256
      || report.original?.preflightFile !== preflightFileName(RECOVERY_ORIGINAL_HEAD)
      || report.original?.preflightSha256 !== RECOVERY_ORIGINAL_PREFLIGHT_SHA256
      || !/^[a-f0-9]{40}$/.test(report.executionHead || '')
      || report.recovery?.head !== report.executionHead
      || report.recovery?.preflightFile !== recoveryPreflightFileName(report.executionHead)
      || !/^[a-f0-9]{64}$/.test(report.recovery?.preflightSha256 || '')
      || !/^[a-f0-9]{64}$/.test(report.recovery?.gate3AnalysisSha256 || '')
      || report.recovery?.gate3Analysis?.head !== report.executionHead
      || report.recovery.gate3Analysis.offlineEpoch !== RECOVERY_CURRENT_OFFLINE_EPOCH
      || report.recovery.gate3AnalysisSha256 !== sha256(jsonBytes(report.recovery.gate3Analysis))
      || !/^[a-f0-9]{64}$/.test(report.recovery?.offlineReportSha256 || '')
      || report.recovery?.frozenSnapshotSha256 !== frozenSnapshotSha256(report.recovery?.frozenEvidenceSnapshot)
      || !report.recovery?.source || !report.recovery?.sourceDelta
      || !sameJson(Object.keys(report.recovery.sourceDelta).sort(), [...RECOVERY_ALLOWED_SOURCE_DELTA].sort())
      || !sameJson(report.parentProof, report.original?.parentProof)
      || report.parentProof?.epoch !== PARENT_EPOCH || report.parentProof?.head !== PARENT_HEAD
      || report.parentProof?.charged !== 0 || report.parentProof?.completed !== 0 || report.parentProof?.ambiguous !== 0
      || !sameJson(report.calls, {started: 0, completed: 0, ambiguous: 0})
      || !sameJson(report.budget, core.accounting())) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_RECOVERY_RECEIPT_IDENTITY');
  }
  if (!report.original?.memberSnapshot?.primary || !report.original?.memberSnapshot?.secondary
      || !sameJson(Object.keys(report.original.memberSnapshot.primary).sort(), [
        'gate3-analysis.json', 'plan.json', 'prepare.json', preflightFileName(RECOVERY_ORIGINAL_HEAD)
      ].sort())
      || !sameJson(Object.keys(report.original.memberSnapshot.secondary).sort(),
        Object.keys(report.original.memberSnapshot.primary).sort())
      || Object.keys(report.original.memberSnapshot.primary).some(relative =>
        !sameBytesSnapshot(report.original.memberSnapshot.primary[relative],
          report.original.memberSnapshot.secondary[relative]))) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_RECOVERY_ORIGINAL_INVENTORY');
  }
  if (!sameJson(Object.keys(report.recovery.sourceDelta).sort(), [...RECOVERY_ALLOWED_SOURCE_DELTA].sort())
      || report.recovery.builds?.diagnostic?.wasmSha256 !== report.original.diagnosticWasmSha256
      || report.recovery.builds?.production?.wasmSha256 !== report.original.productionWasmSha256
      || report.recovery.builds?.diagnostic?.wasmSize !== report.original.diagnosticWasmSize
      || report.recovery.builds?.production?.wasmSize !== report.original.productionWasmSize) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_RECOVERY_BUILD_OR_SOURCE');
  }
  return report;
}
function verifyStoredPrepareRecovery(roots, {prepared, originalPreflight, originalGate3,
  allowContinuation02 = false, allowContinuation03 = false, allowContinuation04 = false,
  allowContinuation05 = false, allowContinuation06 = false, allowContinuation07 = false, ownerLock = null} = {}) {
  const stored = readJsonDual(roots, 'prepare-recovery.json');
  if (!stored) return null;
  const report = assertPrepareRecoveryReceiptShape(stored.value);
  const recoveryPreflight = readJsonDual(roots, report.recovery.preflightFile, {required: true});
  assertRecoveryPreflightReceiptShape(recoveryPreflight.value, report.executionHead);
  if (!prepared || prepared.sha256 !== report.original.prepareSha256
      || !originalPreflight || originalPreflight.sha256 !== report.original.preflightSha256
      || prepared.value.head !== report.original.head
      || Object.hasOwn(prepared.value, 'preflightSha256')
      || prepared.value.preflightFile !== report.original.preflightFile
      || !originalGate3 || originalGate3.sha256 !== report.original.gate3Sha256
      || recoveryPreflight.sha256 !== report.recovery.preflightSha256
      || recoveryPreflight.value.head !== report.executionHead
      || !sameJson(recoveryPreflight.value.source, report.recovery.source)
      || !sameJson(recoveryPreflight.value.recovery.sourceDelta, report.recovery.sourceDelta)
      || recoveryPreflight.value.recovery.originalPrepareSha256 !== report.original.prepareSha256
      || recoveryPreflight.value.recovery.originalPreflightSha256 !== report.original.preflightSha256
      || recoveryPreflight.value.gate3.analysisSha256 !== report.recovery.gate3AnalysisSha256
      || !sameJson(recoveryPreflight.value.frozenEvidenceSnapshot, report.recovery.frozenEvidenceSnapshot)
      || !sameJson(recoveryPreflight.value.parentProof, report.parentProof)
      || recoveryPreflight.value.builds.diagnostic.wasm.sha256 !== report.recovery.builds.diagnostic.wasmSha256
      || recoveryPreflight.value.builds.diagnostic.wasm.size !== report.recovery.builds.diagnostic.wasmSize
      || recoveryPreflight.value.builds.production.wasm.sha256 !== report.recovery.builds.production.wasmSha256
      || recoveryPreflight.value.builds.production.wasm.size !== report.recovery.builds.production.wasmSize) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_RECOVERY_LINKAGE');
  }
  assertSameGate3Evidence(originalGate3.value, report.recovery.gate3Analysis, report.executionHead,
    expectedRecoveryOfflineEpoch(report));
  if (!sameJson(recoveryPreflight.value.recovery.gate3Analysis, report.recovery.gate3Analysis)
      || recoveryPreflight.value.recovery.recoveryGate3AnalysisSha256 !== report.recovery.gate3AnalysisSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_RECOVERY_GATE3_IDENTITY');
  }
  const actualMembers = snapshotActiveRootMembers(roots,
    ['gate3-analysis.json', 'plan.json', 'prepare.json', report.original.preflightFile], {requireExact: false});
  if (!sameJson(actualMembers, report.original.memberSnapshot)) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_RECOVERY_ORIGINAL_MUTATED');
  }
  const sourceDelta = verifyRecoverySourceDelta(prepared.value.source, report.recovery.source);
  if (!sameJson(sourceDelta, report.recovery.sourceDelta)
      || !sameJson(report.recovery.gate3Analysis, recoveryPreflight.value.recovery.gate3Analysis)
      || !sameJson(report.recovery.gate3AnalysisSha256, sha256(jsonBytes(report.recovery.gate3Analysis)))) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_RECOVERY_SOURCE_OR_GATE3');
  }
  const originalOffline = prepared.value.gate3.offlineEpoch;
  const expectedNewOffline = report.recovery.gate3Analysis.offlineEpoch;
  assertRecoveryFrozenAppendOnly(prepared.value.frozenEvidenceSnapshot,
    report.recovery.frozenEvidenceSnapshot, report);
  if (report.recovery.gate3Analysis.frozenSnapshotSha256 !== report.recovery.frozenSnapshotSha256
      || report.recovery.gate3Analysis.archiveSha256 !== prepared.value.gate3.archiveSha256
      || report.recovery.gate3Analysis.offlineReportSha256 !== report.recovery.offlineReportSha256
      || originalOffline === expectedNewOffline) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_RECOVERY_GATE3_BINDING');
  }
  const recoveryOffline = latestOfflineReport(roots.repo, roots.home, roots.commonDirectory,
    report.executionHead, report.recovery.gate3Analysis.offlineEpoch);
  if (recoveryOffline.epoch !== expectedNewOffline || recoveryOffline.reportSha256 !== report.recovery.offlineReportSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_RECOVERY_OFFLINE_REPORT');
  }
  const expectedMembers = ['gate3-analysis.json', 'plan.json', 'prepare.json', 'prepare-recovery.json',
    report.original.preflightFile, report.recovery.preflightFile];
  if (allowContinuation02) {
    const continuation = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_02_REL, {required: true});
    assertPrepareRecoveryContinuation02ReceiptShape(continuation.value);
    if (continuation.value.previousRecoveryReceiptSha256 !== stored.sha256
        || continuation.value.previousRecoveryPreflightSha256 !== recoveryPreflight.sha256) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PRIOR_BINDING');
    }
    expectedMembers.push(PREPARE_RECOVERY_CONTINUATION_02_REL,
      continuation.value.recovery.preflightFile);
  }
  if (allowContinuation03) {
    if (!allowContinuation02) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_CHAIN');
    const continuation = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_03_REL, {required: true});
    assertPrepareRecoveryContinuation03ReceiptShape(continuation.value);
    expectedMembers.push(PREPARE_RECOVERY_CONTINUATION_03_REL,
      continuation.value.recovery.preflightFile);
  }
  if (allowContinuation04) {
    if (!allowContinuation03) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_CHAIN');
    const continuation = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_04_REL, {required: true});
    assertPrepareRecoveryContinuation04ReceiptShape(continuation.value);
    expectedMembers.push(PREPARE_RECOVERY_CONTINUATION_04_REL,
      continuation.value.recovery.preflightFile);
  }
  if (allowContinuation05) {
    if (!allowContinuation04) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_CHAIN');
    const continuation = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_05_REL, {required: true});
    assertPrepareRecoveryContinuation05ReceiptShape(continuation.value);
    expectedMembers.push(PREPARE_RECOVERY_CONTINUATION_05_REL,
      continuation.value.recovery.preflightFile);
  }
  if (allowContinuation06) {
    if (!allowContinuation04 || allowContinuation05) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_CHAIN');
    const continuation = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_06_REL, {required: true});
    assertPrepareRecoveryContinuation06ReceiptShape(continuation.value);
    expectedMembers.push(PREPARE_RECOVERY_CONTINUATION_06_REL,
      continuation.value.recovery.preflightFile);
  }
  if (allowContinuation07) {
    if (!allowContinuation04 || allowContinuation05 || allowContinuation06) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_CHAIN');
    }
    const continuation = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_07_REL, {required: true});
    assertPrepareRecoveryContinuation07ReceiptShape(continuation.value);
    expectedMembers.push(PREPARE_RECOVERY_CONTINUATION_07_REL,
      continuation.value.recovery.preflightFile);
  }
  assertRecoveryRootMembers(roots, expectedMembers, {ownerLock,
    blocker: 'BLOCKED_CONTACT_LOSS_PREPARE_RECOVERY_ROOT_MEMBERS'});
  return {value: report, sha256: stored.sha256, preflight: recoveryPreflight,
    executionHead: report.executionHead, executionSource: report.recovery.source,
    frozenEvidenceSnapshot: report.recovery.frozenEvidenceSnapshot};
}
function assertPinnedRecoveryPrepareBinding(prepared, originalPreflight) {
  if (!prepared || prepared.sha256 !== RECOVERY_ORIGINAL_PREPARE_SHA256
      || prepared.value?.head !== RECOVERY_ORIGINAL_HEAD
      || prepared.value?.approvalMarker !== RECOVERY_ORIGINAL_APPROVAL_MARKER
      || prepared.value?.preflightFile !== preflightFileName(RECOVERY_ORIGINAL_HEAD)
      || Object.hasOwn(prepared.value, 'preflightSha256')
      || !originalPreflight || originalPreflight.sha256 !== RECOVERY_ORIGINAL_PREFLIGHT_SHA256) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_RECOVERY_ORIGINAL_BINDING');
  }
  return true;
}
function verifyStoredPrepareRecoveryContinuation02(roots, {prepared, originalGate3, previousRecovery,
  allowContinuation03 = false, allowContinuation04 = false, allowContinuation05 = false,
  allowContinuation06 = false, allowContinuation07 = false, ownerLock = null} = {}) {
  const stored = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_02_REL);
  if (!stored) return null;
  const report = assertPrepareRecoveryContinuation02ReceiptShape(stored.value);
  const preflight = readJsonDual(roots, report.recovery.preflightFile, {required: true});
  assertRecoveryContinuation02PreflightReceiptShape(preflight.value, report.executionHead);
  if (!prepared || prepared.sha256 !== report.original.prepareSha256
      || !originalGate3 || originalGate3.sha256 !== report.original.gate3Sha256
      || !previousRecovery || previousRecovery.sha256 !== report.previousRecoveryReceiptSha256
      || previousRecovery.sha256 !== RECOVERY_FIRST_RECEIPT_SHA256
      || previousRecovery.preflight.sha256 !== report.previousRecoveryPreflightSha256
      || previousRecovery.preflight.sha256 !== RECOVERY_FIRST_PREFLIGHT_SHA256
      || previousRecovery.executionHead !== report.previousExecutionHead
      || report.recovery.preflightSha256 !== preflight.sha256
      || preflight.value.head !== report.executionHead
      || !sameJson(preflight.value.source, report.recovery.source)
      || !sameJson(preflight.value.continuation02.sourceDelta, report.recovery.sourceDelta)
      || !sameJson(preflight.value.continuation02.previousRootSnapshot, report.previousRootSnapshot)
      || preflight.value.continuation02.offlineReportSha256 !== report.recovery.offlineReportSha256
      || preflight.value.continuation02.offlineManifestSha256 !== report.recovery.offlineManifestSha256
      || preflight.value.gate3.analysisSha256 !== report.recovery.gate3AnalysisSha256
      || !sameJson(preflight.value.frozenEvidenceSnapshot, report.recovery.frozenEvidenceSnapshot)
      || !sameJson(preflight.value.parentProof, report.parentProof)
      || !sameJson(report.parentProof, previousRecovery.value.parentProof)
      || !sameJson(report.recovery.builds, previousRecovery.value.recovery.builds)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_LINKAGE');
  }
  assertSameGate3Evidence(originalGate3.value, report.recovery.gate3Analysis,
    report.executionHead, expectedRecoveryOfflineEpoch(report));
  if (!sameJson(preflight.value.continuation02.gate3Analysis, report.recovery.gate3Analysis)
      || report.recovery.gate3Analysis.frozenSnapshotSha256 !== report.recovery.frozenSnapshotSha256
      || report.recovery.gate3Analysis.archiveSha256 !== prepared.value.gate3.archiveSha256
      || report.recovery.gate3Analysis.offlineReportSha256 !== report.recovery.offlineReportSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_GATE3');
  }
  const sourceDelta = verifyRecoverySourceDelta(prepared.value.source, report.recovery.source);
  if (!sameJson(sourceDelta, report.recovery.sourceDelta)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_SOURCE');
  }
  assertRecoveryFrozenAppendOnly(prepared.value.frozenEvidenceSnapshot,
    report.recovery.frozenEvidenceSnapshot, report);
  const offline = latestOfflineReport(roots.repo, roots.home, roots.commonDirectory,
    report.executionHead, PREPARE_RECOVERY_CONTINUATION_02_OFFLINE_EPOCH);
  if (offline.reportSha256 !== report.recovery.offlineReportSha256
      || offline.manifestSha256 !== report.recovery.offlineManifestSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_OFFLINE');
  }
  const priorNames = Object.keys(report.previousRootSnapshot.primary).sort();
  const actualPriorSnapshot = snapshotActiveRootMembers(roots, priorNames, {requireExact: false});
  if (!sameJson(actualPriorSnapshot, report.previousRootSnapshot)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PRIOR_ROOT_MUTATED');
  }
  const expected = ['gate3-analysis.json', 'plan.json', 'prepare.json', 'prepare-recovery.json',
    PREPARE_RECOVERY_CONTINUATION_02_REL, preflightFileName(RECOVERY_ORIGINAL_HEAD),
    recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD), report.recovery.preflightFile];
  if (allowContinuation03) {
    const continuation03 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_03_REL, {required: true});
    assertPrepareRecoveryContinuation03ReceiptShape(continuation03.value);
    expected.push(PREPARE_RECOVERY_CONTINUATION_03_REL, continuation03.value.recovery.preflightFile);
  }
  if (allowContinuation04) {
    if (!allowContinuation03) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_CHAIN');
    const continuation04 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_04_REL, {required: true});
    assertPrepareRecoveryContinuation04ReceiptShape(continuation04.value);
    expected.push(PREPARE_RECOVERY_CONTINUATION_04_REL, continuation04.value.recovery.preflightFile);
  }
  if (allowContinuation05) {
    if (!allowContinuation04) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_CHAIN');
    const continuation05 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_05_REL, {required: true});
    assertPrepareRecoveryContinuation05ReceiptShape(continuation05.value);
    expected.push(PREPARE_RECOVERY_CONTINUATION_05_REL, continuation05.value.recovery.preflightFile);
  }
  if (allowContinuation06) {
    if (!allowContinuation04 || allowContinuation05) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_CHAIN');
    const continuation06 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_06_REL, {required: true});
    assertPrepareRecoveryContinuation06ReceiptShape(continuation06.value);
    expected.push(PREPARE_RECOVERY_CONTINUATION_06_REL, continuation06.value.recovery.preflightFile);
  }
  if (allowContinuation07) {
    if (!allowContinuation04 || allowContinuation05 || allowContinuation06) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_CHAIN');
    }
    const continuation07 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_07_REL, {required: true});
    assertPrepareRecoveryContinuation07ReceiptShape(continuation07.value);
    expected.push(PREPARE_RECOVERY_CONTINUATION_07_REL, continuation07.value.recovery.preflightFile);
  }
  assertRecoveryRootMembers(roots, expected, {ownerLock,
    blocker: 'BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_ROOT_MEMBERS'});
  return {value: report, sha256: stored.sha256, preflight,
    executionHead: report.executionHead, executionSource: report.recovery.source,
    frozenEvidenceSnapshot: report.recovery.frozenEvidenceSnapshot};
}
function verifyStoredPrepareRecoveryContinuation03(roots, {prepared, originalGate3,
  previousContinuation02, allowContinuation04 = false, allowContinuation05 = false,
  allowContinuation06 = false, allowContinuation07 = false, ownerLock = null} = {}) {
  const stored = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_03_REL);
  if (!stored) return null;
  const report = assertPrepareRecoveryContinuation03ReceiptShape(stored.value);
  const preflight = readJsonDual(roots, report.recovery.preflightFile, {required: true});
  assertRecoveryContinuation03PreflightReceiptShape(preflight.value, report.executionHead);
  const priorPreflight = previousContinuation02?.preflight;
  if (!prepared || prepared.sha256 !== report.original.prepareSha256
      || !originalGate3 || originalGate3.sha256 !== report.original.gate3Sha256
      || !previousContinuation02 || previousContinuation02.sha256 !== report.previousRecoveryReceiptSha256
      || previousContinuation02.sha256 !== RECOVERY_CONTINUATION_02_RECEIPT_SHA256
      || !priorPreflight || priorPreflight.sha256 !== report.previousRecoveryPreflightSha256
      || priorPreflight.sha256 !== RECOVERY_CONTINUATION_02_PREFLIGHT_SHA256
      || previousContinuation02.executionHead !== report.previousExecutionHead
      || report.recovery.preflightSha256 !== preflight.sha256
      || preflight.value.head !== report.executionHead
      || !sameJson(preflight.value.source, report.recovery.source)
      || !sameJson(preflight.value.continuation03.sourceDelta, report.recovery.sourceDelta)
      || !sameJson(preflight.value.continuation03.previousRootSnapshot, report.previousRootSnapshot)
      || preflight.value.continuation03.offlineReportSha256 !== report.recovery.offlineReportSha256
      || preflight.value.continuation03.offlineManifestSha256 !== report.recovery.offlineManifestSha256
      || !sameJson(preflight.value.continuation03.offlineHistory, report.recovery.offlineHistory)
      || preflight.value.gate3.analysisSha256 !== report.recovery.gate3AnalysisSha256
      || !sameJson(preflight.value.frozenEvidenceSnapshot, report.recovery.frozenEvidenceSnapshot)
      || !sameJson(preflight.value.parentProof, report.parentProof)
      || !sameJson(report.parentProof, previousContinuation02.value.parentProof)
      || !sameJson(report.recovery.builds, previousContinuation02.value.recovery.builds)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_LINKAGE');
  }
  const preflightBuilds = {diagnostic: {wasmSha256: preflight.value.builds.diagnostic.wasm.sha256,
    wasmSize: preflight.value.builds.diagnostic.wasm.size},
  production: {wasmSha256: preflight.value.builds.production.wasm.sha256,
    wasmSize: preflight.value.builds.production.wasm.size}};
  if (!sameJson(report.recovery.builds, preflightBuilds)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_BUILD_LINKAGE');
  }
  assertSameGate3Evidence(originalGate3.value, report.recovery.gate3Analysis,
    report.executionHead, expectedRecoveryOfflineEpoch(report));
  if (!sameJson(preflight.value.continuation03.gate3Analysis, report.recovery.gate3Analysis)
      || report.recovery.gate3Analysis.frozenSnapshotSha256 !== report.recovery.frozenSnapshotSha256
      || report.recovery.gate3Analysis.archiveSha256 !== prepared.value.gate3.archiveSha256
      || report.recovery.gate3Analysis.offlineReportSha256 !== report.recovery.offlineReportSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_GATE3');
  }
  const sourceDelta = verifyRecoverySourceDelta(prepared.value.source, report.recovery.source);
  if (!sameJson(sourceDelta, report.recovery.sourceDelta)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_SOURCE');
  }
  assertRecoveryFrozenAppendOnly(prepared.value.frozenEvidenceSnapshot,
    report.recovery.frozenEvidenceSnapshot, report);
  const offline = latestOfflineReport(roots.repo, roots.home, roots.commonDirectory,
    report.executionHead, PREPARE_RECOVERY_CONTINUATION_03_OFFLINE_EPOCH);
  if (offline.reportSha256 !== report.recovery.offlineReportSha256
      || offline.manifestSha256 !== report.recovery.offlineManifestSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_OFFLINE');
  }
  const priorNames = Object.keys(report.previousRootSnapshot.primary).sort();
  const actualPriorSnapshot = snapshotActiveRootMembers(roots, priorNames, {requireExact: false});
  if (!sameJson(actualPriorSnapshot, report.previousRootSnapshot)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_PRIOR_ROOT_MUTATED');
  }
  const expected = ['gate3-analysis.json', 'plan.json', 'prepare.json', 'prepare-recovery.json',
    PREPARE_RECOVERY_CONTINUATION_02_REL, PREPARE_RECOVERY_CONTINUATION_03_REL,
    preflightFileName(RECOVERY_ORIGINAL_HEAD), recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD),
    recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD), report.recovery.preflightFile];
  if (allowContinuation04) {
    const continuation04 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_04_REL, {required: true});
    assertPrepareRecoveryContinuation04ReceiptShape(continuation04.value);
    expected.push(PREPARE_RECOVERY_CONTINUATION_04_REL, continuation04.value.recovery.preflightFile);
  }
  if (allowContinuation05) {
    if (!allowContinuation04) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_CHAIN');
    const continuation05 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_05_REL, {required: true});
    assertPrepareRecoveryContinuation05ReceiptShape(continuation05.value);
    expected.push(PREPARE_RECOVERY_CONTINUATION_05_REL, continuation05.value.recovery.preflightFile);
  }
  if (allowContinuation06) {
    if (!allowContinuation04 || allowContinuation05) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_CHAIN');
    const continuation06 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_06_REL, {required: true});
    assertPrepareRecoveryContinuation06ReceiptShape(continuation06.value);
    expected.push(PREPARE_RECOVERY_CONTINUATION_06_REL, continuation06.value.recovery.preflightFile);
  }
  if (allowContinuation07) {
    if (!allowContinuation04 || allowContinuation05 || allowContinuation06) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_CHAIN');
    }
    const continuation07 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_07_REL, {required: true});
    assertPrepareRecoveryContinuation07ReceiptShape(continuation07.value);
    expected.push(PREPARE_RECOVERY_CONTINUATION_07_REL, continuation07.value.recovery.preflightFile);
  }
  assertRecoveryRootMembers(roots, expected, {ownerLock,
    blocker: 'BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_ROOT_MEMBERS'});
  return {value: report, sha256: stored.sha256, preflight,
    executionHead: report.executionHead, executionSource: report.recovery.source,
    frozenEvidenceSnapshot: report.recovery.frozenEvidenceSnapshot};
}
function verifyStoredPrepareRecoveryContinuation04(roots, {prepared, originalGate3,
  previousContinuation03, allowContinuation05 = false, allowContinuation06 = false,
  allowContinuation07 = false, ownerLock = null} = {}) {
  const stored = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_04_REL);
  if (!stored) return null;
  const report = assertPrepareRecoveryContinuation04ReceiptShape(stored.value);
  const preflight = readJsonDual(roots, report.recovery.preflightFile, {required: true});
  assertRecoveryContinuation04PreflightReceiptShape(preflight.value, report.executionHead);
  const priorPreflight = previousContinuation03?.preflight;
  if (!prepared || prepared.sha256 !== report.original.prepareSha256
      || !originalGate3 || originalGate3.sha256 !== report.original.gate3Sha256
      || !previousContinuation03 || previousContinuation03.sha256 !== report.previousRecoveryReceiptSha256
      || previousContinuation03.sha256 !== RECOVERY_CONTINUATION_03_RECEIPT_SHA256
      || !priorPreflight || priorPreflight.sha256 !== report.previousRecoveryPreflightSha256
      || priorPreflight.sha256 !== RECOVERY_CONTINUATION_03_PREFLIGHT_SHA256
      || previousContinuation03.executionHead !== report.previousExecutionHead
      || report.recovery.preflightSha256 !== preflight.sha256
      || preflight.value.head !== report.executionHead
      || !sameJson(preflight.value.source, report.recovery.source)
      || !sameJson(preflight.value.continuation04.sourceDelta, report.recovery.sourceDelta)
      || !sameJson(preflight.value.continuation04.previousRootSnapshot, report.previousRootSnapshot)
      || preflight.value.continuation04.offlineReportSha256 !== report.recovery.offlineReportSha256
      || preflight.value.continuation04.offlineManifestSha256 !== report.recovery.offlineManifestSha256
      || !sameJson(preflight.value.continuation04.offlineHistory, report.recovery.offlineHistory)
      || preflight.value.gate3.analysisSha256 !== report.recovery.gate3AnalysisSha256
      || !sameJson(preflight.value.frozenEvidenceSnapshot, report.recovery.frozenEvidenceSnapshot)
      || !sameJson(preflight.value.parentProof, report.parentProof)
      || !sameJson(report.parentProof, previousContinuation03.value.parentProof)
      || !sameJson(previousContinuation03.value.recovery.frozenEvidenceSnapshot?.parentEvidence,
        report.recovery.frozenEvidenceSnapshot?.parentEvidence)
      || Object.keys(previousContinuation03.value.recovery.frozenEvidenceSnapshot?.offlineEpochs || {}).some(epoch =>
        !sameJson(previousContinuation03.value.recovery.frozenEvidenceSnapshot.offlineEpochs[epoch],
          report.recovery.frozenEvidenceSnapshot?.offlineEpochs?.[epoch]))
      || !sameJson(report.recovery.builds, previousContinuation03.value.recovery.builds)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_LINKAGE');
  }
  const preflightBuilds = {diagnostic: {wasmSha256: preflight.value.builds.diagnostic.wasm.sha256,
    wasmSize: preflight.value.builds.diagnostic.wasm.size},
  production: {wasmSha256: preflight.value.builds.production.wasm.sha256,
    wasmSize: preflight.value.builds.production.wasm.size}};
  if (!sameJson(report.recovery.builds, preflightBuilds)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_BUILD_LINKAGE');
  }
  assertSameGate3Evidence(originalGate3.value, report.recovery.gate3Analysis,
    report.executionHead, expectedRecoveryOfflineEpoch(report));
  if (!sameJson(preflight.value.continuation04.gate3Analysis, report.recovery.gate3Analysis)
      || report.recovery.gate3Analysis.frozenSnapshotSha256 !== report.recovery.frozenSnapshotSha256
      || report.recovery.gate3Analysis.archiveSha256 !== prepared.value.gate3.archiveSha256
      || report.recovery.gate3Analysis.offlineReportSha256 !== report.recovery.offlineReportSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_GATE3');
  }
  const sourceDelta = verifyRecoverySourceDelta(prepared.value.source, report.recovery.source);
  if (!sameJson(sourceDelta, report.recovery.sourceDelta)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_SOURCE');
  }
  assertRecoveryFrozenAppendOnly(prepared.value.frozenEvidenceSnapshot,
    report.recovery.frozenEvidenceSnapshot, report);
  const offline = latestOfflineReport(roots.repo, roots.home, roots.commonDirectory,
    report.executionHead, PREPARE_RECOVERY_CONTINUATION_04_OFFLINE_EPOCH);
  if (offline.reportSha256 !== report.recovery.offlineReportSha256
      || offline.manifestSha256 !== report.recovery.offlineManifestSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_OFFLINE');
  }
  const priorNames = Object.keys(report.previousRootSnapshot.primary).sort();
  const actualPriorSnapshot = snapshotActiveRootMembers(roots, priorNames, {requireExact: false});
  if (!sameJson(actualPriorSnapshot, report.previousRootSnapshot)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_PRIOR_ROOT_MUTATED');
  }
  const expected = ['gate3-analysis.json', 'plan.json', 'prepare.json', 'prepare-recovery.json',
    PREPARE_RECOVERY_CONTINUATION_02_REL, PREPARE_RECOVERY_CONTINUATION_03_REL,
    preflightFileName(RECOVERY_ORIGINAL_HEAD), recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD),
    recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD),
    recoveryPreflightFileName(RECOVERY_CONTINUATION_03_EXECUTION_HEAD), report.recovery.preflightFile,
    PREPARE_RECOVERY_CONTINUATION_04_REL];
  if (allowContinuation05) {
    const continuation05 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_05_REL, {required: true});
    assertPrepareRecoveryContinuation05ReceiptShape(continuation05.value);
    expected.push(PREPARE_RECOVERY_CONTINUATION_05_REL, continuation05.value.recovery.preflightFile);
  }
  if (allowContinuation06) {
    if (allowContinuation05) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_CHAIN');
    const continuation06 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_06_REL, {required: true});
    assertPrepareRecoveryContinuation06ReceiptShape(continuation06.value);
    expected.push(PREPARE_RECOVERY_CONTINUATION_06_REL, continuation06.value.recovery.preflightFile);
  }
  if (allowContinuation07) {
    if (allowContinuation05 || allowContinuation06) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_CHAIN');
    }
    const continuation07 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_07_REL, {required: true});
    assertPrepareRecoveryContinuation07ReceiptShape(continuation07.value);
    expected.push(PREPARE_RECOVERY_CONTINUATION_07_REL, continuation07.value.recovery.preflightFile);
  }
  assertRecoveryRootMembers(roots, expected, {ownerLock,
    blocker: 'BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_ROOT_MEMBERS'});
  return {value: report, sha256: stored.sha256, preflight,
    executionHead: report.executionHead, executionSource: report.recovery.source,
    frozenEvidenceSnapshot: report.recovery.frozenEvidenceSnapshot};
}
function verifyStoredPrepareRecoveryContinuation05(roots, {prepared, originalGate3,
  previousContinuation04, ownerLock = null} = {}) {
  const stored = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_05_REL);
  if (!stored) return null;
  const report = assertPrepareRecoveryContinuation05ReceiptShape(stored.value);
  const preflight = readJsonDual(roots, report.recovery.preflightFile, {required: true});
  assertRecoveryContinuation05PreflightReceiptShape(preflight.value, report.executionHead);
  if (!prepared || prepared.sha256 !== report.original.prepareSha256
      || !originalGate3 || originalGate3.sha256 !== report.original.gate3Sha256
      || !previousContinuation04 || previousContinuation04.sha256 !== report.previousRecoveryReceiptSha256
      || previousContinuation04.preflight.sha256 !== report.previousRecoveryPreflightSha256
      || previousContinuation04.executionHead !== report.previousExecutionHead
      || report.recovery.preflightSha256 !== preflight.sha256
      || preflight.value.head !== report.executionHead
      || !sameJson(preflight.value.source, report.recovery.source)
      || !sameJson(preflight.value.continuation05.sourceDelta, report.recovery.sourceDelta)
      || !sameJson(preflight.value.continuation05.previousRootSnapshot, report.previousRootSnapshot)
      || !sameJson(preflight.value.continuation05.previousOfflineHistory, report.recovery.previousOfflineHistory)
      || !sameJson(preflight.value.continuation05.offlineHistory, report.recovery.offlineHistory)
      || preflight.value.continuation05.offlineReportSha256 !== report.recovery.offlineReportSha256
      || preflight.value.continuation05.offlineManifestSha256 !== report.recovery.offlineManifestSha256
      || preflight.value.gate3.analysisSha256 !== report.recovery.gate3AnalysisSha256
      || !sameJson(preflight.value.frozenEvidenceSnapshot, report.recovery.frozenEvidenceSnapshot)
      || !sameJson(preflight.value.parentProof, report.parentProof)
      || !sameJson(report.parentProof, previousContinuation04.value.parentProof)
      || !sameJson(report.recovery.previousOfflineHistory, previousContinuation04.value.recovery.offlineHistory)
      || !sameJson(report.recovery.builds, previousContinuation04.value.recovery.builds)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_LINKAGE');
  }
  const preflightBuilds = {diagnostic: {wasmSha256: preflight.value.builds.diagnostic.wasm.sha256,
    wasmSize: preflight.value.builds.diagnostic.wasm.size},
  production: {wasmSha256: preflight.value.builds.production.wasm.sha256,
    wasmSize: preflight.value.builds.production.wasm.size}};
  if (!sameJson(report.recovery.builds, preflightBuilds)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_BUILD_LINKAGE');
  }
  assertSameGate3Evidence(originalGate3.value, report.recovery.gate3Analysis,
    report.executionHead, expectedRecoveryOfflineEpoch(report));
  if (!sameJson(preflight.value.continuation05.gate3Analysis, report.recovery.gate3Analysis)
      || report.recovery.gate3Analysis.frozenSnapshotSha256 !== report.recovery.frozenSnapshotSha256
      || report.recovery.gate3Analysis.archiveSha256 !== prepared.value.gate3.archiveSha256
      || report.recovery.gate3Analysis.offlineReportSha256 !== report.recovery.offlineReportSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_GATE3');
  }
  const sourceDelta = verifyRecoverySourceDelta(prepared.value.source, report.recovery.source);
  if (!sameJson(sourceDelta, report.recovery.sourceDelta)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_SOURCE');
  }
  assertRecoveryFrozenAppendOnly(prepared.value.frozenEvidenceSnapshot,
    report.recovery.frozenEvidenceSnapshot, report);
  const offline = latestOfflineReport(roots.repo, roots.home, roots.commonDirectory,
    report.executionHead, PREPARE_RECOVERY_CONTINUATION_05_OFFLINE_EPOCH);
  if (offline.reportSha256 !== report.recovery.offlineReportSha256
      || offline.manifestSha256 !== report.recovery.offlineManifestSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_OFFLINE');
  }
  const priorNames = Object.keys(report.previousRootSnapshot.primary).sort();
  const actualPriorSnapshot = snapshotActiveRootMembers(roots, priorNames, {requireExact: false});
  if (!sameJson(actualPriorSnapshot, report.previousRootSnapshot)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_PRIOR_ROOT_MUTATED');
  }
  const expected = ['gate3-analysis.json', 'plan.json', 'prepare.json', 'prepare-recovery.json',
    PREPARE_RECOVERY_CONTINUATION_02_REL, PREPARE_RECOVERY_CONTINUATION_03_REL,
    PREPARE_RECOVERY_CONTINUATION_04_REL,
    preflightFileName(RECOVERY_ORIGINAL_HEAD), recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD),
    recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD),
    recoveryPreflightFileName(RECOVERY_CONTINUATION_03_EXECUTION_HEAD),
    recoveryPreflightFileName(report.previousExecutionHead), report.recovery.preflightFile,
    PREPARE_RECOVERY_CONTINUATION_05_REL];
  assertRecoveryRootMembers(roots, expected, {ownerLock,
    blocker: 'BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_ROOT_MEMBERS'});
  return {value: report, sha256: stored.sha256, preflight,
    executionHead: report.executionHead, executionSource: report.recovery.source,
    frozenEvidenceSnapshot: report.recovery.frozenEvidenceSnapshot};
}
function verifyStoredPrepareRecoveryContinuation06(roots, {prepared, originalGate3,
  previousContinuation04, ownerLock = null} = {}) {
  const stored = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_06_REL);
  if (!stored) return null;
  if (!previousContinuation04) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_PREDECESSOR');
  const report = assertPrepareRecoveryContinuation06ReceiptShape(stored.value);
  const preflight = readJsonDual(roots, report.recovery.preflightFile, {required: true});
  assertRecoveryContinuation06PreflightReceiptShape(preflight.value, report.executionHead);
  const expectedPreviousOffline = {...previousContinuation04.value.recovery.offlineHistory,
    analysis24: {reportSha256: RECOVERY_ANALYSIS24_REPORT_SHA256,
      manifestSha256: RECOVERY_ANALYSIS24_MANIFEST_SHA256}};
  if (!prepared || prepared.sha256 !== report.original.prepareSha256
      || !originalGate3 || originalGate3.sha256 !== report.original.gate3Sha256
      || !previousContinuation04 || previousContinuation04.sha256 !== report.previousRecoveryReceiptSha256
      || previousContinuation04.sha256 !== RECOVERY_CONTINUATION_04_RECEIPT_SHA256
      || previousContinuation04.preflight.sha256 !== report.previousRecoveryPreflightSha256
      || previousContinuation04.preflight.sha256 !== RECOVERY_CONTINUATION_04_PREFLIGHT_SHA256
      || previousContinuation04.executionHead !== report.previousExecutionHead
      || report.recovery.preflightSha256 !== preflight.sha256
      || preflight.value.head !== report.executionHead
      || !sameJson(preflight.value.source, report.recovery.source)
      || !sameJson(preflight.value.continuation06.sourceDelta, report.recovery.sourceDelta)
      || !sameJson(preflight.value.continuation06.previousRootSnapshot, report.previousRootSnapshot)
      || !sameJson(preflight.value.continuation06.previousOfflineHistory, report.recovery.previousOfflineHistory)
      || !sameJson(preflight.value.continuation06.offlineHistory, report.recovery.offlineHistory)
      || preflight.value.continuation06.offlineReportSha256 !== report.recovery.offlineReportSha256
      || preflight.value.continuation06.offlineManifestSha256 !== report.recovery.offlineManifestSha256
      || preflight.value.gate3.analysisSha256 !== report.recovery.gate3AnalysisSha256
      || !sameJson(preflight.value.frozenEvidenceSnapshot, report.recovery.frozenEvidenceSnapshot)
      || !sameJson(preflight.value.parentProof, report.parentProof)
      || !sameJson(report.parentProof, previousContinuation04.value.parentProof)
      || !sameJson(report.recovery.previousOfflineHistory, expectedPreviousOffline)
      || !sameJson(report.recovery.builds, previousContinuation04.value.recovery.builds)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_LINKAGE');
  }
  const preflightBuilds = {diagnostic: {wasmSha256: preflight.value.builds.diagnostic.wasm.sha256,
    wasmSize: preflight.value.builds.diagnostic.wasm.size},
  production: {wasmSha256: preflight.value.builds.production.wasm.sha256,
    wasmSize: preflight.value.builds.production.wasm.size}};
  if (!sameJson(report.recovery.builds, preflightBuilds)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_BUILD_LINKAGE');
  }
  assertSameGate3Evidence(originalGate3.value, report.recovery.gate3Analysis,
    report.executionHead, expectedRecoveryOfflineEpoch(report));
  if (!sameJson(preflight.value.continuation06.gate3Analysis, report.recovery.gate3Analysis)
      || report.recovery.gate3Analysis.frozenSnapshotSha256 !== report.recovery.frozenSnapshotSha256
      || report.recovery.gate3Analysis.archiveSha256 !== prepared.value.gate3.archiveSha256
      || report.recovery.gate3Analysis.offlineReportSha256 !== report.recovery.offlineReportSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_GATE3');
  }
  const sourceDelta = verifyRecoverySourceDelta(prepared.value.source, report.recovery.source);
  if (!sameJson(sourceDelta, report.recovery.sourceDelta)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_SOURCE');
  }
  assertRecoveryFrozenAppendOnly(prepared.value.frozenEvidenceSnapshot,
    report.recovery.frozenEvidenceSnapshot, report);
  const offline = latestOfflineReport(roots.repo, roots.home, roots.commonDirectory,
    report.executionHead, PREPARE_RECOVERY_CONTINUATION_06_OFFLINE_EPOCH);
  if (offline.reportSha256 !== report.recovery.offlineReportSha256
      || offline.manifestSha256 !== report.recovery.offlineManifestSha256
      || offline.reportSha256 !== report.recovery.gate3Analysis.offlineReportSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_OFFLINE');
  }
  const priorNames = Object.keys(report.previousRootSnapshot.primary).sort();
  const actualPriorSnapshot = snapshotActiveRootMembers(roots, priorNames, {requireExact: false});
  if (!sameJson(actualPriorSnapshot, report.previousRootSnapshot)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_PRIOR_ROOT_MUTATED');
  }
  const expected = ['gate3-analysis.json', 'plan.json', 'prepare.json', 'prepare-recovery.json',
    PREPARE_RECOVERY_CONTINUATION_02_REL, PREPARE_RECOVERY_CONTINUATION_03_REL,
    PREPARE_RECOVERY_CONTINUATION_04_REL, preflightFileName(RECOVERY_ORIGINAL_HEAD),
    recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD),
    recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD),
    recoveryPreflightFileName(RECOVERY_CONTINUATION_03_EXECUTION_HEAD),
    recoveryPreflightFileName(RECOVERY_CONTINUATION_04_EXECUTION_HEAD),
    report.recovery.preflightFile, PREPARE_RECOVERY_CONTINUATION_06_REL];
  assertRecoveryRootMembers(roots, expected, {ownerLock,
    blocker: 'BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_ROOT_MEMBERS'});
  return {value: report, sha256: stored.sha256, preflight,
    executionHead: report.executionHead, executionSource: report.recovery.source,
    frozenEvidenceSnapshot: report.recovery.frozenEvidenceSnapshot};
}
function verifyStoredPrepareRecoveryContinuation07(roots, {prepared, originalGate3,
  previousContinuation04, ownerLock = null} = {}) {
  const stored = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_07_REL);
  if (!stored) return null;
  if (!previousContinuation04) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_PREDECESSOR');
  if (readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_05_REL)
      || readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_06_REL)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_EXCLUSIVITY');
  }
  const report = assertPrepareRecoveryContinuation07ReceiptShape(stored.value);
  const preflight = readJsonDual(roots, report.recovery.preflightFile, {required: true});
  assertRecoveryContinuation07PreflightReceiptShape(preflight.value, report.executionHead);
  const expectedPreviousOffline = {...previousContinuation04.value.recovery.offlineHistory,
    analysis24: {reportSha256: RECOVERY_ANALYSIS24_REPORT_SHA256,
      manifestSha256: RECOVERY_ANALYSIS24_MANIFEST_SHA256},
    analysis25: {reportSha256: RECOVERY_ANALYSIS25_REPORT_SHA256,
      manifestSha256: RECOVERY_ANALYSIS25_MANIFEST_SHA256}};
  if (!prepared || prepared.sha256 !== report.original.prepareSha256
      || !originalGate3 || originalGate3.sha256 !== report.original.gate3Sha256
      || previousContinuation04.sha256 !== report.previousRecoveryReceiptSha256
      || previousContinuation04.sha256 !== RECOVERY_CONTINUATION_04_RECEIPT_SHA256
      || previousContinuation04.preflight.sha256 !== report.previousRecoveryPreflightSha256
      || previousContinuation04.preflight.sha256 !== RECOVERY_CONTINUATION_04_PREFLIGHT_SHA256
      || previousContinuation04.executionHead !== report.previousExecutionHead
      || report.recovery.preflightSha256 !== preflight.sha256
      || preflight.value.head !== report.executionHead
      || !sameJson(preflight.value.source, report.recovery.source)
      || !sameJson(preflight.value.continuation07.sourceDelta, report.recovery.sourceDelta)
      || !sameJson(preflight.value.continuation07.previousRootSnapshot, report.previousRootSnapshot)
      || !sameJson(preflight.value.continuation07.previousOfflineHistory, report.recovery.previousOfflineHistory)
      || !sameJson(preflight.value.continuation07.offlineHistory, report.recovery.offlineHistory)
      || preflight.value.continuation07.offlineReportSha256 !== report.recovery.offlineReportSha256
      || preflight.value.continuation07.offlineManifestSha256 !== report.recovery.offlineManifestSha256
      || preflight.value.gate3.analysisSha256 !== report.recovery.gate3AnalysisSha256
      || !sameJson(preflight.value.frozenEvidenceSnapshot, report.recovery.frozenEvidenceSnapshot)
      || !sameJson(preflight.value.parentProof, report.parentProof)
      || !sameJson(report.parentProof, previousContinuation04.value.parentProof)
      || !sameJson(report.recovery.previousOfflineHistory, expectedPreviousOffline)
      || !sameJson(report.recovery.builds, previousContinuation04.value.recovery.builds)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_LINKAGE');
  }
  const preflightBuilds = {diagnostic: {wasmSha256: preflight.value.builds.diagnostic.wasm.sha256,
    wasmSize: preflight.value.builds.diagnostic.wasm.size},
  production: {wasmSha256: preflight.value.builds.production.wasm.sha256,
    wasmSize: preflight.value.builds.production.wasm.size}};
  if (!sameJson(report.recovery.builds, preflightBuilds)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_BUILD_LINKAGE');
  }
  assertSameGate3Evidence(originalGate3.value, report.recovery.gate3Analysis,
    report.executionHead, expectedRecoveryOfflineEpoch(report));
  if (!sameJson(preflight.value.continuation07.gate3Analysis, report.recovery.gate3Analysis)
      || report.recovery.gate3Analysis.frozenSnapshotSha256 !== report.recovery.frozenSnapshotSha256
      || report.recovery.gate3Analysis.archiveSha256 !== prepared.value.gate3.archiveSha256
      || report.recovery.gate3Analysis.offlineReportSha256 !== report.recovery.offlineReportSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_GATE3');
  }
  const sourceDelta = verifyRecoverySourceDelta(prepared.value.source, report.recovery.source,
    RECOVERY_CONTINUATION_07_ALLOWED_SOURCE_DELTA);
  if (!sameJson(sourceDelta, report.recovery.sourceDelta)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_SOURCE');
  }
  assertRecoveryFrozenAppendOnly(prepared.value.frozenEvidenceSnapshot,
    report.recovery.frozenEvidenceSnapshot, report);
  const offline = latestOfflineReport(roots.repo, roots.home, roots.commonDirectory,
    report.executionHead, PREPARE_RECOVERY_CONTINUATION_07_OFFLINE_EPOCH);
  if (offline.reportSha256 !== report.recovery.offlineReportSha256
      || offline.manifestSha256 !== report.recovery.offlineManifestSha256
      || offline.reportSha256 !== report.recovery.gate3Analysis.offlineReportSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_OFFLINE');
  }
  const priorNames = Object.keys(report.previousRootSnapshot.primary).sort();
  const actualPriorSnapshot = snapshotActiveRootMembers(roots, priorNames, {requireExact: false});
  if (!sameJson(actualPriorSnapshot, report.previousRootSnapshot)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_PRIOR_ROOT_MUTATED');
  }
  const expected = [...priorNames, report.recovery.preflightFile, PREPARE_RECOVERY_CONTINUATION_07_REL];
  assertRecoveryRootMembers(roots, expected, {ownerLock,
    blocker: 'BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_ROOT_MEMBERS'});
  return {value: report, sha256: stored.sha256, preflight,
    executionHead: report.executionHead, executionSource: report.recovery.source,
    frozenEvidenceSnapshot: report.recovery.frozenEvidenceSnapshot};
}
function classifyFullCTestPreflight({status, errorCode = null, stdout = '', stderr = '',
  expectedLifecycleReportSha256 = BASELINE_PRODUCTION_REPORT_SHA256} = {}) {
  const output = `${stdout || ''}\n${stderr || ''}`;
  if (errorCode) throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_CTEST_EXECUTION');
  const summary = output.match(/(\d+)% tests passed,\s*(\d+) tests failed out of\s*(\d+)/i);
  const failureNames = [...output.matchAll(/^\s*\d+\s+-\s+(.+?)\s+\(Failed\)\s*$/gm)]
    .map(match => match[1]).sort();
  const skippedCount = ctestSkippedCount(output);
  if (!summary || Number(summary[3]) !== 50 || Number(summary[2]) !== 3 || skippedCount !== 0
      || status !== 8 || !sameJson(failureNames, [...BASELINE_CTEST_FAILURES].sort())) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_NEW_CTEST_FAILURE');
  }
  if (!output.includes(BASELINE_AUDIO_ERROR) || !output.includes(BASELINE_STAGE4_INPUT_ERROR)) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_CTEST_FAILURE_SIGNATURE');
  }
  const lifecycle = extractJsonBlock(output, 'wasm.dsp.super-synth.supersynth-v9-production-lifecycle');
  const lifecycleBytes = Buffer.from(`${JSON.stringify(lifecycle, null, 2)}\n`);
  const reportSha256 = sha256(lifecycleBytes);
  if (lifecycle.productionWasmSha256 !== BASELINE_PRODUCTION_WASM_SHA256
      || lifecycle.cells !== 1408 || lifecycle.adjacentComparisons !== 1390
      || reportSha256 !== expectedLifecycleReportSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_BASELINE_LIFECYCLE_DRIFT');
  }
  const fullCTest = {decision: 'BASELINE_FAILURES_DISCLOSED', baselineHead: BASELINE_HEAD,
    exitCode: status, testCount: Number(summary[3]), failedCount: Number(summary[2]), skippedCount,
    failureNames, signatures: {audioQuality: BASELINE_AUDIO_ERROR,
      productionLifecycleReportSha256: reportSha256, productionWasmSha256: lifecycle.productionWasmSha256,
      stage4Input: BASELINE_STAGE4_INPUT_ERROR}, stdoutSha256: sha256(Buffer.from(stdout || '')),
    stderrSha256: sha256(Buffer.from(stderr || ''))};
  return fullCTest;
}
function fileSnapshot(root, relative) {
  const file = path.join(root, relative), info = syncReadSha(file);
  return {sha256: info.sha256, size: info.size, mtimeMs: info.mtimeMs};
}
function sourceSnapshot(root) {
  return Object.fromEntries(SOURCE_FILES.map(relative => [relative, fileSnapshot(root, relative)]));
}
function sameJson(a, b) { return JSON.stringify(stable(a)) === JSON.stringify(stable(b)); }
function parentInventory(roots, expectedMembers = PARENT_ROOT_MEMBERS) {
  const copies = {};
  for (const [name, base] of [['primary', roots.primary], ['secondary', roots.secondary]]) {
    let stat;
    try { stat = fs.lstatSync(base); } catch (error) {
      if (error.code === 'ENOENT') throw new Error('BLOCKED_CONTACT_LOSS_PARENT_ROOT_MISSING');
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(base) !== base) {
      throw new Error('BLOCKED_CONTACT_LOSS_PARENT_ROOT_UNSAFE');
    }
    const members = fs.readdirSync(base).sort();
    if (!sameJson(members, [...expectedMembers].sort())) throw new Error('BLOCKED_CONTACT_LOSS_PARENT_MEMBERS');
    const files = {};
    for (const relative of members) files[relative] = fileSnapshot(base, relative);
    copies[name] = {directoryMtimeMs: stat.mtimeMs, members, files};
  }
  if (!sameJson(copies.primary.members, copies.secondary.members)) throw new Error('BLOCKED_CONTACT_LOSS_PARENT_MEMBERS');
  for (const relative of expectedMembers) {
    if (copies.primary.files[relative].sha256 !== copies.secondary.files[relative].sha256
        || copies.primary.files[relative].size !== copies.secondary.files[relative].size) {
      throw new Error(`BLOCKED_CONTACT_LOSS_PARENT_COPY_DRIFT:${relative}`);
    }
  }
  return copies;
}
function verifyParentExperiment01({root = ROOT, home = os.homedir(), commonDirectory} = {},
  {expected = {prepareSha256: PARENT_PREPARE_SHA256, planSha256: PARENT_PLAN_SHA256,
    gate3Sha256: PARENT_GATE3_SHA256, head: PARENT_HEAD, members: PARENT_ROOT_MEMBERS}} = {}) {
  const roots = resolveRoots({root, home, commonDirectory, epoch: PARENT_EPOCH});
  const inventory = parentInventory(roots, expected.members);
  const prepare = readJsonDual(roots, 'prepare.json', {required: true});
  const plan = readJsonDual(roots, 'plan.json', {required: true});
  const gate3 = readJsonDual(roots, 'gate3-analysis.json', {required: true});
  if (prepare.sha256 !== expected.prepareSha256 || plan.sha256 !== expected.planSha256
      || gate3.sha256 !== expected.gate3Sha256) throw new Error('BLOCKED_CONTACT_LOSS_PARENT_DIGEST');
  const value = prepare.value;
  if (value.schemaVersion !== 1 || value.issue !== 7 || value.pr !== 8 || value.branch !== PR_BRANCH
      || value.head !== expected.head || value.contractSha256 !== CONTRACT_SHA256
      || value.approvalMarker !== ISSUE_APPROVAL_MARKER || value.startedCalls !== 0
      || value.completedCalls !== 0 || value.ambiguousCalls !== 0
      || !sameJson(value.plan, core.plan()) || !sameJson(value.budget, core.accounting())
      || value.gate3?.analysisSha256 !== gate3.sha256 || value.gate3?.status !== 'GATE3_ANALYSIS_PASS'
      || value.gate3?.cellCount !== 140 || value.gate3?.observationCount !== 20) {
    throw new Error('BLOCKED_CONTACT_LOSS_PARENT_PREPARE_IDENTITY');
  }
  const expectedPlan = jsonBytes({schemaVersion: 1, plan: core.plan(), callCap: 42,
    historicalCalls: 3251, lifetimeCap: 5255, downstreamReserve: 1962});
  if (!plan.bytes.equals(expectedPlan)) throw new Error('BLOCKED_CONTACT_LOSS_PARENT_PLAN_IDENTITY');
  if (gate3.value.status !== 'GATE3_ANALYSIS_PASS' || gate3.value.head !== expected.head
      || gate3.value.contractSha256 !== CONTRACT_SHA256 || gate3.value.cellCount !== 140
      || gate3.value.observationCount !== 20 || gate3.value.causalStatus !== 'NOT_CONFIRMED'
      || gate3.value.archiveSha256 !== value.gate3.archiveSha256
      || gate3.value.offlineReportSha256 !== value.gate3.offlineReportSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_PARENT_GATE3_IDENTITY');
  }
  const state = readExperimentState(roots);
  if (state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0 || state.candidateResults.length !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_PARENT_NONZERO_CALLS');
  }
  const proof = {epoch: PARENT_EPOCH, head: expected.head, prepareSha256: prepare.sha256,
    planSha256: plan.sha256, gate3Sha256: gate3.sha256, charged: 0, completed: 0, ambiguous: 0,
    rootMembers: [...expected.members].sort(), copies: inventory};
  return {roots, proof, inventory, state, expected};
}
function verifyParentInventoryUnchanged(before, options) {
  const after = verifyParentExperiment01(options, {expected: before.expected});
  if (!sameJson(before.inventory, after.inventory)) throw new Error('BLOCKED_CONTACT_LOSS_PARENT_CHANGED_DURING_PREPARE');
  return after;
}
function epochRootMembers(roots) {
  const present = [roots.primary, roots.secondary].map(directory => {
    try {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(directory) !== directory) {
        throw new Error('BLOCKED_CONTACT_LOSS_EPOCH_ROOT_UNSAFE');
      }
      return fs.readdirSync(directory).sort();
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  });
  if ((present[0] === null) !== (present[1] === null)) throw new Error('BLOCKED_CONTACT_LOSS_EPOCH_ROOT_DUAL_MISSING');
  if (present[0] === null) return [];
  if (!sameJson(present[0], present[1])) throw new Error('BLOCKED_CONTACT_LOSS_EPOCH_ROOT_DIVERGED');
  const allowed = ['acceptance', 'experiment', 'gate3-analysis.json', 'plan.json', 'prepare.json',
    'prepare-recovery.json', PREPARE_RECOVERY_CONTINUATION_02_REL,
    PREPARE_RECOVERY_CONTINUATION_03_REL, PREPARE_RECOVERY_CONTINUATION_04_REL,
    PREPARE_RECOVERY_CONTINUATION_05_REL, PREPARE_RECOVERY_CONTINUATION_06_REL, 'writer.lock'];
  if (present[0].some(name => !allowed.includes(name)
      && !/^preflight-[a-f0-9]{40}\.json$/.test(name)
      && !/^recovery-preflight-[a-f0-9]{40}\.json$/.test(name))) {
    throw new Error('BLOCKED_CONTACT_LOSS_EPOCH_ROOT_MEMBERS');
  }
  return present[0];
}
function ownedWriterLock(roots, ownerLock) {
  if (!ownerLock || typeof ownerLock.owner !== 'string' || !Buffer.isBuffer(ownerLock.bytes)) return false;
  const stored = readDual(roots, 'writer.lock');
  if (!stored || !stored.bytes.equals(ownerLock.bytes)) return false;
  let value;
  try { value = JSON.parse(stored.bytes.toString('utf8')); } catch { return false; }
  return value?.schemaVersion === 1 && value.owner === ownerLock.owner && value.pid === process.pid
    && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt));
}
function assertRecoveryRootMembers(roots, expectedMembers, {ownerLock = null, blocker} = {}) {
  const members = epochRootMembers(roots), hasLock = members.includes('writer.lock');
  if (ownerLock && (!hasLock || !ownedWriterLock(roots, ownerLock))) {
    throw new Error('BLOCKED_CONTACT_LOSS_LOCK_OWNER_CHANGED');
  }
  if (hasLock && !ownedWriterLock(roots, ownerLock)) throw new Error(blocker);
  const actual = members.filter(name => name !== 'acceptance' && name !== 'experiment' && name !== 'writer.lock');
  if (!sameJson(actual, [...expectedMembers].sort())) throw new Error(blocker);
  return true;
}
function combinedExperimentCharge(parentCalls, currentCalls) {
  if (!Number.isSafeInteger(parentCalls) || parentCalls < 0
      || !Number.isSafeInteger(currentCalls) || currentCalls < 0) throw new Error('BLOCKED_CONTACT_LOSS_CALL_ACCOUNTING');
  const combined = parentCalls + currentCalls;
  core.accounting({startedExperimentCalls: combined});
  return combined;
}
function combinedExperimentCalls(roots, {ownerLock = null,
  parentVerifier = verifyParentExperiment01, stateReader = readExperimentState} = {}) {
  const parent = parentVerifier({root: roots.repo, home: roots.home, commonDirectory: roots.commonDirectory});
  const current = stateReader(roots, {ownerLock});
  return combinedExperimentCharge(parent.state.charged, current.charged);
}
function latestOfflineReport(root, home, commonDirectory, expectedHead, expectedEpoch = null) {
  const offlineCore = require('./issue7-physical-root-cause-offline-v1-core.cjs');
  const roots = offlineCore.resolveInputRoots({root, home, commonDirectory});
  const primaryBase = roots.offlineBase.primaryRoot, secondaryBase = roots.offlineBase.secondaryRoot;
  let primary = [], secondary = [];
  try { primary = fs.readdirSync(primaryBase).filter(name => /^analysis-[0-9]{2}$/.test(name)).sort(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { secondary = fs.readdirSync(secondaryBase).filter(name => /^analysis-[0-9]{2}$/.test(name)).sort(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!primary.length || !sameJson(primary, secondary)) throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EPOCH_COPIES');
  const numbers = primary.map(name => Number(name.slice('analysis-'.length)));
  if (numbers.length < 4 || numbers.some((number, index) => number !== index + 1)) {
    throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EPOCH_SEQUENCE');
  }
  const latestNumber = Number(primary.at(-1).slice('analysis-'.length));
  let number = latestNumber;
  if (expectedEpoch !== null) {
    const match = /^physical-root-cause-offline-v1\/analysis-(\d{2})$/.exec(expectedEpoch);
    if (!match) throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EPOCH_EXPECTATION');
    number = Number(match[1]);
    if (!primary.includes(`analysis-${String(number).padStart(2, '0')}`)) {
      throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EXPECTED_EPOCH_MISSING');
    }
  }
  let report, manifest, value, manifestValue;
  for (const item of numbers) {
    const pair = offlineCore.resolveOfflinePair(roots, item);
    const primaryMembers = fs.readdirSync(pair.primary).sort(), secondaryMembers = fs.readdirSync(pair.secondary).sort();
    if (!sameJson(primaryMembers, [...OFFLINE_FILES].sort()) || !sameJson(primaryMembers, secondaryMembers)) {
      throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EPOCH_MEMBERS');
    }
    const storedReport = offlineCore.readDual(pair, 'report.json'), storedManifest = offlineCore.readDual(pair, 'manifest.json');
    if (!storedReport || !storedManifest) throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EPOCH_INCOMPLETE');
    const previousValue = JSON.parse(storedReport.bytes.toString('utf8'));
    const previousManifest = JSON.parse(storedManifest.bytes.toString('utf8'));
    if (!offlineCore.jsonBytes(previousValue).equals(storedReport.bytes)
        || !offlineCore.jsonBytes(previousManifest).equals(storedManifest.bytes)
        || previousValue.epoch !== `${OFFLINE_EPOCH_PREFIX}${String(item).padStart(2, '0')}`
        || previousManifest.schemaVersion !== 1 || previousManifest.issue !== 7
        || previousManifest.epoch !== previousValue.epoch || previousManifest.reportSha256 !== storedReport.sha256
        || !sameJson(previousManifest.files, OFFLINE_FILES) || !/^[a-f0-9]{40}$/.test(previousManifest.head || '')) {
      throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_PRIOR_EPOCH_INVALID');
    }
    if (item === number) { report = storedReport; manifest = storedManifest; value = previousValue; manifestValue = previousManifest; }
  }
  if (value.epoch !== `${OFFLINE_EPOCH_PREFIX}${String(number).padStart(2, '0')}`
      || value.outcome !== 'GATE0_2_VERIFIED_AND_PUBLISHED'
      || value.delivery?.currentHead !== expectedHead || value.delivery?.prBranch !== PR_BRANCH
      || manifestValue.head !== expectedHead
      || value.gate0?.status !== 'PASS' || value.gate0?.acousticCalls !== 0
      || value.gate1?.status !== 'PASS' || value.gate1?.predicate !== 'RECOVERED_IDENTICAL'
      || value.gate2?.status !== 'PASS' || value.gate2?.comparison?.result !== 'PCM_METRICS_RECOMPUTED_AND_MATCHED'
      || value.gate2?.cellCount !== 140 || manifestValue.reportSha256 !== report.sha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_REPORT_NOT_CURRENT_AND_VERIFIED');
  }
  return {number, epoch: value.epoch, reportSha256: report.sha256, manifestSha256: manifest.sha256, report: value, roots};
}

function locateArchive(home = os.homedir()) {
  const explicit = process.env.ISSUE7_SALAMANDER_ARCHIVE_PATH;
  if (explicit) return path.resolve(explicit);
  return require('./analyze-issue7-physical-identification.cjs')
    .locateGoogleDriveArchive({cloudStorage: path.join(home, 'Library', 'CloudStorage')});
}
function frozenSourceSnapshot({root = ROOT, home = os.homedir(), commonDirectory} = {}) {
  const offline = require('./issue7-physical-root-cause-offline-v1-core.cjs');
  const roots = offline.resolveInputRoots({root, home, commonDirectory});
  const primary = fs.readdirSync(roots.offlineBase.primaryRoot).filter(name => /^analysis-[0-9]{2}$/.test(name)).sort();
  const secondary = fs.readdirSync(roots.offlineBase.secondaryRoot).filter(name => /^analysis-[0-9]{2}$/.test(name)).sort();
  if (!primary.length || !sameJson(primary, secondary)) throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EPOCH_COPIES');
  const offlineEpochs = {};
  for (const name of primary) {
    const number = Number(name.slice('analysis-'.length)), pair = offline.resolveOfflinePair(roots, number);
    const membersA = fs.readdirSync(pair.primary).sort(), membersB = fs.readdirSync(pair.secondary).sort();
    if (!sameJson(membersA, [...OFFLINE_FILES].sort()) || !sameJson(membersA, membersB)) {
      throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EPOCH_MEMBERS');
    }
    const records = {};
    for (const relative of OFFLINE_FILES) {
      const stored = offline.readDual(pair, relative);
      if (!stored) throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EPOCH_INCOMPLETE');
      const filePrimary = path.join(pair.primary, relative), fileSecondary = path.join(pair.secondary, relative);
      const stat = file => { const value = fs.lstatSync(file); return {sha256: stored.sha256, size: value.size, mtimeMs: value.mtimeMs}; };
      records[relative] = {primary: stat(filePrimary), secondary: stat(fileSecondary)};
    }
    offlineEpochs[name] = records;
  }
  return {parentEvidence: offline.snapshotSources(roots), offlineEpochs};
}
function frozenSnapshotSha256(snapshot) { return sha256(Buffer.from(JSON.stringify(stable(snapshot)))); }
function recoveryPreflightFileName(head) {
  if (!/^[a-f0-9]{40}$/.test(head || '')) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_HEAD');
  return `recovery-preflight-${head}.json`;
}
function snapshotActiveRootMembers(roots, members, {requireExact = true} = {}) {
  const copies = {};
  for (const [name, base] of [['primary', roots.primary], ['secondary', roots.secondary]]) {
    const rootStat = fs.lstatSync(base);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || fs.realpathSync(base) !== base) {
      throw new Error('BLOCKED_CONTACT_LOSS_EPOCH_ROOT_UNSAFE');
    }
    const present = fs.readdirSync(base).sort();
    if (requireExact ? !sameJson(present, [...members].sort())
      : members.some(relative => !present.includes(relative))) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_ORIGINAL_MEMBERS');
    }
    copies[name] = Object.fromEntries(members.map(relative => [relative, fileSnapshot(base, relative)]));
  }
  for (const relative of members) {
    if (!sameBytesSnapshot(copies.primary[relative], copies.secondary[relative])) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_ORIGINAL_COPY_DRIFT');
    }
  }
  return copies;
}
function assertLockedRecoveryPrefix(roots, expectedSnapshot) {
  const expected = Object.keys(expectedSnapshot?.primary || {}).sort();
  if (!expectedSnapshot?.secondary
      || !sameJson(Object.keys(expectedSnapshot.secondary).sort(), expected)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PREFIX_SET');
  }
  const present = epochRootMembers(roots);
  if (!present.includes('writer.lock')
      || !sameJson(present.filter(name => name !== 'writer.lock').sort(), expected)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PREFIX_SET');
  }
  const current = snapshotActiveRootMembers(roots, expected, {requireExact: false});
  if (!sameJson(current, expectedSnapshot)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PREFIX_MUTATED');
  }
  return true;
}
function sameBytesSnapshot(left, right) {
  return Boolean(left && right && left.sha256 === right.sha256 && left.size === right.size);
}
function verifyRecoverySourceDelta(originalSource, recoverySource, allowedSourceDelta = RECOVERY_ALLOWED_SOURCE_DELTA) {
  const originalPaths = Object.keys(originalSource || {}).sort(), currentPaths = Object.keys(recoverySource || {}).sort();
  const expectedOldPaths = SOURCE_FILES.filter(relative => relative !== PREPARE_RECOVERY_CONTRACT_REL
    && relative !== PREPARE_RECOVERY_CONTINUATION_07_CONTRACT_REL).sort();
  const currentPathSets = [[...SOURCE_FILES].filter(relative =>
    relative !== PREPARE_RECOVERY_CONTINUATION_07_CONTRACT_REL).sort(), [...SOURCE_FILES].sort()];
  if (!sameJson(originalPaths, expectedOldPaths) || !currentPathSets.some(paths => sameJson(currentPaths, paths))) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_SOURCE_MANIFEST');
  }
  const changed = [...new Set([...originalPaths, ...currentPaths])].filter(relative =>
    !sameJson(originalSource[relative] ?? null, recoverySource[relative] ?? null)).sort();
  if (!sameJson(changed, [...allowedSourceDelta].sort())) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_SOURCE_DELTA');
  }
  for (const relative of originalPaths) {
    if (!allowedSourceDelta.includes(relative) && !sameJson(originalSource[relative], recoverySource[relative])) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_UNAUTHORIZED_SOURCE_DRIFT');
    }
  }
  return Object.fromEntries(changed.map(relative => [relative, {
    before: originalSource[relative] || null, after: recoverySource[relative] || null
  }]));
}
function readOriginalMalformedPreparation(roots, {allowRecoveryHistory = false} = {}) {
  const originalPreflightFile = preflightFileName(RECOVERY_ORIGINAL_HEAD);
  const members = ['gate3-analysis.json', 'plan.json', 'prepare.json', originalPreflightFile];
  const memberSnapshot = snapshotActiveRootMembers(roots, members, {requireExact: !allowRecoveryHistory});
  const prepare = readJsonDual(roots, 'prepare.json', {required: true});
  const plan = readDual(roots, 'plan.json', {required: true});
  const gate3 = readJsonDual(roots, 'gate3-analysis.json', {required: true});
  const originalPreflight = readJsonDual(roots, originalPreflightFile, {required: true});
  const expectedPlan = jsonBytes({schemaVersion: 2, epoch: ACTIVE_EPOCH,
    contractSha256: SUCCESSOR_CONTRACT_SHA256, plan: core.plan(), callCap: 42,
    historicalCalls: 3251, lifetimeCap: 5255, downstreamReserve: 1962});
  if (prepare.sha256 !== RECOVERY_ORIGINAL_PREPARE_SHA256
      || plan.sha256 !== RECOVERY_ORIGINAL_PLAN_SHA256
      || gate3.sha256 !== RECOVERY_ORIGINAL_GATE3_SHA256
      || originalPreflight.sha256 !== RECOVERY_ORIGINAL_PREFLIGHT_SHA256
      || !plan.bytes.equals(expectedPlan)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_ORIGINAL_HASH');
  }
  const value = prepare.value;
  assertPreflightReceiptShape(originalPreflight.value, RECOVERY_ORIGINAL_HEAD);
  if (value.schemaVersion !== 2 || value.issue !== 7 || value.pr !== PR_NUMBER
      || value.branch !== PR_BRANCH || value.head !== RECOVERY_ORIGINAL_HEAD
      || value.epoch !== ACTIVE_EPOCH || value.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
      || value.preflightFile !== originalPreflightFile || Object.hasOwn(value, 'preflightSha256')
      || value.gate3?.analysisSha256 !== gate3.sha256
      || gate3.value.head !== RECOVERY_ORIGINAL_HEAD
      || gate3.value.status !== 'GATE3_ANALYSIS_PASS' || gate3.value.cellCount !== 140
      || !sameJson(value.source, originalPreflight.value.source)
      || !sameJson(value.parentEpoch, originalPreflight.value.parentProof)
      || !sameJson(value.frozenEvidenceSnapshot, originalPreflight.value.frozenEvidenceSnapshot)
      || value.startedCalls !== 0 || value.completedCalls !== 0 || value.ambiguousCalls !== 0
      || !sameJson(value.plan, core.plan()) || !sameJson(value.budget, core.accounting())
      || !sameJson(originalPreflight.value.gate3.analysisSha256, gate3.sha256)
      || originalPreflight.value.builds.diagnostic.wasm.sha256 !== value.build?.wasm?.sha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_ORIGINAL_IDENTITY');
  }
  return {prepare, plan, gate3, originalPreflight, memberSnapshot};
}
function assertRecoveryFrozenAppendOnly(originalSnapshot, recoverySnapshot, recoveryModeOrReceipt) {
  const policy = recoveryModeOrReceipt?.kind
    ? expectedRecoveryPolicy(recoveryModeOrReceipt) : recoveryPolicyForMode(recoveryModeOrReceipt);
  const originalEpochs = Object.keys(originalSnapshot?.offlineEpochs || {}).sort();
  const recoveryEpochs = Object.keys(recoverySnapshot?.offlineEpochs || {}).sort();
  if (!originalEpochs.length
      || originalEpochs.at(-1) !== `analysis-${String(RECOVERY_FROZEN_BASE_LATEST_ANALYSIS).padStart(2, '0')}`
      || !sameJson(originalSnapshot.parentEvidence, recoverySnapshot?.parentEvidence)
      || recoveryEpochs.length !== originalEpochs.length + policy.expectedAdditionalEpochs
      || !sameJson(recoveryEpochs.slice(0, originalEpochs.length), originalEpochs)
      || recoveryEpochs.at(-1) !== policy.expectedLatestEpoch) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_FROZEN_EPOCH_SEQUENCE');
  }
  for (const epoch of originalEpochs) {
    if (!sameJson(originalSnapshot.offlineEpochs[epoch], recoverySnapshot.offlineEpochs[epoch])) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_FROZEN_PARENT_DRIFT');
    }
  }
  const appendedEpochs = recoveryEpochs.slice(originalEpochs.length);
  if (!sameJson(appendedEpochs, policy.appendedEpochs)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_FROZEN_EPOCH_SEQUENCE');
  }
  for (const epoch of appendedEpochs) {
    const item = recoverySnapshot.offlineEpochs[epoch];
    for (const relative of OFFLINE_FILES) {
      const copies = item?.[relative];
      const validSnapshot = value => /^[a-f0-9]{64}$/.test(value?.sha256 || '')
        && Number.isSafeInteger(value?.size) && value.size > 0 && Number.isFinite(value?.mtimeMs);
      if (!copies?.primary || !copies?.secondary || !validSnapshot(copies.primary)
          || !validSnapshot(copies.secondary) || !sameBytesSnapshot(copies.primary, copies.secondary)) {
        throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_FROZEN_APPEND_INCOMPLETE');
      }
    }
    const pinned = RECOVERY_FROZEN_PINNED_IDENTITIES[epoch];
    if (pinned && (item?.['report.json']?.primary.sha256 !== pinned.reportSha256
        || item?.['manifest.json']?.primary.sha256 !== pinned.manifestSha256)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_FROZEN_PINNED_IDENTITY');
    }
  }
  const latest = recoverySnapshot.offlineEpochs[policy.expectedLatestEpoch];
  if (!latest?.['report.json'] || !latest?.['manifest.json']) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_FROZEN_LATEST_INCOMPLETE');
  }
  return true;
}
function comparableGate3Evidence(value) {
  const copy = structuredClone(value);
  for (const key of ['head', 'branch', 'prUrl', 'offlineEpoch', 'offlineReportSha256', 'frozenSnapshotSha256']) delete copy[key];
  return copy;
}
function assertSameGate3Evidence(original, recovery, expectedHead, expectedOfflineEpoch = null) {
  const expectedEpochNumber = Number(String(original?.offlineEpoch || '').slice('physical-root-cause-offline-v1/analysis-'.length)) + 1;
  const expectedEpoch = expectedOfflineEpoch
    || `physical-root-cause-offline-v1/analysis-${String(expectedEpochNumber).padStart(2, '0')}`;
  if (recovery?.head !== expectedHead || recovery?.offlineEpoch !== expectedEpoch
      || recovery.status !== 'GATE3_ANALYSIS_PASS' || recovery.cellCount !== 140 || recovery.observationCount !== 20
      || !sameJson(comparableGate3Evidence(original), comparableGate3Evidence(recovery))) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_GATE3_EVIDENCE_DRIFT');
  }
  return expectedEpoch;
}
const RECOVERY_OFFLINE_EPOCHS_BY_MODE = Object.freeze({
  recovery: RECOVERY_CURRENT_OFFLINE_EPOCH,
  continuation02: PREPARE_RECOVERY_CONTINUATION_02_OFFLINE_EPOCH,
  continuation03: PREPARE_RECOVERY_CONTINUATION_03_OFFLINE_EPOCH,
  continuation04: PREPARE_RECOVERY_CONTINUATION_04_OFFLINE_EPOCH,
  continuation05: PREPARE_RECOVERY_CONTINUATION_05_OFFLINE_EPOCH,
  continuation06: PREPARE_RECOVERY_CONTINUATION_06_OFFLINE_EPOCH,
  continuation07: PREPARE_RECOVERY_CONTINUATION_07_OFFLINE_EPOCH
});
function recoveryPolicyForMode(mode = {}) {
  const selected = Object.keys(RECOVERY_OFFLINE_EPOCHS_BY_MODE).filter(name => mode[name] === true);
  if (selected.length !== 1 || Object.keys(mode).some(name => !(name in RECOVERY_OFFLINE_EPOCHS_BY_MODE))) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_OFFLINE_MODE');
  }
  const offlineEpoch = RECOVERY_OFFLINE_EPOCHS_BY_MODE[selected[0]];
  const match = /^physical-root-cause-offline-v1\/analysis-(\d{2})$/.exec(offlineEpoch);
  const latestNumber = match ? Number(match[1]) : NaN;
  const expectedAdditionalEpochs = latestNumber - RECOVERY_FROZEN_BASE_LATEST_ANALYSIS;
  if (!Number.isSafeInteger(latestNumber) || expectedAdditionalEpochs < 1) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_OFFLINE_POLICY');
  }
  const appendedEpochs = Object.freeze(Array.from({length: expectedAdditionalEpochs}, (_, index) =>
    `analysis-${String(RECOVERY_FROZEN_BASE_LATEST_ANALYSIS + index + 1).padStart(2, '0')}`));
  return Object.freeze({mode: selected[0], offlineEpoch, expectedLatestEpoch: appendedEpochs.at(-1),
    expectedAdditionalEpochs, appendedEpochs});
}
function recoveryOfflineEpochForMode(mode = {}) {
  return recoveryPolicyForMode(mode).offlineEpoch;
}
function expectedRecoveryPolicy(recoveryReceipt) {
  const modeByKind = {
    CONTACT_LOSS_PREPARE_RECOVERY: 'recovery',
    CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_02: 'continuation02',
    CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_03: 'continuation03',
    CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_04: 'continuation04',
    CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_05: 'continuation05',
    CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_06: 'continuation06',
    CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_07: 'continuation07'
  };
  const kind = String(recoveryReceipt?.kind || '').replace(/_PREFLIGHT$/, '');
  const mode = modeByKind[kind];
  if (!mode) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_RECEIPT_KIND');
  return recoveryPolicyForMode({[mode]: true});
}
function expectedRecoveryOfflineEpoch(recoveryReceipt) {
  return expectedRecoveryPolicy(recoveryReceipt).offlineEpoch;
}
function expectedRecoveryPreflightHeads({firstRecovery, continuation02, continuation03,
  continuation04, continuation05, continuation06, continuation07} = {}) {
  if (!firstRecovery?.executionHead || (continuation05 && (continuation06 || continuation07))
      || (continuation06 && continuation07)
      || (continuation07 && (!continuation02 || !continuation03 || !continuation04))) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_PREFLIGHT_CHAIN');
  }
  return [firstRecovery.executionHead,
    ...(continuation02 ? [continuation02.executionHead] : []),
    ...(continuation03 ? [continuation03.executionHead] : []),
    ...(continuation04 ? [continuation04.executionHead] : []),
    ...(continuation05 ? [continuation05.executionHead] : []),
    ...(continuation06 ? [continuation06.executionHead] : []),
    ...(continuation07 ? [continuation07.executionHead] : [])]
    .map(recoveryPreflightFileName).sort();
}
function assertFrozenSnapshotMatches(actual, prepare) {
  const expected = prepare?.frozenEvidenceSnapshot;
  if (!expected || !sameJson(actual, expected)) throw new Error('BLOCKED_CONTACT_LOSS_FROZEN_EVIDENCE_DRIFT');
  // Older immutable prepare records bind the full snapshot directly; derive
  // this redundant digest instead of rewriting those records.
  const expectedSha256 = prepare.gate3?.frozenSnapshotSha256 || frozenSnapshotSha256(expected);
  if (frozenSnapshotSha256(actual) !== expectedSha256) throw new Error('BLOCKED_CONTACT_LOSS_FROZEN_EVIDENCE_DRIFT');
  return true;
}
function gate3Analysis({root = ROOT, home = os.homedir(), commonDirectory} = {}) {
  const identity = currentIdentity(root), pr = verifiedPullRequest(root, identity.head);
  const offline = latestOfflineReport(root, home, commonDirectory, identity.head);
  const offlineCore = require('./issue7-physical-root-cause-offline-v1-core.cjs');
  const inputs = offlineCore.resolveInputRoots({root, home, commonDirectory});
  const before = frozenSourceSnapshot({root, home, commonDirectory}), records = offlineCore.verifyFrozenRecords(inputs);
  const archive = locateArchive(home);
  if (!archive) throw new Error('BLOCKED_CONTACT_LOSS_REFERENCE_ARCHIVE_MISSING');
  const observations = [
    ...offlineCore.readVerifiedV3Rows(inputs, records.p5History.value),
    ...offlineCore.readVerifiedV4Rows(inputs, records.p5History.value, records.p3Result.value)
  ];
  if (observations.length !== 20) throw new Error('BLOCKED_CONTACT_LOSS_HISTORICAL_OBSERVATION_COUNT');
  const reference = offlineCore.readVerifiedReference(archive, records.p3Manifest.value);
  const recomputed = offlineCore.recomputeOfficial({rows: observations, reference, gainDb: records.sharedGainOffsetDb});
  const comparison = offlineCore.compareHistory(recomputed, records.p5History.value, {db: 1e-6, nonDb: 1e-8});
  const after = frozenSourceSnapshot({root, home, commonDirectory});
  if (!sameJson(before, after)) throw new Error('BLOCKED_CONTACT_LOSS_FROZEN_EVIDENCE_CHANGED');
  if (comparison.result !== 'PCM_METRICS_RECOMPUTED_AND_MATCHED') throw new Error('BLOCKED_CONTACT_LOSS_HISTORICAL_PCM_MISMATCH');
  const sourceRows = recomputed.flatMap(observation => observation.metrics.map(row => ({id: observation.id,
    source: observation.source, pitch: row.pitch, velocity: row.velocity,
    earlyResidualDb: row.earlyResidualDb, lateResidualDb: row.lateResidualDb,
    postAttackShapeErrorDb: row.postAttackShapeErrorDb, hardFailures: row.hardFailures,
    finite: row.finite, guardHits: row.guardHits, peakDbfs: row.peakDbfs})));
  return {status: 'GATE3_ANALYSIS_PASS', contractSha256: CONTRACT_SHA256, head: identity.head, branch: identity.branch,
    prUrl: pr.url, offlineEpoch: offline.epoch, offlineReportSha256: offline.reportSha256,
    archiveSha256: reference.archiveSha256, observationCount: observations.length, cellCount: recomputed.reduce((sum, row) => sum + row.rows.length, 0),
    comparison, sourceRows, hypothesis: 'HAMMER_CONTACT_DISSIPATION_HYPOTHESIS',
    causalStatus: 'NOT_CONFIRMED', stage3: 'NOT EVALUATED', stage4: 'NOT EVALUATED',
    frozenSnapshotSha256: frozenSnapshotSha256(before)};
}

function verifyDiagnosticBuild(root, expectedHead, options = {}) {
  const buildDirectory = path.resolve(root, options.buildDirectory || DIAGNOSTIC_BUILD_REL);
  const cachePath = path.join(buildDirectory, 'CMakeCache.txt'), wasmPath = path.join(buildDirectory, WASM_REL);
  const cache = fs.readFileSync(cachePath, 'utf8');
  const option = (name, value) => new RegExp(`^${name}:[^=]+=${value}$`, 'm').test(cache);
  if (!option('BUILD_TESTING', 'ON') || !option('SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS', 'ON')
      || !option('SORAOTO_SUPERSYNTH_CONTACT_LOSS_DIAGNOSTICS', 'ON')
      || !option('SORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS', 'OFF')
      || !cache.includes(`CMAKE_HOME_DIRECTORY:INTERNAL=${path.join(root, 'wasm')}`)
      || !cache.includes(`CMAKE_TOOLCHAIN_FILE:FILEPATH=${path.join(root, 'wasm/cmake/wasm32-clang.cmake')}`)) {
    throw new Error('BLOCKED_CONTACT_LOSS_DIAGNOSTIC_BUILD_OPTIONS');
  }
  const objectPath = path.join(buildDirectory, 'plugins/dsp/super-synth/CMakeFiles/soraoto_dsp_super_synth.dir/src/plugin.c.obj');
  const objectStat = fs.statSync(objectPath), wasm = syncReadSha(wasmPath);
  const compileInputs = ['wasm/plugins/dsp/super-synth/src/plugin.c', 'wasm/CMakeLists.txt',
    'wasm/cmake/wasm_plugin.cmake', 'wasm/plugins/dsp/super-synth/presets.json',
    'wasm/shared/generated/super-synth_grand_profiles.h'];
  if (compileInputs.some(relative => fs.statSync(path.join(root, relative)).mtimeMs > objectStat.mtimeMs)
      || wasm.mtimeMs < objectStat.mtimeMs) throw new Error('BLOCKED_CONTACT_LOSS_STALE_DIAGNOSTIC_BUILD');
  const exports = WebAssembly.Module.exports(new WebAssembly.Module(wasm.bytes)).map(row => row.name);
  for (const name of ['soraoto_supersynth_contact_loss_set', 'soraoto_supersynth_contact_loss_get',
    'soraoto_supersynth_guard_hit_count', 'soraoto_supersynth_active_voice_count']) {
    if (!exports.includes(name)) throw new Error('BLOCKED_CONTACT_LOSS_DIAGNOSTIC_EXPORTS');
  }
  const source = sourceSnapshot(root);
  return {head: expectedHead, source, diagnosticBuildDirectory: path.relative(root, buildDirectory),
    wasm: {sha256: wasm.sha256, size: wasm.size, exports: exports.filter(name => name.startsWith('soraoto_supersynth_contact_loss_')).sort()}};
}

function verifyProductionBuild(root, expectedHead, options = {}) {
  const buildDirectory = path.resolve(root, options.buildDirectory || RELEASE_BUILD_REL);
  const cachePath = path.join(buildDirectory, 'CMakeCache.txt'), wasmPath = path.join(buildDirectory, WASM_REL);
  const cache = fs.readFileSync(cachePath, 'utf8');
  const option = (name, value) => new RegExp(`^${name}:[^=]+=${value}$`, 'm').test(cache);
  if (!option('BUILD_TESTING', 'OFF') || !option('SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS', 'OFF')
      || !option('SORAOTO_SUPERSYNTH_CONTACT_LOSS_DIAGNOSTICS', 'OFF')
      || !option('SORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS', 'OFF')
      || !cache.includes(`CMAKE_HOME_DIRECTORY:INTERNAL=${path.join(root, 'wasm')}`)
      || !cache.includes(`CMAKE_TOOLCHAIN_FILE:FILEPATH=${path.join(root, 'wasm/cmake/wasm32-clang.cmake')}`)) {
    throw new Error('BLOCKED_CONTACT_LOSS_PRODUCTION_BUILD_OPTIONS');
  }
  const objectPath = path.join(buildDirectory, 'plugins/dsp/super-synth/CMakeFiles/soraoto_dsp_super_synth.dir/src/plugin.c.obj');
  const objectStat = fs.statSync(objectPath), wasm = syncReadSha(wasmPath);
  const compileInputs = ['wasm/plugins/dsp/super-synth/src/plugin.c', 'wasm/CMakeLists.txt',
    'wasm/cmake/wasm_plugin.cmake', 'wasm/plugins/dsp/super-synth/presets.json',
    'wasm/shared/generated/super-synth_grand_profiles.h'];
  if (compileInputs.some(relative => fs.statSync(path.join(root, relative)).mtimeMs > objectStat.mtimeMs)
      || wasm.mtimeMs < objectStat.mtimeMs) throw new Error('BLOCKED_CONTACT_LOSS_STALE_PRODUCTION_BUILD');
  const exports = WebAssembly.Module.exports(new WebAssembly.Module(wasm.bytes)).map(row => row.name).sort();
  for (const name of ['soraoto_plugin_process', 'soraoto_plugin_init']) {
    if (!exports.includes(name)) throw new Error('BLOCKED_CONTACT_LOSS_PRODUCTION_BUILD_EXPORTS');
  }
  if (exports.some(name => ['soraoto_supersynth_contact_loss_set', 'soraoto_supersynth_contact_loss_get',
    'soraoto_supersynth_guard_hit_count', 'soraoto_supersynth_active_voice_count'].includes(name))) {
    throw new Error('BLOCKED_CONTACT_LOSS_PRODUCTION_BUILD_DIAGNOSTIC_EXPORTS');
  }
  return {head: expectedHead, source: sourceSnapshot(root), productionBuildDirectory: path.relative(root, buildDirectory),
    wasm: {sha256: wasm.sha256, size: wasm.size, exports}};
}

const BASELINE_INPUT_PATHS = Object.freeze([
  'wasm/test/audio-quality-regression.test.js', 'wasm/test/helpers/plugin-harness.cjs',
  'web-player/src/js/compiler.js', 'web-player/src/js/instrument-library.js', 'web-player/public/songs',
  'wasm/plugins/dsp/super-synth/test/tools/verify-supersynth-v9-production-lifecycle.cjs',
  'wasm/plugins/dsp/super-synth/test/tools/piano-pitch-estimator.cjs',
  'wasm/plugins/dsp/super-synth/test/supersynth-v9-full-range-calibration.test.js',
  'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json',
  'wasm/plugins/dsp/super-synth/presets.json', 'wasm/plugins/dsp/super-synth/src/plugin.c',
  'wasm/shared/generated/super-synth_grand_profiles.h', 'wasm/plugins/dsp/drum-machine',
  'wasm/plugins/effects/master-limiter'
]);
const BASELINE_TEST_SOURCE_HASHES = Object.freeze({
  'wasm/test/audio-quality-regression.test.js': 'cb24d7b78b9145e5d43ca4405d48a0b52259557ef7df2a45d1c04ec199c2d165',
  'wasm/plugins/dsp/super-synth/test/tools/verify-supersynth-v9-production-lifecycle.cjs': '7f88c043544ac0984702efe883d5b35ab3b4191bc8c41767094f39d1a573ebbd',
  'wasm/plugins/dsp/super-synth/test/supersynth-v9-full-range-calibration.test.js': 'a78bf720b84868d41f68c91f394dad8c79d035fcc20b70dc020df2a094a075c8'
});
function verifyBaselineInputs(root, head) {
  for (const [relative, expected] of Object.entries(BASELINE_TEST_SOURCE_HASHES)) {
    if (syncReadSha(path.join(root, relative)).sha256 !== expected) {
      throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_BASELINE_SOURCE_DRIFT');
    }
  }
  const result = spawnSync('rtk', ['git', 'diff', '--quiet', `${BASELINE_HEAD}...${head}`, '--', ...BASELINE_INPUT_PATHS],
    {cwd: root, stdio: ['ignore', 'ignore', 'ignore']});
  if (result.error || result.status !== 0) throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_BASELINE_INPUT_DRIFT');
  return {baselineHead: BASELINE_HEAD, unchangedPaths: [...BASELINE_INPUT_PATHS], sourceHashes: BASELINE_TEST_SOURCE_HASHES};
}

function preflightTestEnvironment({root = ROOT, diagnosticBuildDirectory, productionBuildDirectory, env = process.env} = {}) {
  const diagnosticPath = path.resolve(root, diagnosticBuildDirectory || DIAGNOSTIC_BUILD_REL);
  const productionPath = path.resolve(root, productionBuildDirectory || RELEASE_BUILD_REL);
  if (diagnosticPath === productionPath) throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_BUILD_MATRIX');
  return {...env, ISSUE7_CONTACT_LOSS_REQUIRE_BUILD_MATRIX: '1',
    ISSUE7_CONTACT_LOSS_BUILD_DIR: diagnosticPath,
    ISSUE7_CONTACT_LOSS_PRODUCTION_BUILD_DIR: productionPath,
    ISSUE7_CONTACT_LOSS_RELEASE_BUILD_DIR: productionPath,
    SORAOTO_WASM_BUILD_DIR: diagnosticPath,
    ISSUE7_ROOT_CAUSE_PRIVATE_EVIDENCE: '1'};
}

function buildP3SourceManifest(p3Record, readBlob) {
  const creatorCommit = p3Record?.creatorCommit;
  const sourceHashes = p3Record?.optimizer?.sourceHashes;
  if (!/^[a-f0-9]{40}$/.test(creatorCommit || '') || !sourceHashes || typeof sourceHashes !== 'object'
      || Array.isArray(sourceHashes) || typeof readBlob !== 'function') {
    throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_P3_SOURCE_RECORD');
  }
  const entries = Object.entries(sourceHashes)
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (entries.length !== P3_PINNED_SOURCE_COUNT) throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_P3_SOURCE_COUNT');
  const rows = entries.map(([relative, expectedSha256]) => {
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)
        || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..')
        || !/^[a-f0-9]{64}$/.test(expectedSha256 || '')) {
      throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_P3_SOURCE_PATH');
    }
    let bytes;
    try { bytes = readBlob(creatorCommit, relative); }
    catch { throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_P3_SOURCE_UNAVAILABLE'); }
    try { if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes); }
    catch { throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_P3_SOURCE_UNAVAILABLE'); }
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== expectedSha256) throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_P3_SOURCE_IDENTITY');
    return {path: relative, size: bytes.length, sha256: actualSha256};
  });
  return {creatorCommit, rows, sha256: sha256(jsonBytes(rows))};
}

function runOfflineFrozenWithP3Sources({root = ROOT, home = os.homedir(), commonDirectory,
  head, args, env = process.env} = {}) {
  if (path.basename(root) !== 'soraoto_dsl') throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_P3_REPOSITORY_IDENTITY');
  const p3Core = require('./issue7-physical-fit-v4-core.cjs');
  const p3Roots = p3Core.resolveRoots(root, home, commonDirectory);
  const p3Stored = p3Core.readDual(p3Roots, 'runtime-revisions/physical-fit-P3.json');
  if (!p3Stored) throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_P3_RECORD_MISSING');
  const p3Record = JSON.parse(p3Stored.bytes.toString('utf8'));
  const sourceManifest = buildP3SourceManifest(p3Record,
    (commit, relative) => gitBytes(root, ['show', commit + ':' + relative]));
  if (git(root, ['merge-base', p3Record.creatorCommit, head]) !== p3Record.creatorCommit) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_P3_CREATOR_NOT_ANCESTOR');
  }
  const originalWasm = syncReadSha(path.join(root, P1_DIAGNOSTIC_WASM_REL));
  if (originalWasm.sha256 !== P1_DIAGNOSTIC_WASM_SHA256) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_P1_WASM_IDENTITY');
  }

  const temporaryParent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'issue7-contact-loss-preflight-')));
  const scratchRoot = path.join(temporaryParent, path.basename(root));
  const temporaryBranch = 'codex/preflight-issue7-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
  let worktreeAdded = false, branchAdded = false, commandResult, failureCode = null, cleanupFailed = false;
  let contextStep = 'P3_CONTEXT';
  try {
    contextStep = 'P3_WORKTREE_ADD';
    git(root, ['worktree', 'add', '--no-track', '-b', temporaryBranch, scratchRoot, head]);
    worktreeAdded = true;
    branchAdded = true;
    contextStep = 'P3_WORKTREE_HEAD';
    if (git(scratchRoot, ['rev-parse', 'HEAD']) !== head) {
      throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_P3_WORKTREE_HEAD');
    }
    contextStep = 'P3_WORKTREE_UPSTREAM';
    git(scratchRoot, ['branch', '--set-upstream-to', 'origin/' + PR_BRANCH]);
    if (git(scratchRoot, ['rev-parse', '--abbrev-ref', '@{upstream}']) !== 'origin/' + PR_BRANCH) {
      throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_P3_WORKTREE_UPSTREAM');
    }
    contextStep = 'P3_SOURCE_OVERLAY';
    for (const row of sourceManifest.rows) {
      const target = assertSafe(scratchRoot, path.join(scratchRoot, row.path));
      const bytes = gitBytes(root, ['show', sourceManifest.creatorCommit + ':' + row.path]);
      if (bytes.length !== row.size || sha256(bytes) !== row.sha256) {
        throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_P3_SOURCE_IDENTITY');
      }
      fs.writeFileSync(target, bytes);
    }
    contextStep = 'P1_WASM_LINK';
    const scratchWasm = assertSafe(scratchRoot, path.join(scratchRoot, P1_DIAGNOSTIC_WASM_REL));
    fs.mkdirSync(path.dirname(scratchWasm), {recursive: true});
    if (fs.existsSync(scratchWasm)) throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_P1_WASM_TARGET_EXISTS');
    fs.symlinkSync(path.join(root, P1_DIAGNOSTIC_WASM_REL), scratchWasm);
    contextStep = 'OFFLINE_FROZEN_TESTS';
    commandResult = runPreflightCommand(scratchRoot, args, env);
  } catch (error) {
    failureCode = /^BLOCKED_[A-Z0-9_]+/.exec(String(error?.message || ''))?.[0]
      || 'BLOCKED_CONTACT_LOSS_PREFLIGHT_' + contextStep;
  } finally {
    if (!worktreeAdded) {
      const entries = spawnSync('rtk', ['git', 'worktree', 'list', '--porcelain'],
        {cwd: root, encoding: 'utf8'});
      if (entries.error || entries.status !== 0) cleanupFailed = true;
      else if (entries.stdout.split(/\r?\n/).includes('worktree ' + scratchRoot)) worktreeAdded = true;
    }
    if (worktreeAdded) {
      try { git(root, ['worktree', 'remove', '--force', scratchRoot]); }
      catch { cleanupFailed = true; }
    }
    if (!branchAdded) {
      const exists = spawnSync('rtk', ['git', 'show-ref', '--verify', '--quiet', 'refs/heads/' + temporaryBranch],
        {cwd: root, stdio: 'ignore'});
      if (exists.error || ![0, 1].includes(exists.status)) cleanupFailed = true;
      else if (exists.status === 0) branchAdded = true;
    }
    if (branchAdded) {
      try { git(root, ['branch', '-D', temporaryBranch]); }
      catch { cleanupFailed = true; }
    }
    try { fs.rmdirSync(temporaryParent); }
    catch { cleanupFailed = true; }
  }
  if (cleanupFailed) throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_P3_CONTEXT_CLEANUP');
  if (failureCode) throw new Error(failureCode);
  return {result: commandResult, sourceContext: {
    kind: 'P3_PINNED_TEMP_WORKTREE', head, p3CreatorCommit: sourceManifest.creatorCommit,
    p3RecordSha256: p3Stored.sha256, p3SourceCount: sourceManifest.rows.length,
    p3SourceManifestSha256: sourceManifest.sha256,
    originalP1WasmSha256: originalWasm.sha256, originalP1WasmSize: originalWasm.size,
    upstreamVerified: true, worktreeRemoved: true, branchRemoved: true
  }};
}

function runPreflightCommand(root, args, env = process.env) {
  const result = spawnSync('rtk', args, {cwd: root, encoding: 'utf8', env,
    maxBuffer: 128 * 1024 * 1024});
  return {status: result.status, errorCode: result.error?.code || null,
    stdout: result.stdout || '', stderr: result.stderr || ''};
}
function summarizePassingCtest(output, expectedCount) {
  const text = String(output);
  const legacy = text.match(/(\d+)% tests passed,\s*(\d+) tests failed out of\s*(\d+)/i);
  const current = text.match(/(\d+)% tests passed out of\s*(\d+)/i);
  const summary = legacy
    ? {tests: Number(legacy[3]), failed: Number(legacy[2])}
    : current && Number(current[1]) === 100
      ? {tests: Number(current[2]), failed: 0}
      : null;
  const skipped = ctestSkippedCount(text);
  const failureDetails = /^\s*\d+\s+-\s+.+?\s+\(Failed\)\s*$/m.test(text)
    || /The following tests FAILED:/i.test(text);
  const failed = summary ? Math.max(summary.failed, failureDetails ? 1 : 0) : null;
  if (!summary || summary.tests !== expectedCount || summary.failed !== 0 || skipped !== 0 || failureDetails) {
    return {tests: summary ? summary.tests : null,
      passed: summary ? Math.max(0, summary.tests - failed) : null, failed, skipped};
  }
  return {tests: summary.tests, passed: summary.tests, failed: 0, skipped: 0};
}
function summarizeCommand(result, summary) {
  return {...summary, stdoutSha256: sha256(Buffer.from(result.stdout)), stderrSha256: sha256(Buffer.from(result.stderr))};
}
function verifyRecoveryPostCTestEvidence({mode, testResults, originalGate3, analysis, expectedHead, currentHead,
  sourceBefore, sourceAfter, frozenBefore, frozenAfter, expectedPrefixSnapshot,
  currentPrefixSnapshot, expectedRootMembers, currentRootMembers} = {}) {
  const strictNode = testResults?.focusedNodeResult?.status === 0
    && !testResults.focusedNodeResult.errorCode
    && testResults.focusedNode?.tests > 0
    && testResults.focusedNode.passed === testResults.focusedNode.tests
    && testResults.focusedNode.failed === 0 && testResults.focusedNode.skipped === 0;
  const strictFocusedCTest = testResults?.focusedCTestResult?.status === 0
    && !testResults.focusedCTestResult.errorCode
    && testResults.focusedCTest?.tests === 2 && testResults.focusedCTest.passed === 2
    && testResults.focusedCTest.failed === 0 && testResults.focusedCTest.skipped === 0;
  const strictFrozen = testResults?.offlineFrozenResult?.status === 0
    && !testResults.offlineFrozenResult.errorCode
    && testResults.offlineFrozen?.tests > 0
    && testResults.offlineFrozen.passed === testResults.offlineFrozen.tests
    && testResults.offlineFrozen.failed === 0 && testResults.offlineFrozen.skipped === 0;
  const disclosedFullCTest = testResults?.fullCTest?.decision === 'BASELINE_FAILURES_DISCLOSED'
    && testResults.fullCTest.testCount === 50 && testResults.fullCTest.failedCount === 3
    && testResults.fullCTest.skippedCount === 0 && testResults.fullCTest.exitCode === 8;
  if (!strictNode || !strictFocusedCTest || !strictFrozen || !disclosedFullCTest) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_CHECKS');
  }
  const expectedOfflineEpoch = recoveryOfflineEpochForMode(mode);
  if (currentHead !== expectedHead) throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_IDENTITY_DRIFT');
  assertSameGate3Evidence(originalGate3, analysis, expectedHead, expectedOfflineEpoch);
  if (!sameJson(sourceBefore, sourceAfter)) throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_IDENTITY_DRIFT');
  if (!sameJson(frozenBefore, frozenAfter)) throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_FROZEN_DRIFT');
  const expectedMembers = [...(expectedRootMembers || [])].sort();
  if (!sameJson(Object.keys(expectedPrefixSnapshot?.primary || {}).sort(), expectedMembers)
      || !sameJson(Object.keys(expectedPrefixSnapshot?.secondary || {}).sort(), expectedMembers)
      || !sameJson(expectedPrefixSnapshot, currentPrefixSnapshot)
      || !sameJson([...(currentRootMembers || [])].sort(), expectedMembers)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_PREFIX_MUTATED');
  }
  return {status: 'PASS', expectedOfflineEpoch, writes: 0, renders: 0, acousticCalls: 0};
}
function preflightExperiment({root = ROOT, home = os.homedir(), commonDirectory, buildDirectory,
  productionBuildDirectory, recovery = false, continuation02 = false, continuation03 = false,
  continuation04 = false, continuation05 = false, continuation06 = false, continuation07 = false,
  testOnlyAdapters = null} = {}) {
  if (testOnlyAdapters && (process.env.ISSUE7_CONTACT_LOSS_V1_TEST_ADAPTERS !== '1'
      || path.resolve(root) === ROOT)) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_TEST_ADAPTERS_ON_LIVE_ROOT');
  }
  const call = (name, fallback, ...args) =>
    typeof testOnlyAdapters?.[name] === 'function' ? testOnlyAdapters[name](...args) : fallback(...args);
  const roots = resolveRoots({root, home, commonDirectory}), identity = call('currentIdentity', currentIdentity, root);
  const recoveryMode = {recovery, continuation02, continuation03, continuation04,
    continuation05, continuation06, continuation07};
  if (Object.values(recoveryMode).filter(Boolean).length > 1) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_MODE_CONFLICT');
  }
  if (identity.branch !== PR_BRANCH) throw new Error('BLOCKED_CONTACT_LOSS_BRANCH');
  call('verifiedPullRequest', verifiedPullRequest, root, identity.head);
  call('verifyIssueApproval', verifyIssueApproval, root);
  if (continuation02) call('verifyPrepareRecoveryContinuation02Approval', verifyPrepareRecoveryContinuation02Approval, root);
  if (continuation03) call('verifyPrepareRecoveryContinuation03Approval', verifyPrepareRecoveryContinuation03Approval, root);
  if (continuation04) call('verifyPrepareRecoveryContinuation04Approval', verifyPrepareRecoveryContinuation04Approval, root);
  if (continuation05) call('verifyPrepareRecoveryContinuation05Approval', verifyPrepareRecoveryContinuation05Approval, root);
  if (continuation06) call('verifyPrepareRecoveryContinuation06Approval', verifyPrepareRecoveryContinuation06Approval, root);
  if (continuation07) call('verifyPrepareRecoveryContinuation07Approval', verifyPrepareRecoveryContinuation07Approval, root);
  const activeMembers = call('epochRootMembers', epochRootMembers, roots);
  if (activeMembers.includes('writer.lock')) throw new Error('BLOCKED_CONTACT_LOSS_WRITER_LOCK_EXISTS');
  let original = null, previousRecovery = null, previousContinuation02 = null,
    previousContinuation03 = null, previousContinuation04 = null, previousRootSnapshot = null;
  if (recovery) {
    original = readOriginalMalformedPreparation(roots);
    if (activeMembers.length !== 4 || activeMembers.includes('prepare-recovery.json')
        || activeMembers.some(name => !['gate3-analysis.json', 'plan.json', 'prepare.json',
          preflightFileName(RECOVERY_ORIGINAL_HEAD)].includes(name))) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_PARTIAL_STATE');
    }
  } else if (continuation02) {
    original = readOriginalMalformedPreparation(roots, {allowRecoveryHistory: true});
    const expectedMembers = ['gate3-analysis.json', 'plan.json', 'prepare.json',
      preflightFileName(RECOVERY_ORIGINAL_HEAD), recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD),
      'prepare-recovery.json'].sort();
    if (!sameJson(activeMembers, expectedMembers)) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PREFIX_SET');
    const originalGate3 = readJsonDual(roots, 'gate3-analysis.json', {required: true});
    previousRecovery = verifyStoredPrepareRecovery(roots, {prepared: original.prepare,
      originalPreflight: original.originalPreflight, originalGate3});
    if (previousRecovery.sha256 !== RECOVERY_FIRST_RECEIPT_SHA256
        || previousRecovery.preflight.sha256 !== RECOVERY_FIRST_PREFLIGHT_SHA256) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PRIOR_RECEIPT');
    }
    const state = readExperimentState(roots);
    if (state.status !== 'READY' || state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_NONZERO_STATE');
    }
    previousRootSnapshot = snapshotActiveRootMembers(roots, expectedMembers);
  } else if (continuation03) {
    original = readOriginalMalformedPreparation(roots, {allowRecoveryHistory: true});
    const expectedMembers = ['gate3-analysis.json', 'plan.json', 'prepare.json',
      preflightFileName(RECOVERY_ORIGINAL_HEAD), recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD),
      'prepare-recovery.json', recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD),
      PREPARE_RECOVERY_CONTINUATION_02_REL].sort();
    if (!sameJson(activeMembers, expectedMembers)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_PREFIX_SET');
    }
    const originalGate3 = readJsonDual(roots, 'gate3-analysis.json', {required: true});
    previousRecovery = verifyStoredPrepareRecovery(roots, {prepared: original.prepare,
      originalPreflight: original.originalPreflight, originalGate3, allowContinuation02: true});
    if (previousRecovery.sha256 !== RECOVERY_FIRST_RECEIPT_SHA256
        || previousRecovery.preflight.sha256 !== RECOVERY_FIRST_PREFLIGHT_SHA256) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_FIRST_RECOVERY');
    }
    previousContinuation02 = verifyStoredPrepareRecoveryContinuation02(roots, {prepared: original.prepare,
      originalGate3, previousRecovery});
    if (previousContinuation02.sha256 !== RECOVERY_CONTINUATION_02_RECEIPT_SHA256
        || previousContinuation02.preflight.sha256 !== RECOVERY_CONTINUATION_02_PREFLIGHT_SHA256) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_PREVIOUS_RECEIPT');
    }
    const state = readExperimentState(roots);
    if (state.status !== 'READY' || state.recovery?.sha256 !== previousContinuation02.sha256
        || state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_NONZERO_STATE');
    }
    previousRootSnapshot = snapshotActiveRootMembers(roots, expectedMembers);
  } else if (continuation04) {
    original = readOriginalMalformedPreparation(roots, {allowRecoveryHistory: true});
    const expectedMembers = ['gate3-analysis.json', 'plan.json', 'prepare.json',
      preflightFileName(RECOVERY_ORIGINAL_HEAD), recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD),
      'prepare-recovery.json', recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD),
      PREPARE_RECOVERY_CONTINUATION_02_REL,
      recoveryPreflightFileName(RECOVERY_CONTINUATION_03_EXECUTION_HEAD),
      PREPARE_RECOVERY_CONTINUATION_03_REL].sort();
    if (!sameJson(activeMembers, expectedMembers)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_PREFIX_SET');
    }
    const originalGate3 = readJsonDual(roots, 'gate3-analysis.json', {required: true});
    previousRecovery = verifyStoredPrepareRecovery(roots, {prepared: original.prepare,
      originalPreflight: original.originalPreflight, originalGate3,
      allowContinuation02: true, allowContinuation03: true});
    previousContinuation02 = verifyStoredPrepareRecoveryContinuation02(roots, {prepared: original.prepare,
      originalGate3, previousRecovery, allowContinuation03: true});
    if (previousContinuation02.sha256 !== RECOVERY_CONTINUATION_02_RECEIPT_SHA256
        || previousContinuation02.preflight.sha256 !== RECOVERY_CONTINUATION_02_PREFLIGHT_SHA256) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_CONTINUATION_02');
    }
    previousContinuation03 = verifyStoredPrepareRecoveryContinuation03(roots, {prepared: original.prepare,
      originalGate3, previousContinuation02});
    if (previousContinuation03.sha256 !== RECOVERY_CONTINUATION_03_RECEIPT_SHA256
        || previousContinuation03.preflight.sha256 !== RECOVERY_CONTINUATION_03_PREFLIGHT_SHA256) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_PREVIOUS_RECEIPT');
    }
    const state = readExperimentState(roots);
    if (state.status !== 'READY' || state.recovery?.sha256 !== previousContinuation03.sha256
        || state.executionHead !== RECOVERY_CONTINUATION_03_EXECUTION_HEAD
        || state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_NONZERO_STATE');
    }
    previousRootSnapshot = snapshotActiveRootMembers(roots, expectedMembers);
  } else if (continuation05) {
    original = call('readOriginalMalformedPreparation', readOriginalMalformedPreparation, roots, {allowRecoveryHistory: true});
    const state = call('readExperimentState', readExperimentState, roots);
    previousContinuation04 = state.recovery;
    if (!previousContinuation04 || previousContinuation04.value.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_04'
        || state.status !== 'READY' || state.recovery.sha256 !== previousContinuation04.sha256
        || state.executionHead !== previousContinuation04.executionHead
        || state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_STATE');
    }
    const expectedMembers = ['gate3-analysis.json', 'plan.json', 'prepare.json',
      preflightFileName(RECOVERY_ORIGINAL_HEAD), recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD),
      'prepare-recovery.json', recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD),
      PREPARE_RECOVERY_CONTINUATION_02_REL,
      recoveryPreflightFileName(RECOVERY_CONTINUATION_03_EXECUTION_HEAD),
      PREPARE_RECOVERY_CONTINUATION_03_REL,
      recoveryPreflightFileName(previousContinuation04.executionHead), PREPARE_RECOVERY_CONTINUATION_04_REL].sort();
    if (!sameJson(activeMembers, expectedMembers)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_PREFIX_SET');
    }
    previousRootSnapshot = call('snapshotActiveRootMembers', snapshotActiveRootMembers, roots, expectedMembers);
  } else if (continuation06) {
    original = call('readOriginalMalformedPreparation', readOriginalMalformedPreparation, roots, {allowRecoveryHistory: true});
    const state = call('readExperimentState', readExperimentState, roots);
    previousContinuation04 = state.recovery;
    if (!previousContinuation04 || previousContinuation04.value.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_04'
        || state.status !== 'READY' || state.recovery.sha256 !== RECOVERY_CONTINUATION_04_RECEIPT_SHA256
        || state.recovery.preflight.sha256 !== RECOVERY_CONTINUATION_04_PREFLIGHT_SHA256
        || state.executionHead !== RECOVERY_CONTINUATION_04_EXECUTION_HEAD
        || state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0
        || call('readDual', readDual, roots, PREPARE_RECOVERY_CONTINUATION_05_REL)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_STATE');
    }
    const expectedMembers = ['gate3-analysis.json', 'plan.json', 'prepare.json',
      preflightFileName(RECOVERY_ORIGINAL_HEAD), recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD),
      'prepare-recovery.json', recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD),
      PREPARE_RECOVERY_CONTINUATION_02_REL,
      recoveryPreflightFileName(RECOVERY_CONTINUATION_03_EXECUTION_HEAD),
      PREPARE_RECOVERY_CONTINUATION_03_REL,
      recoveryPreflightFileName(RECOVERY_CONTINUATION_04_EXECUTION_HEAD),
      PREPARE_RECOVERY_CONTINUATION_04_REL].sort();
    if (!sameJson(activeMembers, expectedMembers)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_PREFIX_SET');
    }
    previousRootSnapshot = call('snapshotActiveRootMembers', snapshotActiveRootMembers, roots, expectedMembers);
  } else if (continuation07) {
    original = call('readOriginalMalformedPreparation', readOriginalMalformedPreparation, roots, {allowRecoveryHistory: true});
    const state = call('readExperimentState', readExperimentState, roots);
    previousContinuation04 = state.recovery;
    if (!previousContinuation04 || previousContinuation04.value.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_04'
        || state.status !== 'READY' || state.recovery.sha256 !== RECOVERY_CONTINUATION_04_RECEIPT_SHA256
        || state.recovery.preflight.sha256 !== RECOVERY_CONTINUATION_04_PREFLIGHT_SHA256
        || state.executionHead !== RECOVERY_CONTINUATION_04_EXECUTION_HEAD
        || state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0
        || call('readDual', readDual, roots, PREPARE_RECOVERY_CONTINUATION_05_REL)
        || call('readDual', readDual, roots, PREPARE_RECOVERY_CONTINUATION_06_REL)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_STATE');
    }
    const expectedMembers = ['gate3-analysis.json', 'plan.json', 'prepare.json',
      preflightFileName(RECOVERY_ORIGINAL_HEAD), recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD),
      'prepare-recovery.json', recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD),
      PREPARE_RECOVERY_CONTINUATION_02_REL,
      recoveryPreflightFileName(RECOVERY_CONTINUATION_03_EXECUTION_HEAD),
      PREPARE_RECOVERY_CONTINUATION_03_REL,
      recoveryPreflightFileName(RECOVERY_CONTINUATION_04_EXECUTION_HEAD),
      PREPARE_RECOVERY_CONTINUATION_04_REL].sort();
    if (!sameJson(activeMembers, expectedMembers)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_PREFIX_SET');
    }
    previousRootSnapshot = call('snapshotActiveRootMembers', snapshotActiveRootMembers, roots, expectedMembers);
  } else {
    if (activeMembers.some(name => !/^preflight-[a-f0-9]{40}\.json$/.test(name))) {
      throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_AFTER_PREPARE');
    }
    for (const name of activeMembers) {
      const head = name.slice('preflight-'.length, -'.json'.length);
      assertPreflightReceiptShape(readJsonDual(roots, name, {required: true}).value, head);
    }
  }
  const parent = call('verifyParentExperiment01', verifyParentExperiment01, {root, home, commonDirectory});
  if (original && !sameJson(original.prepare.value.parentEpoch, parent.proof)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_PARENT_DRIFT');
  }
  const analysis = call('gate3Analysis', gate3Analysis, {root, home, commonDirectory});
  if (analysis.status !== 'GATE3_ANALYSIS_PASS' || analysis.cellCount !== 140) throw new Error('BLOCKED_CONTACT_LOSS_GATE3');
  const frozenEvidenceSnapshot = call('frozenSourceSnapshot', frozenSourceSnapshot, {root, home, commonDirectory});
  if (frozenSnapshotSha256(frozenEvidenceSnapshot) !== analysis.frozenSnapshotSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_FROZEN_EVIDENCE_CHANGED');
  }
  let recoveryEpoch = null, sourceDelta = null;
  if (original) {
    const expectedOfflineEpoch = recoveryPolicyForMode(recoveryMode).offlineEpoch;
    recoveryEpoch = assertSameGate3Evidence(original.gate3.value, analysis, identity.head,
      expectedOfflineEpoch);
    assertRecoveryFrozenAppendOnly(original.prepare.value.frozenEvidenceSnapshot,
      frozenEvidenceSnapshot, recoveryMode);
  }
  let source = call('sourceSnapshot', sourceSnapshot, root);
  if (original) sourceDelta = verifyRecoverySourceDelta(original.prepare.value.source, source,
    continuation07 ? RECOVERY_CONTINUATION_07_ALLOWED_SOURCE_DELTA : RECOVERY_ALLOWED_SOURCE_DELTA);
  const preflightName = recovery || continuation02 || continuation03 || continuation04 || continuation05 || continuation06 || continuation07
    ? recoveryPreflightFileName(identity.head) : preflightFileName(identity.head);
  const currentDiagnostic = recovery ? null : call('verifyDiagnosticBuild', verifyDiagnosticBuild, root, identity.head, {buildDirectory});
  const currentProduction = recovery ? null : call('verifyProductionBuild', verifyProductionBuild, root, identity.head, {buildDirectory: productionBuildDirectory});
  const existing = call('readJsonDual', readJsonDual, roots, preflightName);
  if (existing) {
  if (recovery || continuation02 || continuation03 || continuation04 || continuation05 || continuation06 || continuation07) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_PARTIAL_STATE');
    assertPreflightReceiptShape(existing.value, identity.head);
    if (!sameJson(existing.value.source, source)
        || existing.value.gate3.analysisSha256 !== sha256(jsonBytes(analysis))
        || !sameJson(existing.value.parentProof, parent.proof)
        || !sameJson(existing.value.frozenEvidenceSnapshot, frozenEvidenceSnapshot)
        || existing.value.builds.diagnostic.wasm.sha256 !== currentDiagnostic.wasm.sha256
        || existing.value.builds.production.wasm.sha256 !== currentProduction.wasm.sha256) {
      throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_STALE');
    }
    return {status: 'PREPARED_PREFLIGHT_REUSED', head: identity.head, preflightFile: preflightName,
      preflightSha256: existing.sha256, checks: existing.value.checks, writes: 0, renders: 0, acousticCalls: 0};
  }
  if (!recovery && !continuation02 && !continuation03 && !continuation04 && !continuation05 && !continuation06 && !continuation07
      && (readDual(roots, 'prepare.json') || readDual(roots, 'plan.json') || readDual(roots, 'gate3-analysis.json'))) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_AFTER_PREPARE');
  }
  const diagnosticPath = path.resolve(root, buildDirectory || DIAGNOSTIC_BUILD_REL);
  const productionPath = path.resolve(root, productionBuildDirectory || RELEASE_BUILD_REL);
  call('runBuildCommand', runBuildCommand, root, ['cmake', '--build', diagnosticPath, '--parallel'], 'BLOCKED_CONTACT_LOSS_PREFLIGHT_DIAGNOSTIC_BUILD');
  call('runBuildCommand', runBuildCommand, root, ['cmake', '--build', productionPath, '--parallel'], 'BLOCKED_CONTACT_LOSS_PREFLIGHT_PRODUCTION_BUILD');
  source = call('sourceSnapshot', sourceSnapshot, root);
  const diagnostic = call('verifyDiagnosticBuild', verifyDiagnosticBuild, root, identity.head, {buildDirectory});
  const production = call('verifyProductionBuild', verifyProductionBuild, root, identity.head, {buildDirectory: productionBuildDirectory});
  if (diagnostic.wasm.sha256 !== BASELINE_PRODUCTION_WASM_SHA256) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_DIAGNOSTIC_WASM_IDENTITY');
  }
  if (original && (diagnostic.wasm.sha256 !== original.prepare.value.build.wasm.sha256
      || diagnostic.wasm.size !== original.prepare.value.build.wasm.size
      || production.wasm.sha256 !== original.originalPreflight.value.builds.production.wasm.sha256
      || production.wasm.size !== original.originalPreflight.value.builds.production.wasm.size)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_WASM_AFTER_BUILD');
  }
  const baselineInputs = call('verifyBaselineInputs', verifyBaselineInputs, root, identity.head);
  const testEnv = preflightTestEnvironment({root, diagnosticBuildDirectory: diagnosticPath,
    productionBuildDirectory: productionPath});
  const focusedNodeArgs = ['node', '--test',
    'wasm/plugins/dsp/super-synth/test/tools/issue7-contact-loss-v1-core.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-contact-loss-v1.test.cjs'];
  const focusedNodeResult = call('runPreflightCommand', runPreflightCommand, root, focusedNodeArgs, testEnv);
  const focusedNodeSummary = nodeTestSummary(`${focusedNodeResult.stdout}\n${focusedNodeResult.stderr}`);
  const focusedNode = summarizeCommand(focusedNodeResult, focusedNodeSummary);
  const ctestArgs = ['ctest', '--test-dir', diagnosticPath, '--output-on-failure', '--verbose', '-R',
    '^wasm\\.dsp\\.super-synth\\.(issue7-contact-loss-v1-core|run-issue7-contact-loss-v1)$'];
  const focusedCTestResult = call('runPreflightCommand', runPreflightCommand, root, ctestArgs, testEnv);
  const focusedCTestSummary = summarizePassingCtest(`${focusedCTestResult.stdout}\n${focusedCTestResult.stderr}`, 2);
  const focusedCTest = summarizeCommand(focusedCTestResult, focusedCTestSummary);
  const offlineArgs = ['node', '--test',
    'wasm/plugins/dsp/super-synth/test/tools/issue7-physical-root-cause-offline-v1.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-root-cause-offline-v1.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/analyze-issue7-physical-root-cause-v1.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-fit-v5.test.cjs',
    'wasm/plugins/dsp/super-synth/test/tools/run-issue7-physical-fit-v5-review.test.cjs'];
  const marker = path.join(root, `.codex-test-dirty-${process.pid}`);
  const dirtyBefore = currentIdentity(root);
  fs.writeFileSync(marker, 'temporary regression precondition\n', {flag: 'wx'});
  let offlineFrozenResult, offlineFrozenSourceContext;
  try {
    if (!git(root, ['status', '--porcelain=v2', '--untracked-files=all']).includes(path.basename(marker))) {
      throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_DIRTY_MARKER');
    }
    const pinnedRun = call('runOfflineFrozenWithP3Sources', runOfflineFrozenWithP3Sources, {root, home, commonDirectory,
      head: identity.head, args: offlineArgs, env: testEnv});
    offlineFrozenResult = pinnedRun.result;
    offlineFrozenSourceContext = pinnedRun.sourceContext;
  } finally { fs.unlinkSync(marker); }
  const dirtyAfter = call('currentIdentity', currentIdentity, root);
  if (dirtyBefore.head !== dirtyAfter.head || dirtyBefore.branch !== dirtyAfter.branch) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_WORKTREE_DRIFT');
  }
  const offlineFrozenSummary = nodeTestSummary(`${offlineFrozenResult.stdout}\n${offlineFrozenResult.stderr}`);
  const offlineFrozen = {...summarizeCommand(offlineFrozenResult, offlineFrozenSummary),
    sourceContext: offlineFrozenSourceContext};
  const fullCTestEnv = {...testEnv, SUPERSYNTH_REPORT_DIR: ''};
  delete fullCTestEnv.SUPERSYNTH_LIFECYCLE_PATH;
  const fullCTestResult = call('runPreflightCommand', runPreflightCommand, root,
    ['ctest', '--test-dir', diagnosticPath, '--output-on-failure'], fullCTestEnv);
  let fullCTest;
  try {
    fullCTest = call('classifyFullCTestPreflight', classifyFullCTestPreflight, fullCTestResult);
  } catch (error) {
    const output = `${fullCTestResult.stdout}\n${fullCTestResult.stderr}`;
    const summary = output.match(/(\d+)% tests passed,\s*(\d+) tests failed out of\s*(\d+)/i);
    const names = [...output.matchAll(/^\s*\d+\s+-\s+(.+?)\s+\(Failed\)\s*$/gm)].map(match => match[1]).sort();
    fullCTest = {decision: 'BLOCKED_PREFLIGHT_CTEST', blocker: String(error.message || error),
      baselineHead: BASELINE_HEAD, exitCode: fullCTestResult.status, testCount: summary ? Number(summary[3]) : null,
      failedCount: summary ? Number(summary[2]) : null, skippedCount: ctestSkippedCount(output), failureNames: names,
      stdoutSha256: sha256(Buffer.from(fullCTestResult.stdout)), stderrSha256: sha256(Buffer.from(fullCTestResult.stderr))};
  }
  const current = call('currentIdentity', currentIdentity, root);
  call('verifiedPullRequest', verifiedPullRequest, root, current.head);
  call('verifyIssueApproval', verifyIssueApproval, root);
  if (current.head !== identity.head || !sameJson(call('sourceSnapshot', sourceSnapshot, root), source)
      || !sameJson(call('frozenSourceSnapshot', frozenSourceSnapshot, {root, home, commonDirectory}), frozenEvidenceSnapshot)) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_IDENTITY_DRIFT');
  }
  if (original) {
    sourceDelta = verifyRecoverySourceDelta(original.prepare.value.source, source,
      continuation07 ? RECOVERY_CONTINUATION_07_ALLOWED_SOURCE_DELTA : RECOVERY_ALLOWED_SOURCE_DELTA);
    assertRecoveryFrozenAppendOnly(original.prepare.value.frozenEvidenceSnapshot,
      frozenEvidenceSnapshot, recoveryMode);
    if (!sameJson(call('snapshotActiveRootMembers', snapshotActiveRootMembers, roots,
      Object.keys(original.memberSnapshot.primary), {requireExact: false}), original.memberSnapshot)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_ORIGINAL_MUTATED');
    }
    if ((continuation02 || continuation03 || continuation04 || continuation05 || continuation06 || continuation07) && !sameJson(call('snapshotActiveRootMembers', snapshotActiveRootMembers, roots,
      Object.keys(previousRootSnapshot.primary)), previousRootSnapshot)) {
      throw new Error(continuation07 ? 'BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_PREFIX_MUTATED'
        : continuation06 ? 'BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_PREFIX_MUTATED'
        : continuation05 ? 'BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_PREFIX_MUTATED'
        : continuation04 ? 'BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_PREFIX_MUTATED'
        : continuation03 ? 'BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_PREFIX_MUTATED'
          : 'BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PREFIX_MUTATED');
    }
  }
  const parentAfter = call('verifyParentInventoryUnchanged', verifyParentInventoryUnchanged, parent, {root, home, commonDirectory});
  const checks = {builds: {diagnostic: {pass: true, wasmSha256: diagnostic.wasm.sha256},
      production: {pass: true, wasmSha256: production.wasm.sha256}},
    focusedNode, focusedCTest, offlineFrozen, fullCTest};
  const strictPass = focusedNodeResult.status === 0 && !focusedNodeResult.errorCode
    && focusedNode.passed === focusedNode.tests && focusedNode.failed === 0 && focusedNode.skipped === 0
    && focusedCTestResult.status === 0 && !focusedCTestResult.errorCode
    && focusedCTest.passed === 2 && focusedCTest.failed === 0 && focusedCTest.skipped === 0
    && offlineFrozenResult.status === 0 && !offlineFrozenResult.errorCode
    && offlineFrozen.passed === offlineFrozen.tests && offlineFrozen.failed === 0 && offlineFrozen.skipped === 0;
  if (!strictPass || fullCTest.decision !== 'BASELINE_FAILURES_DISCLOSED') {
    return {status: 'BLOCKED_CONTACT_LOSS_PREFLIGHT_CHECKS', head: identity.head, checks,
      writes: 0, renders: 0, acousticCalls: 0};
  }
  if (original) {
    const prefixSnapshot = previousRootSnapshot || original.memberSnapshot;
    const prefixMembers = Object.keys(prefixSnapshot.primary).sort();
    verifyRecoveryPostCTestEvidence({mode: recoveryMode, testResults: {
      focusedNodeResult, focusedNode, focusedCTestResult, focusedCTest,
      offlineFrozenResult, offlineFrozen, fullCTest},
    originalGate3: original.gate3.value, analysis, expectedHead: identity.head,
    currentHead: current.head, sourceBefore: source, sourceAfter: call('sourceSnapshot', sourceSnapshot, root),
    frozenBefore: frozenEvidenceSnapshot,
    frozenAfter: call('frozenSourceSnapshot', frozenSourceSnapshot, {root, home, commonDirectory}),
    expectedPrefixSnapshot: prefixSnapshot,
    currentPrefixSnapshot: call('snapshotActiveRootMembers', snapshotActiveRootMembers, roots, prefixMembers),
    expectedRootMembers: prefixMembers, currentRootMembers: call('epochRootMembers', epochRootMembers, roots)});
    if (typeof testOnlyAdapters?.afterPostCTestGate === 'function') {
      const intercepted = testOnlyAdapters.afterPostCTestGate({mode: recoveryMode, checks,
        frozenEvidenceSnapshot, writes: 0, renders: 0, acousticCalls: 0});
      if (intercepted !== undefined) return intercepted;
    }
  }
  const baseReport = {schemaVersion: 1, kind: 'CONTACT_LOSS_PREPARE_PREFLIGHT',
    decision: 'PREPARE_PREFLIGHT_READY', epoch: ACTIVE_EPOCH, head: identity.head, branch: identity.branch,
    contractSha256: SUCCESSOR_CONTRACT_SHA256, ctestOrderContractSha256: CTEST_ORDER_CONTRACT_SHA256,
    issueApprovalMarker: ISSUE_APPROVAL_MARKER, successorApprovalMarker: SUCCESSOR_APPROVAL_MARKER,
    ctestOrderApprovalMarker: CTEST_ORDER_APPROVAL_MARKER,
    parentProof: parentAfter.proof, gate3: {analysisSha256: sha256(jsonBytes(analysis))},
    frozenEvidenceSnapshot, frozenSnapshotSha256: frozenSnapshotSha256(frozenEvidenceSnapshot),
    source, baselineInputs,
    builds: {diagnostic: {pass: true, ...diagnostic}, production: {pass: true, ...production}}, checks};
  let report;
  if (continuation07) {
    const offline = latestOfflineReport(root, home, commonDirectory, identity.head,
      PREPARE_RECOVERY_CONTINUATION_07_OFFLINE_EPOCH);
    const previousOfflineHistory = {...previousContinuation04.value.recovery.offlineHistory,
      analysis24: {reportSha256: RECOVERY_ANALYSIS24_REPORT_SHA256,
        manifestSha256: RECOVERY_ANALYSIS24_MANIFEST_SHA256},
      analysis25: {reportSha256: RECOVERY_ANALYSIS25_REPORT_SHA256,
        manifestSha256: RECOVERY_ANALYSIS25_MANIFEST_SHA256}};
    const offlineHistory = {...previousOfflineHistory,
      analysis26: {reportSha256: offline.reportSha256, manifestSha256: offline.manifestSha256}};
    const continuation = {approvalMarker: PREPARE_RECOVERY_CONTINUATION_07_APPROVAL_MARKER,
      designSha256: PREPARE_RECOVERY_CONTINUATION_07_DESIGN_SHA256,
      previousExecutionHead: previousContinuation04.executionHead,
      previousRecoveryPreflightSha256: previousContinuation04.preflight.sha256,
      previousRecoveryReceiptSha256: previousContinuation04.sha256,
      previousOfflineHistory,
      originalPrepareSha256: original.prepare.sha256,
      originalPlanSha256: original.plan.sha256,
      originalGate3Sha256: original.gate3.sha256,
      originalPreflightSha256: original.originalPreflight.sha256,
      executionHead: identity.head, preflightFile: preflightName,
      offlineEpoch: PREPARE_RECOVERY_CONTINUATION_07_OFFLINE_EPOCH,
      offlineReportSha256: offline.reportSha256, offlineManifestSha256: offline.manifestSha256,
      offlineHistory, gate3AnalysisSha256: sha256(jsonBytes(analysis)), gate3Analysis: analysis,
      sourceDelta, previousRootSnapshot};
    report = assertRecoveryContinuation07PreflightReceiptShape({...baseReport,
      kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_07_PREFLIGHT', continuation07: continuation}, identity.head);
  } else if (continuation06) {
    const offline = latestOfflineReport(root, home, commonDirectory, identity.head,
      PREPARE_RECOVERY_CONTINUATION_06_OFFLINE_EPOCH);
    const previousOfflineHistory = {...previousContinuation04.value.recovery.offlineHistory,
      analysis24: {reportSha256: RECOVERY_ANALYSIS24_REPORT_SHA256,
        manifestSha256: RECOVERY_ANALYSIS24_MANIFEST_SHA256}};
    const offlineHistory = {...previousOfflineHistory,
      analysis25: {reportSha256: offline.reportSha256, manifestSha256: offline.manifestSha256}};
    const continuation = {approvalMarker: PREPARE_RECOVERY_CONTINUATION_06_APPROVAL_MARKER,
      designSha256: PREPARE_RECOVERY_CONTINUATION_06_DESIGN_SHA256,
      previousExecutionHead: previousContinuation04.executionHead,
      previousRecoveryPreflightSha256: previousContinuation04.preflight.sha256,
      previousRecoveryReceiptSha256: previousContinuation04.sha256,
      previousOfflineHistory,
      originalPrepareSha256: original.prepare.sha256,
      originalPlanSha256: original.plan.sha256,
      originalGate3Sha256: original.gate3.sha256,
      originalPreflightSha256: original.originalPreflight.sha256,
      executionHead: identity.head, preflightFile: preflightName,
      offlineEpoch: PREPARE_RECOVERY_CONTINUATION_06_OFFLINE_EPOCH,
      offlineReportSha256: offline.reportSha256, offlineManifestSha256: offline.manifestSha256,
      offlineHistory, gate3AnalysisSha256: sha256(jsonBytes(analysis)), gate3Analysis: analysis,
      sourceDelta, previousRootSnapshot};
    report = assertRecoveryContinuation06PreflightReceiptShape({...baseReport,
      kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_06_PREFLIGHT', continuation06: continuation}, identity.head);
  } else if (continuation05) {
    const offline = latestOfflineReport(root, home, commonDirectory, identity.head,
      PREPARE_RECOVERY_CONTINUATION_05_OFFLINE_EPOCH);
    const previousOfflineHistory = previousContinuation04.value.recovery.offlineHistory;
    const offlineHistory = {...previousOfflineHistory,
      analysis24: {reportSha256: offline.reportSha256, manifestSha256: offline.manifestSha256}};
    const continuation = {approvalMarker: PREPARE_RECOVERY_CONTINUATION_05_APPROVAL_MARKER,
      designSha256: PREPARE_RECOVERY_CONTINUATION_05_DESIGN_SHA256,
      previousExecutionHead: previousContinuation04.executionHead,
      previousRecoveryPreflightSha256: previousContinuation04.preflight.sha256,
      previousRecoveryReceiptSha256: previousContinuation04.sha256,
      previousOfflineHistory,
      originalPrepareSha256: original.prepare.sha256,
      originalPlanSha256: original.plan.sha256,
      originalGate3Sha256: original.gate3.sha256,
      originalPreflightSha256: original.originalPreflight.sha256,
      executionHead: identity.head, preflightFile: preflightName,
      offlineEpoch: PREPARE_RECOVERY_CONTINUATION_05_OFFLINE_EPOCH,
      offlineReportSha256: offline.reportSha256, offlineManifestSha256: offline.manifestSha256,
      offlineHistory, gate3AnalysisSha256: sha256(jsonBytes(analysis)), gate3Analysis: analysis,
      sourceDelta, previousRootSnapshot};
    report = assertRecoveryContinuation05PreflightReceiptShape({...baseReport,
      kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_05_PREFLIGHT', continuation05: continuation}, identity.head);
  } else if (continuation04) {
    const offline = latestOfflineReport(root, home, commonDirectory, identity.head,
      PREPARE_RECOVERY_CONTINUATION_04_OFFLINE_EPOCH);
    const continuation = {approvalMarker: PREPARE_RECOVERY_CONTINUATION_04_APPROVAL_MARKER,
      designSha256: PREPARE_RECOVERY_CONTINUATION_04_DESIGN_SHA256,
      previousExecutionHead: previousContinuation03.executionHead,
      previousRecoveryPreflightSha256: previousContinuation03.preflight.sha256,
      previousRecoveryReceiptSha256: previousContinuation03.sha256,
      originalPrepareSha256: original.prepare.sha256,
      originalPlanSha256: original.plan.sha256,
      originalGate3Sha256: original.gate3.sha256,
      originalPreflightSha256: original.originalPreflight.sha256,
      executionHead: identity.head, preflightFile: preflightName,
      offlineEpoch: PREPARE_RECOVERY_CONTINUATION_04_OFFLINE_EPOCH,
      offlineReportSha256: offline.reportSha256, offlineManifestSha256: offline.manifestSha256,
      offlineHistory: {analysis20: {reportSha256: RECOVERY_ANALYSIS20_REPORT_SHA256,
        manifestSha256: RECOVERY_ANALYSIS20_MANIFEST_SHA256},
        analysis21: {reportSha256: RECOVERY_ANALYSIS21_REPORT_SHA256,
          manifestSha256: RECOVERY_ANALYSIS21_MANIFEST_SHA256},
        analysis22: {reportSha256: RECOVERY_ANALYSIS22_REPORT_SHA256,
          manifestSha256: RECOVERY_ANALYSIS22_MANIFEST_SHA256},
        analysis23: {reportSha256: offline.reportSha256, manifestSha256: offline.manifestSha256}},
      gate3AnalysisSha256: sha256(jsonBytes(analysis)), gate3Analysis: analysis,
      sourceDelta, previousRootSnapshot};
    report = assertRecoveryContinuation04PreflightReceiptShape({...baseReport,
      kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_04_PREFLIGHT', continuation04: continuation}, identity.head);
  } else if (continuation03) {
    const offline = latestOfflineReport(root, home, commonDirectory, identity.head,
      PREPARE_RECOVERY_CONTINUATION_03_OFFLINE_EPOCH);
    const continuation = {approvalMarker: PREPARE_RECOVERY_CONTINUATION_03_APPROVAL_MARKER,
      designSha256: PREPARE_RECOVERY_CONTINUATION_03_DESIGN_SHA256,
      previousExecutionHead: previousContinuation02.executionHead,
      previousRecoveryPreflightSha256: previousContinuation02.preflight.sha256,
      previousRecoveryReceiptSha256: previousContinuation02.sha256,
      originalPrepareSha256: original.prepare.sha256,
      originalPlanSha256: original.plan.sha256,
      originalGate3Sha256: original.gate3.sha256,
      originalPreflightSha256: original.originalPreflight.sha256,
      executionHead: identity.head, preflightFile: preflightName,
      offlineEpoch: PREPARE_RECOVERY_CONTINUATION_03_OFFLINE_EPOCH,
      offlineReportSha256: offline.reportSha256, offlineManifestSha256: offline.manifestSha256,
      offlineHistory: {analysis20: {reportSha256: RECOVERY_ANALYSIS20_REPORT_SHA256,
        manifestSha256: RECOVERY_ANALYSIS20_MANIFEST_SHA256},
        analysis21: {reportSha256: RECOVERY_ANALYSIS21_REPORT_SHA256,
          manifestSha256: RECOVERY_ANALYSIS21_MANIFEST_SHA256},
        analysis22: {reportSha256: offline.reportSha256, manifestSha256: offline.manifestSha256}},
      gate3AnalysisSha256: sha256(jsonBytes(analysis)), gate3Analysis: analysis,
      sourceDelta, previousRootSnapshot};
    report = assertRecoveryContinuation03PreflightReceiptShape({...baseReport,
      kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_03_PREFLIGHT', continuation03: continuation}, identity.head);
  } else if (continuation02) {
    const offline = latestOfflineReport(root, home, commonDirectory, identity.head,
      PREPARE_RECOVERY_CONTINUATION_02_OFFLINE_EPOCH);
    const continuation = {approvalMarker: PREPARE_RECOVERY_CONTINUATION_02_APPROVAL_MARKER,
      amendmentApprovalMarker: PREPARE_RECOVERY_ANALYSIS21_AMENDMENT_APPROVAL_MARKER,
      designSha256: PREPARE_RECOVERY_CONTINUATION_02_DESIGN_SHA256,
      previousExecutionHead: previousRecovery.executionHead,
      previousRecoveryPreflightSha256: previousRecovery.preflight.sha256,
      previousRecoveryReceiptSha256: previousRecovery.sha256,
      originalPrepareSha256: original.prepare.sha256,
      originalPlanSha256: original.plan.sha256,
      originalGate3Sha256: original.gate3.sha256,
      originalPreflightSha256: original.originalPreflight.sha256,
      executionHead: identity.head, preflightFile: preflightName,
      offlineEpoch: PREPARE_RECOVERY_CONTINUATION_02_OFFLINE_EPOCH,
      offlineReportSha256: offline.reportSha256, offlineManifestSha256: offline.manifestSha256,
      gate3AnalysisSha256: sha256(jsonBytes(analysis)), gate3Analysis: analysis,
      sourceDelta, previousRootSnapshot};
    report = assertRecoveryContinuation02PreflightReceiptShape({...baseReport,
      kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_02_PREFLIGHT', continuation02: continuation}, identity.head);
  } else if (recovery) {
    const recovery = {approvalMarker: PREPARE_RECOVERY_APPROVAL_MARKER,
      contractSha256: PREPARE_RECOVERY_LEGACY_CONTRACT_SHA256,
      originalHead: RECOVERY_ORIGINAL_HEAD,
      originalPrepareSha256: original.prepare.sha256,
      originalPlanSha256: original.plan.sha256,
      originalGate3Sha256: original.gate3.sha256,
      originalPreflightFile: preflightFileName(RECOVERY_ORIGINAL_HEAD),
      originalPreflightSha256: original.originalPreflight.sha256,
      recoveryHead: identity.head,
      recoveryPreflightFile: preflightName,
      recoveryGate3AnalysisSha256: sha256(jsonBytes(analysis)),
      gate3Analysis: analysis,
      sourceDelta};
    report = assertRecoveryPreflightReceiptShape({...baseReport,
      kind: 'CONTACT_LOSS_PREPARE_RECOVERY_PREFLIGHT', recovery}, identity.head);
  } else {
    report = assertPreflightReceiptShape(baseReport, identity.head);
  }
  const lock = acquireLock(roots);
  try {
    if (original) {
      const before = (continuation02 || continuation03 || continuation04 || continuation05 || continuation06)
        ? previousRootSnapshot : original.memberSnapshot;
      if (continuation02 || continuation03 || continuation04 || continuation05 || continuation06) {
        assertLockedRecoveryPrefix(roots, before);
      } else if (!sameJson(snapshotActiveRootMembers(roots, Object.keys(before.primary),
        {requireExact: false}), before)) {
        throw new Error(continuation06 ? 'BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_PREFIX_MUTATED'
          : continuation05 ? 'BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_PREFIX_MUTATED'
          : continuation04 ? 'BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_PREFIX_MUTATED'
          : continuation03 ? 'BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_PREFIX_MUTATED'
            : continuation02 ? 'BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PREFIX_MUTATED'
              : 'BLOCKED_CONTACT_LOSS_RECOVERY_ORIGINAL_MUTATED');
      }
    }
    const stored = writeDualImmutable(roots, preflightName, jsonBytes(report));
    const readback = readJsonDual(roots, preflightName, {required: true});
    if (readback.sha256 !== stored.sha256) throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_READBACK');
    return {status: 'PREPARE_PREFLIGHT_READY', head: identity.head, preflightFile: preflightName,
      preflightSha256: readback.sha256, checks, writes: stored.status === 'CREATED' ? 1 : 0,
      renders: 0, acousticCalls: 0};
  } finally { releaseLock(roots, lock); }
}

function verifyPreflightForPrepare({roots, head, source, parentProof, frozenEvidenceSnapshot,
  analysisSha256, diagnosticWasmSha256, productionWasmSha256} = {}) {
  const preflightFile = preflightFileName(head), preflight = readJsonDual(roots, preflightFile);
  if (!preflight) throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_MISSING');
  assertPreflightReceiptShape(preflight.value, head);
  if (!sameJson(preflight.value.source, source)
      || !sameJson(preflight.value.parentProof, parentProof)
      || !sameJson(preflight.value.frozenEvidenceSnapshot, frozenEvidenceSnapshot)
      || preflight.value.gate3.analysisSha256 !== analysisSha256
      || preflight.value.builds.diagnostic.wasm.sha256 !== diagnosticWasmSha256
      || preflight.value.builds.production.wasm.sha256 !== productionWasmSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_IDENTITY');
  }
  return {preflightFile, preflightSha256: preflight.sha256};
}
function buildPreparePreflightBinding(preflight) {
  if (!preflight || typeof preflight.preflightFile !== 'string'
      || !/^[a-f0-9]{64}$/.test(preflight.preflightSha256 || '')) {
    throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_PREFLIGHT_BINDING');
  }
  return {preflightFile: preflight.preflightFile, preflightSha256: preflight.preflightSha256};
}

function recoverPreparedExperiment({root = ROOT, home = os.homedir(), commonDirectory,
  buildDirectory, productionBuildDirectory} = {}) {
  const roots = resolveRoots({root, home, commonDirectory});
  const existingRecovery = readJsonDual(roots, 'prepare-recovery.json');
  if (existingRecovery) {
    const state = readExperimentState(roots);
    const identity = verifyPreparedCurrent(roots, state, {root, home, commonDirectory, buildDirectory});
    return {status: 'PREPARE_RECOVERY_REUSED', head: identity.head,
      recoverySha256: existingRecovery.sha256, recoveryPreflightSha256: state.recovery.preflight.sha256,
      charged: state.charged, completed: state.completed, ambiguous: state.ambiguous,
      writes: 0, renders: 0, acousticCalls: 0};
  }
  const identity = currentIdentity(root);
  const original = readOriginalMalformedPreparation(roots);
  if (original.prepare.value.head !== RECOVERY_ORIGINAL_HEAD || identity.head === RECOVERY_ORIGINAL_HEAD) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_HEAD');
  }
  const preflightName = recoveryPreflightFileName(identity.head);
  if (readDual(roots, preflightName)) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_PARTIAL_STATE');
  const preflightResult = preflightExperiment({root, home, commonDirectory, buildDirectory,
    productionBuildDirectory, recovery: true});
  if (preflightResult.status !== 'PREPARE_PREFLIGHT_READY') return {
    status: preflightResult.status, head: identity.head, checks: preflightResult.checks,
    writes: preflightResult.writes || 0, renders: 0, acousticCalls: 0
  };
  const recoveryPreflight = readJsonDual(roots, preflightName, {required: true});
  assertRecoveryPreflightReceiptShape(recoveryPreflight.value, identity.head);
  if (recoveryPreflight.sha256 !== preflightResult.preflightSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_PREFLIGHT_READBACK');
  }
  const recoveryAnalysis = recoveryPreflight.value.recovery.gate3Analysis;
  const record = {schemaVersion: 1, kind: 'CONTACT_LOSS_PREPARE_RECOVERY', issue: 7, pr: 8,
    epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
    recoveryContractSha256: PREPARE_RECOVERY_LEGACY_CONTRACT_SHA256,
    approvalMarker: PREPARE_RECOVERY_APPROVAL_MARKER,
    original: {head: RECOVERY_ORIGINAL_HEAD, prepareSha256: original.prepare.sha256,
      planSha256: original.plan.sha256, gate3Sha256: original.gate3.sha256,
      preflightFile: preflightFileName(RECOVERY_ORIGINAL_HEAD),
      preflightSha256: original.originalPreflight.sha256, memberSnapshot: original.memberSnapshot,
      parentProof: original.prepare.value.parentEpoch,
      diagnosticWasmSha256: original.prepare.value.build.wasm.sha256,
      diagnosticWasmSize: original.prepare.value.build.wasm.size,
      productionWasmSha256: original.originalPreflight.value.builds.production.wasm.sha256,
      productionWasmSize: original.originalPreflight.value.builds.production.wasm.size},
    executionHead: identity.head,
    recovery: {head: identity.head, preflightFile: preflightName,
      preflightSha256: recoveryPreflight.sha256,
      gate3AnalysisSha256: sha256(jsonBytes(recoveryAnalysis)), gate3Analysis: recoveryAnalysis,
      offlineReportSha256: recoveryAnalysis.offlineReportSha256,
      frozenSnapshotSha256: recoveryPreflight.value.frozenSnapshotSha256,
      frozenEvidenceSnapshot: recoveryPreflight.value.frozenEvidenceSnapshot,
      source: recoveryPreflight.value.source,
      sourceDelta: recoveryPreflight.value.recovery.sourceDelta,
      builds: {diagnostic: {wasmSha256: recoveryPreflight.value.builds.diagnostic.wasm.sha256,
        wasmSize: recoveryPreflight.value.builds.diagnostic.wasm.size},
      production: {wasmSha256: recoveryPreflight.value.builds.production.wasm.sha256,
        wasmSize: recoveryPreflight.value.builds.production.wasm.size}}},
    parentProof: recoveryPreflight.value.parentProof,
    calls: {started: 0, completed: 0, ambiguous: 0}, budget: core.accounting()};
  assertPrepareRecoveryReceiptShape(record);
  const lock = acquireLock(roots);
  let writeResult;
  try {
    if (!sameJson(snapshotActiveRootMembers(roots, Object.keys(original.memberSnapshot.primary),
      {requireExact: false}), original.memberSnapshot)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_ORIGINAL_MUTATED');
    }
    const rootMembers = epochRootMembers(roots);
    if (!rootMembers.includes(preflightName) || rootMembers.includes('prepare-recovery.json')) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_PARTIAL_STATE');
    }
    writeResult = writeDualImmutable(roots, 'prepare-recovery.json', jsonBytes(record));
    const readback = readJsonDual(roots, 'prepare-recovery.json', {required: true});
    if (readback.sha256 !== writeResult.sha256 || !sameJson(readback.value, record)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_READBACK');
    }
  } finally { releaseLock(roots, lock); }
  const state = readExperimentState(roots);
  const current = verifyPreparedCurrent(roots, state, {root, home, commonDirectory, buildDirectory});
  if (current.head !== identity.head || state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_POST_VERIFY');
  }
  return {status: 'PREPARE_RECOVERY_READY', head: identity.head,
    recoverySha256: writeResult.sha256, recoveryPreflightSha256: recoveryPreflight.sha256,
    checks: recoveryPreflight.value.checks, charged: state.charged, completed: state.completed,
    ambiguous: state.ambiguous, writes: 2, renders: 0, acousticCalls: 0};
}

function recoverPreparedContinuation02({root = ROOT, home = os.homedir(), commonDirectory,
  buildDirectory, productionBuildDirectory} = {}) {
  const roots = resolveRoots({root, home, commonDirectory});
  const existing = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_02_REL);
  if (existing) {
    const state = readExperimentState(roots);
    const identity = verifyPreparedCurrent(roots, state, {root, home, commonDirectory, buildDirectory});
    if (identity.head !== state.executionHead || state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_POST_VERIFY');
    }
    return {status: 'RECOVERY_CONTINUATION_02_REUSED', head: identity.head,
      receiptSha256: existing.sha256, preflightSha256: state.recovery.preflight.sha256,
      charged: state.charged, completed: state.completed, ambiguous: state.ambiguous,
      writes: 0, renders: 0, acousticCalls: 0};
  }
  const identity = currentIdentity(root);
  if (identity.branch !== PR_BRANCH) throw new Error('BLOCKED_CONTACT_LOSS_BRANCH');
  verifiedPullRequest(root, identity.head);
  verifyIssueApproval(root);
  verifyPrepareRecoveryContinuation02Approval(root);
  const original = readOriginalMalformedPreparation(roots, {allowRecoveryHistory: true});
  const existingRecovery = readJsonDual(roots, 'prepare-recovery.json', {required: true});
  const originalGate3 = readJsonDual(roots, 'gate3-analysis.json', {required: true});
  const previousRecovery = verifyStoredPrepareRecovery(roots, {prepared: original.prepare,
    originalPreflight: original.originalPreflight, originalGate3});
  if (previousRecovery.sha256 !== RECOVERY_FIRST_RECEIPT_SHA256
      || previousRecovery.preflight.sha256 !== RECOVERY_FIRST_PREFLIGHT_SHA256
      || existingRecovery.sha256 !== RECOVERY_FIRST_RECEIPT_SHA256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PRIOR_RECEIPT');
  }
  const previousRootSnapshot = snapshotActiveRootMembers(roots,
    ['gate3-analysis.json', 'plan.json', 'prepare.json',
      preflightFileName(RECOVERY_ORIGINAL_HEAD), recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD),
      'prepare-recovery.json'].sort());
  const rootMembers = epochRootMembers(roots);
  const expectedPrefix = Object.keys(previousRootSnapshot.primary).sort();
  if (!sameJson(rootMembers, expectedPrefix)
      || readDual(roots, recoveryPreflightFileName(identity.head))) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PARTIAL_STATE');
  }
  const state = readExperimentState(roots);
  if (state.status !== 'READY' || state.recovery?.sha256 !== previousRecovery.sha256
      || state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_STATE');
  }
  const preflightResult = preflightExperiment({root, home, commonDirectory, buildDirectory,
    productionBuildDirectory, continuation02: true});
  if (preflightResult.status !== 'PREPARE_PREFLIGHT_READY') return {
    status: preflightResult.status, head: identity.head, checks: preflightResult.checks,
    writes: preflightResult.writes || 0, renders: 0, acousticCalls: 0
  };
  const preflight = readJsonDual(roots, recoveryPreflightFileName(identity.head), {required: true});
  assertRecoveryContinuation02PreflightReceiptShape(preflight.value, identity.head);
  if (preflight.sha256 !== preflightResult.preflightSha256
      || !sameJson(preflight.value.continuation02.previousRootSnapshot, previousRootSnapshot)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PREFLIGHT_READBACK');
  }
  const continuation = preflight.value.continuation02;
  const record = {schemaVersion: 1, kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_02',
    issue: 7, pr: PR_NUMBER, epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
    approvalMarker: PREPARE_RECOVERY_CONTINUATION_02_APPROVAL_MARKER,
    amendmentApprovalMarker: PREPARE_RECOVERY_ANALYSIS21_AMENDMENT_APPROVAL_MARKER,
    designSha256: PREPARE_RECOVERY_CONTINUATION_02_DESIGN_SHA256,
    previousExecutionHead: previousRecovery.executionHead,
    previousRecoveryPreflightSha256: previousRecovery.preflight.sha256,
    previousRecoveryReceiptSha256: previousRecovery.sha256,
    original: {head: RECOVERY_ORIGINAL_HEAD, prepareSha256: original.prepare.sha256,
      planSha256: original.plan.sha256, gate3Sha256: original.gate3.sha256,
      preflightSha256: original.originalPreflight.sha256},
    executionHead: identity.head,
    previousRootSnapshot,
    recovery: {head: identity.head, preflightFile: preflight.value.continuation02.preflightFile,
      preflightSha256: preflight.sha256, gate3AnalysisSha256: continuation.gate3AnalysisSha256,
      gate3Analysis: continuation.gate3Analysis, offlineReportSha256: continuation.offlineReportSha256,
      offlineManifestSha256: continuation.offlineManifestSha256,
      frozenSnapshotSha256: preflight.value.frozenSnapshotSha256,
      frozenEvidenceSnapshot: preflight.value.frozenEvidenceSnapshot,
      source: preflight.value.source, sourceDelta: continuation.sourceDelta,
      builds: {diagnostic: {wasmSha256: preflight.value.builds.diagnostic.wasm.sha256,
        wasmSize: preflight.value.builds.diagnostic.wasm.size},
      production: {wasmSha256: preflight.value.builds.production.wasm.sha256,
        wasmSize: preflight.value.builds.production.wasm.size}}},
    parentProof: preflight.value.parentProof, calls: {started: 0, completed: 0, ambiguous: 0},
    budget: core.accounting()};
  assertPrepareRecoveryContinuation02ReceiptShape(record);
  const lock = acquireLock(roots);
  let writeResult;
  try {
    if (!sameJson(snapshotActiveRootMembers(roots, expectedPrefix, {requireExact: false}), previousRootSnapshot)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PREFIX_MUTATED');
    }
    const currentMembers = epochRootMembers(roots).filter(name => name !== 'writer.lock').sort();
    const expectedMembers = [...expectedPrefix, recoveryPreflightFileName(identity.head)].sort();
    if (!sameJson(currentMembers, expectedMembers)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PARTIAL_STATE');
    }
    writeResult = writeDualImmutable(roots, PREPARE_RECOVERY_CONTINUATION_02_REL, jsonBytes(record));
    const readback = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_02_REL, {required: true});
    if (readback.sha256 !== writeResult.sha256 || !sameJson(readback.value, record)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_READBACK');
    }
  } finally { releaseLock(roots, lock); }
  const recoveredState = readExperimentState(roots);
  const current = verifyPreparedCurrent(roots, recoveredState, {root, home, commonDirectory, buildDirectory});
  if (current.head !== identity.head || recoveredState.executionHead !== identity.head
      || recoveredState.charged !== 0 || recoveredState.completed !== 0 || recoveredState.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_POST_VERIFY');
  }
  return {status: 'RECOVERY_CONTINUATION_02_READY', head: identity.head,
    previousRecoverySha256: previousRecovery.sha256, receiptSha256: writeResult.sha256,
    preflightSha256: preflight.sha256, checks: preflight.value.checks,
    charged: recoveredState.charged, completed: recoveredState.completed,
    ambiguous: recoveredState.ambiguous, writes: 2, renders: 0, acousticCalls: 0};
}

function recoverPreparedContinuation03({root = ROOT, home = os.homedir(), commonDirectory,
  buildDirectory, productionBuildDirectory} = {}) {
  const roots = resolveRoots({root, home, commonDirectory});
  const existing = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_03_REL);
  if (existing) {
    const state = readExperimentState(roots);
    const identity = verifyPreparedCurrent(roots, state, {root, home, commonDirectory, buildDirectory});
    if (identity.head !== state.executionHead || state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_POST_VERIFY');
    }
    return {status: 'RECOVERY_CONTINUATION_03_REUSED', head: identity.head,
      receiptSha256: existing.sha256, preflightSha256: state.recovery.preflight.sha256,
      charged: state.charged, completed: state.completed, ambiguous: state.ambiguous,
      writes: 0, renders: 0, acousticCalls: 0};
  }
  const identity = currentIdentity(root);
  if (identity.branch !== PR_BRANCH) throw new Error('BLOCKED_CONTACT_LOSS_BRANCH');
  verifiedPullRequest(root, identity.head);
  verifyIssueApproval(root);
  verifyPrepareRecoveryContinuation03Approval(root);
  const original = readOriginalMalformedPreparation(roots, {allowRecoveryHistory: true});
  const originalGate3 = readJsonDual(roots, 'gate3-analysis.json', {required: true});
  const previousRecovery = verifyStoredPrepareRecovery(roots, {prepared: original.prepare,
    originalPreflight: original.originalPreflight, originalGate3, allowContinuation02: true});
  if (previousRecovery.sha256 !== RECOVERY_FIRST_RECEIPT_SHA256
      || previousRecovery.preflight.sha256 !== RECOVERY_FIRST_PREFLIGHT_SHA256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_FIRST_RECOVERY');
  }
  const previousContinuation02 = verifyStoredPrepareRecoveryContinuation02(roots, {prepared: original.prepare,
    originalGate3, previousRecovery});
  if (previousContinuation02.sha256 !== RECOVERY_CONTINUATION_02_RECEIPT_SHA256
      || previousContinuation02.preflight.sha256 !== RECOVERY_CONTINUATION_02_PREFLIGHT_SHA256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_PREVIOUS_RECEIPT');
  }
  const expectedPrefix = ['gate3-analysis.json', 'plan.json', 'prepare.json',
    preflightFileName(RECOVERY_ORIGINAL_HEAD), recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD),
    'prepare-recovery.json', recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD),
    PREPARE_RECOVERY_CONTINUATION_02_REL].sort();
  const previousRootSnapshot = snapshotActiveRootMembers(roots, expectedPrefix);
  if (!sameJson(Object.keys(previousRootSnapshot.primary).sort(), expectedPrefix)
      || readDual(roots, recoveryPreflightFileName(identity.head))) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_PARTIAL_STATE');
  }
  const state = readExperimentState(roots);
  if (state.status !== 'READY' || state.recovery?.sha256 !== previousContinuation02.sha256
      || state.executionHead !== RECOVERY_CONTINUATION_02_EXECUTION_HEAD
      || state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_STATE');
  }
  const preflightResult = preflightExperiment({root, home, commonDirectory, buildDirectory,
    productionBuildDirectory, continuation03: true});
  if (preflightResult.status !== 'PREPARE_PREFLIGHT_READY') return {
    status: preflightResult.status, head: identity.head, checks: preflightResult.checks,
    writes: preflightResult.writes || 0, renders: 0, acousticCalls: 0
  };
  const preflight = readJsonDual(roots, recoveryPreflightFileName(identity.head), {required: true});
  assertRecoveryContinuation03PreflightReceiptShape(preflight.value, identity.head);
  if (preflight.sha256 !== preflightResult.preflightSha256
      || !sameJson(preflight.value.continuation03.previousRootSnapshot, previousRootSnapshot)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_PREFLIGHT_READBACK');
  }
  const continuation = preflight.value.continuation03;
  const record = {schemaVersion: 1, kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_03',
    issue: 7, pr: PR_NUMBER, epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
    approvalMarker: PREPARE_RECOVERY_CONTINUATION_03_APPROVAL_MARKER,
    designSha256: PREPARE_RECOVERY_CONTINUATION_03_DESIGN_SHA256,
    previousExecutionHead: previousContinuation02.executionHead,
    previousRecoveryPreflightSha256: previousContinuation02.preflight.sha256,
    previousRecoveryReceiptSha256: previousContinuation02.sha256,
    original: {head: RECOVERY_ORIGINAL_HEAD, prepareSha256: original.prepare.sha256,
      planSha256: original.plan.sha256, gate3Sha256: original.gate3.sha256,
      preflightSha256: original.originalPreflight.sha256},
    executionHead: identity.head, previousRootSnapshot,
    recovery: {head: identity.head, preflightFile: preflight.value.continuation03.preflightFile,
      preflightSha256: preflight.sha256, gate3AnalysisSha256: continuation.gate3AnalysisSha256,
      gate3Analysis: continuation.gate3Analysis, offlineReportSha256: continuation.offlineReportSha256,
      offlineManifestSha256: continuation.offlineManifestSha256, offlineHistory: continuation.offlineHistory,
      frozenSnapshotSha256: preflight.value.frozenSnapshotSha256,
      frozenEvidenceSnapshot: preflight.value.frozenEvidenceSnapshot,
      source: preflight.value.source, sourceDelta: continuation.sourceDelta,
      builds: {diagnostic: {wasmSha256: preflight.value.builds.diagnostic.wasm.sha256,
        wasmSize: preflight.value.builds.diagnostic.wasm.size},
      production: {wasmSha256: preflight.value.builds.production.wasm.sha256,
        wasmSize: preflight.value.builds.production.wasm.size}}},
    parentProof: preflight.value.parentProof, calls: {started: 0, completed: 0, ambiguous: 0},
    budget: core.accounting()};
  assertPrepareRecoveryContinuation03ReceiptShape(record);
  const lock = acquireLock(roots);
  let writeResult;
  try {
    if (!sameJson(snapshotActiveRootMembers(roots, expectedPrefix, {requireExact: false}), previousRootSnapshot)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_PREFIX_MUTATED');
    }
    const currentMembers = epochRootMembers(roots).filter(name => name !== 'writer.lock').sort();
    const expectedMembers = [...expectedPrefix, recoveryPreflightFileName(identity.head)].sort();
    if (!sameJson(currentMembers, expectedMembers)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_PARTIAL_STATE');
    }
    writeResult = writeDualImmutable(roots, PREPARE_RECOVERY_CONTINUATION_03_REL, jsonBytes(record));
    const readback = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_03_REL, {required: true});
    if (readback.sha256 !== writeResult.sha256 || !sameJson(readback.value, record)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_READBACK');
    }
  } finally { releaseLock(roots, lock); }
  const recoveredState = readExperimentState(roots);
  const current = verifyPreparedCurrent(roots, recoveredState, {root, home, commonDirectory, buildDirectory});
  if (current.head !== identity.head || recoveredState.executionHead !== identity.head
      || recoveredState.charged !== 0 || recoveredState.completed !== 0 || recoveredState.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_03_POST_VERIFY');
  }
  return {status: 'RECOVERY_CONTINUATION_03_READY', head: identity.head,
    previousRecoverySha256: previousContinuation02.sha256, receiptSha256: writeResult.sha256,
    preflightSha256: preflight.sha256, checks: preflight.value.checks,
    charged: recoveredState.charged, completed: recoveredState.completed,
    ambiguous: recoveredState.ambiguous, writes: 2, renders: 0, acousticCalls: 0};
}

function recoverPreparedContinuation04({root = ROOT, home = os.homedir(), commonDirectory,
  buildDirectory, productionBuildDirectory} = {}) {
  const roots = resolveRoots({root, home, commonDirectory});
  const existing = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_04_REL);
  if (existing) {
    const state = readExperimentState(roots);
    const identity = verifyPreparedCurrent(roots, state, {root, home, commonDirectory, buildDirectory});
    if (identity.head !== state.executionHead || state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_POST_VERIFY');
    }
    return {status: 'RECOVERY_CONTINUATION_04_REUSED', head: identity.head,
      receiptSha256: existing.sha256, preflightSha256: state.recovery.preflight.sha256,
      charged: state.charged, completed: state.completed, ambiguous: state.ambiguous,
      writes: 0, renders: 0, acousticCalls: 0};
  }
  const identity = currentIdentity(root);
  if (identity.branch !== PR_BRANCH) throw new Error('BLOCKED_CONTACT_LOSS_BRANCH');
  verifiedPullRequest(root, identity.head);
  verifyIssueApproval(root);
  verifyPrepareRecoveryContinuation04Approval(root);
  const original = readOriginalMalformedPreparation(roots, {allowRecoveryHistory: true});
  const originalGate3 = readJsonDual(roots, 'gate3-analysis.json', {required: true});
  const previousRecovery = verifyStoredPrepareRecovery(roots, {prepared: original.prepare,
    originalPreflight: original.originalPreflight, originalGate3,
    allowContinuation02: true, allowContinuation03: true});
  const previousContinuation02 = verifyStoredPrepareRecoveryContinuation02(roots, {prepared: original.prepare,
    originalGate3, previousRecovery, allowContinuation03: true});
  if (previousContinuation02.sha256 !== RECOVERY_CONTINUATION_02_RECEIPT_SHA256
      || previousContinuation02.preflight.sha256 !== RECOVERY_CONTINUATION_02_PREFLIGHT_SHA256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_CONTINUATION_02');
  }
  const previousContinuation03 = verifyStoredPrepareRecoveryContinuation03(roots, {prepared: original.prepare,
    originalGate3, previousContinuation02});
  if (previousContinuation03.sha256 !== RECOVERY_CONTINUATION_03_RECEIPT_SHA256
      || previousContinuation03.preflight.sha256 !== RECOVERY_CONTINUATION_03_PREFLIGHT_SHA256) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_PREVIOUS_RECEIPT');
  }
  const expectedPrefix = ['gate3-analysis.json', 'plan.json', 'prepare.json',
    preflightFileName(RECOVERY_ORIGINAL_HEAD), recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD),
    'prepare-recovery.json', recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD),
    PREPARE_RECOVERY_CONTINUATION_02_REL,
    recoveryPreflightFileName(RECOVERY_CONTINUATION_03_EXECUTION_HEAD),
    PREPARE_RECOVERY_CONTINUATION_03_REL].sort();
  const previousRootSnapshot = snapshotActiveRootMembers(roots, expectedPrefix);
  if (!sameJson(Object.keys(previousRootSnapshot.primary).sort(), expectedPrefix)
      || readDual(roots, recoveryPreflightFileName(identity.head))) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_PARTIAL_STATE');
  }
  const state = readExperimentState(roots);
  if (state.status !== 'READY' || state.recovery?.sha256 !== previousContinuation03.sha256
      || state.executionHead !== RECOVERY_CONTINUATION_03_EXECUTION_HEAD
      || state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_STATE');
  }
  const preflightResult = preflightExperiment({root, home, commonDirectory, buildDirectory,
    productionBuildDirectory, continuation04: true});
  if (preflightResult.status !== 'PREPARE_PREFLIGHT_READY') return {
    status: preflightResult.status, head: identity.head, checks: preflightResult.checks,
    writes: preflightResult.writes || 0, renders: 0, acousticCalls: 0
  };
  const preflight = readJsonDual(roots, recoveryPreflightFileName(identity.head), {required: true});
  assertRecoveryContinuation04PreflightReceiptShape(preflight.value, identity.head);
  if (preflight.sha256 !== preflightResult.preflightSha256
      || !sameJson(preflight.value.continuation04.previousRootSnapshot, previousRootSnapshot)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_PREFLIGHT_READBACK');
  }
  const continuation = preflight.value.continuation04;
  const record = {schemaVersion: 1, kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_04',
    issue: 7, pr: PR_NUMBER, epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
    approvalMarker: PREPARE_RECOVERY_CONTINUATION_04_APPROVAL_MARKER,
    designSha256: PREPARE_RECOVERY_CONTINUATION_04_DESIGN_SHA256,
    previousExecutionHead: previousContinuation03.executionHead,
    previousRecoveryPreflightSha256: previousContinuation03.preflight.sha256,
    previousRecoveryReceiptSha256: previousContinuation03.sha256,
    original: {head: RECOVERY_ORIGINAL_HEAD, prepareSha256: original.prepare.sha256,
      planSha256: original.plan.sha256, gate3Sha256: original.gate3.sha256,
      preflightSha256: original.originalPreflight.sha256},
    executionHead: identity.head, previousRootSnapshot,
    recovery: {head: identity.head, preflightFile: continuation.preflightFile,
      preflightSha256: preflight.sha256, gate3AnalysisSha256: continuation.gate3AnalysisSha256,
      gate3Analysis: continuation.gate3Analysis, offlineReportSha256: continuation.offlineReportSha256,
      offlineManifestSha256: continuation.offlineManifestSha256, offlineHistory: continuation.offlineHistory,
      frozenSnapshotSha256: preflight.value.frozenSnapshotSha256,
      frozenEvidenceSnapshot: preflight.value.frozenEvidenceSnapshot,
      source: preflight.value.source, sourceDelta: continuation.sourceDelta,
      builds: {diagnostic: {wasmSha256: preflight.value.builds.diagnostic.wasm.sha256,
        wasmSize: preflight.value.builds.diagnostic.wasm.size},
      production: {wasmSha256: preflight.value.builds.production.wasm.sha256,
        wasmSize: preflight.value.builds.production.wasm.size}}},
    parentProof: preflight.value.parentProof, calls: {started: 0, completed: 0, ambiguous: 0},
    budget: core.accounting()};
  assertPrepareRecoveryContinuation04ReceiptShape(record);
  const lock = acquireLock(roots);
  let writeResult;
  try {
    if (!sameJson(snapshotActiveRootMembers(roots, expectedPrefix, {requireExact: false}), previousRootSnapshot)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_PREFIX_MUTATED');
    }
    const currentMembers = epochRootMembers(roots).filter(name => name !== 'writer.lock').sort();
    const expectedMembers = [...expectedPrefix, recoveryPreflightFileName(identity.head)].sort();
    if (!sameJson(currentMembers, expectedMembers)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_PARTIAL_STATE');
    }
    writeResult = writeDualImmutable(roots, PREPARE_RECOVERY_CONTINUATION_04_REL, jsonBytes(record));
    const readback = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_04_REL, {required: true});
    if (readback.sha256 !== writeResult.sha256 || !sameJson(readback.value, record)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_READBACK');
    }
  } finally { releaseLock(roots, lock); }
  const recoveredState = readExperimentState(roots);
  const current = verifyPreparedCurrent(roots, recoveredState, {root, home, commonDirectory, buildDirectory});
  if (current.head !== identity.head || recoveredState.executionHead !== identity.head
      || recoveredState.charged !== 0 || recoveredState.completed !== 0 || recoveredState.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_04_POST_VERIFY');
  }
  return {status: 'RECOVERY_CONTINUATION_04_READY', head: identity.head,
    previousRecoverySha256: previousContinuation03.sha256, receiptSha256: writeResult.sha256,
    preflightSha256: preflight.sha256, checks: preflight.value.checks,
    charged: recoveredState.charged, completed: recoveredState.completed,
    ambiguous: recoveredState.ambiguous, writes: 2, renders: 0, acousticCalls: 0};
}

function recoverPreparedContinuation05({root = ROOT, home = os.homedir(), commonDirectory,
  buildDirectory, productionBuildDirectory} = {}) {
  const roots = resolveRoots({root, home, commonDirectory});
  const existing = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_05_REL);
  if (existing) {
    const state = readExperimentState(roots);
    const identity = verifyPreparedCurrent(roots, state, {root, home, commonDirectory, buildDirectory});
    if (identity.head !== state.executionHead || state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_POST_VERIFY');
    }
    return {status: 'RECOVERY_CONTINUATION_05_REUSED', head: identity.head,
      receiptSha256: existing.sha256, preflightSha256: state.recovery.preflight.sha256,
      charged: state.charged, completed: state.completed, ambiguous: state.ambiguous,
      writes: 0, renders: 0, acousticCalls: 0};
  }
  const identity = currentIdentity(root);
  if (identity.branch !== PR_BRANCH) throw new Error('BLOCKED_CONTACT_LOSS_BRANCH');
  verifiedPullRequest(root, identity.head);
  verifyIssueApproval(root);
  verifyPrepareRecoveryContinuation05Approval(root);
  const original = readOriginalMalformedPreparation(roots, {allowRecoveryHistory: true});
  const state = readExperimentState(roots), previousContinuation04 = state.recovery;
  if (state.status !== 'READY' || !previousContinuation04
      || previousContinuation04.value.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_04'
      || state.executionHead !== previousContinuation04.executionHead
      || state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_STATE');
  }
  const expectedPrefix = ['gate3-analysis.json', 'plan.json', 'prepare.json',
    preflightFileName(RECOVERY_ORIGINAL_HEAD), recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD),
    'prepare-recovery.json', recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD),
    PREPARE_RECOVERY_CONTINUATION_02_REL,
    recoveryPreflightFileName(RECOVERY_CONTINUATION_03_EXECUTION_HEAD),
    PREPARE_RECOVERY_CONTINUATION_03_REL,
    recoveryPreflightFileName(previousContinuation04.executionHead),
    PREPARE_RECOVERY_CONTINUATION_04_REL].sort();
  const previousRootSnapshot = snapshotActiveRootMembers(roots, expectedPrefix);
  if (!sameJson(epochRootMembers(roots), expectedPrefix)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_PARTIAL_STATE');
  }
  const preflightResult = preflightExperiment({root, home, commonDirectory, buildDirectory,
    productionBuildDirectory, continuation05: true});
  if (preflightResult.status !== 'PREPARE_PREFLIGHT_READY') return {
    status: preflightResult.status, head: identity.head, checks: preflightResult.checks,
    writes: preflightResult.writes || 0, renders: 0, acousticCalls: 0
  };
  const preflight = readJsonDual(roots, recoveryPreflightFileName(identity.head), {required: true});
  assertRecoveryContinuation05PreflightReceiptShape(preflight.value, identity.head);
  if (preflight.sha256 !== preflightResult.preflightSha256
      || !sameJson(preflight.value.continuation05.previousRootSnapshot, previousRootSnapshot)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_PREFLIGHT_READBACK');
  }
  const continuation = preflight.value.continuation05;
  const record = {schemaVersion: 1, kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_05',
    issue: 7, pr: PR_NUMBER, epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
    approvalMarker: PREPARE_RECOVERY_CONTINUATION_05_APPROVAL_MARKER,
    designSha256: PREPARE_RECOVERY_CONTINUATION_05_DESIGN_SHA256,
    previousExecutionHead: previousContinuation04.executionHead,
    previousRecoveryPreflightSha256: previousContinuation04.preflight.sha256,
    previousRecoveryReceiptSha256: previousContinuation04.sha256,
    original: {head: RECOVERY_ORIGINAL_HEAD, prepareSha256: original.prepare.sha256,
      planSha256: original.plan.sha256, gate3Sha256: original.gate3.sha256,
      preflightSha256: original.originalPreflight.sha256},
    executionHead: identity.head, previousRootSnapshot,
    recovery: {head: identity.head, preflightFile: continuation.preflightFile,
      preflightSha256: preflight.sha256, gate3AnalysisSha256: continuation.gate3AnalysisSha256,
      gate3Analysis: continuation.gate3Analysis, offlineReportSha256: continuation.offlineReportSha256,
      offlineManifestSha256: continuation.offlineManifestSha256,
      previousOfflineHistory: continuation.previousOfflineHistory, offlineHistory: continuation.offlineHistory,
      frozenSnapshotSha256: preflight.value.frozenSnapshotSha256,
      frozenEvidenceSnapshot: preflight.value.frozenEvidenceSnapshot,
      source: preflight.value.source, sourceDelta: continuation.sourceDelta,
      builds: {diagnostic: {wasmSha256: preflight.value.builds.diagnostic.wasm.sha256,
        wasmSize: preflight.value.builds.diagnostic.wasm.size},
      production: {wasmSha256: preflight.value.builds.production.wasm.sha256,
        wasmSize: preflight.value.builds.production.wasm.size}}},
    parentProof: preflight.value.parentProof, calls: {started: 0, completed: 0, ambiguous: 0},
    budget: core.accounting()};
  assertPrepareRecoveryContinuation05ReceiptShape(record);
  const lock = acquireLock(roots);
  let writeResult;
  try {
    if (!sameJson(snapshotActiveRootMembers(roots, expectedPrefix, {requireExact: false}), previousRootSnapshot)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_PREFIX_MUTATED');
    }
    const currentMembers = epochRootMembers(roots).filter(name => name !== 'writer.lock').sort();
    const expectedMembers = [...expectedPrefix, recoveryPreflightFileName(identity.head)].sort();
    if (!sameJson(currentMembers, expectedMembers)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_PARTIAL_STATE');
    }
    writeResult = writeDualImmutable(roots, PREPARE_RECOVERY_CONTINUATION_05_REL, jsonBytes(record));
    const readback = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_05_REL, {required: true});
    if (readback.sha256 !== writeResult.sha256 || !sameJson(readback.value, record)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_READBACK');
    }
  } finally { releaseLock(roots, lock); }
  const recoveredState = readExperimentState(roots);
  const current = verifyPreparedCurrent(roots, recoveredState, {root, home, commonDirectory, buildDirectory});
  if (current.head !== identity.head || recoveredState.executionHead !== identity.head
      || recoveredState.charged !== 0 || recoveredState.completed !== 0 || recoveredState.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_05_POST_VERIFY');
  }
  return {status: 'RECOVERY_CONTINUATION_05_READY', head: identity.head,
    previousRecoverySha256: previousContinuation04.sha256, receiptSha256: writeResult.sha256,
    preflightSha256: preflight.sha256, checks: preflight.value.checks,
    charged: recoveredState.charged, completed: recoveredState.completed,
    ambiguous: recoveredState.ambiguous, writes: 2, renders: 0, acousticCalls: 0};
}

function recoverPreparedContinuation06({root = ROOT, home = os.homedir(), commonDirectory,
  buildDirectory, productionBuildDirectory} = {}) {
  const roots = resolveRoots({root, home, commonDirectory});
  const identity = currentIdentity(root);
  if (readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_06_REL)
      || readJsonDual(roots, recoveryPreflightFileName(identity.head))) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_ALREADY_ATTEMPTED');
  }
  if (identity.branch !== PR_BRANCH) throw new Error('BLOCKED_CONTACT_LOSS_BRANCH');
  verifiedPullRequest(root, identity.head);
  verifyIssueApproval(root);
  verifyPrepareRecoveryContinuation06Approval(root);
  const original = readOriginalMalformedPreparation(roots, {allowRecoveryHistory: true});
  const state = readExperimentState(roots), previousContinuation04 = state.recovery;
  if (state.status !== 'READY' || !previousContinuation04
      || previousContinuation04.value.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_04'
      || previousContinuation04.sha256 !== RECOVERY_CONTINUATION_04_RECEIPT_SHA256
      || previousContinuation04.preflight.sha256 !== RECOVERY_CONTINUATION_04_PREFLIGHT_SHA256
      || state.executionHead !== RECOVERY_CONTINUATION_04_EXECUTION_HEAD
      || state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0
      || readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_05_REL)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_STATE');
  }
  const expectedPrefix = ['gate3-analysis.json', 'plan.json', 'prepare.json',
    preflightFileName(RECOVERY_ORIGINAL_HEAD), recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD),
    'prepare-recovery.json', recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD),
    PREPARE_RECOVERY_CONTINUATION_02_REL,
    recoveryPreflightFileName(RECOVERY_CONTINUATION_03_EXECUTION_HEAD),
    PREPARE_RECOVERY_CONTINUATION_03_REL,
    recoveryPreflightFileName(RECOVERY_CONTINUATION_04_EXECUTION_HEAD),
    PREPARE_RECOVERY_CONTINUATION_04_REL].sort();
  const previousRootSnapshot = snapshotActiveRootMembers(roots, expectedPrefix);
  if (!sameJson(epochRootMembers(roots), expectedPrefix)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_PREFIX_SET');
  }
  const preflightResult = preflightExperiment({root, home, commonDirectory, buildDirectory,
    productionBuildDirectory, continuation06: true});
  if (preflightResult.status !== 'PREPARE_PREFLIGHT_READY') return {
    status: preflightResult.status, head: identity.head, checks: preflightResult.checks,
    writes: preflightResult.writes || 0, renders: 0, acousticCalls: 0};
  const preflight = readJsonDual(roots, recoveryPreflightFileName(identity.head), {required: true});
  assertRecoveryContinuation06PreflightReceiptShape(preflight.value, identity.head);
  if (preflight.sha256 !== preflightResult.preflightSha256
      || !sameJson(preflight.value.continuation06.previousRootSnapshot, previousRootSnapshot)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_PREFLIGHT_READBACK');
  }
  const continuation = preflight.value.continuation06;
  const record = {schemaVersion: 1, kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_06',
    issue: 7, pr: PR_NUMBER, epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
    approvalMarker: PREPARE_RECOVERY_CONTINUATION_06_APPROVAL_MARKER,
    designSha256: PREPARE_RECOVERY_CONTINUATION_06_DESIGN_SHA256,
    previousExecutionHead: previousContinuation04.executionHead,
    previousRecoveryPreflightSha256: previousContinuation04.preflight.sha256,
    previousRecoveryReceiptSha256: previousContinuation04.sha256,
    original: {head: RECOVERY_ORIGINAL_HEAD, prepareSha256: original.prepare.sha256,
      planSha256: original.plan.sha256, gate3Sha256: original.gate3.sha256,
      preflightSha256: original.originalPreflight.sha256},
    executionHead: identity.head, previousRootSnapshot,
    recovery: {head: identity.head, preflightFile: continuation.preflightFile,
      preflightSha256: preflight.sha256, gate3AnalysisSha256: continuation.gate3AnalysisSha256,
      gate3Analysis: continuation.gate3Analysis, offlineReportSha256: continuation.offlineReportSha256,
      offlineManifestSha256: continuation.offlineManifestSha256,
      previousOfflineHistory: continuation.previousOfflineHistory, offlineHistory: continuation.offlineHistory,
      frozenSnapshotSha256: preflight.value.frozenSnapshotSha256,
      frozenEvidenceSnapshot: preflight.value.frozenEvidenceSnapshot,
      source: preflight.value.source, sourceDelta: continuation.sourceDelta,
      builds: {diagnostic: {wasmSha256: preflight.value.builds.diagnostic.wasm.sha256,
        wasmSize: preflight.value.builds.diagnostic.wasm.size},
      production: {wasmSha256: preflight.value.builds.production.wasm.sha256,
        wasmSize: preflight.value.builds.production.wasm.size}}},
    parentProof: preflight.value.parentProof, calls: {started: 0, completed: 0, ambiguous: 0},
    budget: core.accounting()};
  assertPrepareRecoveryContinuation06ReceiptShape(record);
  const lock = acquireLock(roots);
  let writeResult;
  try {
    if (!sameJson(snapshotActiveRootMembers(roots, expectedPrefix, {requireExact: false}), previousRootSnapshot)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_PREFIX_MUTATED');
    }
    const currentMembers = epochRootMembers(roots).filter(name => name !== 'writer.lock').sort();
    const expectedMembers = [...expectedPrefix, recoveryPreflightFileName(identity.head)].sort();
    if (!sameJson(currentMembers, expectedMembers)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_PARTIAL_STATE');
    }
    writeResult = writeDualImmutable(roots, PREPARE_RECOVERY_CONTINUATION_06_REL, jsonBytes(record));
    const readback = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_06_REL, {required: true});
    if (readback.sha256 !== writeResult.sha256 || !sameJson(readback.value, record)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_READBACK');
    }
  } finally { releaseLock(roots, lock); }
  const recoveredState = readExperimentState(roots);
  const current = verifyPreparedCurrent(roots, recoveredState, {root, home, commonDirectory, buildDirectory});
  if (current.head !== identity.head || recoveredState.executionHead !== identity.head
      || recoveredState.charged !== 0 || recoveredState.completed !== 0 || recoveredState.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_POST_VERIFY');
  }
  return {status: 'RECOVERY_CONTINUATION_06_READY', head: identity.head,
    previousRecoverySha256: previousContinuation04.sha256, receiptSha256: writeResult.sha256,
    preflightSha256: preflight.sha256, checks: preflight.value.checks,
    charged: recoveredState.charged, completed: recoveredState.completed,
    ambiguous: recoveredState.ambiguous, writes: 2, renders: 0, acousticCalls: 0};
}

function recoverPreparedContinuation07({root = ROOT, home = os.homedir(), commonDirectory,
  buildDirectory, productionBuildDirectory} = {}) {
  const roots = resolveRoots({root, home, commonDirectory});
  const identity = currentIdentity(root);
  if (readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_07_REL)
      || readJsonDual(roots, recoveryPreflightFileName(identity.head))) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_ALREADY_ATTEMPTED');
  }
  if (identity.branch !== PR_BRANCH) throw new Error('BLOCKED_CONTACT_LOSS_BRANCH');
  verifiedPullRequest(root, identity.head);
  verifyIssueApproval(root);
  verifyPrepareRecoveryContinuation07Approval(root);
  const original = readOriginalMalformedPreparation(roots, {allowRecoveryHistory: true});
  const state = readExperimentState(roots), previousContinuation04 = state.recovery;
  if (state.status !== 'READY' || !previousContinuation04
      || previousContinuation04.value.kind !== 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_04'
      || previousContinuation04.sha256 !== RECOVERY_CONTINUATION_04_RECEIPT_SHA256
      || previousContinuation04.preflight.sha256 !== RECOVERY_CONTINUATION_04_PREFLIGHT_SHA256
      || state.executionHead !== RECOVERY_CONTINUATION_04_EXECUTION_HEAD
      || state.charged !== 0 || state.completed !== 0 || state.ambiguous !== 0
      || readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_05_REL)
      || readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_06_REL)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_STATE');
  }
  const expectedPrefix = ['gate3-analysis.json', 'plan.json', 'prepare.json',
    preflightFileName(RECOVERY_ORIGINAL_HEAD), recoveryPreflightFileName(RECOVERY_FIRST_EXECUTION_HEAD),
    'prepare-recovery.json', recoveryPreflightFileName(RECOVERY_CONTINUATION_02_EXECUTION_HEAD),
    PREPARE_RECOVERY_CONTINUATION_02_REL,
    recoveryPreflightFileName(RECOVERY_CONTINUATION_03_EXECUTION_HEAD),
    PREPARE_RECOVERY_CONTINUATION_03_REL,
    recoveryPreflightFileName(RECOVERY_CONTINUATION_04_EXECUTION_HEAD),
    PREPARE_RECOVERY_CONTINUATION_04_REL].sort();
  if (!sameJson(epochRootMembers(roots), expectedPrefix)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_PREFIX_SET');
  }
  const previousRootSnapshot = snapshotActiveRootMembers(roots, expectedPrefix);
  const preflightResult = preflightExperiment({root, home, commonDirectory, buildDirectory,
    productionBuildDirectory, continuation07: true});
  if (preflightResult.status !== 'PREPARE_PREFLIGHT_READY') return {
    status: preflightResult.status, head: identity.head, checks: preflightResult.checks,
    writes: preflightResult.writes || 0, renders: 0, acousticCalls: 0};
  const preflight = readJsonDual(roots, recoveryPreflightFileName(identity.head), {required: true});
  assertRecoveryContinuation07PreflightReceiptShape(preflight.value, identity.head);
  if (preflight.sha256 !== preflightResult.preflightSha256
      || !sameJson(preflight.value.continuation07.previousRootSnapshot, previousRootSnapshot)) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_PREFLIGHT_READBACK');
  }
  const continuation = preflight.value.continuation07;
  const record = {schemaVersion: 1, kind: 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_07',
    issue: 7, pr: PR_NUMBER, epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
    approvalMarker: PREPARE_RECOVERY_CONTINUATION_07_APPROVAL_MARKER,
    designSha256: PREPARE_RECOVERY_CONTINUATION_07_DESIGN_SHA256,
    previousExecutionHead: previousContinuation04.executionHead,
    previousRecoveryPreflightSha256: previousContinuation04.preflight.sha256,
    previousRecoveryReceiptSha256: previousContinuation04.sha256,
    original: {head: RECOVERY_ORIGINAL_HEAD, prepareSha256: original.prepare.sha256,
      planSha256: original.plan.sha256, gate3Sha256: original.gate3.sha256,
      preflightSha256: original.originalPreflight.sha256},
    executionHead: identity.head, previousRootSnapshot,
    recovery: {head: identity.head, preflightFile: continuation.preflightFile,
      preflightSha256: preflight.sha256, gate3AnalysisSha256: continuation.gate3AnalysisSha256,
      gate3Analysis: continuation.gate3Analysis, offlineReportSha256: continuation.offlineReportSha256,
      offlineManifestSha256: continuation.offlineManifestSha256,
      previousOfflineHistory: continuation.previousOfflineHistory, offlineHistory: continuation.offlineHistory,
      frozenSnapshotSha256: preflight.value.frozenSnapshotSha256,
      frozenEvidenceSnapshot: preflight.value.frozenEvidenceSnapshot,
      source: preflight.value.source, sourceDelta: continuation.sourceDelta,
      builds: {diagnostic: {wasmSha256: preflight.value.builds.diagnostic.wasm.sha256,
        wasmSize: preflight.value.builds.diagnostic.wasm.size},
      production: {wasmSha256: preflight.value.builds.production.wasm.sha256,
        wasmSize: preflight.value.builds.production.wasm.size}}},
    parentProof: preflight.value.parentProof, calls: {started: 0, completed: 0, ambiguous: 0},
    budget: core.accounting()};
  assertPrepareRecoveryContinuation07ReceiptShape(record);
  const lock = acquireLock(roots);
  let writeResult;
  try {
    if (!sameJson(snapshotActiveRootMembers(roots, expectedPrefix, {requireExact: false}), previousRootSnapshot)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_PREFIX_MUTATED');
    }
    const currentMembers = epochRootMembers(roots).filter(name => name !== 'writer.lock').sort();
    const expectedMembers = [...expectedPrefix, recoveryPreflightFileName(identity.head)].sort();
    if (!sameJson(currentMembers, expectedMembers)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_PARTIAL_STATE');
    }
    writeResult = writeDualImmutable(roots, PREPARE_RECOVERY_CONTINUATION_07_REL, jsonBytes(record));
    const readback = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_07_REL, {required: true});
    if (readback.sha256 !== writeResult.sha256 || !sameJson(readback.value, record)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_READBACK');
    }
  } finally { releaseLock(roots, lock); }
  const recoveredState = readExperimentState(roots);
  const current = verifyPreparedCurrent(roots, recoveredState, {root, home, commonDirectory, buildDirectory});
  if (current.head !== identity.head || recoveredState.executionHead !== identity.head
      || recoveredState.charged !== 0 || recoveredState.completed !== 0 || recoveredState.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_POST_VERIFY');
  }
  return {status: 'RECOVERY_CONTINUATION_07_READY', head: identity.head,
    previousRecoverySha256: previousContinuation04.sha256, receiptSha256: writeResult.sha256,
    preflightSha256: preflight.sha256, checks: preflight.value.checks,
    charged: recoveredState.charged, completed: recoveredState.completed,
    ambiguous: recoveredState.ambiguous, writes: 2, renders: 0, acousticCalls: 0};
}

function prepareExperiment({root = ROOT, home = os.homedir(), commonDirectory, buildDirectory} = {}) {
  const roots = resolveRoots({root, home, commonDirectory}), identity = currentIdentity(root);
  if (![PR_BRANCH, LOCAL_WORKTREE_BRANCH].includes(identity.branch)) throw new Error('BLOCKED_CONTACT_LOSS_BRANCH');
  verifiedPullRequest(root, identity.head);
  verifyIssueApproval(root);
  const parent = verifyParentExperiment01({root, home, commonDirectory});
  const analysis = gate3Analysis({root, home, commonDirectory});
  if (analysis.status !== 'GATE3_ANALYSIS_PASS' || analysis.cellCount !== 140) throw new Error('BLOCKED_CONTACT_LOSS_GATE3');
  const frozenEvidenceSnapshot = frozenSourceSnapshot({root, home, commonDirectory});
  if (frozenSnapshotSha256(frozenEvidenceSnapshot) !== analysis.frozenSnapshotSha256) throw new Error('BLOCKED_CONTACT_LOSS_FROZEN_EVIDENCE_CHANGED');
  const source = sourceSnapshot(root), build = verifyDiagnosticBuild(root, identity.head, {buildDirectory});
  const productionBuild = verifyProductionBuild(root, identity.head);
  const preflight = verifyPreflightForPrepare({roots, head: identity.head, source, parentProof: parent.proof,
    frozenEvidenceSnapshot, analysisSha256: sha256(jsonBytes(analysis)),
    diagnosticWasmSha256: build.wasm.sha256, productionWasmSha256: productionBuild.wasm.sha256});
  const preflightBinding = buildPreparePreflightBinding(preflight);
  const record = {schemaVersion: 2, issue: 7, pr: 8, prUrl: PR_URL, branch: PR_BRANCH, head: identity.head,
    epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
    approvalMarker: ISSUE_APPROVAL_MARKER, successorApprovalMarker: SUCCESSOR_APPROVAL_MARKER,
    ctestOrderContractSha256: CTEST_ORDER_CONTRACT_SHA256,
    ctestOrderApprovalMarker: CTEST_ORDER_APPROVAL_MARKER,
    ...preflightBinding,
    parentEpoch: parent.proof,
    gate3: {status: analysis.status, offlineEpoch: analysis.offlineEpoch, offlineReportSha256: analysis.offlineReportSha256,
      archiveSha256: analysis.archiveSha256, observationCount: analysis.observationCount, cellCount: analysis.cellCount,
      causalStatus: analysis.causalStatus, hypothesis: analysis.hypothesis,
      frozenSnapshotSha256: analysis.frozenSnapshotSha256},
    source, build, frozenEvidenceSnapshot, plan: core.plan(), startedCalls: 0, completedCalls: 0, ambiguousCalls: 0,
    budget: core.accounting(), createdAt: new Date().toISOString()};
  const lock = acquireLock(roots);
  try {
    const existing = readJsonDual(roots, 'prepare.json');
    const gate3Stored = readDual(roots, 'gate3-analysis.json');
    const expectedPlan = jsonBytes({schemaVersion: 2, epoch: ACTIVE_EPOCH,
      contractSha256: SUCCESSOR_CONTRACT_SHA256, plan: core.plan(), callCap: 42,
      historicalCalls: 3251, lifetimeCap: 5255, downstreamReserve: 1962});
    const storedPlan = readDual(roots, 'plan.json');
    if (existing && !gate3Stored) throw new Error('BLOCKED_CONTACT_LOSS_GATE3_REPORT_MISSING');
    if (!existing && (storedPlan || gate3Stored)) throw new Error('BLOCKED_CONTACT_LOSS_ORPHAN_PREPARE_INPUT');
    if (gate3Stored && !gate3Stored.bytes.equals(jsonBytes(analysis))) throw new Error('BLOCKED_CONTACT_LOSS_GATE3_REPORT_CONFLICT');
    if (!gate3Stored) writeDualImmutable(roots, 'gate3-analysis.json', jsonBytes(analysis));
    record.gate3.analysisSha256 = sha256(jsonBytes(analysis));
    if (existing) {
      if (!sameJson({...existing.value, createdAt: null}, {...record, createdAt: null})
          || existing.value.gate3?.analysisSha256 !== record.gate3.analysisSha256) throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_CONFLICT');
      if (!storedPlan || !storedPlan.bytes.equals(expectedPlan)) throw new Error('BLOCKED_CONTACT_LOSS_PLAN_MISSING_OR_CONFLICT');
      verifyParentInventoryUnchanged(parent, {root, home, commonDirectory});
      return {status: 'PREPARED_REUSED', prepareSha256: existing.sha256, roots};
    }
    writeDualImmutable(roots, 'prepare.json', jsonBytes(record));
    writeDualImmutable(roots, 'plan.json', expectedPlan);
    verifyParentInventoryUnchanged(parent, {root, home, commonDirectory});
    return {status: 'PREPARED', prepareSha256: sha256(jsonBytes(record)), roots};
  } finally {
    releaseLock(roots, lock);
  }
}

function acquireLock(roots) {
  const owner = crypto.randomUUID(), bytes = jsonBytes({schemaVersion: 1, owner, pid: process.pid, createdAt: new Date().toISOString()});
  writeDualImmutable(roots, 'writer.lock', bytes);
  return {owner, bytes};
}
function releaseLock(roots, lock) {
  const stored = readDual(roots, 'writer.lock', {required: true});
  if (!stored.bytes.equals(lock.bytes)) throw new Error('BLOCKED_CONTACT_LOSS_LOCK_OWNER_CHANGED');
  for (const root of [roots.primary, roots.secondary]) {
    const file = relativeFile(root, 'writer.lock');
    fs.unlinkSync(file); fsyncDirectory(path.dirname(file));
  }
}

function readExperimentState(roots, {ownerLock = null} = {}) {
  const rootMembers = roots.epoch === ACTIVE_EPOCH ? epochRootMembers(roots) : null;
  const prepared = readJsonDual(roots, 'prepare.json');
  if (!prepared) {
    if (roots.epoch === ACTIVE_EPOCH) {
      const preflightNames = rootMembers.filter(name => /^preflight-[a-f0-9]{40}\.json$/.test(name));
      const otherMembers = rootMembers.filter(name => !/^preflight-[a-f0-9]{40}\.json$/.test(name));
      if (otherMembers.length || (preflightNames.length && rootMembers.includes('writer.lock'))) {
        throw new Error('BLOCKED_CONTACT_LOSS_ORPHAN_ACTIVE_EPOCH');
      }
      const preflights = preflightNames.map(name => {
        const head = name.slice('preflight-'.length, -'.json'.length);
        const stored = readJsonDual(roots, name, {required: true});
        assertPreflightReceiptShape(stored.value, head);
        return {file: name, sha256: stored.sha256, value: stored.value};
      });
      return {status: preflights.length ? 'PREFLIGHT_READY' : 'NOT_PREPARED',
        preflightReports: preflights, charged: 0, completed: 0, ambiguous: 0, candidateResults: []};
    }
    return {status: 'NOT_PREPARED', charged: 0, completed: 0, ambiguous: 0, candidateResults: []};
  }
  let currentPreflight = null, recovery = null, verifiedFirstRecovery = null,
    verifiedContinuation02 = null, verifiedContinuation03 = null, verifiedContinuation04 = null,
    verifiedContinuation07 = null;
  let executionHead = prepared.value.head, executionSource = prepared.value.source;
  if (roots.epoch === ACTIVE_EPOCH) {
    for (const name of ['gate3-analysis.json', 'plan.json']) {
      if (!rootMembers.includes(name)) throw new Error(`BLOCKED_CONTACT_LOSS_ACTIVE_EPOCH_MEMBER_MISSING:${name}`);
    }
    const preflightFile = preflightFileName(prepared.value.head);
    if (!rootMembers.includes(preflightFile)) throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_MISSING');
    const preflight = readJsonDual(roots, preflightFile, {required: true});
    currentPreflight = {file: preflightFile, sha256: preflight.sha256, value: preflight.value};
    assertPreflightReceiptShape(preflight.value, prepared.value.head);
    if (preflight.value.source && !sameJson(preflight.value.source, prepared.value.source)
        || preflight.value.parentProof && !sameJson(preflight.value.parentProof, prepared.value.parentEpoch)
        || preflight.value.builds.diagnostic.wasm.sha256 !== prepared.value.build?.wasm?.sha256
        || preflight.value.gate3.analysisSha256 !== prepared.value.gate3?.analysisSha256) {
      throw new Error('BLOCKED_CONTACT_LOSS_PREFLIGHT_PREPARE_IDENTITY');
    }
    const storedRecovery = readJsonDual(roots, 'prepare-recovery.json');
    const storedContinuation02 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_02_REL);
    const storedContinuation03 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_03_REL);
    const storedContinuation04 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_04_REL);
    const storedContinuation05 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_05_REL);
    const storedContinuation06 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_06_REL);
    const storedContinuation07 = readJsonDual(roots, PREPARE_RECOVERY_CONTINUATION_07_REL);
    if (storedContinuation05 && storedContinuation06) throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_06_CHAIN');
    if (storedContinuation07 && (storedContinuation05 || storedContinuation06)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_07_EXCLUSIVITY');
    }
    if (storedRecovery) {
      // The recovery contract deliberately preserves the old malformed prepare
      // bytes. Authenticate that fixed record and its original preflight first;
      // the immutable recovery receipt below binds the new execution HEAD.
      assertPinnedRecoveryPrepareBinding(prepared, preflight);
      const originalGate3 = readJsonDual(roots, 'gate3-analysis.json', {required: true});
      verifiedFirstRecovery = verifyStoredPrepareRecovery(roots, {prepared, originalPreflight: preflight,
        originalGate3, allowContinuation02: Boolean(storedContinuation02),
        allowContinuation03: Boolean(storedContinuation03),
        allowContinuation04: Boolean(storedContinuation04),
        allowContinuation05: Boolean(storedContinuation05),
        allowContinuation06: Boolean(storedContinuation06),
        allowContinuation07: Boolean(storedContinuation07), ownerLock});
      verifiedContinuation02 = storedContinuation02
        ? verifyStoredPrepareRecoveryContinuation02(roots, {prepared, originalGate3,
          previousRecovery: verifiedFirstRecovery, allowContinuation03: Boolean(storedContinuation03),
          allowContinuation04: Boolean(storedContinuation04),
          allowContinuation05: Boolean(storedContinuation05),
          allowContinuation06: Boolean(storedContinuation06),
          allowContinuation07: Boolean(storedContinuation07), ownerLock}) : null;
      verifiedContinuation03 = storedContinuation03
        ? verifyStoredPrepareRecoveryContinuation03(roots, {prepared, originalGate3,
          previousContinuation02: verifiedContinuation02, allowContinuation04: Boolean(storedContinuation04),
          allowContinuation05: Boolean(storedContinuation05),
          allowContinuation06: Boolean(storedContinuation06),
          allowContinuation07: Boolean(storedContinuation07), ownerLock}) : null;
      verifiedContinuation04 = storedContinuation04
        ? verifyStoredPrepareRecoveryContinuation04(roots, {prepared, originalGate3,
          previousContinuation03: verifiedContinuation03, allowContinuation05: Boolean(storedContinuation05),
          allowContinuation06: Boolean(storedContinuation06),
          allowContinuation07: Boolean(storedContinuation07), ownerLock}) : null;
      const continuation05 = storedContinuation05
        ? verifyStoredPrepareRecoveryContinuation05(roots, {prepared, originalGate3,
          previousContinuation04: verifiedContinuation04, ownerLock}) : null;
      const continuation06 = storedContinuation06
        ? verifyStoredPrepareRecoveryContinuation06(roots, {prepared, originalGate3,
          previousContinuation04: verifiedContinuation04, ownerLock}) : null;
      verifiedContinuation07 = storedContinuation07
        ? verifyStoredPrepareRecoveryContinuation07(roots, {prepared, originalGate3,
          previousContinuation04: verifiedContinuation04, ownerLock}) : null;
      recovery = verifiedContinuation07 || continuation06 || continuation05 || verifiedContinuation04
        || verifiedContinuation03 || verifiedContinuation02 || verifiedFirstRecovery;
    } else if (storedContinuation02 || storedContinuation03 || storedContinuation04 || storedContinuation05
        || storedContinuation06 || storedContinuation07) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_CONTINUATION_02_PARTIAL_STATE');
    } else if (prepared.value.schemaVersion !== 2 || prepared.value.epoch !== ACTIVE_EPOCH
        || prepared.value.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
        || prepared.value.approvalMarker !== ISSUE_APPROVAL_MARKER
        || prepared.value.successorApprovalMarker !== SUCCESSOR_APPROVAL_MARKER
        || prepared.value.ctestOrderContractSha256 !== CTEST_ORDER_CONTRACT_SHA256
        || prepared.value.ctestOrderApprovalMarker !== CTEST_ORDER_APPROVAL_MARKER
        || prepared.value.preflightFile !== preflightFile || prepared.value.preflightSha256 !== preflight.sha256
        || prepared.value.parentEpoch?.epoch !== PARENT_EPOCH
        || prepared.value.parentEpoch?.head !== PARENT_HEAD
        || prepared.value.parentEpoch?.prepareSha256 !== PARENT_PREPARE_SHA256
        || prepared.value.parentEpoch?.planSha256 !== PARENT_PLAN_SHA256
        || prepared.value.parentEpoch?.gate3Sha256 !== PARENT_GATE3_SHA256
        || prepared.value.parentEpoch?.charged !== 0 || prepared.value.parentEpoch?.completed !== 0
        || prepared.value.parentEpoch?.ambiguous !== 0
        || !sameJson(prepared.value.plan, core.plan()) || prepared.value.startedCalls !== 0
        || prepared.value.completedCalls !== 0 || prepared.value.ambiguousCalls !== 0
        || !sameJson(prepared.value.budget, core.accounting())) {
      throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_IDENTITY');
    }
    const plan = readDual(roots, 'plan.json', {required: true});
    const expectedPlan = jsonBytes({schemaVersion: 2, epoch: ACTIVE_EPOCH,
      contractSha256: SUCCESSOR_CONTRACT_SHA256, plan: core.plan(), callCap: 42,
      historicalCalls: 3251, lifetimeCap: 5255, downstreamReserve: 1962});
    const gate3 = readJsonDual(roots, 'gate3-analysis.json', {required: true});
    if (!plan.bytes.equals(expectedPlan) || gate3.sha256 !== prepared.value.gate3?.analysisSha256
        || gate3.value.status !== 'GATE3_ANALYSIS_PASS' || gate3.value.head !== prepared.value.head) {
      throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_REPORT_IDENTITY');
    }
    const recoveryFiles = rootMembers.filter(name => /^recovery-preflight-[a-f0-9]{40}\.json$/.test(name));
    if (storedRecovery) {
      const expectedRecoveryFiles = expectedRecoveryPreflightHeads({
        firstRecovery: verifiedFirstRecovery, continuation02: verifiedContinuation02,
        continuation03: verifiedContinuation03, continuation04: verifiedContinuation04,
        continuation05: storedContinuation05 ? recovery : null,
        continuation06: storedContinuation06 ? recovery : null,
        continuation07: storedContinuation07 ? recovery : null});
      if (!sameJson(recoveryFiles, expectedRecoveryFiles)
          || !recoveryFiles.includes(recovery.value.recovery.preflightFile)) {
        throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_RECOVERY_PREFLIGHT_SET');
      }
      executionHead = recovery.executionHead;
      executionSource = recovery.executionSource;
    } else if (recoveryFiles.length || rootMembers.includes('prepare-recovery.json')) {
      throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_RECOVERY_PARTIAL_STATE');
    } else if (prepared.value.preflightSha256 !== preflight.sha256) {
      throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_IDENTITY');
    }
  } else if (prepared.value.schemaVersion !== 1 || prepared.value.head !== PARENT_HEAD
      || prepared.value.contractSha256 !== CONTRACT_SHA256 || prepared.value.approvalMarker !== ISSUE_APPROVAL_MARKER) {
    throw new Error('BLOCKED_CONTACT_LOSS_PARENT_PREPARE_IDENTITY');
  }
  const expected = core.plan(), calls = [], candidateResults = [];
  let gap = false, ambiguous = 0;
  for (let index = 0; index < expected.length; index++) {
    const item = expected[index], base = `${EXPERIMENT_REL}/${item.id}`;
    const start = readJsonDual(roots, `${base}/start.json`), complete = readJsonDual(roots, `${base}/complete.json`);
    if (!start) {
      if (complete) throw new Error('BLOCKED_CONTACT_LOSS_NONCONTIGUOUS_LEDGER');
      gap = true;
      calls.push({cell: item, status: 'NOT_STARTED'});
      continue;
    }
    if (gap || start.value.schemaVersion !== 1 || (roots.epoch === ACTIVE_EPOCH
        && (start.value.epoch !== ACTIVE_EPOCH || start.value.contractSha256 !== SUCCESSOR_CONTRACT_SHA256))
        || start.value.id !== item.id || start.value.alpha !== item.alpha
        || start.value.alphaOrder !== item.alphaOrder || start.value.pitch !== item.pitch
        || start.value.velocity !== item.velocity || start.value.cellOrder !== item.cellOrder
        || start.value.state !== 'STARTED' || start.value.sourceHead !== executionHead
        || start.value.wasmSha256 !== prepared.value.build.wasm.sha256) throw new Error('BLOCKED_CONTACT_LOSS_START_IDENTITY');
    if (!complete) { ambiguous++; calls.push({cell: item, status: 'AMBIGUOUS'}); gap = true; continue; }
    const audio = readDual(roots, `${base}/audio.wav`, {required: true});
    const metadata = readJsonDual(roots, `${base}/metadata.json`, {required: true});
    let normalizedMetrics;
    try { normalizedMetrics = normalizeAnalyzerMetrics(metadata.value.metrics, metadata.value.guardHits); }
    catch { throw new Error('BLOCKED_CONTACT_LOSS_COMPLETE_IDENTITY'); }
    if (complete.value.schemaVersion !== 1 || (roots.epoch === ACTIVE_EPOCH
        && (complete.value.epoch !== ACTIVE_EPOCH || complete.value.contractSha256 !== SUCCESSOR_CONTRACT_SHA256))
        || complete.value.state !== 'COMPLETE' || complete.value.id !== item.id
        || complete.value.audioSha256 !== audio.sha256
        || complete.value.metadataSha256 !== metadata.sha256 || metadata.value.id !== item.id
        || (roots.epoch === ACTIVE_EPOCH && (metadata.value.epoch !== ACTIVE_EPOCH
          || metadata.value.contractSha256 !== SUCCESSOR_CONTRACT_SHA256))
        || metadata.value.alpha !== item.alpha || metadata.value.alphaOrder !== item.alphaOrder
        || metadata.value.pitch !== item.pitch || metadata.value.velocity !== item.velocity
        || metadata.value.cellOrder !== item.cellOrder
        || metadata.value.sourceHead !== executionHead || metadata.value.wasmSha256 !== prepared.value.build.wasm.sha256
        || metadata.value.audioSha256 !== audio.sha256 || metadata.value.finite !== normalizedMetrics.official.finite
        || !Number.isSafeInteger(metadata.value.guardHits) || metadata.value.guardHits < 0) {
      throw new Error('BLOCKED_CONTACT_LOSS_COMPLETE_IDENTITY');
    }
    calls.push({cell: item, status: 'COMPLETE', start, complete, audio, metadata});
  }
  for (let alphaOrder = 0; alphaOrder < core.ALPHAS.length; alphaOrder++) {
    const rows = calls.slice(alphaOrder * 7, alphaOrder * 7 + 7);
    if (rows.length === 7 && rows.every(row => row.status === 'COMPLETE')) {
      const stored = readJsonDual(roots, `${EXPERIMENT_REL}/alpha-${String(alphaOrder).padStart(2, '0')}.json`);
      if (stored) {
        if (roots.epoch === ACTIVE_EPOCH && (stored.value.epoch !== ACTIVE_EPOCH
            || stored.value.contractSha256 !== SUCCESSOR_CONTRACT_SHA256)) {
          throw new Error('BLOCKED_CONTACT_LOSS_CANDIDATE_IDENTITY');
        }
        candidateResults.push(stored.value);
      }
    }
  }
  return {status: ambiguous ? 'BLOCKED_AMBIGUOUS_CALL' : 'READY', prepare: prepared.value,
    recovery, executionHead, executionSource,
    preflightReports: currentPreflight ? [currentPreflight, ...(recovery ? [recovery.preflight] : [])] : [],
    prepareSha256: prepared.sha256, calls, charged: calls.filter(row => row.status !== 'NOT_STARTED').length,
    completed: calls.filter(row => row.status === 'COMPLETE').length, ambiguous, candidateResults};
}

function writeFloatWav(left, right) {
  if (!left?.length || left.length !== right.length || left.length > 0xffffffff / 8) throw new Error('BLOCKED_CONTACT_LOSS_AUDIO_SHAPE');
  const dataSize = left.length * 8, out = Buffer.alloc(44 + dataSize);
  out.write('RIFF', 0); out.writeUInt32LE(36 + dataSize, 4); out.write('WAVE', 8); out.write('fmt ', 12);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(3, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(SAMPLE_RATE, 24);
  out.writeUInt32LE(SAMPLE_RATE * 8, 28); out.writeUInt16LE(8, 32); out.writeUInt16LE(32, 34); out.write('data', 36); out.writeUInt32LE(dataSize, 40);
  for (let index = 0, offset = 44; index < left.length; index++, offset += 8) {
    out.writeFloatLE(left[index], offset); out.writeFloatLE(right[index], offset + 4);
  }
  return out;
}

function officialMetricPayload(metrics) {
  const official = metrics?.official || metrics;
  if (!official || typeof official !== 'object' || typeof official.finite !== 'boolean'
      || !Array.isArray(official.envelopeDbfs) || official.envelopeDbfs.length < 5
      || !official.envelopeDbfs.every(Number.isFinite)
      || !Number.isFinite(official.peakDbfs) || !Number.isFinite(official.spectralCentroidHz)
      || official.spectralCentroidHz <= 0 || !Number.isFinite(official.above2kPowerRatio)) {
    throw new Error('BLOCKED_CONTACT_LOSS_ANALYZER_METRICS');
  }
  return official;
}
function normalizeAnalyzerMetrics(metrics, guardHits = metrics?.outputGuardHits ?? metrics?.official?.outputGuardHits ?? 0) {
  if (!metrics || typeof metrics !== 'object' || !metrics.official || typeof metrics.official !== 'object'
      || !Number.isSafeInteger(guardHits) || guardHits < 0) throw new Error('BLOCKED_CONTACT_LOSS_ANALYZER_METRICS');
  const official = officialMetricPayload(metrics);
  return {...metrics, outputGuardHits: guardHits, official: {...official, outputGuardHits: guardHits}};
}
function analyzerFixture(pitch = 69) {
  const left = new Float32Array(RENDER_FRAMES), right = new Float32Array(RENDER_FRAMES);
  const frequency = 440 * 2 ** ((pitch - 69) / 12);
  for (let index = 0; index < left.length; index++) {
    const phase = 2 * Math.PI * frequency * index / SAMPLE_RATE;
    left[index] = 0.12 * (Math.sin(phase) + 0.17 * Math.sin(phase * 2));
    right[index] = 0.115 * (Math.sin(phase) + 0.15 * Math.sin(phase * 2));
  }
  return {left, right};
}
function assertAnalyzerContract() {
  const analyzer = require('./analyze-issue7-physical-identification.cjs');
  const {left, right} = analyzerFixture(96);
  normalizeAnalyzerMetrics(analyzer.analyze(left, right, 96, SAMPLE_RATE), 0);
  return {status: 'ANALYZER_SHAPE_PASS', fixtureFrames: left.length};
}
function captureMetadata({cell, sourceHead, wasmSha256, guardHits, metrics, epoch = ACTIVE_EPOCH}) {
  const normalizedMetrics = normalizeAnalyzerMetrics(metrics, guardHits);
  return {epoch, contractSha256: SUCCESSOR_CONTRACT_SHA256,
    id: cell.id, alpha: cell.alpha, alphaOrder: cell.alphaOrder, pitch: cell.pitch,
    velocity: cell.velocity, cellOrder: cell.cellOrder, sourceHead, wasmSha256,
    finite: normalizedMetrics.official.finite, guardHits, metrics: normalizedMetrics};
}

function renderCall({root = ROOT, buildDirectory, cell, harnessFactory, epoch = ACTIVE_EPOCH}) {
  const {PluginHarness} = require('../../../../../test/helpers/plugin-harness.cjs');
  const oldBuild = process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR = path.resolve(root, buildDirectory || DIAGNOSTIC_BUILD_REL);
  let harness;
  try {
    harness = harnessFactory
      ? harnessFactory(root, WASM_REL, {sampleRate: SAMPLE_RATE, maxFrames: BLOCK_FRAMES})
      : new PluginHarness(root, WASM_REL, {sampleRate: SAMPLE_RATE, maxFrames: BLOCK_FRAMES});
    harness.applyPreset('concert_grand');
    for (const [name, value] of [['engine_model', 'concert_grand'], ['voice_drift', 0], ['lfo1_pitch', 0], ['chorus_mix', 0]]) harness.setPlain(name, value);
    const setter = harness.e.soraoto_supersynth_contact_loss_set, getter = harness.e.soraoto_supersynth_contact_loss_get;
    if (typeof setter !== 'function' || typeof getter !== 'function') throw new Error('BLOCKED_CONTACT_LOSS_EXPORTS');
    if ((setter(cell.alpha) | 0) !== 0 || Math.abs(getter() - cell.alpha) > 1e-6) throw new Error('BLOCKED_CONTACT_LOSS_SETTER_STATE');
    const guardStart = harness.e.soraoto_supersynth_guard_hit_count();
    const left = new Float32Array(RENDER_FRAMES), right = new Float32Array(RENDER_FRAMES);
    for (let position = 0; position < RENDER_FRAMES; position += BLOCK_FRAMES) {
      const count = Math.min(BLOCK_FRAMES, RENDER_FRAMES - position);
      const events = position === 0 ? [{kind: 1, noteId: 1, pitch: cell.pitch, velocity: cell.velocity / 127, offset: 0}] : [];
      const output = harness.process(count, {events});
      left.set(output[0][0], position); right.set(output[0][1], position);
    }
    const guardHits = harness.e.soraoto_supersynth_guard_hit_count() - guardStart;
    const audio = writeFloatWav(left, right), analyzed = require('./analyze-issue7-physical-identification.cjs')
      .analyze(left, right, cell.pitch, SAMPLE_RATE);
    const metadata = captureMetadata({cell, sourceHead: git(root, ['rev-parse', 'HEAD']),
      wasmSha256: sha256(harness.bytes), guardHits, metrics: analyzed, epoch});
    return {audio, metadata};
  } finally {
    try { harness?.close(); } finally {
      if (oldBuild === undefined) delete process.env.SORAOTO_WASM_BUILD_DIR;
      else process.env.SORAOTO_WASM_BUILD_DIR = oldBuild;
    }
  }
}

function decodeAudio(wav) {
  const loss = require('./physical-fit-v4-loss.cjs');
  return loss.decodeFloat32StereoWav(wav);
}
function referenceRows({root = ROOT, home = os.homedir(), commonDirectory, archivePath} = {}) {
  const offline = require('./issue7-physical-root-cause-offline-v1-core.cjs');
  const input = offline.resolveInputRoots({root, home, commonDirectory}), records = offline.verifyFrozenRecords(input);
  const archive = archivePath || locateArchive(home);
  if (!archive) throw new Error('BLOCKED_CONTACT_LOSS_REFERENCE_ARCHIVE_MISSING');
  return offline.readVerifiedReference(archive, records.p3Manifest.value).rows;
}
function scoreAlpha({alphaOrder, rows, refs, gainDb, sourceHead, wasmSha256, epoch = ACTIVE_EPOCH}) {
  const direct = require('./stage3-direct-reference-metrics.cjs');
  const loss = require('./physical-fit-v4-loss.cjs');
  const cellRows = core.STRESS_CELLS.map(([pitch, velocity], cellOrder) => {
    const source = rows.find(row => row.cell.pitch === pitch && row.cell.velocity === velocity);
    if (!source) throw new Error('BLOCKED_CONTACT_LOSS_ALPHA_CELL_MISSING');
    const ref = refs.find(row => row.pitch === pitch && row.velocity === velocity);
    if (!ref) throw new Error('BLOCKED_CONTACT_LOSS_REFERENCE_CELL_MISSING');
    const audio = decodeAudio(source.audio.bytes), analyzed = require('./analyze-issue7-physical-identification.cjs')
      .analyze(audio.left, audio.right, pitch, SAMPLE_RATE);
    const actualMetrics = normalizeAnalyzerMetrics(analyzed, source.metadata.value.guardHits);
    const referenceMetrics = officialMetricPayload(ref.metrics);
    return {cell: {pitch, velocity, cellOrder}, actual: {pitch, velocity, metrics: actualMetrics},
      referenceMetrics, ref, audio};
  });
  const evaluation = direct.evaluateDirectReferenceMatrix(cellRows.map(row => ({pitch: row.cell.pitch,
    velocity: row.cell.velocity, metrics: row.referenceMetrics})),
  cellRows.map(row => ({...row.actual, metrics: row.actual.metrics.official})));
  const effectiveGainDb = alphaOrder === 0
    ? loss.sharedGainDb(cellRows.map(row => row.ref.metrics), cellRows.map(row => row.actual.metrics))
    : gainDb;
  if (!Number.isFinite(effectiveGainDb)) throw new Error('BLOCKED_CONTACT_LOSS_SHARED_GAIN');
  const familyLoss = loss.candidateLoss(cellRows.map(row => ({pitch: row.cell.pitch, reference: row.ref.audio, model: row.audio})), effectiveGainDb).total;
  const result = {epoch, contractSha256: SUCCESSOR_CONTRACT_SHA256,
    alpha: core.ALPHAS[alphaOrder], alphaOrder, familyLoss, official: evaluation, sharedGainDb: effectiveGainDb,
    sourceHead, wasmSha256, cells: cellRows.map(({cell, actual}, index) => ({...cell,
      finite: actual.metrics.official.finite, guardHits: actual.metrics.official.outputGuardHits,
      peakDbfs: actual.metrics.official.peakDbfs,
      wavSha256: rows.find(row => row.cell.pitch === cell.pitch && row.cell.velocity === cell.velocity).audio.sha256,
      metadataSha256: rows.find(row => row.cell.pitch === cell.pitch && row.cell.velocity === cell.velocity).metadata.sha256,
      measuredIndex: index}))};
  if (alphaOrder !== 0) core.classifyCandidate(result);
  return result;
}

function scoreCompletedAlpha({alphaOrder, calls, refs, gainDb, sourceHead, wasmSha256, epoch = ACTIVE_EPOCH, evaluator = scoreAlpha}) {
  if (!Array.isArray(calls) || calls.length !== 7 || calls.some(row => row.status !== 'COMPLETE')) {
    throw new Error('BLOCKED_CONTACT_LOSS_ALPHA_INCOMPLETE');
  }
  return evaluator({alphaOrder, rows: calls.map(row => ({cell: row.cell,
    audio: row.audio || readDual(row.roots, `${EXPERIMENT_REL}/${row.cell.id}/audio.wav`, {required: true}),
    metadata: row.metadata || readJsonDual(row.roots, `${EXPERIMENT_REL}/${row.cell.id}/metadata.json`, {required: true})})),
    refs, gainDb, sourceHead, wasmSha256, epoch});
}
function verifiedReceipt(state, identity = {head: state.executionHead || state.prepare.head}) {
  if (state.charged !== 42 || state.completed !== 42 || state.ambiguous !== 0) throw new Error('BLOCKED_CONTACT_LOSS_INCOMPLETE_EXPERIMENT');
  return {status: 'VERIFIED_DUAL_STORE', startedCallCount: state.charged,
    completedCallCount: state.completed, ambiguousCallCount: state.ambiguous,
    baseline: {status: 'VERIFIED_SOURCE_BOUND_NEW_BUILD', alpha: core.ALPHAS[0], sourceHead: identity.head,
      wasmSha256: state.prepare.build.wasm.sha256},
    calls: state.calls.map(row => ({...row.cell, id: row.cell.id, state: row.status,
      sourceIdentityStatus: row.start.value.sourceHead === identity.head && row.start.value.wasmSha256 === state.prepare.build.wasm.sha256 ? 'MATCH' : 'MISMATCH',
      sourceHead: row.start.value.sourceHead, wasmSha256: row.start.value.wasmSha256,
      audioSha256: row.complete.value.audioSha256, metadataSha256: row.complete.value.metadataSha256}))};
}

function verifyPreparedCurrent(roots, state, {root = ROOT, home = os.homedir(), commonDirectory, buildDirectory} = {}) {
  const parent = verifyParentExperiment01({root, home, commonDirectory});
  if (!sameJson(state.prepare.parentEpoch, parent.proof)) throw new Error('BLOCKED_CONTACT_LOSS_PARENT_PROOF_DRIFT');
  const identity = currentIdentity(root);
  const executionHead = state.executionHead || state.prepare.head;
  const executionSource = state.executionSource || state.prepare.source;
  if (identity.head !== executionHead || ![PR_BRANCH, LOCAL_WORKTREE_BRANCH].includes(identity.branch)) {
    throw new Error('BLOCKED_CONTACT_LOSS_HEAD_DRIFT');
  }
  verifiedPullRequest(root, identity.head);
  verifyIssueApproval(root);
  if (state.recovery?.value.kind === 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_05') {
    verifyPrepareRecoveryContinuation05Approval(root);
  }
  if (state.recovery?.value.kind === 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_06') {
    verifyPrepareRecoveryContinuation06Approval(root);
  }
  if (state.recovery?.value.kind === 'CONTACT_LOSS_PREPARE_RECOVERY_CONTINUATION_07') {
    verifyPrepareRecoveryContinuation07Approval(root);
  }
  if (!sameJson(sourceSnapshot(root), executionSource)) throw new Error('BLOCKED_CONTACT_LOSS_SOURCE_DRIFT');
  const gate3 = readJsonDual(roots, 'gate3-analysis.json', {required: true});
  if (gate3.sha256 !== state.prepare.gate3.analysisSha256 || gate3.value.status !== 'GATE3_ANALYSIS_PASS'
      || gate3.value.head !== state.prepare.head || gate3.value.offlineReportSha256 !== state.prepare.gate3.offlineReportSha256) {
    throw new Error('BLOCKED_CONTACT_LOSS_GATE3_REPORT_IDENTITY');
  }
  const frozenNow = frozenSourceSnapshot({root, home, commonDirectory});
  if (state.recovery) {
    const recoveryReport = state.recovery.value.recovery;
    if (!sameJson(frozenNow, recoveryReport.frozenEvidenceSnapshot)
        || frozenSnapshotSha256(frozenNow) !== recoveryReport.frozenSnapshotSha256) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_FROZEN_EVIDENCE_DRIFT');
    }
    assertSameGate3Evidence(gate3.value, recoveryReport.gate3Analysis, executionHead,
      expectedRecoveryOfflineEpoch(state.recovery.value));
  } else assertFrozenSnapshotMatches(frozenNow, state.prepare);
  const currentBuild = verifyDiagnosticBuild(root, identity.head, {buildDirectory});
  if (currentBuild.wasm.sha256 !== state.prepare.build.wasm.sha256 || !sameJson(currentBuild.source, executionSource)) {
    throw new Error('BLOCKED_CONTACT_LOSS_BUILD_DRIFT');
  }
  if (state.recovery) {
    const production = verifyProductionBuild(root, identity.head);
    const recoveryBuilds = state.recovery.value.recovery.builds;
    if (production.wasm.sha256 !== recoveryBuilds.production.wasmSha256
        || production.wasm.size !== recoveryBuilds.production.wasmSize
        || !sameJson(production.source, executionSource)) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_PRODUCTION_BUILD_DRIFT');
    }
  }
  const offline = latestOfflineReport(root, home, commonDirectory, identity.head,
    state.recovery?.value?.recovery?.gate3Analysis?.offlineEpoch || null);
  const expectedOfflineSha = state.recovery
    ? state.recovery.value.recovery.offlineReportSha256 : state.prepare.gate3.offlineReportSha256;
  if (offline.reportSha256 !== expectedOfflineSha) throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EVIDENCE_DRIFT');
  return identity;
}

function preparedAcceptanceIdentity(state) {
  const head = state.executionHead || state.prepare.head;
  const source = state.executionSource || state.prepare.source;
  return {head, wasmSha256: state.prepare.build.wasm.sha256,
    sourceSnapshotSha256: sha256(Buffer.from(JSON.stringify(stable(source)))), buildRole: 'diagnostic'};
}
function executionPreparation(state) {
  const head = state.executionHead || state.prepare.head;
  const source = state.executionSource || state.prepare.source;
  const recovery = state.recovery?.value?.recovery;
  const gate3 = recovery ? {...state.prepare.gate3,
    offlineEpoch: recovery.gate3Analysis.offlineEpoch,
    offlineReportSha256: recovery.offlineReportSha256,
    frozenSnapshotSha256: recovery.frozenSnapshotSha256} : state.prepare.gate3;
  return {...state.prepare, head, source, gate3};
}
function verifyAcceptanceLedgerIdentity(roots, stage, cells, expected) {
  const calls = readAcceptanceCalls(roots, stage, cells);
  if (calls.charged !== cells.length || calls.completed !== cells.length || calls.ambiguous !== 0) {
    throw new Error(`BLOCKED_CONTACT_LOSS_ACCEPTANCE_INCOMPLETE:${stage}`);
  }
  for (const call of calls.calls) {
    const value = call.start.value;
    if (value.epoch !== ACTIVE_EPOCH || value.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
        || value.head !== expected.head || value.wasmSha256 !== expected.wasmSha256
        || value.sourceSnapshotSha256 !== expected.sourceSnapshotSha256 || value.buildRole !== expected.buildRole) {
      throw new Error(`BLOCKED_CONTACT_LOSS_ACCEPTANCE_SOURCE_BINDING:${stage}`);
    }
  }
  return calls;
}
function verifySelectionAfterPromotion({roots, state, selectionStored, root = ROOT, home = os.homedir(), commonDirectory,
  archivePath, parentVerifier = verifyParentExperiment01, snapshotReader = frozenSourceSnapshot,
  referenceReader = referenceRows, frozenSnapshotReader = frozenSourceSnapshot,
  offlineReportReader = latestOfflineReport, wasmArtifactReader = syncReadSha} = {}) {
  if (state.charged !== 42 || state.completed !== 42 || state.ambiguous !== 0 || state.candidateResults.length !== 6) {
    throw new Error('BLOCKED_CONTACT_LOSS_INCOMPLETE_EXPERIMENT');
  }
  const parent = parentVerifier({root, home, commonDirectory});
  if (!sameJson(state.prepare.parentEpoch, parent.proof)) throw new Error('BLOCKED_CONTACT_LOSS_PARENT_PROOF_DRIFT');
  const before = snapshotReader({root, home, commonDirectory});
  const refs = referenceReader({root, home, commonDirectory, archivePath});
  const identity = preparedAcceptanceIdentity(state);
  const storedResults = verifyStoredAlphaResults(roots, state, {root, home, commonDirectory, refs,
    evaluator: scoreAlpha, expectedIdentity: identity, skipCurrentAuthority: true,
    frozenSnapshotReader, offlineReportReader, wasmArtifactReader});
  if (storedResults.baselineUnsafe) throw new Error('BLOCKED_CONTACT_LOSS_BASELINE_UNSAFE');
  const receipt = verifiedReceipt(state, {head: state.executionHead || state.prepare.head});
  const decision = core.selectCandidate(state.candidateResults, {receipt});
  const expected = {schemaVersion: 1, epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
    ...decision, receipt, charged: state.charged, completed: state.completed,
    ambiguous: state.ambiguous, stage3: 'NOT RUN', stage4: 'NOT RUN'};
  if (!selectionStored || !sameJson(selectionStored.value, expected)) throw new Error('BLOCKED_CONTACT_LOSS_SELECTION_MISMATCH');
  if (!sameJson(before, snapshotReader({root, home, commonDirectory}))) throw new Error('BLOCKED_CONTACT_LOSS_FROZEN_EVIDENCE_CHANGED_DURING_VERIFY');
  return decision;
}

function runBounded({root = ROOT, home = os.homedir(), commonDirectory, buildDirectory,
  renderer = renderCall, evaluator = scoreAlpha, archivePath, terminalVerifier = verifyExperiment} = {}) {
  assertAnalyzerContract();
  const roots = resolveRoots({root, home, commonDirectory}), state = readExperimentState(roots);
  if (!state.prepare) throw new Error('BLOCKED_CONTACT_LOSS_NOT_PREPARED');
  const priorTerminal = readJsonDual(roots, `${EXPERIMENT_REL}/terminal.json`);
  if (priorTerminal) {
    const verified = terminalVerifier({root, home, commonDirectory, buildDirectory, archivePath, evaluator});
    if (verified.status !== priorTerminal.value.status || verified.charged !== state.charged
        || verified.completed !== state.completed || verified.ambiguous !== state.ambiguous) {
      throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_LEDGER_MISMATCH');
    }
    return {...priorTerminal.value, charged: verified.charged, completed: verified.completed,
      ambiguous: verified.ambiguous, terminalEvidence: 'VERIFIED'};
  }
  if (state.ambiguous) throw new Error('BLOCKED_CONTACT_LOSS_AMBIGUOUS_CALL_NO_RERENDER');
  const identity = verifyPreparedCurrent(roots, state, {root, home, commonDirectory, buildDirectory});
  const refs = referenceRows({root, home, commonDirectory, archivePath});
  const lock = acquireLock(roots);
  try {
    let calls = readExperimentState(roots, {ownerLock: lock}), charged = calls.charged;
    if (calls.ambiguous) throw new Error('BLOCKED_CONTACT_LOSS_AMBIGUOUS_CALL_NO_RERENDER');
    if (combinedExperimentCalls(roots, {ownerLock: lock}) > core.EXPERIMENT_CALL_CAP) throw new Error('BLOCKED_CONTACT_LOSS_CALL_CAP');
    if (calls.completed > 0) {
      const reports = verifyStoredAlphaResults(roots, calls, {root, home, commonDirectory, buildDirectory,
        refs, evaluator, createMissingReports: true});
      if (reports.baselineUnsafe) {
        const terminal = {epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
          status: 'GATE4_BASELINE_UNSAFE', reason: 'BASELINE_SAFETY_GATE_FAILED', charged,
          completed: calls.completed, ambiguous: calls.ambiguous, stage3: 'NOT RUN', stage4: 'NOT RUN'};
        writeDualImmutable(roots, `${EXPERIMENT_REL}/terminal.json`, jsonBytes(terminal));
        return terminal;
      }
      calls = readExperimentState(roots, {ownerLock: lock});
    }
    for (let index = charged; index < core.EXPERIMENT_CALL_CAP; index++) {
      const cell = core.plan()[index], base = `${EXPERIMENT_REL}/${cell.id}`;
      verifyPreparedCurrent(roots, calls, {root, home, commonDirectory, buildDirectory});
      const currentBuild = verifyDiagnosticBuild(root, identity.head, {buildDirectory});
      if (currentBuild.wasm.sha256 !== calls.prepare.build.wasm.sha256) throw new Error('BLOCKED_CONTACT_LOSS_BUILD_DRIFT');
      const start = {schemaVersion: 1, epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
        id: cell.id, alpha: cell.alpha, alphaOrder: cell.alphaOrder,
        pitch: cell.pitch, velocity: cell.velocity, cellOrder: cell.cellOrder,
        sourceHead: identity.head, wasmSha256: currentBuild.wasm.sha256, state: 'STARTED',
        startedAt: new Date().toISOString()};
      writeDualImmutable(roots, `${base}/start.json`, jsonBytes(start));
      let capture;
      try { capture = renderer({root, buildDirectory: path.relative(root, path.resolve(root, buildDirectory || DIAGNOSTIC_BUILD_REL)), cell, epoch: ACTIVE_EPOCH}); }
      catch (error) { throw new Error(`BLOCKED_CONTACT_LOSS_AMBIGUOUS_CALL:${cell.id}:${error.message}`); }
      try { verifyPreparedCurrent(roots, calls, {root, home, commonDirectory, buildDirectory}); }
      catch { throw new Error(`BLOCKED_CONTACT_LOSS_AMBIGUOUS_CALL:${cell.id}:SOURCE_OR_REMOTE_IDENTITY_DRIFT`); }
      if (!Buffer.isBuffer(capture?.audio) || !capture.metadata || capture.metadata.id !== cell.id
          || capture.metadata.alpha !== cell.alpha || capture.metadata.pitch !== cell.pitch
          || capture.metadata.velocity !== cell.velocity || capture.metadata.sourceHead !== identity.head
          || capture.metadata.wasmSha256 !== currentBuild.wasm.sha256) throw new Error(`BLOCKED_CONTACT_LOSS_CAPTURE_IDENTITY:${cell.id}`);
      const metadata = {...capture.metadata, epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
        audioSha256: sha256(capture.audio), completedAt: new Date().toISOString()};
      writeDualImmutable(roots, `${base}/audio.wav`, capture.audio);
      writeDualImmutable(roots, `${base}/metadata.json`, jsonBytes(metadata));
      writeDualImmutable(roots, `${base}/complete.json`, jsonBytes({schemaVersion: 1, epoch: ACTIVE_EPOCH,
        contractSha256: SUCCESSOR_CONTRACT_SHA256, id: cell.id,
        state: 'COMPLETE', audioSha256: sha256(capture.audio), metadataSha256: sha256(jsonBytes(metadata)), completedAt: metadata.completedAt}));
      calls = readExperimentState(roots, {ownerLock: lock});
      if (calls.ambiguous) throw new Error('BLOCKED_CONTACT_LOSS_AMBIGUOUS_CALL_NO_RERENDER');
      charged = calls.charged;
      const unsafeCapture = capture.metadata.finite !== true || capture.metadata.guardHits !== 0
        || !Number.isFinite(capture.metadata.metrics?.peakDbfs) || capture.metadata.metrics.peakDbfs >= 0;
      if (unsafeCapture) {
        const terminal = {epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
          status: 'BLOCKED_UNSAFE_CAPTURE', reason: 'FINITE_GUARD_OR_PEAK_GATE', charged,
          completed: calls.completed, ambiguous: calls.ambiguous, stage3: 'NOT RUN', stage4: 'NOT RUN'};
        writeDualImmutable(roots, `${EXPERIMENT_REL}/terminal.json`, jsonBytes(terminal));
        return terminal;
      }
      const alphaStart = cell.alphaOrder * 7, alphaCalls = calls.calls.slice(alphaStart, alphaStart + 7);
      if (alphaCalls.length === 7 && alphaCalls.every(row => row.status === 'COMPLETE')) {
        const baselineScore = cell.alphaOrder === 0 ? null : readJsonDual(roots, `${EXPERIMENT_REL}/alpha-00.json`, {required: true}).value;
        let scored;
        try {
        scored = evaluator({alphaOrder: cell.alphaOrder, epoch: ACTIVE_EPOCH, rows: alphaCalls.map(row => ({cell: row.cell,
            audio: readDual(roots, `${EXPERIMENT_REL}/${row.cell.id}/audio.wav`, {required: true}),
            metadata: readJsonDual(roots, `${EXPERIMENT_REL}/${row.cell.id}/metadata.json`, {required: true})})),
            refs, gainDb: baselineScore?.sharedGainDb ?? null, sourceHead: identity.head, wasmSha256: currentBuild.wasm.sha256});
          scored = {...scored, epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256};
        } catch {
          const terminal = {epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
            status: 'BLOCKED_METRIC_RECOMPUTATION', reason: 'OFFICIAL_METRICS_UNVERIFIABLE',
            charged, completed: calls.completed, ambiguous: calls.ambiguous, stage3: 'NOT RUN', stage4: 'NOT RUN'};
          writeDualImmutable(roots, `${EXPERIMENT_REL}/terminal.json`, jsonBytes(terminal));
          return terminal;
        }
        if (cell.alphaOrder === 0) {
          try { core.assertBaselineSafe(scored); }
          catch {
            const terminal = {epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
              status: 'GATE4_BASELINE_UNSAFE', reason: 'BASELINE_SAFETY_GATE_FAILED', charged,
              completed: calls.completed, ambiguous: calls.ambiguous, stage3: 'NOT RUN', stage4: 'NOT RUN'};
            writeDualImmutable(roots, `${EXPERIMENT_REL}/alpha-00.json`, jsonBytes({...scored, status: terminal.status}));
            writeDualImmutable(roots, `${EXPERIMENT_REL}/terminal.json`, jsonBytes(terminal));
            return terminal;
          }
        }
        writeDualImmutable(roots, `${EXPERIMENT_REL}/alpha-${String(cell.alphaOrder).padStart(2, '0')}.json`, jsonBytes(scored));
      }
    }
    calls = readExperimentState(roots, {ownerLock: lock});
    if (calls.charged !== 42 || calls.completed !== 42 || calls.ambiguous !== 0 || calls.candidateResults.length !== 6) {
      throw new Error('BLOCKED_CONTACT_LOSS_INCOMPLETE_EXPERIMENT');
    }
    verifyPreparedCurrent(roots, calls, {root, home, commonDirectory, buildDirectory});
    const receipt = verifiedReceipt(calls, identity);
    const selection = core.selectCandidate(calls.candidateResults, {receipt});
    writeDualImmutable(roots, `${EXPERIMENT_REL}/selection.json`, jsonBytes({schemaVersion: 1,
      epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256, ...selection,
      receipt, charged: calls.charged, completed: calls.completed, ambiguous: calls.ambiguous,
      stage3: 'NOT RUN', stage4: 'NOT RUN'}));
    return {status: selection.status, charged: calls.charged, completed: calls.completed,
      ambiguous: calls.ambiguous, selectedAlpha: selection.selected?.alpha ?? null};
  } finally { releaseLock(roots, lock); }
}

function verifyStoredAlphaResults(roots, state, {root = ROOT, home = os.homedir(), commonDirectory,
  buildDirectory, refs = null, evaluator = scoreAlpha, createMissingReports = false,
  skipCurrentAuthority = false, expectedIdentity, expectedTerminal = null,
  preparedVerifier = verifyPreparedCurrent, frozenSnapshotReader = frozenSourceSnapshot,
  offlineReportReader = latestOfflineReport, wasmArtifactReader = syncReadSha} = {}) {
  if (skipCurrentAuthority) {
    const original = expectedIdentity || preparedAcceptanceIdentity(state), storedGate3 = readJsonDual(roots, 'gate3-analysis.json', {required: true});
    if (storedGate3.sha256 !== state.prepare.gate3.analysisSha256 || storedGate3.value.head !== state.prepare.head
        || storedGate3.value.status !== 'GATE3_ANALYSIS_PASS') {
      throw new Error('BLOCKED_CONTACT_LOSS_PREPARE_EVIDENCE_DRIFT');
    }
    const frozen = frozenSnapshotReader({root, home, commonDirectory});
    if (state.recovery) {
      if (!sameJson(frozen, state.recovery.value.recovery.frozenEvidenceSnapshot)
          || frozenSnapshotSha256(frozen) !== state.recovery.value.recovery.frozenSnapshotSha256) {
        throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_FROZEN_EVIDENCE_DRIFT');
      }
    } else assertFrozenSnapshotMatches(frozen, state.prepare);
    const offline = offlineReportReader(root, home, commonDirectory,
      state.executionHead || state.prepare.head,
      state.recovery?.value?.recovery?.gate3Analysis?.offlineEpoch || null);
    const expectedOfflineSha = state.recovery ? state.recovery.value.recovery.offlineReportSha256
      : state.prepare.gate3.offlineReportSha256;
    if (offline.reportSha256 !== expectedOfflineSha) throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EVIDENCE_DRIFT');
    const directory = path.resolve(root, buildDirectory || state.prepare.build.diagnosticBuildDirectory);
    const artifact = wasmArtifactReader(path.join(directory, WASM_REL));
    if (artifact.sha256 !== original.wasmSha256 || artifact.size !== state.prepare.build.wasm.size) {
      throw new Error('BLOCKED_CONTACT_LOSS_ORIGINAL_DIAGNOSTIC_WASM_DRIFT');
    }
  } else preparedVerifier(roots, state, {root, home, commonDirectory, buildDirectory});
  const reference = refs || referenceRows({root, home, commonDirectory});
  let baselineScore = null, baselineUnsafe = false, terminalMetricFailure = false;
  const terminalAlphaOrder = expectedTerminal?.status === 'BLOCKED_METRIC_RECOMPUTATION'
    ? (expectedTerminal.charged / 7) - 1 : -1;
  const unsafeTerminalAlphaOrder = expectedTerminal?.status === 'BLOCKED_UNSAFE_CAPTURE'
      && Number.isSafeInteger(expectedTerminal.charged) && expectedTerminal.charged % 7 === 0
    ? (expectedTerminal.charged / 7) - 1 : -1;
  let verifiedAlphaCount = 0;
  if (expectedTerminal?.status === 'BLOCKED_UNSAFE_CAPTURE'
      && (expectedTerminal.charged !== state.charged || expectedTerminal.completed !== state.completed
        || expectedTerminal.ambiguous !== state.ambiguous)) {
    throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_LEDGER_MISMATCH');
  }
  for (let alphaOrder = 0; alphaOrder < core.ALPHAS.length; alphaOrder++) {
    const calls = state.calls.slice(alphaOrder * 7, alphaOrder * 7 + 7);
    if (calls.length !== 7 || calls.some(row => row.status !== 'COMPLETE')) break;
    const stored = readJsonDual(roots, `${EXPERIMENT_REL}/alpha-${String(alphaOrder).padStart(2, '0')}.json`);
    if (alphaOrder === unsafeTerminalAlphaOrder) {
      if (stored) throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_REPORT_UNEXPECTED');
      break;
    }
    if (expectedTerminal?.status === 'BLOCKED_METRIC_RECOMPUTATION' && alphaOrder === terminalAlphaOrder && stored) {
      throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_REPORT_UNEXPECTED');
    }
    let recomputed;
    try {
      recomputed = scoreCompletedAlpha({alphaOrder, calls, refs: reference,
        gainDb: baselineScore?.sharedGainDb ?? null, sourceHead: state.executionHead || state.prepare.head,
        wasmSha256: state.prepare.build.wasm.sha256, epoch: ACTIVE_EPOCH, evaluator});
    } catch {
      if (expectedTerminal?.status === 'BLOCKED_METRIC_RECOMPUTATION'
          && alphaOrder === terminalAlphaOrder && !stored) {
        terminalMetricFailure = true;
        break;
      }
      throw new Error('BLOCKED_CONTACT_LOSS_STORED_METRIC_RECOMPUTATION');
    }
    if (expectedTerminal?.status === 'BLOCKED_METRIC_RECOMPUTATION' && alphaOrder === terminalAlphaOrder) {
      throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_FAILURE_NOT_REPRODUCED');
    }
    if (alphaOrder === 0) {
      try { core.assertBaselineSafe(recomputed); }
      catch { recomputed.status = 'GATE4_BASELINE_UNSAFE'; baselineUnsafe = true; }
      baselineScore = recomputed;
    }
    const relative = `${EXPERIMENT_REL}/alpha-${String(alphaOrder).padStart(2, '0')}.json`;
    if (!stored && createMissingReports) writeDualImmutable(roots, relative, jsonBytes(recomputed));
    else if (!stored) throw new Error(`BLOCKED_CONTACT_LOSS_ALPHA_REPORT_MISSING:alpha-${alphaOrder}`);
    else if (!sameJson(stored.value, recomputed)) throw new Error(`BLOCKED_CONTACT_LOSS_STORED_METRIC_MISMATCH:alpha-${alphaOrder}`);
    verifiedAlphaCount++;
  }
  if (expectedTerminal?.status === 'BLOCKED_METRIC_RECOMPUTATION' && !terminalMetricFailure) {
    throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_FAILURE_NOT_REPRODUCED');
  }
  return {status: 'PASS', verifiedAlphaCount,
    charged: state.charged, completed: state.completed, ambiguous: state.ambiguous, baselineUnsafe,
    terminalMetricFailure};
}

function terminalExpectedRecord(terminal, state) {
  const details = {
    BLOCKED_UNSAFE_CAPTURE: 'FINITE_GUARD_OR_PEAK_GATE',
    BLOCKED_METRIC_RECOMPUTATION: 'OFFICIAL_METRICS_UNVERIFIABLE',
    GATE4_BASELINE_UNSAFE: 'BASELINE_SAFETY_GATE_FAILED'
  };
  const reason = details[terminal?.status];
  if (!reason) throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_STATUS');
  const expected = {epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
    status: terminal.status, reason, charged: state.charged, completed: state.completed,
    ambiguous: state.ambiguous, stage3: 'NOT RUN', stage4: 'NOT RUN'};
  if (!sameJson(terminal, expected)) throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_LEDGER_MISMATCH');
  if (state.ambiguous !== 0 || state.charged !== state.completed || state.charged <= 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_LEDGER_MISMATCH');
  }
  if (terminal.status === 'BLOCKED_UNSAFE_CAPTURE') {
    const unsafe = [];
    for (let index = 0; index < state.charged; index++) {
      const call = state.calls[index];
      if (call?.status !== 'COMPLETE') throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_LEDGER_MISMATCH');
      if (verifyStoredUnsafeCapture(call)) unsafe.push(index);
    }
    if (unsafe.length !== 1 || unsafe[0] !== state.charged - 1) {
      throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_UNSAFE_GATE_NOT_REPRODUCED');
    }
  } else if (terminal.status === 'GATE4_BASELINE_UNSAFE') {
    if (state.charged !== 7 || state.completed !== 7 || state.candidateResults.length !== 1) {
      throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_LEDGER_MISMATCH');
    }
  } else if (state.charged % 7 !== 0 || state.candidateResults.length !== (state.charged / 7) - 1) {
    throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_LEDGER_MISMATCH');
  }
  return expected;
}

function verifyStoredUnsafeCapture(call) {
  const metadata = call.metadata?.value, recorded = metadata?.metrics?.official;
  if (!metadata || !recorded || !Number.isSafeInteger(metadata.guardHits) || metadata.guardHits < 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_MEASURED_METRIC_MISSING');
  }
  const audio = decodeAudio(call.audio.bytes);
  const recomputed = normalizeAnalyzerMetrics(require('./analyze-issue7-physical-identification.cjs')
    .analyze(audio.left, audio.right, call.cell.pitch, SAMPLE_RATE), metadata.guardHits).official;
  const fields = ['finite', 'peakDbfs', 'outputGuardHits'];
  for (const field of fields) {
    if (recomputed[field] !== recorded[field]) throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_MEASURED_METRIC_MISMATCH');
  }
  return recomputed.finite !== true || metadata.guardHits !== 0 || recomputed.peakDbfs >= 0;
}

function verifyExperiment(options = {}) {
  const {root = ROOT, home = os.homedir(), commonDirectory, buildDirectory, archivePath, ownerLock = null,
    parentVerifier = verifyParentExperiment01, preparedVerifier = verifyPreparedCurrent,
    promotedVerifier = verifyPromotedAuthority, promotionSelectionVerifier = verifySelectionAfterPromotion,
    snapshotReader = frozenSourceSnapshot, referenceReader = referenceRows, evaluator = scoreAlpha} = options;
  const roots = resolveRoots({root, home, commonDirectory});
  const parent = parentVerifier({root, home, commonDirectory});
  const state = readExperimentState(roots, {ownerLock});
  if (!state.prepare) return {status: state.status === 'PREFLIGHT_READY' ? 'PREFLIGHT_READY' : 'NOT_PREPARED', epoch: ACTIVE_EPOCH,
    parentEpoch: {status: 'VERIFIED', ...parent.proof, copies: undefined},
    preflightReports: (state.preflightReports || []).map(row => ({head: row.value.head, file: row.file, sha256: row.sha256})),
    charged: 0, completed: 0, ambiguous: 0, writes: 0, renders: 0, acousticCalls: 0};
  if (!sameJson(state.prepare.parentEpoch, parent.proof)) throw new Error('BLOCKED_CONTACT_LOSS_PARENT_PROOF_DRIFT');
  const promotion = readPromotion(roots);
  if (promotion) {
    promotedVerifier({roots, state, root, home, commonDirectory});
    const selectionStored = readJsonDual(roots, `${EXPERIMENT_REL}/selection.json`, {required: true});
    const before = snapshotReader({root, home, commonDirectory});
    const selection = promotionSelectionVerifier({roots, state, selectionStored, root, home, commonDirectory, archivePath,
      parentVerifier, snapshotReader, referenceReader});
    if (selection.status !== selectionStored.value.status) throw new Error('BLOCKED_CONTACT_LOSS_SELECTION_MISMATCH');
    const after = snapshotReader({root, home, commonDirectory});
    if (!sameJson(before, after)) throw new Error('BLOCKED_CONTACT_LOSS_FROZEN_EVIDENCE_CHANGED_DURING_VERIFY');
    return {status: selection.status, epoch: ACTIVE_EPOCH, charged: state.charged, completed: state.completed,
      ambiguous: state.ambiguous, verifiedAlphaCount: 6, selection, promotionSha256: promotion.sha256,
      frozenEvidenceUnchanged: true, writes: 0, renders: 0, acousticCalls: 0};
  }
  const terminal = readJsonDual(roots, `${EXPERIMENT_REL}/terminal.json`);
  if (state.ambiguous && !terminal) return {status: 'BLOCKED_AMBIGUOUS_CALL', charged: state.charged,
    completed: state.completed, ambiguous: state.ambiguous, writes: 0, renders: 0, acousticCalls: 0};
  const before = snapshotReader({root, home, commonDirectory});
  const identity = preparedVerifier(roots, state, {root, home, commonDirectory, buildDirectory});
  let alphaVerification = {baselineUnsafe: false, terminalMetricFailure: false, verifiedAlphaCount: 0};
  if (terminal) terminalExpectedRecord(terminal.value, state);
  const hasCompleteAlpha = Array.from({length: core.ALPHAS.length}, (_, alphaOrder) =>
    state.calls.slice(alphaOrder * 7, alphaOrder * 7 + 7)).some(calls =>
    calls.length === 7 && calls.every(row => row.status === 'COMPLETE'));
  if (hasCompleteAlpha) {
    const refs = referenceReader({root, home, commonDirectory, archivePath});
    alphaVerification = verifyStoredAlphaResults(roots, state, {root, home, commonDirectory,
      buildDirectory, refs, evaluator, expectedTerminal: terminal?.value, preparedVerifier});
  }
  if (terminal?.value.status === 'BLOCKED_METRIC_RECOMPUTATION' && !alphaVerification.terminalMetricFailure) {
    throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_FAILURE_NOT_REPRODUCED');
  }
  if (terminal?.value.status === 'GATE4_BASELINE_UNSAFE' && !alphaVerification.baselineUnsafe) {
    throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_BASELINE_GATE_NOT_REPRODUCED');
  }
  if (terminal && readDual(roots, `${EXPERIMENT_REL}/selection.json`)) {
    throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_SELECTION_CONFLICT');
  }
  let selection = null;
  if (state.completed === 42 && state.charged === 42 && !terminal) {
    if (state.candidateResults.length !== 6) throw new Error('BLOCKED_CONTACT_LOSS_CANDIDATE_REPORT_COUNT');
    const receipt = verifiedReceipt(state, identity), decision = core.selectCandidate(state.candidateResults, {receipt});
    const stored = readJsonDual(roots, `${EXPERIMENT_REL}/selection.json`, {required: true}).value;
  const expected = {schemaVersion: 1, epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
      ...decision, receipt, charged: state.charged, completed: state.completed,
      ambiguous: state.ambiguous, stage3: 'NOT RUN', stage4: 'NOT RUN'};
    if (!sameJson(stored, expected)) throw new Error('BLOCKED_CONTACT_LOSS_SELECTION_MISMATCH');
    selection = decision;
  } else if (readDual(roots, `${EXPERIMENT_REL}/selection.json`)) {
    throw new Error('BLOCKED_CONTACT_LOSS_EARLY_SELECTION');
  }
  const after = snapshotReader({root, home, commonDirectory});
  if (!sameJson(before, after)) throw new Error('BLOCKED_CONTACT_LOSS_FROZEN_EVIDENCE_CHANGED_DURING_VERIFY');
  return {status: terminal?.value.status || selection?.status || 'VERIFIED_IN_PROGRESS', epoch: ACTIVE_EPOCH,
    charged: state.charged, completed: state.completed, ambiguous: state.ambiguous,
    verifiedAlphaCount: alphaVerification.verifiedAlphaCount, selection,
    frozenEvidenceUnchanged: true, writes: 0, renders: 0, acousticCalls: 0};
}

function acceptanceCallId(stage, index, cell) {
  const detail = cell.pattern ? `${cell.pattern}-${cell.role || ''}` : `${cell.kind || 'cell'}-${cell.pitch ?? 'x'}-${cell.velocity ?? 'x'}`;
  return `${stage}-${String(index).padStart(4, '0')}-${detail.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`;
}
function readAcceptanceCalls(roots, stage, cells) {
  const calls = [], baseRoot = `${ACCEPTANCE_ROOT}/${stage}/calls`;
  let gap = false, ambiguous = 0;
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index], id = acceptanceCallId(stage, index, cell), base = `${baseRoot}/${id}`;
    const start = readJsonDual(roots, `${base}/start.json`), complete = readJsonDual(roots, `${base}/complete.json`);
    if (!start) {
      if (complete) throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_LEDGER_GAP');
      gap = true; calls.push({cell, id, status: 'NOT_STARTED'}); continue;
    }
    if (gap || start.value.schemaVersion !== 1 || start.value.epoch !== ACTIVE_EPOCH
        || start.value.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
        || start.value.id !== id || start.value.stage !== stage
        || start.value.callOrder !== index || !sameJson(start.value.cell, cell)
        || !/^[a-f0-9]{40}$/.test(start.value.head || '')
        || !/^[a-f0-9]{64}$/.test(start.value.wasmSha256 || '')
        || !/^[a-f0-9]{64}$/.test(start.value.sourceSnapshotSha256 || '')) {
      throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_START_IDENTITY');
    }
    if (!complete) { ambiguous++; gap = true; calls.push({cell, id, status: 'AMBIGUOUS', start}); continue; }
    const audio = readDual(roots, `${base}/audio.wav`, {required: true});
    const metadata = readJsonDual(roots, `${base}/metadata.json`, {required: true});
    if (complete.value.schemaVersion !== 1 || complete.value.epoch !== ACTIVE_EPOCH
        || complete.value.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
        || complete.value.id !== id || complete.value.stage !== stage
        || complete.value.state !== 'COMPLETE' || complete.value.audioSha256 !== audio.sha256
        || complete.value.metadataSha256 !== metadata.sha256 || metadata.value.id !== id
        || metadata.value.epoch !== ACTIVE_EPOCH || metadata.value.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
        || metadata.value.stage !== stage || metadata.value.callOrder !== index
        || !sameJson(metadata.value.cell, cell) || metadata.value.sourceHead !== start.value.head
        || metadata.value.wasmSha256 !== start.value.wasmSha256
        || metadata.value.sourceSnapshotSha256 !== start.value.sourceSnapshotSha256
        || metadata.value.audioSha256 !== audio.sha256) throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_COMPLETE_IDENTITY');
    calls.push({cell, id, status: 'COMPLETE', start, complete, audio, metadata});
  }
  if (ambiguous) throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_AMBIGUOUS_CALL');
  return {calls, charged: calls.filter(row => row.status !== 'NOT_STARTED').length,
    completed: calls.filter(row => row.status === 'COMPLETE').length, ambiguous};
}
function acceptanceIdentity({root = ROOT, buildDirectory, buildRole = 'diagnostic'} = {}) {
  const local = currentIdentity(root), wasm = syncReadSha(path.join(root, buildDirectory, WASM_REL));
  return {head: local.head, branch: local.branch, sourceSnapshotSha256: sha256(Buffer.from(JSON.stringify(stable(sourceSnapshot(root))))),
    wasmSha256: wasm.sha256, buildRole};
}
function assertAcceptanceIdentityBeforeAfter(before, after) {
  if (before.head !== after.head || before.branch !== after.branch
      || before.sourceSnapshotSha256 !== after.sourceSnapshotSha256
      || before.wasmSha256 !== after.wasmSha256 || before.buildRole !== after.buildRole) {
    throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_IDENTITY_DRIFT');
  }
}
function runAcceptancePlan({roots, stage, cells, identityNow, render, previousAcceptanceCalls = 0,
  ownerLock = null} = {}) {
  if (!Array.isArray(cells) || !cells.length) throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_PLAN_EMPTY');
  let state = readAcceptanceCalls(roots, stage, cells);
  if (state.charged !== state.completed) throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_AMBIGUOUS_CALL');
  for (let index = state.completed; index < cells.length; index++) {
    const cell = cells[index], id = acceptanceCallId(stage, index, cell), base = `${ACCEPTANCE_ROOT}/${stage}/calls/${id}`;
    const identity = identityNow(cell), before = {...identity};
    core.accounting({startedExperimentCalls: combinedExperimentCalls(roots, {ownerLock}),
      startedAcceptanceCalls: previousAcceptanceCalls + index + 1});
    writeDualImmutable(roots, `${base}/start.json`, jsonBytes({schemaVersion: 1, epoch: ACTIVE_EPOCH,
      contractSha256: SUCCESSOR_CONTRACT_SHA256, id, stage, callOrder: index,
      cell, head: identity.head, wasmSha256: identity.wasmSha256,
      sourceSnapshotSha256: identity.sourceSnapshotSha256, buildRole: identity.buildRole,
      state: 'STARTED', startedAt: new Date().toISOString()}));
    let capture;
    try { capture = render(cell, identity); }
    catch { throw new Error(`BLOCKED_CONTACT_LOSS_ACCEPTANCE_AMBIGUOUS_CALL:${stage}:${id}`); }
    let after;
    try { after = identityNow(cell); assertAcceptanceIdentityBeforeAfter(before, after); }
    catch { throw new Error(`BLOCKED_CONTACT_LOSS_ACCEPTANCE_AMBIGUOUS_CALL:${stage}:${id}:IDENTITY_DRIFT`); }
    if (!Buffer.isBuffer(capture?.audio) || !capture.metadata || typeof capture.metadata !== 'object') {
      throw new Error(`BLOCKED_CONTACT_LOSS_ACCEPTANCE_CAPTURE_INVALID:${stage}:${id}`);
    }
    const audioSha256 = sha256(capture.audio), metadata = {...capture.metadata, schemaVersion: 1,
      epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
      id, stage, callOrder: index, cell, sourceHead: identity.head, wasmSha256: identity.wasmSha256,
      sourceSnapshotSha256: identity.sourceSnapshotSha256, buildRole: identity.buildRole, audioSha256,
      completedAt: new Date().toISOString()};
    const metadataBytes = jsonBytes(metadata);
    writeDualImmutable(roots, `${base}/audio.wav`, capture.audio);
    writeDualImmutable(roots, `${base}/metadata.json`, metadataBytes);
    writeDualImmutable(roots, `${base}/complete.json`, jsonBytes({schemaVersion: 1, epoch: ACTIVE_EPOCH,
      contractSha256: SUCCESSOR_CONTRACT_SHA256, id, stage, state: 'COMPLETE',
      audioSha256, metadataSha256: sha256(metadataBytes), completedAt: metadata.completedAt}));
    state = readAcceptanceCalls(roots, stage, cells);
  }
  if (state.charged !== cells.length || state.completed !== cells.length || state.ambiguous !== 0) {
    throw new Error(`BLOCKED_CONTACT_LOSS_ACCEPTANCE_INCOMPLETE:${stage}`);
  }
  return state;
}
function recordAcceptanceReport(roots, stage, report, {persist = true} = {}) {
  const boundReport = {...report, epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256};
  const relative = `${ACCEPTANCE_ROOT}/${stage}/report.json`, bytes = jsonBytes(boundReport), existing = readJsonDual(roots, relative);
  if (existing && !existing.bytes.equals(bytes)) throw new Error(`BLOCKED_CONTACT_LOSS_ACCEPTANCE_REPORT_CONFLICT:${stage}`);
  if (!existing && !persist) throw new Error(`BLOCKED_CONTACT_LOSS_ACCEPTANCE_REPORT_MISSING:${stage}`);
  if (!existing) writeDualImmutable(roots, relative, bytes);
  return {report: boundReport, sha256: sha256(bytes), status: existing ? (persist ? 'REUSED' : 'VERIFIED') : 'CREATED'};
}

function referenceMetricsForCells(root, cells) {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'), 'utf8'));
  const byKey = new Map((fixture.directCells || []).map(row => [`${row.pitch}:${row.velocity}`, row]));
  const rows = cells.map(cell => {
    const row = byKey.get(`${cell.pitch}:${cell.velocity}`);
    if (!row?.metrics) throw new Error('BLOCKED_CONTACT_LOSS_REFERENCE_METRIC_CELL_MISSING');
    return {pitch: cell.pitch, velocity: cell.velocity, metrics: row.metrics};
  });
  return {fixture, rows, fixtureSha256: sha256(fs.readFileSync(path.join(root,
    'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json')))};
}
function confirmationReport(roots, root, selectedAlpha, {persist = true} = {}) {
  const cells = core.CONFIRMATION_CELLS.map((cell, index) => ({kind: 'confirmation', ...cell, cellOrder: index,
    alpha: selectedAlpha, alphaOrder: core.alphaIndex(selectedAlpha)}));
  const calls = readAcceptanceCalls(roots, 'confirmation', cells);
  const {fixtureSha256, rows: refs} = referenceMetricsForCells(root, cells);
  const actual = calls.calls.map(call => ({pitch: call.cell.pitch, velocity: call.cell.velocity,
    metrics: call.metadata.value.metrics}));
  const direct = require('./stage3-direct-reference-metrics.cjs');
  const official = direct.evaluateDirectReferenceMatrix(refs, actual, {requiredVelocityLayers: CONFIRMATION_LAYERS});
  const m = official.metrics;
  const pass = m.cellFailureCount === 0 && m.directPitchFailureCount === 0 && m.finite === true
    && m.guardHitTotal === 0 && m.peakWorstDbfs < 0 && m.dynamicSpan.failingPitchCount === 0
    && m.brightnessDirection.failingPitchCount === 0;
  const report = {schemaVersion: 1, gate: 'CONFIRMATION', decision: pass ? 'CONFIRMATION_PASS' : 'BLOCKED_CONFIRMATION_FAIL',
    pass, alpha: selectedAlpha, calls: calls.completed, callIds: calls.calls.map(call => call.id),
    audioSha256: calls.calls.map(call => call.audio.sha256), metadataSha256: calls.calls.map(call => call.metadata.sha256),
    referenceFixtureSha256: fixtureSha256, official};
  return recordAcceptanceReport(roots, 'confirmation', report, {persist});
}
function renderHeadroomCall({root = ROOT, buildDirectory, cell} = {}) {
  const {PluginHarness} = require('../../../../../test/helpers/plugin-harness.cjs');
  const build = path.resolve(root, buildDirectory), oldBuild = process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR = build;
  let harness;
  try {
    harness = new PluginHarness(root, WASM_REL, {sampleRate: SAMPLE_RATE, maxFrames: BLOCK_FRAMES});
    harness.applyPreset('concert_grand');
    for (const [name, value] of [['voice_drift', 0], ['lfo1_pitch', 0], ['chorus_mix', 0], ['engine_model', 'concert_grand']]) harness.setPlain(name, value);
    const alpha = cell.role === 'baseline' ? 1 : cell.alpha;
    const setter = harness.e.soraoto_supersynth_contact_loss_set;
    if (typeof setter !== 'function' || (setter(alpha) | 0) !== 0
        || Math.abs(harness.e.soraoto_supersynth_contact_loss_get() - alpha) > 1e-6) throw new Error('BLOCKED_CONTACT_LOSS_HEADROOM_SETTER');
    const pitches = cell.pattern === 'open-c-major-nine' ? [48, 55, 60, 64, 67, 71, 74, 76, 79, 84]
      : Array.from({length: 32}, (_, index) => 48 + index);
    const left = new Float32Array(96000), right = new Float32Array(96000), callbackMs = [];
    const guardStart = harness.e.soraoto_supersynth_guard_hit_count(); let finite = true, peak = 0;
    for (let position = 0; position < left.length; position += BLOCK_FRAMES) {
      const count = Math.min(BLOCK_FRAMES, left.length - position);
      const events = position === 0 ? pitches.map((pitch, index) => ({kind: 1, noteId: index + 1, pitch, velocity: 124 / 127, offset: 0})) : [];
      const started = performance.now(), output = harness.process(count, {events})[0];
      callbackMs.push(performance.now() - started); left.set(output[0], position); right.set(output[1], position);
      for (let i = 0; i < count; i++) { const l = output[0][i], r = output[1][i];
        if (!Number.isFinite(l) || !Number.isFinite(r)) finite = false;
        peak = Math.max(peak, Math.abs(l), Math.abs(r));
      }
    }
    const guardHits = harness.e.soraoto_supersynth_guard_hit_count() - guardStart;
    return {audio: writeFloatWav(left, right), metadata: {metrics: {finite, peak, peakDbfs: peak ? 20 * Math.log10(peak) : -240,
      guardHits, maxCallbackMs: Math.max(...callbackMs), callbackMs}, role: cell.role, pattern: cell.pattern, alpha}};
  } finally { try { harness?.close(); } finally {
    if (oldBuild === undefined) delete process.env.SORAOTO_WASM_BUILD_DIR; else process.env.SORAOTO_WASM_BUILD_DIR = oldBuild;
  } }
}
function headroomReport(roots, selectedAlpha, {persist = true} = {}) {
  const cells = core.HEADROOM_CELLS.map(cell => ({...cell, kind: 'headroom', alpha: cell.role === 'baseline' ? 1 : selectedAlpha}));
  const calls = readAcceptanceCalls(roots, 'headroom', cells), byPattern = new Map();
  for (const call of calls.calls) {
    const pair = byPattern.get(call.cell.pattern) || {};
    pair[call.cell.role] = call.metadata.value.metrics; byPattern.set(call.cell.pattern, pair);
  }
  const rows = [...byPattern.entries()].map(([pattern, pair]) => {
    const baseline = pair.baseline, candidate = pair.candidate;
    if (!baseline || !candidate) throw new Error('BLOCKED_CONTACT_LOSS_HEADROOM_PAIR_MISSING');
    const peakIncreaseDb = candidate.peakDbfs - baseline.peakDbfs;
    const pass = baseline.finite && candidate.finite && baseline.guardHits === 0 && candidate.guardHits === 0
      && baseline.peakDbfs < 0 && candidate.peakDbfs < 0 && peakIncreaseDb <= 0.1
      && baseline.maxCallbackMs < 2.667 && candidate.maxCallbackMs < 2.667;
    return {pattern, baselinePeakDbfs: baseline.peakDbfs, candidatePeakDbfs: candidate.peakDbfs,
      peakIncreaseDb, baselineMaxCallbackMs: baseline.maxCallbackMs, candidateMaxCallbackMs: candidate.maxCallbackMs,
      baselineGuardHits: baseline.guardHits, candidateGuardHits: candidate.guardHits, pass};
  });
  const pass = rows.length === 2 && rows.every(row => row.pass);
  const report = {schemaVersion: 1, gate: 'HEADROOM', decision: pass ? 'HEADROOM_PASS' : 'BLOCKED_HEADROOM_FAIL',
    pass, alpha: selectedAlpha, calls: calls.completed, rows};
  return recordAcceptanceReport(roots, 'headroom', report, {persist});
}
const PROMOTION_PATHS = Object.freeze(['wasm/plugins/dsp/super-synth/presets.json',
  'wasm/shared/generated/super-synth_grand_profiles.h'].sort());
function commitParent(root, commit) { return git(root, ['rev-parse', `${commit}^`]); }
function commitChangedPaths(root, commit) {
  return git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--no-renames', commit])
    .split(/\r?\n/).filter(Boolean).sort();
}
function promoteProfileBytes(originalBytes, alpha) {
  const originalText = originalBytes.toString('utf8'), start = originalText.indexOf('"concert_grand"');
  if (start < 0) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_PRESET_MISSING');
  const nextPreset = originalText.indexOf('\n  "', start + 1);
  const end = nextPreset < 0 ? originalText.length : nextPreset;
  let section = originalText.slice(start, end);
  const soft = Number((0.08 * alpha).toFixed(8)), hard = Number((0.28 * alpha).toFixed(8));
  let softCount = 0, hardCount = 0;
  section = section.replace(/("contact_loss_soft"\s*:\s*)[-+0-9.eE]+/g, (_match, prefix) => { softCount++; return `${prefix}${soft}`; });
  section = section.replace(/("contact_loss_hard"\s*:\s*)[-+0-9.eE]+/g, (_match, prefix) => { hardCount++; return `${prefix}${hard}`; });
  if (softCount !== 1 || hardCount !== 1) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_PROFILE_SHAPE');
  const newText = originalText.slice(0, start) + section + originalText.slice(end), before = JSON.parse(originalText), after = JSON.parse(newText);
  const expected = JSON.parse(JSON.stringify(before));
  expected.concert_grand.engine_config.hammer.contact_loss_soft = soft;
  expected.concert_grand.engine_config.hammer.contact_loss_hard = hard;
  if (!sameJson(after, expected)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_UNRELATED_PRESET_DRIFT');
  return {bytes: Buffer.from(newText), soft, hard};
}
function assertPromotionCommit({root = ROOT, prepare, selectedAlpha, expectedHead} = {}) {
  const parent = commitParent(root, expectedHead), paths = commitChangedPaths(root, expectedHead);
  if (parent !== prepare.head || !sameJson(paths, PROMOTION_PATHS)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_COMMIT_IDENTITY');
  const presetText = gitBytes(root, ['show', `${expectedHead}:wasm/plugins/dsp/super-synth/presets.json`]).toString('utf8');
  const promoted = JSON.parse(presetText), expectedSoft = Number((0.08 * selectedAlpha).toFixed(8)),
    expectedHard = Number((0.28 * selectedAlpha).toFixed(8));
  if (promoted.concert_grand?.engine_config?.hammer?.contact_loss_soft !== expectedSoft
      || promoted.concert_grand?.engine_config?.hammer?.contact_loss_hard !== expectedHard) {
    throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_COMMIT_VALUES');
  }
  for (const relative of PROMOTION_PATHS) {
    const committed = gitBytes(root, ['show', `${expectedHead}:${relative}`]);
    if (!committed.equals(fs.readFileSync(path.join(root, relative)))) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_COMMIT_WORKTREE_MISMATCH');
  }
  return {parent, paths, expectedSoft, expectedHard, tree: git(root, ['rev-parse', `${expectedHead}^{tree}`])};
}
function readPromotion(roots) {
  const stored = readJsonDual(roots, `${ACCEPTANCE_ROOT}/promotion.json`);
  return stored ? {value: stored.value, sha256: stored.sha256} : null;
}
function verifyPromotedAuthority({roots, state, root = ROOT, home = os.homedir(), commonDirectory,
  pullRequestVerifier = verifiedPullRequest, issueApprovalVerifier = verifyIssueApproval,
  offlineReportReader = latestOfflineReport, snapshotReader = frozenSourceSnapshot,
  sourceSnapshotReader = sourceSnapshot} = {}) {
  const promotion = readPromotion(roots);
  if (!promotion) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_RECEIPT_MISSING');
  const record = promotion.value, identity = currentIdentity(root);
  const preparedIdentity = executionPreparation(state);
  const selection = readJsonDual(roots, `${EXPERIMENT_REL}/selection.json`, {required: true}).value;
  const selectedAlpha = selection.selected?.alpha;
  const identityChecks = {
    schema: record.schemaVersion === 2 && record.epoch === ACTIVE_EPOCH && record.contractSha256 === SUCCESSOR_CONTRACT_SHA256,
    head: identity.head === record.head && [PR_BRANCH, LOCAL_WORKTREE_BRANCH].includes(identity.branch),
    parent: record.parentHead === preparedIdentity.head && commitParent(root, record.head) === record.parentHead,
    selection: record.selectionSha256 === readDual(roots, `${EXPERIMENT_REL}/selection.json`, {required: true}).sha256,
    recordPaths: sameJson(record.changedPaths, PROMOTION_PATHS),
    commitPaths: sameJson(commitChangedPaths(root, record.head), PROMOTION_PATHS),
    tree: git(root, ['rev-parse', `${record.head}^{tree}`]) === record.tree
  };
  const failedIdentityChecks = Object.entries(identityChecks).filter(([, pass]) => !pass).map(([name]) => name);
  if (failedIdentityChecks.length) throw new Error(`BLOCKED_CONTACT_LOSS_PROMOTION_IDENTITY:${failedIdentityChecks.join(',')}`);
  if (!core.ALPHAS.includes(selectedAlpha)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_SELECTION');
  const commit = assertPromotionCommit({root, prepare: preparedIdentity, selectedAlpha, expectedHead: record.head});
  if (commit.tree !== record.tree || record.values?.contact_loss_soft !== commit.expectedSoft
      || record.values?.contact_loss_hard !== commit.expectedHard
      || !sameJson(record.sourceBefore, preparedIdentity.source)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_VALUES');
  pullRequestVerifier(root, identity.head); issueApprovalVerifier(root);
  const currentSources = sourceSnapshotReader(root);
  if (!sameJson(currentSources, record.sourceAfter)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_SOURCE_DRIFT');
  for (const relative of SOURCE_FILES) {
    if (!PROMOTION_PATHS.includes(relative) && !sameJson(record.sourceBefore[relative], record.sourceAfter[relative])) {
      throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_CHANGED_UNAUTHORIZED_SOURCE');
    }
  }
  const priorOffline = offlineReportReader(root, home, commonDirectory, preparedIdentity.head);
  if (priorOffline.reportSha256 !== preparedIdentity.gate3.offlineReportSha256) throw new Error('BLOCKED_CONTACT_LOSS_OFFLINE_EVIDENCE_DRIFT');
  const frozen = snapshotReader({root, home, commonDirectory});
  if (state.recovery) {
    if (!sameJson(frozen, state.recovery.value.recovery.frozenEvidenceSnapshot)
        || frozenSnapshotSha256(frozen) !== state.recovery.value.recovery.frozenSnapshotSha256) {
      throw new Error('BLOCKED_CONTACT_LOSS_RECOVERY_FROZEN_EVIDENCE_DRIFT');
    }
  } else assertFrozenSnapshotMatches(frozen, state.prepare);
  return {...identity, promotion: record, promotionSha256: promotion.sha256};
}
function promoteSelected({roots, state, selection, root = ROOT} = {}) {
  const preparedIdentity = executionPreparation(state);
  const existing = readPromotion(roots);
  if (existing) return verifyPromotedAuthority({roots, state, root});
  const beforeIdentity = currentIdentity(root);
  if (beforeIdentity.head !== preparedIdentity.head) {
    const recovery = assertPromotionCommit({root, prepare: preparedIdentity, selectedAlpha: selection.selected.alpha,
      expectedHead: beforeIdentity.head});
    if (![PR_BRANCH, LOCAL_WORKTREE_BRANCH].includes(beforeIdentity.branch)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_RECOVERY_BRANCH');
    const sourceAfter = sourceSnapshot(root);
    for (const relative of SOURCE_FILES) {
      if (!PROMOTION_PATHS.includes(relative) && !sameJson(sourceAfter[relative], preparedIdentity.source[relative])) {
        throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_RECOVERY_SOURCE_DRIFT');
      }
    }
    for (const relative of PROMOTION_PATHS) {
      const parentBytes = gitBytes(root, ['show', `${preparedIdentity.head}:${relative}`]);
      const parentSnapshot = preparedIdentity.source[relative];
      if (sha256(parentBytes) !== parentSnapshot.sha256 || parentBytes.length !== parentSnapshot.size) {
        throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_RECOVERY_PARENT_MISMATCH');
      }
    }
    verifyIssueApproval(root);
    const remote = JSON.parse(github(['pr', 'view', String(PR_NUMBER), '--repo', REPOSITORY,
      '--json', 'state,number,headRefName,headRefOid,baseRefName,url'], {cwd: root}));
    if (remote.state !== 'OPEN' || remote.number !== PR_NUMBER || remote.headRefName !== PR_BRANCH
        || remote.baseRefName !== 'main' || remote.url !== PR_URL
        || ![preparedIdentity.head, beforeIdentity.head].includes(remote.headRefOid)) {
      throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_RECOVERY_REMOTE_HEAD');
    }
    if (remote.headRefOid === preparedIdentity.head) {
      runBuildCommand(root, ['git', 'push', 'origin', `HEAD:refs/heads/${PR_BRANCH}`], 'BLOCKED_CONTACT_LOSS_PROMOTION_PUSH');
    }
    const pushedIdentity = currentIdentity(root); verifiedPullRequest(root, pushedIdentity.head);
    if (pushedIdentity.head !== beforeIdentity.head) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_HEAD_READBACK');
    const record = {schemaVersion: 2, issue: 7, pr: 8, epoch: ACTIVE_EPOCH,
      contractSha256: SUCCESSOR_CONTRACT_SHA256,
      selectionSha256: readDual(roots, `${EXPERIMENT_REL}/selection.json`, {required: true}).sha256,
      alpha: selection.selected.alpha, parentHead: preparedIdentity.head, head: beforeIdentity.head, tree: recovery.tree,
      changedPaths: PROMOTION_PATHS, sourceBefore: preparedIdentity.source, sourceAfter,
      values: {contact_loss_soft: recovery.expectedSoft, contact_loss_hard: recovery.expectedHard},
      remoteReadback: {state: 'OPEN', branch: PR_BRANCH, head: pushedIdentity.head}, recoveredAfterCommit: true,
      createdAt: new Date().toISOString()};
    writeDualImmutable(roots, `${ACCEPTANCE_ROOT}/promotion.json`, jsonBytes(record));
    return verifyPromotedAuthority({roots, state, root});
  }
  if (![PR_BRANCH, LOCAL_WORKTREE_BRANCH].includes(beforeIdentity.branch)) {
    throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_PARENT_HEAD');
  }
  verifiedPullRequest(root, beforeIdentity.head); verifyIssueApproval(root);
  const sourceBefore = sourceSnapshot(root);
  if (!sameJson(sourceBefore, preparedIdentity.source)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_SOURCE_DRIFT');
  const presetPath = path.join(root, 'wasm/plugins/dsp/super-synth/presets.json'), original = fs.readFileSync(presetPath);
  const update = promoteProfileBytes(original, selection.selected.alpha);
  const status = git(root, ['status', '--porcelain=v2', '--untracked-files=all']);
  const statusLines = status.split(/\r?\n/).filter(line => line && !line.startsWith('# '));
  const changed = statusLines.map(line => line.slice(3).split(' -> ').at(-1)).sort();
  if (statusLines.length && !sameJson(changed, PROMOTION_PATHS)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_DIRTY_WORKTREE');
  if (!statusLines.length) fs.writeFileSync(presetPath, update.bytes);
  const generatorOutput = path.join(os.tmpdir(), 'issue7-contact-loss-v1-metadata');
  const generated = spawnSync('rtk', ['python3', 'wasm/cmake/generate_plugin_metadata.py', generatorOutput],
    {cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
  if (generated.error || generated.status !== 0) throw new Error('BLOCKED_CONTACT_LOSS_METADATA_GENERATION');
  const currentStatus = git(root, ['status', '--porcelain=v2', '--untracked-files=all']);
  const dirty = currentStatus.split(/\r?\n/).filter(line => line && !line.startsWith('# '));
  const changedNow = dirty.map(line => line.slice(3).split(' -> ').at(-1)).sort();
  if (!sameJson(changedNow, PROMOTION_PATHS)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_PATH_SET');
  const prospectiveHead = git(root, ['rev-parse', 'HEAD']);
  let head = prospectiveHead;
  if (sameJson(commitChangedPaths(root, prospectiveHead), PROMOTION_PATHS)
      && commitParent(root, prospectiveHead) === preparedIdentity.head) {
    // A prior invocation may have committed before its push or receipt write.
  } else {
    git(root, ['add', '--', ...PROMOTION_PATHS]);
    git(root, ['commit', '-m', 'issue7: promote measured contact-loss alpha']);
    head = git(root, ['rev-parse', 'HEAD']);
  }
  const verified = assertPromotionCommit({root, prepare: preparedIdentity, selectedAlpha: selection.selected.alpha, expectedHead: head});
  const pushed = spawnSync('rtk', ['git', 'push', 'origin', `HEAD:refs/heads/${PR_BRANCH}`],
    {cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
  if (pushed.error || pushed.status !== 0) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_PUSH');
  const local = currentIdentity(root); verifiedPullRequest(root, local.head);
  if (local.head !== head) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_HEAD_READBACK');
  const sourceAfter = sourceSnapshot(root), record = {schemaVersion: 2, issue: 7, pr: 8,
    epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
    selectionSha256: readDual(roots, `${EXPERIMENT_REL}/selection.json`, {required: true}).sha256,
    alpha: selection.selected.alpha, parentHead: preparedIdentity.head, head, tree: verified.tree,
    changedPaths: PROMOTION_PATHS, sourceBefore, sourceAfter,
    values: {contact_loss_soft: verified.expectedSoft, contact_loss_hard: verified.expectedHard},
    remoteReadback: {state: 'OPEN', branch: PR_BRANCH, head: local.head}, createdAt: new Date().toISOString()};
  writeDualImmutable(roots, `${ACCEPTANCE_ROOT}/promotion.json`, jsonBytes(record));
  return verifyPromotedAuthority({roots, state, root});
}

function runBuildCommand(root, args, code) {
  const result = spawnSync('rtk', args, {cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  if (result.error || result.status !== 0) throw new Error(code);
  return {status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim()};
}
function buildPromotedPair({root = ROOT} = {}) {
  const toolchain = path.join(root, 'wasm/cmake/wasm32-clang.cmake');
  const configs = [
    {role: 'test', directory: 'build/wasm-contact-loss-promoted-test', testing: 'ON', guards: 'ON'},
    {role: 'release', directory: 'build/wasm-contact-loss-promoted-release', testing: 'OFF', guards: 'OFF'}
  ];
  const builds = {};
  for (const config of configs) {
    const absolute = path.join(root, config.directory);
    runBuildCommand(root, ['cmake', '-S', path.join(root, 'wasm'), '-B', absolute,
      `-DCMAKE_TOOLCHAIN_FILE=${toolchain}`, `-DBUILD_TESTING=${config.testing}`,
      `-DSORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=${config.guards}`,
      '-DSORAOTO_SUPERSYNTH_CONTACT_LOSS_DIAGNOSTICS=OFF',
      '-DSORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS=OFF'], 'BLOCKED_CONTACT_LOSS_PROMOTED_CMAKE_CONFIGURE');
    runBuildCommand(root, ['cmake', '--build', absolute, '--parallel'], 'BLOCKED_CONTACT_LOSS_PROMOTED_CMAKE_BUILD');
    const cache = fs.readFileSync(path.join(absolute, 'CMakeCache.txt'), 'utf8');
    const option = (name, value) => new RegExp(`^${name}:BOOL=${value}$`, 'm').test(cache);
    if (!option('BUILD_TESTING', config.testing) || !option('SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS', config.guards)
        || !option('SORAOTO_SUPERSYNTH_CONTACT_LOSS_DIAGNOSTICS', 'OFF')
        || !option('SORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS', 'OFF')) {
      throw new Error('BLOCKED_CONTACT_LOSS_PROMOTED_BUILD_OPTIONS');
    }
    const wasmPath = path.join(absolute, WASM_REL), wasm = syncReadSha(wasmPath);
    const exports = WebAssembly.Module.exports(new WebAssembly.Module(wasm.bytes)).map(row => row.name);
    if (!exports.includes('soraoto_plugin_process') || !exports.includes('soraoto_plugin_init')) {
      throw new Error('BLOCKED_CONTACT_LOSS_PROMOTED_BUILD_EXPORTS');
    }
    if (config.guards === 'ON') {
      for (const name of ['soraoto_supersynth_guard_hit_count', 'soraoto_supersynth_active_voice_count']) {
        if (!exports.includes(name)) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTED_BUILD_EXPORTS');
      }
    } else if (exports.includes('soraoto_supersynth_guard_hit_count')
        || exports.includes('soraoto_supersynth_active_voice_count')) {
      throw new Error('BLOCKED_CONTACT_LOSS_RELEASE_EXPORTS');
    }
    if (exports.some(name => name.startsWith('soraoto_supersynth_contact_loss_'))) {
      throw new Error('BLOCKED_CONTACT_LOSS_PROMOTED_BUILD_EXPOSES_TEST_SETTER');
    }
    builds[config.role] = {directory: config.directory, wasmSha256: wasm.sha256, wasmSize: wasm.size,
      cacheSha256: sha256(fs.readFileSync(path.join(absolute, 'CMakeCache.txt'))), exports: exports.sort()};
  }
  return builds;
}
function assertCurrentAcceptanceIdentity({root = ROOT, buildDirectory, buildRole} = {}) {
  const identity = acceptanceIdentity({root, buildDirectory, buildRole});
  if (![PR_BRANCH, LOCAL_WORKTREE_BRANCH].includes(identity.branch)) throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_BRANCH');
  verifiedPullRequest(root, identity.head);
  verifyIssueApproval(root);
  return identity;
}
function withWasmBuild(root, buildDirectory, callback) {
  const key = 'SORAOTO_WASM_BUILD_DIR', prior = process.env[key];
  process.env[key] = path.resolve(root, buildDirectory);
  try { return callback(); }
  finally { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; }
}
function renderPromotedCell({root = ROOT, buildDirectory, cell} = {}) {
  const capture = require('./capture-supersynth-matrix.cjs');
  const result = withWasmBuild(root, buildDirectory, () => capture.renderNormalized(cell.pitch,
    cell.velocity / 127, {}, {returnSamples: true}));
  return {audio: writeFloatWav(result.left, result.right), metadata: {pitch: cell.pitch, velocity: cell.velocity,
    metrics: result.metrics, finite: result.metrics.finite, guardHits: result.metrics.outputGuardHits ?? 0}};
}
function renderReleaseCell({root = ROOT, buildDirectory, cell} = {}) {
  const {PluginHarness} = require('../../../../../test/helpers/plugin-harness.cjs');
  const absolute = path.resolve(root, buildDirectory), prior = process.env.SORAOTO_WASM_BUILD_DIR;
  process.env.SORAOTO_WASM_BUILD_DIR = absolute;
  let harness;
  try {
    harness = new PluginHarness(root, WASM_REL, {sampleRate: SAMPLE_RATE, maxFrames: BLOCK_FRAMES});
    harness.applyPreset('concert_grand');
    for (const [name, value] of [['engine_model', 'concert_grand'], ['voice_drift', 0], ['lfo1_pitch', 0], ['chorus_mix', 0]]) harness.setPlain(name, value);
    const pitches = cell.kind === 'chord' ? cell.pitches : [cell.pitch];
    const velocity = cell.kind === 'chord' ? cell.velocity : cell.velocity;
    const left = new Float32Array(RENDER_FRAMES), right = new Float32Array(RENDER_FRAMES);
    const guardStart = typeof harness.e.soraoto_supersynth_guard_hit_count === 'function'
      ? harness.e.soraoto_supersynth_guard_hit_count() : null;
    let finite = true, peak = 0;
    for (let position = 0; position < RENDER_FRAMES; position += BLOCK_FRAMES) {
      const count = Math.min(BLOCK_FRAMES, RENDER_FRAMES - position);
      const events = position === 0 ? pitches.map((pitch, index) => ({kind: 1, noteId: index + 1,
        pitch, velocity: velocity / 127, offset: 0})) : [];
      const output = harness.process(count, {events})[0]; left.set(output[0], position); right.set(output[1], position);
      for (let frame = 0; frame < count; frame++) {
        if (!Number.isFinite(output[0][frame]) || !Number.isFinite(output[1][frame])) finite = false;
        peak = Math.max(peak, Math.abs(output[0][frame]), Math.abs(output[1][frame]));
      }
    }
    const guardHits = guardStart === null ? null : harness.e.soraoto_supersynth_guard_hit_count() - guardStart;
    return {audio: writeFloatWav(left, right), metadata: {finite, peak, peakDbfs: peak ? 20 * Math.log10(peak) : -240, guardHits}};
  } finally {
    try { harness?.close(); }
    finally { if (prior === undefined) delete process.env.SORAOTO_WASM_BUILD_DIR; else process.env.SORAOTO_WASM_BUILD_DIR = prior; }
  }
}
function releaseEquivalenceReport(roots, {persist = true} = {}) {
  const cells = core.RELEASE_CELLS, test = readAcceptanceCalls(roots, 'release-test', cells), release = readAcceptanceCalls(roots, 'release-production', cells);
  const loss = require('./physical-fit-v4-loss.cjs'), rows = cells.map((cell, index) => {
    const testCall = test.calls[index], releaseCall = release.calls[index];
    const a = loss.decodeFloat32StereoWav(testCall.audio.bytes), b = loss.decodeFloat32StereoWav(releaseCall.audio.bytes);
    if (a.left.length !== b.left.length || a.right.length !== b.right.length) {
      return {cell, pass: false, reason: 'PCM_LENGTH_MISMATCH', maximumAbsoluteDifference: null};
    }
    let maximumAbsoluteDifference = 0;
    for (let i = 0; i < a.left.length; i++) {
      maximumAbsoluteDifference = Math.max(maximumAbsoluteDifference, Math.abs(a.left[i] - b.left[i]), Math.abs(a.right[i] - b.right[i]));
    }
    const testMetrics = testCall.metadata.value.metrics, releaseMetrics = releaseCall.metadata.value.metrics;
    const pass = maximumAbsoluteDifference <= 1e-6 && testMetrics.finite === true && releaseMetrics.finite === true
      && testMetrics.guardHits === 0 && releaseMetrics.guardHits === null
      && Number.isFinite(testMetrics.peakDbfs) && testMetrics.peakDbfs < 0
      && Number.isFinite(releaseMetrics.peakDbfs) && releaseMetrics.peakDbfs < 0;
    return {cell, pass, maximumAbsoluteDifference,
      testAudioSha256: testCall.audio.sha256, releaseAudioSha256: releaseCall.audio.sha256};
  });
  const pass = rows.length === 12 && rows.every(row => row.pass);
  return recordAcceptanceReport(roots, 'release-equivalence', {schemaVersion: 1, gate: 'RELEASE_EQUIVALENCE',
    decision: pass ? 'RELEASE_EQUIVALENCE_PASS' : 'BLOCKED_RELEASE_EQUIVALENCE_FAIL', pass, calls: 24,
    maximumAbsoluteDifference: Math.max(...rows.map(row => row.maximumAbsoluteDifference || 0)), rows}, {persist});
}
function stage3Cells() {
  const recovery = require('./run-stage3-production-recovery.cjs');
  if (recovery.CELL_SPECS.length !== 486) throw new Error('BLOCKED_CONTACT_LOSS_STAGE3_CELL_SET');
  return recovery.CELL_SPECS.map(cell => ({...cell}));
}
function stage3Report(roots, root, stage3WasmBuild, acceptanceOffset, {persist = true, ownerLock = null} = {}) {
  const recovery = require('./run-stage3-production-recovery.cjs'), direct = require('./run-stage3-direct-reference.cjs');
  const cells = stage3Cells(), calls = readAcceptanceCalls(roots, 'stage3', cells);
  const fixtureBytes = fs.readFileSync(path.join(root, 'wasm/plugins/dsp/super-synth/test/reference/salamander-grand-piano-v3-metrics.json'));
  const fixture = JSON.parse(fixtureBytes.toString('utf8')); direct.validateReferenceFixture(fixture);
  const rows = calls.calls.map(call => ({cell: call.cell, pitch: call.cell.pitch, velocity: call.cell.velocity,
    metrics: call.metadata.value.metrics}));
  const directRows = rows.filter(row => row.cell.kind === 'direct').map(row => ({pitch: row.pitch, velocity: row.velocity, metrics: row.metrics}));
  const sentinelRows = rows.filter(row => row.cell.kind === 'sentinel').map(row => ({pitch: row.pitch, velocity: row.velocity, metrics: row.metrics}));
  const evaluated = direct.evaluateDirect(fixture, {matrix: directRows});
  const byKey = new Map(directRows.map(row => [`${row.pitch}:${row.velocity}`, row]));
  const sentinels = sentinelRows.map(row => ({pitch: row.pitch, velocity: row.velocity,
    ...direct.compareSentinelMetrics(byKey.get(`${row.pitch}:${row.velocity}`), row)}));
  const directPass = evaluated.pass && evaluated.direct.coverage.cells === 480
    && evaluated.counts.dynamicSpanFailingPitches === 0 && evaluated.counts.brightnessDirectionFailingPitches === 0
    && evaluated.direct.metrics.guardHitTotal === 0 && evaluated.direct.metrics.finite === true
    && evaluated.direct.metrics.peakWorstDbfs < 0;
  const pass = calls.completed === 486 && calls.charged === 486 && directPass && sentinels.length === 6 && sentinels.every(row => row.pass);
  const decision = pass ? 'STAGE3_READY_FOR_STAGE4' : 'BLOCKED_STAGE3_ACCEPTANCE_FAIL';
  const result = {schemaVersion: 1, gate: 'STAGE3', decision, pass, sourceHead: currentIdentity(root).head,
    build: {directory: stage3WasmBuild.directory, wasmSha256: stage3WasmBuild.wasmSha256},
    calls: calls.completed, fixtureSha256: sha256(fixtureBytes), coverage: {directCells: directRows.length,
      sentinels: sentinelRows.length, total: rows.length}, direct: {pass: directPass, counts: evaluated.counts,
      metrics: evaluated.direct.metrics, diagnostics: evaluated.diagnostics}, sentinels,
    rows: rows.map(row => ({cell: row.cell, metrics: row.metrics})),
    accounting: core.accounting({startedExperimentCalls: combinedExperimentCalls(roots, {ownerLock}),
      startedAcceptanceCalls: acceptanceOffset + calls.charged})};
  return recordAcceptanceReport(roots, 'stage3', result, {persist});
}
function runLegacyStage4Conformance(root, document) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'issue7-contact-loss-stage4-'));
  const matrixPath = path.join(temporary, 'lifecycle.json');
  try {
    fs.writeFileSync(matrixPath, JSON.stringify(document));
    const evaluator = require('./stage4-full-range-evaluator.cjs');
    const result = spawnSync('rtk', ['node', evaluator.LEGACY_TEST], {cwd: root, encoding: 'utf8',
      env: {...process.env, SUPERSYNTH_LIFECYCLE_PATH: matrixPath, SUPERSYNTH_REPORT_DIR: ''}, maxBuffer: 8 * 1024 * 1024});
    return {pass: result.status === 0, status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim()};
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
}
function renderLifecycleWithAudio({root = ROOT, buildDirectory, cell} = {}) {
  const {PluginHarness} = require('../../../../../test/helpers/plugin-harness.cjs');
  const capture = require('./capture-supersynth-stage4-lifecycle.cjs');
  const metricsModule = require('./salamander-metrics.cjs'), pitchModule = require('./piano-pitch-estimator.cjs');
  const prior = process.env.SORAOTO_WASM_BUILD_DIR; process.env.SORAOTO_WASM_BUILD_DIR = path.resolve(root, buildDirectory);
  let harness;
  try {
    harness = new PluginHarness(root, WASM_REL, {sampleRate: capture.SAMPLE_RATE, maxFrames: capture.BLOCK});
    const exports = harness.e;
    if (typeof exports.soraoto_supersynth_active_voice_count !== 'function'
        || typeof exports.soraoto_supersynth_guard_hit_count !== 'function') throw new Error('BLOCKED_CONTACT_LOSS_STAGE4_DIAGNOSTICS');
    harness.applyPreset('concert_grand'); harness.setPlain('voice_drift', 0); harness.setPlain('lfo1_pitch', 0); harness.setPlain('chorus_mix', 0);
    const holdFrames = Math.floor(capture.SAMPLE_RATE * capture.HOLD_MS / 1000);
    const releaseLimitFrames = Math.floor(capture.SAMPLE_RATE * capture.RELEASE_LIMIT_MS / 1000);
    const heldLeft = new Float32Array(holdFrames), heldRight = new Float32Array(holdFrames);
    const fullLeft = new Float32Array(holdFrames + releaseLimitFrames + capture.BLOCK);
    const fullRight = new Float32Array(fullLeft.length);
    let finite = true, peak = 0, position = 0;
    const guardStart = exports.soraoto_supersynth_guard_hit_count() >>> 0;
    const append = (output, offset) => {
      const left = output?.[0], right = output?.[1];
      if (!left || !right || left.length !== right.length) throw new Error('BLOCKED_CONTACT_LOSS_STAGE4_STEREO');
      fullLeft.set(left, offset); fullRight.set(right, offset);
      for (let i = 0; i < left.length; i++) {
        if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) finite = false;
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      }
    };
    while (position < holdFrames) {
      const frames = Math.min(capture.BLOCK, holdFrames - position);
      const output = harness.process(frames, {events: position === 0
        ? [{kind: 1, noteId: 1, pitch: cell.pitch, velocity: cell.velocity / 127, offset: 0}] : []})[0];
      append(output, position); heldLeft.set(output[0], position); heldRight.set(output[1], position); position += frames;
    }
    const noteOffFrame = position;
    let releaseFrames = 0, active = exports.soraoto_supersynth_active_voice_count() >>> 0;
    while (releaseFrames < releaseLimitFrames) {
      const frames = Math.min(capture.BLOCK, releaseLimitFrames - releaseFrames);
      const events = releaseFrames === 0 ? [{kind: 2, noteId: 1, pitch: cell.pitch, velocity: 0, offset: 0}] : [];
      const output = harness.process(frames, {events})[0]; append(output, position); position += frames;
      releaseFrames += frames; active = exports.soraoto_supersynth_active_voice_count() >>> 0;
      if (active === 0) break;
    }
    const releasedWithinLimit = active === 0 && releaseFrames <= releaseLimitFrames;
    let postReleaseProcessed = false, postReleaseFinite = false;
    if (active === 0) {
      const output = harness.process(capture.BLOCK, {events: []})[0];
      postReleaseFinite = output[0].every(Number.isFinite) && output[1].every(Number.isFinite);
      append(output, position); position += capture.BLOCK; postReleaseProcessed = true;
    }
    const analysisFrames = Math.floor(capture.SAMPLE_RATE * .38);
    const metrics = metricsModule.analyzeStereo(heldLeft.subarray(0, analysisFrames), heldRight.subarray(0, analysisFrames), cell.pitch,
      {sampleRate: capture.SAMPLE_RATE});
    const plan = pitchModule.getPianoPitchAnalysisPlan(cell.pitch, {sampleRate: capture.SAMPLE_RATE,
      blockSize: capture.BLOCK, minimumDurationMs: capture.HOLD_MS});
    const pitchMeasurement = pitchModule.estimatePianoPitch(heldLeft, heldRight, {sampleRate: capture.SAMPLE_RATE,
      expectedMidiPitch: cell.pitch, analysisWindows: plan.windows});
    const guardHits = (exports.soraoto_supersynth_guard_hit_count() >>> 0) - guardStart;
    const fullRenderPeakDbfs = peak > 0 ? 20 * Math.log10(peak) : -240;
    Object.assign(metrics, {finite, finiteThroughout: finite, finiteRelease: finite, postReleaseFinite,
      fullRenderPeakDbfs, outputGuardHits: guardHits, pitchMeasurement,
      pitchCapture: {heldFrames: holdFrames, holdMs: capture.HOLD_MS, releaseLimitMs: capture.RELEASE_LIMIT_MS,
        analysisWindowMs: plan.windows, requiredDurationMs: plan.requiredDurationMs},
      lifecycle: {noteOnProcessed: true, noteOffProcessed: true, noteOffFrame, releaseFrames,
        inactiveAfterNoteOffMs: active === 0 ? releaseFrames * 1000 / capture.SAMPLE_RATE : null,
        releasedWithinLimit, postReleaseProcessed, finalActiveVoiceCount: active, guardHits,
        finiteThroughout: finite, postReleaseFinite}});
    return {audio: writeFloatWav(fullLeft.subarray(0, position), fullRight.subarray(0, position)),
      metadata: {pitch: cell.pitch, velocity: cell.velocity, metrics}};
  } finally {
    try { harness?.close(); }
    finally { if (prior === undefined) delete process.env.SORAOTO_WASM_BUILD_DIR; else process.env.SORAOTO_WASM_BUILD_DIR = prior; }
  }
}
function stage4Report(roots, root, stage3Value, stage3Sha256, stage4Build, acceptanceOffset,
  {persist = true, legacyConformance, ownerLock = null} = {}) {
  const capture = require('./capture-supersynth-stage4-lifecycle.cjs'), evaluator = require('./stage4-full-range-evaluator.cjs');
  const cells = [...capture.LIFECYCLE_CELLS, ...capture.REPEAT_CELLS].map(cell => ({...cell}));
  const calls = readAcceptanceCalls(roots, 'stage4', cells);
  const rows = calls.calls.map(call => ({...call.cell, metrics: call.metadata.value.metrics}));
  const matrix = rows.filter(row => row.kind === 'lifecycle'), repeats = rows.filter(row => row.kind === 'repeat');
  const stage3Identity = {resultSha256: stage3Sha256, identity: {sourceHead: stage3Value.sourceHead,
    build: stage3Value.build, fixtureSha256: stage3Value.fixtureSha256}};
  const identity = {stage3ResultSha256: stage3Sha256, stage3Identity: stage3Identity.identity};
  const stage3Rows = (stage3Value.rows || []).map(row => ({pitch: row.cell.pitch, velocity: row.cell.velocity, metrics: row.metrics}));
  let legacyDocument;
  const summary = evaluator.evaluate({root, identity, stage3Identity, stage3Rows, matrix, repeats,
    legacy: persist ? ({document}) => {
      legacyDocument = document;
      return runLegacyStage4Conformance(root, document);
    }
      : () => {
        if (!legacyConformance || typeof legacyConformance.pass !== 'boolean') {
          throw new Error('BLOCKED_CONTACT_LOSS_STAGE4_LEGACY_EVIDENCE_MISSING');
        }
        legacyDocument = {schemaVersion: 1, decision: 'STAGE4_LIFECYCLE_CAPTURE_COMPLETE', identity,
          coverage: {lifecycleCells: matrix.length, adjacentComparisons: 1392, repeatCells: repeats.length},
          render: require('./capture-supersynth-stage4-lifecycle.cjs').renderMetadata(root), matrix, repeats};
        return legacyConformance;
      }, legacyMatrixPath: null});
  const pass = summary.decision === 'STAGE4_FULL_RANGE_COMPLETE' && calls.completed === 1423 && calls.charged === 1423;
  const report = {schemaVersion: 1, gate: 'STAGE4', decision: pass ? 'STAGE4_FULL_RANGE_COMPLETE' : summary.decision,
    pass, sourceHead: currentIdentity(root).head, build: {directory: stage4Build.directory, wasmSha256: stage4Build.wasmSha256},
    calls: calls.completed, coverage: summary.coverage, counts: summary.counts, cellFailures: summary.cellFailures,
    repeatFailures: summary.repeatFailures, stage3IdentityStable: summary.stage3IdentityStable,
    legacyConformance: summary.legacyConformance, legacyDocumentSha256: sha256(jsonBytes(legacyDocument)),
    outputEquivalence: summary.outputEquivalence,
    accounting: core.accounting({startedExperimentCalls: combinedExperimentCalls(roots, {ownerLock}),
      startedAcceptanceCalls: acceptanceOffset + calls.charged})};
  return recordAcceptanceReport(roots, 'stage4', report, {persist});
}
function stage4LegacyDocument(roots, root, stage3Value, stage3Sha256) {
  const capture = require('./capture-supersynth-stage4-lifecycle.cjs'), evaluator = require('./stage4-full-range-evaluator.cjs');
  const cells = [...capture.LIFECYCLE_CELLS, ...capture.REPEAT_CELLS].map(cell => ({...cell}));
  const calls = readAcceptanceCalls(roots, 'stage4', cells);
  if (calls.completed !== cells.length || calls.charged !== cells.length || calls.ambiguous !== 0) {
    throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_INCOMPLETE:stage4');
  }
  const rows = calls.calls.map(call => ({...call.cell, metrics: call.metadata.value.metrics}));
  const matrix = rows.filter(row => row.kind === 'lifecycle'), repeats = rows.filter(row => row.kind === 'repeat');
  const stage3Identity = {resultSha256: stage3Sha256, identity: {sourceHead: stage3Value.sourceHead,
    build: stage3Value.build, fixtureSha256: stage3Value.fixtureSha256}};
  const identity = {stage3ResultSha256: stage3Sha256, stage3Identity: stage3Identity.identity};
  const stage3Rows = (stage3Value.rows || []).map(row => ({pitch: row.cell.pitch, velocity: row.cell.velocity, metrics: row.metrics}));
  let document;
  evaluator.evaluate({root, identity, stage3Identity, stage3Rows, matrix, repeats,
    legacy: input => { document = input.document; return {pass: true, status: 0, stdout: '', stderr: ''}; }, legacyMatrixPath: null});
  if (!document) throw new Error('BLOCKED_CONTACT_LOSS_STAGE4_DOCUMENT_RECONSTRUCTION');
  return document;
}
function runPostStage4FullCTest({roots, root = ROOT, buildDirectory, stage4ReportSha256, document,
  spawn = spawnSync} = {}) {
  const inputBytes = jsonBytes(document), inputSha256 = sha256(inputBytes);
  const relative = `${ACCEPTANCE_ROOT}/full-ctest/report.json`;
  const existing = readJsonDual(roots, relative);
  if (existing) {
    const value = existing.value;
    if (value.epoch !== ACTIVE_EPOCH || value.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
        || value.ctestOrderContractSha256 !== CTEST_ORDER_CONTRACT_SHA256
        || value.ctestOrderApprovalMarker !== CTEST_ORDER_APPROVAL_MARKER
        || value.gate !== 'POST_STAGE4_FULL_CTEST'
        || value.stage4ReportSha256 !== stage4ReportSha256 || value.lifecycleInputSha256 !== inputSha256
        || value.buildRole !== 'guarded-test' || !Number.isSafeInteger(value.testCount) || value.testCount < 1
        || !Number.isSafeInteger(value.failedCount) || value.failedCount < 0
        || !/^[a-f0-9]{64}$/.test(value.stdoutSha256) || !/^[a-f0-9]{64}$/.test(value.stderrSha256)
        || !sameJson(value.command, ['ctest', '--output-on-failure'])
        || value.errorCode !== null
        || value.pass !== (value.exitCode === 0 && value.failedCount === 0)
        || value.decision !== (value.pass ? 'FULL_CTEST_PASS' : 'BLOCKED_FULL_CTEST_FAIL')) {
      throw new Error('BLOCKED_CONTACT_LOSS_FULL_CTEST_IDENTITY');
    }
    return {report: value, sha256: existing.sha256, status: 'REUSED'};
  }
  const buildRoot = path.join(root, 'build');
  fs.mkdirSync(buildRoot, {recursive: true});
  const temporary = fs.mkdtempSync(path.join(buildRoot, '.issue7-contact-loss-post-stage4-'));
  const matrixPath = path.join(temporary, 'lifecycle.json');
  try {
    fs.writeFileSync(matrixPath, inputBytes);
    const ctestDirectory = path.resolve(root, buildDirectory || DIAGNOSTIC_BUILD_REL);
    const result = spawn('rtk', ['ctest', '--test-dir', ctestDirectory, '--output-on-failure'], {
      cwd: root, encoding: 'utf8', env: {...process.env, SUPERSYNTH_LIFECYCLE_PATH: matrixPath,
        SUPERSYNTH_REPORT_DIR: ''}, maxBuffer: 32 * 1024 * 1024});
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const summary = output.match(/(\d+)% tests passed,\s*(\d+) tests failed out of\s*(\d+)/i);
    const failureNames = [...output.matchAll(/^\s*\d+\s+-\s+(.+?)\s+\(Failed\)\s*$/gm)].map(match => match[1]);
    const pass = result.status === 0 && !result.error && Boolean(summary) && Number(summary[2]) === 0;
    const report = {schemaVersion: 1, epoch: ACTIVE_EPOCH, contractSha256: SUCCESSOR_CONTRACT_SHA256,
      ctestOrderContractSha256: CTEST_ORDER_CONTRACT_SHA256,
      ctestOrderApprovalMarker: CTEST_ORDER_APPROVAL_MARKER,
      gate: 'POST_STAGE4_FULL_CTEST', decision: pass ? 'FULL_CTEST_PASS' : 'BLOCKED_FULL_CTEST_FAIL',
      pass, exitCode: result.status, errorCode: result.error?.code || null,
      testCount: summary ? Number(summary[3]) : null, failedCount: summary ? Number(summary[2]) : null,
      failureNames, stdoutSha256: sha256(Buffer.from(result.stdout || '')),
      stderrSha256: sha256(Buffer.from(result.stderr || '')), stage4ReportSha256,
      lifecycleInputSha256: inputSha256, command: ['ctest', '--output-on-failure'],
      buildRole: 'guarded-test'};
    const bytes = jsonBytes(report);
    writeDualImmutable(roots, relative, bytes);
    return {report, sha256: sha256(bytes), status: 'CREATED'};
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
}
function runWebPlayerGates(root = ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'web-player/package.json'), 'utf8'));
  if (!pkg.scripts?.test || !pkg.scripts?.build) throw new Error('BLOCKED_CONTACT_LOSS_WEB_PLAYER_SCRIPTS');
  runBuildCommand(path.join(root, 'web-player'), ['npm', 'test'], 'BLOCKED_CONTACT_LOSS_WEB_PLAYER_TESTS');
  runBuildCommand(path.join(root, 'web-player'), ['npm', 'run', 'build'], 'BLOCKED_CONTACT_LOSS_WEB_PLAYER_BUILD');
  return {test: 'PASS', build: 'PASS'};
}
function sourceSnapshotDigest(root) {
  return sha256(Buffer.from(JSON.stringify(stable(sourceSnapshot(root)))));
}
function verifyPromotedBuildReport(roots, root, promotion) {
  const stored = readJsonDual(roots, `${ACCEPTANCE_ROOT}/promoted-builds/report.json`);
  if (!stored) return null;
  const value = stored.value;
  if (value.epoch !== ACTIVE_EPOCH || value.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
      || value.gate !== 'PROMOTED_BUILDS' || value.decision !== 'PROMOTED_BUILDS_READY' || value.pass !== true
      || value.head !== promotion.head || value.sourceSnapshotSha256 !== sourceSnapshotDigest(root)
      || !value.builds || Object.keys(value.builds).sort().join(',') !== 'release,test') {
    throw new Error('BLOCKED_CONTACT_LOSS_PROMOTED_BUILD_REPORT');
  }
  const expected = {
    test: {directory: 'build/wasm-contact-loss-promoted-test', testing: 'ON', guards: 'ON'},
    release: {directory: 'build/wasm-contact-loss-promoted-release', testing: 'OFF', guards: 'OFF'}
  };
  for (const role of ['test', 'release']) {
    const identity = value.builds[role], config = expected[role], directory = path.resolve(root, config.directory);
    if (identity.directory !== config.directory) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTED_BUILD_PATH');
    const cacheBytes = fs.readFileSync(path.join(directory, 'CMakeCache.txt'));
    const cache = cacheBytes.toString('utf8'), option = (name, expectedValue) =>
      new RegExp(`^${name}:BOOL=${expectedValue}$`, 'm').test(cache);
    if (sha256(cacheBytes) !== identity.cacheSha256 || !option('BUILD_TESTING', config.testing)
        || !option('SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS', config.guards)
        || !option('SORAOTO_SUPERSYNTH_CONTACT_LOSS_DIAGNOSTICS', 'OFF')
        || !option('SORAOTO_SUPERSYNTH_PHYSICAL_IDENTIFICATION_DIAGNOSTICS', 'OFF')) {
      throw new Error('BLOCKED_CONTACT_LOSS_PROMOTED_BUILD_OPTIONS');
    }
    const wasm = syncReadSha(path.join(directory, WASM_REL));
    const exports = WebAssembly.Module.exports(new WebAssembly.Module(wasm.bytes)).map(row => row.name).sort();
    if (identity.wasmSha256 !== wasm.sha256 || identity.wasmSize !== wasm.size
        || !sameJson(identity.exports, exports) || !exports.includes('soraoto_plugin_process')
        || !exports.includes('soraoto_plugin_init')
        || exports.some(name => name.startsWith('soraoto_supersynth_contact_loss_'))
        || (role === 'test' && !['soraoto_supersynth_guard_hit_count', 'soraoto_supersynth_active_voice_count'].every(name => exports.includes(name)))
        || (role === 'release' && ['soraoto_supersynth_guard_hit_count', 'soraoto_supersynth_active_voice_count'].some(name => exports.includes(name)))) {
      throw new Error('BLOCKED_CONTACT_LOSS_PROMOTED_BUILD_ARTIFACT');
    }
  }
  return stored;
}
function verifyAcceptanceProgress({roots, root = ROOT, state, selection, promotion, finalStored} = {}) {
  const requiredFinal = Boolean(finalStored), alpha = selection?.selected?.alpha;
  if (selection?.status !== 'GATE4_STRESS_PASS' || !core.ALPHAS.includes(alpha)) {
    if (requiredFinal) throw new Error('BLOCKED_CONTACT_LOSS_FINAL_SELECTION_UNVERIFIED');
    return {acceptanceCharged: 0, reports: {}};
  }
  const reports = {}, stages = {}, sourceDigest = sourceSnapshotDigest(root);
  let acceptanceCharged = 0;
  const verifyStage = (name, cells, expected, calculate, {required = false} = {}) => {
    const ledger = readAcceptanceCalls(roots, name, cells);
    acceptanceCharged += ledger.charged;
    const stored = readJsonDual(roots, `${ACCEPTANCE_ROOT}/${name}/report.json`);
    if (!stored) {
      if (required) throw new Error(`BLOCKED_CONTACT_LOSS_ACCEPTANCE_REPORT_MISSING:${name}`);
      reports[name] = 'NOT RUN';
      return null;
    }
    verifyAcceptanceLedgerIdentity(roots, name, cells, expected);
    const computed = calculate({persist: false});
    if (computed.sha256 !== stored.sha256 || !computed.report || !sameJson(computed.report, stored.value)) {
      throw new Error(`BLOCKED_CONTACT_LOSS_ACCEPTANCE_REPORT_MISMATCH:${name}`);
    }
    stages[name] = stored;
    reports[name] = stored.value.decision;
    return stored;
  };
  const confirmationCells = core.CONFIRMATION_CELLS.map((cell, index) => ({kind: 'confirmation', ...cell,
    cellOrder: index, alpha, alphaOrder: core.alphaIndex(alpha)}));
  const headroomCells = core.HEADROOM_CELLS.map(cell => ({...cell, kind: 'headroom', alpha: cell.role === 'baseline' ? 1 : alpha}));
  const mustHavePrePromotion = Boolean(promotion || finalStored
    || ['headroom', 'promoted-builds', 'release-equivalence', 'stage3', 'stage4']
      .some(name => readJsonDual(roots, `${ACCEPTANCE_ROOT}/${name}/report.json`)));
  const preIdentity = preparedAcceptanceIdentity(state);
  const confirmation = verifyStage('confirmation', confirmationCells, preIdentity,
    options => confirmationReport(roots, root, alpha, options), {required: mustHavePrePromotion || requiredFinal});
  const headroom = verifyStage('headroom', headroomCells, preIdentity,
    options => headroomReport(roots, alpha, options), {required: mustHavePrePromotion || requiredFinal});
  if (promotion && (!confirmation?.value.pass || !headroom?.value.pass)) {
    throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_PRECONDITION_REPORT');
  }
  if (!promotion && (readJsonDual(roots, `${ACCEPTANCE_ROOT}/promoted-builds/report.json`)
      || readJsonDual(roots, `${ACCEPTANCE_ROOT}/release-equivalence/report.json`)
      || readJsonDual(roots, `${ACCEPTANCE_ROOT}/stage3/report.json`)
      || readJsonDual(roots, `${ACCEPTANCE_ROOT}/stage4/report.json`) || finalStored)) {
    throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_RECEIPT_MISSING');
  }
  let buildReport = null;
  if (promotion) buildReport = verifyPromotedBuildReport(roots, root, promotion);
  if (buildReport) {
    stages['promoted-builds'] = buildReport;
    reports['promoted-builds'] = buildReport.value.decision;
  } else reports['promoted-builds'] = 'NOT RUN';
  const hasLaterThanBuild = ['release-equivalence', 'stage3', 'stage4'].some(name =>
    readJsonDual(roots, `${ACCEPTANCE_ROOT}/${name}/report.json`)) || Boolean(finalStored);
  if (hasLaterThanBuild && !buildReport) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTED_BUILD_REPORT_MISSING');
  if (buildReport) {
    const builds = buildReport.value.builds;
    const testIdentity = {head: promotion.head, wasmSha256: builds.test.wasmSha256,
      sourceSnapshotSha256: sourceDigest, buildRole: 'guarded-test'};
    const releaseIdentity = {head: promotion.head, wasmSha256: builds.release.wasmSha256,
      sourceSnapshotSha256: sourceDigest, buildRole: 'production-release'};
    const testCalls = readAcceptanceCalls(roots, 'release-test', core.RELEASE_CELLS);
    const releaseCalls = readAcceptanceCalls(roots, 'release-production', core.RELEASE_CELLS);
    acceptanceCharged += testCalls.charged + releaseCalls.charged;
    const releaseStored = readJsonDual(roots, `${ACCEPTANCE_ROOT}/release-equivalence/report.json`);
    if (!releaseStored && (requiredFinal || readJsonDual(roots, `${ACCEPTANCE_ROOT}/stage3/report.json`)
        || readJsonDual(roots, `${ACCEPTANCE_ROOT}/stage4/report.json`))) {
      throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_REPORT_MISSING:release-equivalence');
    }
    if (releaseStored) {
      verifyAcceptanceLedgerIdentity(roots, 'release-test', core.RELEASE_CELLS, testIdentity);
      verifyAcceptanceLedgerIdentity(roots, 'release-production', core.RELEASE_CELLS, releaseIdentity);
      const computed = releaseEquivalenceReport(roots, {persist: false});
      if (computed.sha256 !== releaseStored.sha256 || !sameJson(computed.report, releaseStored.value)) {
        throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_REPORT_MISMATCH:release-equivalence');
      }
      stages['release-equivalence'] = releaseStored;
      reports['release-equivalence'] = releaseStored.value.decision;
    } else reports['release-equivalence'] = 'NOT RUN';
    const stage3Plan = stage3Cells(), stage3Stored = readJsonDual(roots, `${ACCEPTANCE_ROOT}/stage3/report.json`);
    const stage3Calls = readAcceptanceCalls(roots, 'stage3', stage3Plan);
    acceptanceCharged += stage3Calls.charged;
    if (stage3Stored) {
      if (!releaseStored?.value.pass) throw new Error('BLOCKED_CONTACT_LOSS_STAGE3_PREDECESSOR');
      verifyAcceptanceLedgerIdentity(roots, 'stage3', stage3Plan, testIdentity);
      const computed = stage3Report(roots, root, builds.test, 53, {persist: false});
      if (computed.sha256 !== stage3Stored.sha256 || !sameJson(computed.report, stage3Stored.value)) {
        throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_REPORT_MISMATCH:stage3');
      }
      stages.stage3 = stage3Stored;
      reports.stage3 = stage3Stored.value.decision;
    } else reports.stage3 = 'NOT RUN';
    const capture = require('./capture-supersynth-stage4-lifecycle.cjs');
    const stage4Cells = [...capture.LIFECYCLE_CELLS, ...capture.REPEAT_CELLS].map(cell => ({...cell}));
    const stage4Calls = readAcceptanceCalls(roots, 'stage4', stage4Cells), stage4Stored = readJsonDual(roots, `${ACCEPTANCE_ROOT}/stage4/report.json`);
    acceptanceCharged += stage4Calls.charged;
    if (stage4Stored) {
      if (!stage3Stored?.value.pass) throw new Error('BLOCKED_CONTACT_LOSS_STAGE4_PREDECESSOR');
      verifyAcceptanceLedgerIdentity(roots, 'stage4', stage4Cells, testIdentity);
      const computed = stage4Report(roots, root, stage3Stored.value, stage3Stored.sha256, builds.test, 539,
        {persist: false, legacyConformance: stage4Stored.value.legacyConformance});
      if (computed.sha256 !== stage4Stored.sha256 || !sameJson(computed.report, stage4Stored.value)) {
        throw new Error('BLOCKED_CONTACT_LOSS_ACCEPTANCE_REPORT_MISMATCH:stage4');
      }
      stages.stage4 = stage4Stored;
      reports.stage4 = stage4Stored.value.decision;
    } else reports.stage4 = 'NOT RUN';
  } else {
    reports['release-equivalence'] = reports.stage3 = reports.stage4 = 'NOT RUN';
  }
  const ctest = readJsonDual(roots, `${ACCEPTANCE_ROOT}/full-ctest/report.json`);
  if (ctest) {
    if (!stages.stage4) throw new Error('BLOCKED_CONTACT_LOSS_FULL_CTEST_STAGE4_MISSING');
    const stage4Document = stage4LegacyDocument(roots, root, stages.stage3.value, stages.stage3.sha256);
    if (ctest.value.epoch !== ACTIVE_EPOCH || ctest.value.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
        || ctest.value.ctestOrderContractSha256 !== CTEST_ORDER_CONTRACT_SHA256
        || ctest.value.ctestOrderApprovalMarker !== CTEST_ORDER_APPROVAL_MARKER
        || ctest.value.gate !== 'POST_STAGE4_FULL_CTEST'
        || ctest.value.stage4ReportSha256 !== stages.stage4.sha256
        || ctest.value.lifecycleInputSha256 !== sha256(jsonBytes(stage4Document))
        || !Number.isSafeInteger(ctest.value.testCount) || ctest.value.testCount < 1
        || !Number.isSafeInteger(ctest.value.failedCount) || ctest.value.failedCount < 0
        || !/^[a-f0-9]{64}$/.test(ctest.value.stdoutSha256) || !/^[a-f0-9]{64}$/.test(ctest.value.stderrSha256)
        || !sameJson(ctest.value.command, ['ctest', '--output-on-failure'])
        || ctest.value.buildRole !== 'guarded-test' || ctest.value.errorCode !== null
        || ctest.value.pass !== (ctest.value.exitCode === 0 && ctest.value.failedCount === 0)
        || ctest.value.decision !== (ctest.value.pass ? 'FULL_CTEST_PASS' : 'BLOCKED_FULL_CTEST_FAIL')) {
      throw new Error('BLOCKED_CONTACT_LOSS_FULL_CTEST_REPORT_MISMATCH');
    }
    stages['full-ctest'] = ctest;
    reports['full-ctest'] = ctest.value.decision;
  } else reports['full-ctest'] = 'NOT RUN';
  if (requiredFinal) {
    const requiredNames = ['confirmation', 'headroom', 'promoted-builds', 'release-equivalence', 'stage3', 'stage4', 'full-ctest'];
    for (const name of requiredNames) {
      if (!stages[name] || stages[name].value.pass !== true) throw new Error(`BLOCKED_CONTACT_LOSS_FINAL_STAGE_NOT_PASS:${name}`);
    }
    const expectedReportHashes = Object.fromEntries(requiredNames.map(name => [name, stages[name].sha256]));
    const final = finalStored.value;
    const promotionReceipt = readPromotion(roots), selectionStored = readJsonDual(roots, `${EXPERIMENT_REL}/selection.json`, {required: true});
    const expectedAccounting = core.accounting({startedExperimentCalls: combinedExperimentCalls(roots), startedAcceptanceCalls: core.RESERVE_CALLS});
    if (final.schemaVersion !== 2 || final.epoch !== ACTIVE_EPOCH || final.contractSha256 !== SUCCESSOR_CONTRACT_SHA256
        || final.ctestOrderContractSha256 !== CTEST_ORDER_CONTRACT_SHA256
        || final.head !== currentIdentity(root).head || final.selectionSha256 !== selectionStored.sha256
        || final.promotionSha256 !== promotionReceipt.sha256 || !sameJson(final.reports, expectedReportHashes)
        || final.decision !== 'ACOUSTIC_PASS_AWAITING_FINAL_REVIEW' || final.stage3 !== 'PASS' || final.stage4 !== 'PASS'
        || final.manualAudio !== 'NOT RUN' || final.review !== 'PENDING'
        || final.webPlayer?.test !== 'PASS' || final.webPlayer?.build !== 'PASS'
        || !sameJson(final.accounting, expectedAccounting)) {
      throw new Error('BLOCKED_CONTACT_LOSS_FINAL_REPORT_MISMATCH');
    }
    reports.final = final.decision;
  } else reports.final = 'NOT RUN';
  return {acceptanceCharged, reports, stages};
}
function continuationDecision({selection, confirmation, headroom, release, stage3, stage4}) {
  if (selection?.status !== 'GATE4_STRESS_PASS') return {status: selection?.status || 'BLOCKED_CONTACT_LOSS_SELECTION_MISSING', stage3: 'NOT RUN', stage4: 'NOT RUN'};
  if (confirmation && confirmation.pass !== true) return {status: confirmation.decision || 'BLOCKED_CONFIRMATION_FAIL', stage3: 'NOT RUN', stage4: 'NOT RUN'};
  if (headroom && headroom.pass !== true) return {status: headroom.decision || 'BLOCKED_HEADROOM_FAIL', stage3: 'NOT RUN', stage4: 'NOT RUN'};
  if (release && release.pass !== true) return {status: release.decision || 'BLOCKED_RELEASE_EQUIVALENCE_FAIL', stage3: 'NOT RUN', stage4: 'NOT RUN'};
  if (stage3 && stage3.pass !== true) return {status: stage3.decision || 'BLOCKED_STAGE3_ACCEPTANCE_FAIL', stage3: stage3.decision, stage4: 'NOT RUN'};
  if (stage4 && stage4.pass !== true) return {status: stage4.decision || 'BLOCKED_STAGE4_ACCEPTANCE_FAIL', stage3: 'PASS', stage4: stage4.decision};
  if (stage4?.pass === true) return {status: 'ACOUSTIC_PASS_AWAITING_FINAL_REVIEW', stage3: 'PASS', stage4: 'PASS'};
  return {status: 'CONTINUATION_READY'};
}
function estimateDualEvidenceBytes({remaining = {experiment: 42, confirmation: 25, headroom: 4,
  releaseEquivalence: 24, stage3: 486, stage4: 1423}} = {}) {
  const capture = require('./capture-supersynth-stage4-lifecycle.cjs');
  const frames = {experiment: RENDER_FRAMES, confirmation: RENDER_FRAMES, headroom: 96000,
    releaseEquivalence: RENDER_FRAMES, stage3: Math.floor(capture.SAMPLE_RATE * 0.38),
    stage4: Math.floor(capture.SAMPLE_RATE * (capture.HOLD_MS + capture.RELEASE_LIMIT_MS) / 1000) + capture.BLOCK};
  let wavBytes = 0, metadataAllowance = 0;
  for (const [stage, count] of Object.entries(remaining)) {
    if (!Object.hasOwn(frames, stage) || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('BLOCKED_CONTACT_LOSS_STORAGE_ESTIMATE');
    }
    wavBytes += count * (44 + frames[stage] * 8);
    metadataAllowance += count * 16384;
  }
  const oneStoreBytes = wavBytes + metadataAllowance + 64 * 1024 * 1024;
  return {oneStoreBytes, dualStoreBytes: 2 * oneStoreBytes, promotionBuildAllowanceBytes: 2 * 1024 * 1024 * 1024};
}
function assertEvidenceCapacity({root = ROOT, home = os.homedir(), remaining} = {}) {
  const estimate = estimateDualEvidenceBytes({remaining});
  const freeBytes = directory => {
    const stats = fs.statfsSync(directory);
    return Number(stats.bavail) * Number(stats.bsize);
  };
  const repoFreeBytes = freeBytes(root), homeFreeBytes = freeBytes(home);
  const repoRequiredBytes = estimate.oneStoreBytes + estimate.promotionBuildAllowanceBytes;
  if (repoFreeBytes < repoRequiredBytes || homeFreeBytes < estimate.oneStoreBytes) {
    throw new Error(`BLOCKED_CONTACT_LOSS_INSUFFICIENT_STORAGE: repoFree=${repoFreeBytes};homeFree=${homeFreeBytes};repoRequired=${repoRequiredBytes};homeRequired=${estimate.oneStoreBytes}`);
  }
  return {repoFreeBytes, homeFreeBytes, repoRequiredBytes, homeRequiredBytes: estimate.oneStoreBytes, ...estimate};
}
function continueApproved({root = ROOT, home = os.homedir(), commonDirectory, buildDirectory, archivePath} = {}) {
  const capacity = assertEvidenceCapacity({root, home});
  const roots = resolveRoots({root, home, commonDirectory});
  let state = readExperimentState(roots), selectionStored = readJsonDual(roots, `${EXPERIMENT_REL}/selection.json`);
  if (!state.prepare) throw new Error('BLOCKED_CONTACT_LOSS_NOT_PREPARED');
  const parent = verifyParentExperiment01({root, home, commonDirectory});
  if (!sameJson(state.prepare.parentEpoch, parent.proof)) throw new Error('BLOCKED_CONTACT_LOSS_PARENT_PROOF_DRIFT');
  if (selectionStored && (selectionStored.value.epoch !== ACTIVE_EPOCH
      || selectionStored.value.contractSha256 !== SUCCESSOR_CONTRACT_SHA256)) {
    throw new Error('BLOCKED_CONTACT_LOSS_SELECTION_IDENTITY');
  }
  if (!selectionStored) {
    const first = runBounded({root, home, commonDirectory, buildDirectory, archivePath});
    state = readExperimentState(roots); selectionStored = readJsonDual(roots, `${EXPERIMENT_REL}/selection.json`);
    if (!selectionStored) return {...first, stage3: 'NOT RUN', stage4: 'NOT RUN'};
  }
  const selection = selectionStored.value;
  if (selection.status !== 'GATE4_STRESS_PASS') return continuationDecision({selection});
  const lock = acquireLock(roots);
  try {
    state = readExperimentState(roots, {ownerLock: lock});
    let promoted = readPromotion(roots), preparedIdentity, promotionCommittedWithoutReceipt = false;
    if (promoted) {
      promoted = verifyPromotedAuthority({roots, state, root, home, commonDirectory});
      const verified = verifySelectionAfterPromotion({roots, state, selectionStored, root, home, commonDirectory, archivePath});
      if (verified.status !== 'GATE4_STRESS_PASS') return continuationDecision({selection: {status: verified.status}});
      preparedIdentity = preparedAcceptanceIdentity(state);
    } else if (currentIdentity(root).head !== (state.executionHead || state.prepare.head)) {
      assertPromotionCommit({root, prepare: executionPreparation(state), selectedAlpha: selection.selected.alpha,
        expectedHead: currentIdentity(root).head});
      promotionCommittedWithoutReceipt = true;
      const verified = verifySelectionAfterPromotion({roots, state, selectionStored, root, home, commonDirectory, archivePath});
      if (verified.status !== 'GATE4_STRESS_PASS') return continuationDecision({selection: {status: verified.status}});
      preparedIdentity = preparedAcceptanceIdentity(state);
    } else {
      const verified = verifyExperiment({root, home, commonDirectory, buildDirectory, archivePath, ownerLock: lock});
      if (verified.status !== 'GATE4_STRESS_PASS') return continuationDecision({selection: {status: verified.status}});
      preparedIdentity = preparedAcceptanceIdentity(state);
    }
    const alpha = selection.selected?.alpha;
    if (!Number.isFinite(alpha) || !core.ALPHAS.includes(alpha)) throw new Error('BLOCKED_CONTACT_LOSS_SELECTED_ALPHA');
    if (!promoted && !promotionCommittedWithoutReceipt) verifyDiagnosticBuild(root,
      state.executionHead || state.prepare.head, {buildDirectory});
    const confirmationCells = core.CONFIRMATION_CELLS.map((cell, index) => ({kind: 'confirmation', ...cell,
      cellOrder: index, alpha, alphaOrder: core.alphaIndex(alpha)}));
    if (promoted || promotionCommittedWithoutReceipt) verifyAcceptanceLedgerIdentity(roots, 'confirmation', confirmationCells, preparedIdentity);
    else runAcceptancePlan({roots, stage: 'confirmation', cells: confirmationCells,
      identityNow: () => assertCurrentAcceptanceIdentity({root, buildDirectory: path.relative(root,
        path.resolve(root, buildDirectory || DIAGNOSTIC_BUILD_REL)), buildRole: 'diagnostic'}),
      render: cell => renderCall({root, buildDirectory, cell}), previousAcceptanceCalls: 0, ownerLock: lock});
    verifyAcceptanceLedgerIdentity(roots, 'confirmation', confirmationCells, preparedIdentity);
    const confirmation = confirmationReport(roots, root, alpha).report;
    let result = continuationDecision({selection, confirmation});
    if (result.status !== 'CONTINUATION_READY') return result;
    const headroomCells = core.HEADROOM_CELLS.map(cell => ({...cell, kind: 'headroom', alpha: cell.role === 'baseline' ? 1 : alpha}));
    if (promoted || promotionCommittedWithoutReceipt) verifyAcceptanceLedgerIdentity(roots, 'headroom', headroomCells, preparedIdentity);
    else runAcceptancePlan({roots, stage: 'headroom', cells: headroomCells,
      identityNow: () => assertCurrentAcceptanceIdentity({root, buildDirectory: path.relative(root,
        path.resolve(root, buildDirectory || DIAGNOSTIC_BUILD_REL)), buildRole: 'diagnostic'}),
      render: cell => renderHeadroomCall({root, buildDirectory, cell}), previousAcceptanceCalls: 25, ownerLock: lock});
    verifyAcceptanceLedgerIdentity(roots, 'headroom', headroomCells, preparedIdentity);
    const headroom = headroomReport(roots, alpha).report;
    result = continuationDecision({selection, confirmation, headroom});
    if (result.status !== 'CONTINUATION_READY') return result;
    if (!promoted) promoted = promoteSelected({roots, state, selection, root, home, commonDirectory});
    const builds = buildPromotedPair({root});
    const buildReport = recordAcceptanceReport(roots, 'promoted-builds', {schemaVersion: 1, gate: 'PROMOTED_BUILDS',
      decision: 'PROMOTED_BUILDS_READY', pass: true, head: promoted.head, sourceSnapshotSha256: sha256(Buffer.from(JSON.stringify(stable(sourceSnapshot(root))))), builds}).report;
    const testCells = core.RELEASE_CELLS, buildDirs = {test: builds.test.directory, release: builds.release.directory};
    for (const role of ['test', 'release']) {
      const stage = `release-${role}`, directory = buildDirs[role];
      runAcceptancePlan({roots, stage, cells: testCells,
        identityNow: () => assertCurrentAcceptanceIdentity({root, buildDirectory: directory,
          buildRole: role === 'test' ? 'guarded-test' : 'production-release'}),
        render: cell => renderReleaseCell({root, buildDirectory: directory, cell}),
        previousAcceptanceCalls: role === 'test' ? 29 : 41, ownerLock: lock});
      verifyAcceptanceLedgerIdentity(roots, stage, testCells, {head: promoted.head,
        wasmSha256: builds[role].wasmSha256,
        sourceSnapshotSha256: sha256(Buffer.from(JSON.stringify(stable(sourceSnapshot(root))))),
        buildRole: role === 'test' ? 'guarded-test' : 'production-release'});
    }
    const release = releaseEquivalenceReport(roots).report;
    result = continuationDecision({selection, confirmation, headroom, release});
    if (result.status !== 'CONTINUATION_READY') return result;
    const stage3Plan = stage3Cells();
    runAcceptancePlan({roots, stage: 'stage3', cells: stage3Plan,
      identityNow: () => assertCurrentAcceptanceIdentity({root, buildDirectory: builds.test.directory, buildRole: 'guarded-test'}),
      render: cell => renderPromotedCell({root, buildDirectory: builds.test.directory, cell}),
      previousAcceptanceCalls: 53, ownerLock: lock});
    verifyAcceptanceLedgerIdentity(roots, 'stage3', stage3Plan, {head: promoted.head, wasmSha256: builds.test.wasmSha256,
      sourceSnapshotSha256: sha256(Buffer.from(JSON.stringify(stable(sourceSnapshot(root))))), buildRole: 'guarded-test'});
    const stage3 = stage3Report(roots, root, builds.test, 53, {ownerLock: lock}).report;
    result = continuationDecision({selection, confirmation, headroom, release, stage3});
    if (result.status !== 'CONTINUATION_READY') return result;
    const lifecycleCells = [...require('./capture-supersynth-stage4-lifecycle.cjs').LIFECYCLE_CELLS,
      ...require('./capture-supersynth-stage4-lifecycle.cjs').REPEAT_CELLS].map(cell => ({...cell}));
    const priorStage4 = readAcceptanceCalls(roots, 'stage4', lifecycleCells);
    assertEvidenceCapacity({root, home, remaining: {stage4: lifecycleCells.length - priorStage4.completed}});
    runAcceptancePlan({roots, stage: 'stage4', cells: lifecycleCells,
      identityNow: () => assertCurrentAcceptanceIdentity({root, buildDirectory: builds.test.directory, buildRole: 'guarded-test'}),
      render: cell => renderLifecycleWithAudio({root, buildDirectory: builds.test.directory, cell}),
      previousAcceptanceCalls: 539, ownerLock: lock});
    verifyAcceptanceLedgerIdentity(roots, 'stage4', lifecycleCells, {head: promoted.head, wasmSha256: builds.test.wasmSha256,
      sourceSnapshotSha256: sha256(Buffer.from(JSON.stringify(stable(sourceSnapshot(root))))), buildRole: 'guarded-test'});
    const stage4 = stage4Report(roots, root, stage3, readDual(roots, `${ACCEPTANCE_ROOT}/stage3/report.json`, {required: true}).sha256,
      builds.test, 539, {ownerLock: lock}).report;
    result = continuationDecision({selection, confirmation, headroom, release, stage3, stage4});
    if (result.status !== 'ACOUSTIC_PASS_AWAITING_FINAL_REVIEW') return result;
    const stage3Stored = readJsonDual(roots, `${ACCEPTANCE_ROOT}/stage3/report.json`, {required: true});
    const stage4Stored = readJsonDual(roots, `${ACCEPTANCE_ROOT}/stage4/report.json`, {required: true});
    const legacyDocument = stage4LegacyDocument(roots, root, stage3Stored.value, stage3Stored.sha256);
    const fullCTest = runPostStage4FullCTest({roots, root, buildDirectory,
      stage4ReportSha256: stage4Stored.sha256, document: legacyDocument});
    if (!fullCTest.report.pass) {
      return {status: fullCTest.report.decision, stage3: 'PASS', stage4: 'PASS',
        fullCTest: fullCTest.report, fullCTestSha256: fullCTest.sha256,
        charged: state.charged, completed: state.completed, ambiguous: state.ambiguous,
        writes: 1, renders: 0, acousticCalls: 0};
    }
    const webPlayer = runWebPlayerGates(root);
    const final = {schemaVersion: 2, issue: 7, pr: 8, epoch: ACTIVE_EPOCH,
      contractSha256: SUCCESSOR_CONTRACT_SHA256, ctestOrderContractSha256: CTEST_ORDER_CONTRACT_SHA256,
      decision: 'ACOUSTIC_PASS_AWAITING_FINAL_REVIEW',
      head: currentIdentity(root).head, selectionSha256: selectionStored.sha256, promotionSha256: promoted.promotionSha256,
      reports: Object.fromEntries(['confirmation', 'headroom', 'promoted-builds', 'release-equivalence', 'stage3', 'stage4']
        .map(name => [name, readDual(roots, `${ACCEPTANCE_ROOT}/${name}/report.json`, {required: true}).sha256])
        .concat([['full-ctest', fullCTest.sha256]])),
      webPlayer, capacity, manualAudio: 'NOT RUN', review: 'PENDING', accounting: core.accounting({startedExperimentCalls: combinedExperimentCalls(roots, {ownerLock: lock}),
        startedAcceptanceCalls: core.RESERVE_CALLS}), stage3: 'PASS', stage4: 'PASS'};
    writeDualImmutable(roots, `${ACCEPTANCE_ROOT}/final-report.json`, jsonBytes(final));
    return final;
  } finally { releaseLock(roots, lock); }
}

function independentlyVerifiedActiveLedger(roots) {
  try {
    const state = readExperimentState(roots);
    return {status: 'VERIFIED', charged: state.charged, completed: state.completed, ambiguous: state.ambiguous};
  } catch {
    return {status: 'UNVERIFIED', charged: null, completed: null, ambiguous: null};
  }
}
function blockerForStatus(error) {
  return String(error?.message || error).match(/BLOCKED_CONTACT_LOSS_[A-Z0-9_]+/)?.[0]
    || 'BLOCKED_CONTACT_LOSS_EXECUTION_IDENTITY_UNVERIFIED';
}
function status({root = ROOT, home = os.homedir(), commonDirectory, buildDirectory,
  parentVerifier = verifyParentExperiment01, preparedVerifier = verifyPreparedCurrent,
  terminalVerifier = verifyExperiment, promotedVerifier = verifyPromotedAuthority,
  promotionSelectionVerifier = verifySelectionAfterPromotion, acceptanceVerifier = verifyAcceptanceProgress,
  snapshotReader = frozenSourceSnapshot,
  referenceReader = referenceRows} = {}) {
  const roots = resolveRoots({root, home, commonDirectory});
  let currentHead = null;
  try { currentHead = git(root, ['rev-parse', 'HEAD']); } catch { /* status remains read-only for empty fixtures */ }
  let parent;
  try { parent = parentVerifier({root, home, commonDirectory}); }
  catch (error) {
    const active = independentlyVerifiedActiveLedger(roots);
    const rawBlocker = blockerForStatus(error);
    return {status: 'BLOCKED_CONTACT_LOSS_PARENT_EPOCH', epoch: ACTIVE_EPOCH,
      parentStatus: 'UNVERIFIED', parentBlocker: rawBlocker,
      activeLedgerStatus: active.status, parentHead: null,
      preparedHead: null, currentHead, parentCharged: null,
      charged: active.charged, completed: active.completed, ambiguous: active.ambiguous,
      combinedCharged: null, cumulative: null, acceptanceCharged: null,
      callCap: core.EXPERIMENT_CALL_CAP,
      acceptanceReserve: core.RESERVE_CALLS,
      lifetimeCap: core.MAX_CALLS, selection: 'NOT RUN', stage3: 'NOT RUN', stage4: 'NOT RUN',
      finalReport: 'NOT RUN', reports: {}, writes: 0, renders: 0, acousticCalls: 0};
  }
  const state = readExperimentState(roots);
  if (state.prepare && !sameJson(state.prepare.parentEpoch, parent.proof)) {
    return {status: 'BLOCKED_CONTACT_LOSS_PARENT_PROOF_DRIFT', epoch: ACTIVE_EPOCH,
      parentStatus: 'VERIFIED', activeLedgerStatus: 'VERIFIED', parentHead: parent.proof.head,
      parentCharged: parent.state.charged,
      preparedHead: state.prepare.head, currentHead,
      charged: state.charged, completed: state.completed, ambiguous: state.ambiguous,
      acceptanceCharged: null, callCap: core.EXPERIMENT_CALL_CAP, acceptanceReserve: core.RESERVE_CALLS,
      combinedCharged: null, cumulative: null, lifetimeCap: core.MAX_CALLS,
      selection: 'NOT RUN', stage3: 'NOT RUN', stage4: 'NOT RUN', finalReport: 'NOT RUN',
      reports: {}, writes: 0, renders: 0, acousticCalls: 0};
  }
  const selection = readJsonDual(roots, `${EXPERIMENT_REL}/selection.json`);
  const terminal = readJsonDual(roots, `${EXPERIMENT_REL}/terminal.json`);
  const final = readJsonDual(roots, `${ACCEPTANCE_ROOT}/final-report.json`), reports = {};
  const promotion = readPromotion(roots);
  if (selection && (selection.value.epoch !== ACTIVE_EPOCH
      || selection.value.contractSha256 !== SUCCESSOR_CONTRACT_SHA256)) {
    return {status: 'BLOCKED_CONTACT_LOSS_SELECTION_IDENTITY', epoch: ACTIVE_EPOCH,
      parentStatus: 'VERIFIED', activeLedgerStatus: 'VERIFIED', parentHead: parent.proof.head, preparedHead: state.prepare?.head || null,
      currentHead, parentCharged: parent.state.charged, charged: state.charged,
      completed: state.completed, ambiguous: state.ambiguous, acceptanceCharged: null,
      callCap: core.EXPERIMENT_CALL_CAP, acceptanceReserve: core.RESERVE_CALLS,
      combinedCharged: null, cumulative: null, lifetimeCap: core.MAX_CALLS,
      selection: 'UNVERIFIED', stage3: 'NOT RUN', stage4: 'NOT RUN', finalReport: 'NOT RUN',
      reports: {}, writes: 0, renders: 0, acousticCalls: 0};
  }
  let executionBlocker = null, verifiedExecution = null, verifiedSelection = null;
  if (state.prepare) {
    try {
      if (promotion) {
        promotedVerifier({roots, state, root, home, commonDirectory});
        if (!selection) throw new Error('BLOCKED_CONTACT_LOSS_PROMOTION_SELECTION_MISSING');
        const decision = promotionSelectionVerifier({roots, state, selectionStored: selection, root, home, commonDirectory,
          parentVerifier, snapshotReader, referenceReader});
        if (decision.status !== selection.value.status) throw new Error('BLOCKED_CONTACT_LOSS_SELECTION_MISMATCH');
        verifiedSelection = decision;
      } else {
        const identity = currentIdentity(root);
        if (identity.head !== (state.executionHead || state.prepare.head) || identity.head !== currentHead) {
          throw new Error('BLOCKED_CONTACT_LOSS_HEAD_DRIFT');
        }
        if (![PR_BRANCH, LOCAL_WORKTREE_BRANCH].includes(identity.branch)) throw new Error('BLOCKED_CONTACT_LOSS_BRANCH');
        if (!sameJson(sourceSnapshot(root), state.executionSource || state.prepare.source)) throw new Error('BLOCKED_CONTACT_LOSS_SOURCE_DRIFT');
        preparedVerifier(roots, state, {root, home, commonDirectory, buildDirectory});
      }
    } catch (error) { executionBlocker = blockerForStatus(error); }
  }
  if (selection || terminal || final || promotion) {
    if (!state.prepare) executionBlocker ||= 'BLOCKED_CONTACT_LOSS_SELECTION_WITHOUT_PREPARE';
    else if (selection && (state.charged !== 42 || state.completed !== 42 || state.ambiguous !== 0)) {
      executionBlocker ||= 'BLOCKED_CONTACT_LOSS_SELECTION_LEDGER_INCOMPLETE';
    } else if (!executionBlocker) {
      try {
        verifiedExecution = terminalVerifier({root, home, commonDirectory, buildDirectory,
          parentVerifier, preparedVerifier, promotedVerifier, promotionSelectionVerifier, snapshotReader, referenceReader});
        if (verifiedExecution.charged !== state.charged || verifiedExecution.completed !== state.completed
            || verifiedExecution.ambiguous !== state.ambiguous) {
          throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_LEDGER_MISMATCH');
        }
        if (terminal && verifiedExecution.status !== terminal.value.status) {
          throw new Error('BLOCKED_CONTACT_LOSS_TERMINAL_LEDGER_MISMATCH');
        }
        if (selection) {
          if (!verifiedExecution.selection || verifiedExecution.selection.status !== selection.value.status) {
            throw new Error('BLOCKED_CONTACT_LOSS_SELECTION_MISMATCH');
          }
          verifiedSelection = verifiedExecution.selection;
        } else if (verifiedExecution.selection) {
          throw new Error('BLOCKED_CONTACT_LOSS_SELECTION_MISSING');
        }
        if (final && !verifiedSelection) throw new Error('BLOCKED_CONTACT_LOSS_FINAL_SELECTION_UNVERIFIED');
      } catch (error) { executionBlocker = blockerForStatus(error); }
    }
  }
  if (executionBlocker && (selection || terminal || final || promotion)) {
    const parentCharged = parent.state.charged, combinedCharged = parentCharged + state.charged;
    return {status: executionBlocker, epoch: ACTIVE_EPOCH,
      activeLedgerStatus: 'VERIFIED', parentStatus: 'VERIFIED', parentHead: parent.proof.head,
      parentCharged, parentPrepareSha256: parent.proof.prepareSha256,
      preparedHead: state.prepare?.head || null, currentHead,
      charged: state.charged, completed: state.completed, ambiguous: state.ambiguous,
      acceptanceCharged: null, callCap: core.EXPERIMENT_CALL_CAP, acceptanceReserve: core.RESERVE_CALLS,
      combinedCharged, cumulative: null, lifetimeCap: core.MAX_CALLS,
      selection: selection ? 'UNVERIFIED' : 'NOT RUN', stage3: 'NOT RUN', stage4: 'NOT RUN',
      finalReport: final ? 'UNVERIFIED' : 'NOT RUN', reports: {}, writes: 0, renders: 0, acousticCalls: 0};
  }
  let verifiedAcceptance = {acceptanceCharged: 0, reports: {}};
  if (verifiedSelection?.status === 'GATE4_STRESS_PASS' || final) {
    try {
      verifiedAcceptance = acceptanceVerifier({roots, root, state, selection: verifiedSelection,
        promotion: promotion?.value, finalStored: final});
    } catch (error) {
      const blocker = blockerForStatus(error), parentCharged = parent.state.charged;
      return {status: blocker, epoch: ACTIVE_EPOCH, activeLedgerStatus: 'VERIFIED', parentStatus: 'VERIFIED',
        parentHead: parent.proof.head, parentCharged, parentPrepareSha256: parent.proof.prepareSha256,
        preparedHead: state.prepare?.head || null, currentHead, charged: state.charged,
        completed: state.completed, ambiguous: state.ambiguous, acceptanceCharged: null,
        callCap: core.EXPERIMENT_CALL_CAP, acceptanceReserve: core.RESERVE_CALLS,
        combinedCharged: parentCharged + state.charged, cumulative: null, lifetimeCap: core.MAX_CALLS,
        selection: verifiedSelection?.status || 'UNVERIFIED', stage3: 'UNVERIFIED', stage4: 'UNVERIFIED',
        finalReport: final ? 'UNVERIFIED' : 'NOT RUN', reports: {}, writes: 0, renders: 0, acousticCalls: 0};
    }
  }
  Object.assign(reports, verifiedAcceptance.reports);
  const parentCharged = parent.state.charged, combinedCharged = parentCharged + state.charged;
  const ctestDecision = verifiedAcceptance.reports['full-ctest'];
  const statusValue = executionBlocker || (final ? verifiedAcceptance.reports.final : null)
    || (ctestDecision && ctestDecision !== 'NOT RUN' && ctestDecision !== 'FULL_CTEST_PASS' ? ctestDecision : null)
    || verifiedSelection?.status || terminal?.value.status || state.status;
  return {status: statusValue, epoch: ACTIVE_EPOCH,
    activeLedgerStatus: 'VERIFIED',
    parentStatus: 'VERIFIED', parentHead: parent.proof.head, parentCharged,
    parentPrepareSha256: parent.proof.prepareSha256,
    preflightReports: (state.preflightReports || []).map(row => ({head: row.value.head, file: row.file, sha256: row.sha256})),
    preparedHead: state.prepare?.head || null, executionHead: state.executionHead || state.prepare?.head || null, currentHead,
    charged: state.charged, completed: state.completed, ambiguous: state.ambiguous,
    acceptanceCharged: verifiedAcceptance.acceptanceCharged, callCap: core.EXPERIMENT_CALL_CAP, acceptanceReserve: core.RESERVE_CALLS,
    combinedCharged, cumulative: core.HISTORICAL_CALLS + combinedCharged + verifiedAcceptance.acceptanceCharged, lifetimeCap: core.MAX_CALLS,
    selection: verifiedSelection?.status || (selection ? 'UNVERIFIED' : 'NOT RUN'),
    stage3: reports.stage3 || 'NOT RUN', stage4: reports.stage4 || 'NOT RUN',
    finalReport: verifiedAcceptance.reports.final || 'NOT RUN', reports, writes: 0, renders: 0, acousticCalls: 0};
}

function parseMode(argv) {
  const modes = argv.filter(value => /^--(?:status|analyze|verify|preflight|prepare|recover-prepared|recover-prepared-continuation-02|recover-prepared-continuation-03|recover-prepared-continuation-04|recover-prepared-continuation-05|recover-prepared-continuation-06|recover-prepared-continuation-07|run-bounded|continue-approved)$/.test(value));
  if (modes.length !== 1 || argv.some(value => !modes.includes(value))) {
    throw new Error('Usage: run-issue7-contact-loss-v1.cjs --status|--analyze|--verify|--preflight|--prepare|--recover-prepared|--recover-prepared-continuation-02|--recover-prepared-continuation-03|--recover-prepared-continuation-04|--recover-prepared-continuation-05|--recover-prepared-continuation-06|--recover-prepared-continuation-07|--run-bounded|--continue-approved');
  }
  return modes[0].slice(2);
}
function main(argv = process.argv.slice(2)) {
  const mode = parseMode(argv);
  let result;
  if (mode === 'status') result = status();
  else if (mode === 'analyze') result = gate3Analysis();
  else if (mode === 'preflight') result = preflightExperiment();
  else if (mode === 'prepare') result = prepareExperiment();
  else if (mode === 'recover-prepared') result = recoverPreparedExperiment();
  else if (mode === 'recover-prepared-continuation-02') result = recoverPreparedContinuation02();
  else if (mode === 'recover-prepared-continuation-03') result = recoverPreparedContinuation03();
  else if (mode === 'recover-prepared-continuation-04') result = recoverPreparedContinuation04();
  else if (mode === 'recover-prepared-continuation-05') result = recoverPreparedContinuation05();
  else if (mode === 'recover-prepared-continuation-06') result = recoverPreparedContinuation06();
  else if (mode === 'recover-prepared-continuation-07') result = recoverPreparedContinuation07();
  else if (mode === 'run-bounded') result = runBounded();
  else if (mode === 'verify') result = verifyExperiment();
  else if (mode === 'continue-approved') result = continueApproved();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (['preflight', 'recover-prepared', 'recover-prepared-continuation-02', 'recover-prepared-continuation-03',
    'recover-prepared-continuation-04', 'recover-prepared-continuation-05', 'recover-prepared-continuation-06',
    'recover-prepared-continuation-07'].includes(mode)
      && result.status?.startsWith('BLOCKED_')) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  try { main(); }
  catch (error) { process.stderr.write(`${String(error.message || error).replace(/\n/g, ' ')}\n`); process.exitCode = 1; }
}

module.exports = {ROOT, REPOSITORY, PR_NUMBER, PR_BRANCH, PR_URL, CONTRACT_SHA256,
  SUCCESSOR_CONTRACT_SHA256, SUCCESSOR_APPROVAL_MARKER, CTEST_ORDER_CONTRACT_SHA256,
  CTEST_ORDER_APPROVAL_MARKER, PREPARE_RECOVERY_CONTINUATION_02_APPROVAL_MARKER,
  PREPARE_RECOVERY_ANALYSIS21_AMENDMENT_APPROVAL_MARKER,
  PREPARE_RECOVERY_CONTINUATION_02_DESIGN_SHA256, PREPARE_RECOVERY_CONTINUATION_02_OFFLINE_EPOCH,
  PREPARE_RECOVERY_CONTINUATION_03_APPROVAL_MARKER, PREPARE_RECOVERY_CONTINUATION_03_DESIGN_SHA256,
  PREPARE_RECOVERY_CONTINUATION_03_OFFLINE_EPOCH, PREPARE_RECOVERY_CONTINUATION_03_REL,
  PREPARE_RECOVERY_CONTINUATION_04_APPROVAL_MARKER, PREPARE_RECOVERY_CONTINUATION_04_DESIGN_SHA256,
  PREPARE_RECOVERY_CONTINUATION_04_OFFLINE_EPOCH, PREPARE_RECOVERY_CONTINUATION_04_REL,
  PREPARE_RECOVERY_CONTINUATION_05_APPROVAL_MARKER, PREPARE_RECOVERY_CONTINUATION_05_DESIGN_SHA256,
  PREPARE_RECOVERY_CONTINUATION_05_OFFLINE_EPOCH, PREPARE_RECOVERY_CONTINUATION_05_REL,
  PREPARE_RECOVERY_CONTINUATION_05_CONTRACT_REL,
  PREPARE_RECOVERY_CONTINUATION_06_APPROVAL_MARKER, PREPARE_RECOVERY_CONTINUATION_06_DESIGN_SHA256,
  PREPARE_RECOVERY_CONTINUATION_06_OFFLINE_EPOCH, PREPARE_RECOVERY_CONTINUATION_06_REL,
  PREPARE_RECOVERY_CONTINUATION_06_CONTRACT_REL,
  PREPARE_RECOVERY_CONTINUATION_07_APPROVAL_MARKER, PREPARE_RECOVERY_CONTINUATION_07_CONTRACT_SHA256,
  PREPARE_RECOVERY_CONTINUATION_07_DESIGN_SHA256, PREPARE_RECOVERY_CONTINUATION_07_OFFLINE_EPOCH,
  PREPARE_RECOVERY_CONTINUATION_07_REL, PREPARE_RECOVERY_CONTINUATION_07_CONTRACT_REL,
  PREPARE_RECOVERY_CONTRACT_REL,
  RECOVERY_ANALYSIS20_REPORT_SHA256, RECOVERY_ANALYSIS20_MANIFEST_SHA256,
  RECOVERY_ANALYSIS21_REPORT_SHA256, RECOVERY_ANALYSIS21_MANIFEST_SHA256,
  RECOVERY_ANALYSIS22_REPORT_SHA256, RECOVERY_ANALYSIS22_MANIFEST_SHA256,
  RECOVERY_ANALYSIS24_REPORT_SHA256, RECOVERY_ANALYSIS24_MANIFEST_SHA256,
  RECOVERY_ANALYSIS25_REPORT_SHA256, RECOVERY_ANALYSIS25_MANIFEST_SHA256,
  RECOVERY_CONTINUATION_04_PREFLIGHT_SHA256, RECOVERY_CONTINUATION_04_RECEIPT_SHA256,
  RECOVERY_CONTINUATION_04_EXECUTION_HEAD,
  RECOVERY_ORIGINAL_HEAD, RECOVERY_ORIGINAL_PREPARE_SHA256, RECOVERY_ORIGINAL_PLAN_SHA256,
  RECOVERY_ORIGINAL_GATE3_SHA256, RECOVERY_ORIGINAL_PREFLIGHT_SHA256,
  RECOVERY_CONTINUATION_03_EXECUTION_HEAD, RECOVERY_CONTINUATION_03_PREFLIGHT_SHA256,
  RECOVERY_CONTINUATION_03_RECEIPT_SHA256,
  RECOVERY_CONTINUATION_02_PREFLIGHT_SHA256, RECOVERY_CONTINUATION_02_RECEIPT_SHA256,
  RECOVERY_CONTINUATION_02_EXECUTION_HEAD,
  PREPARE_RECOVERY_CONTINUATION_02_REL, RECOVERY_FIRST_EXECUTION_HEAD,
  RECOVERY_FIRST_PREFLIGHT_SHA256, RECOVERY_FIRST_RECEIPT_SHA256,
  BASELINE_HEAD, BASELINE_PRODUCTION_WASM_SHA256, BASELINE_PRODUCTION_REPORT_SHA256,
  ACTIVE_EPOCH, PARENT_EPOCH,
  P3_PINNED_SOURCE_COUNT, P1_DIAGNOSTIC_WASM_REL, P1_DIAGNOSTIC_WASM_SHA256,
  BASELINE_INPUT_PATHS, BASELINE_TEST_SOURCE_HASHES,
  PARENT_HEAD, PARENT_PREPARE_SHA256, PARENT_PLAN_SHA256, PARENT_GATE3_SHA256, SOURCE_FILES,
  resolveRoots, readDual, readJsonDual, writeDualImmutable, currentIdentity, verifiedPullRequest,
  verifyIssueApproval, assertPreflightReceiptShape, assertRecoveryPreflightReceiptShape,
  assertPrepareRecoveryReceiptShape, verifyStoredPrepareRecovery, readOriginalMalformedPreparation,
  assertRecoveryContinuation02PreflightReceiptShape, assertPrepareRecoveryContinuation02ReceiptShape,
  assertRecoveryContinuation03PreflightReceiptShape, assertPrepareRecoveryContinuation03ReceiptShape,
  assertRecoveryContinuation04PreflightReceiptShape, assertPrepareRecoveryContinuation04ReceiptShape,
  assertRecoveryContinuation05PriorRootSnapshot, assertRecoveryContinuation05PreflightReceiptShape,
  assertPrepareRecoveryContinuation05ReceiptShape,
  assertContinuation06OfflineHistory, assertRecoveryContinuation06PreflightReceiptShape,
  assertPrepareRecoveryContinuation06ReceiptShape,
  assertContinuation07OfflineHistory, assertRecoveryContinuation07PreflightReceiptShape,
  assertPrepareRecoveryContinuation07ReceiptShape,
  assertRecoveryContinuation02PriorRootSnapshot, assertRecoveryContinuation03PriorRootSnapshot,
  assertRecoveryContinuation04PriorRootSnapshot,
  verifyStoredPrepareRecoveryContinuation02, verifyStoredPrepareRecoveryContinuation03, assertRecoveryRootMembers,
  verifyStoredPrepareRecoveryContinuation04,
  verifyStoredPrepareRecoveryContinuation05,
  verifyStoredPrepareRecoveryContinuation06, verifyStoredPrepareRecoveryContinuation07,
  verifyPrepareRecoveryContinuation02Approval, verifyPrepareRecoveryContinuation03Approval,
  verifyPrepareRecoveryContinuation04Approval,
  verifyPrepareRecoveryContinuation05Approval,
  verifyPrepareRecoveryContinuation06Approval, verifyPrepareRecoveryContinuation07Approval,
  RECOVERY_CONTINUATION_07_ALLOWED_SOURCE_DELTA, verifyRecoverySourceDelta,
  snapshotActiveRootMembers, assertLockedRecoveryPrefix, assertRecoveryFrozenAppendOnly,
  expectedRecoveryOfflineEpoch, recoveryOfflineEpochForMode, recoveryPolicyForMode,
  RECOVERY_FROZEN_PINNED_IDENTITIES, verifyRecoveryPostCTestEvidence,
  expectedRecoveryPreflightHeads,
  assertPinnedRecoveryPrepareBinding,
  expectedRecoveryPreflightHeads,
  classifyFullCTestPreflight, preflightTestEnvironment,
  buildP3SourceManifest, runOfflineFrozenWithP3Sources, preflightFileName,
  verifyPreflightForPrepare, buildPreparePreflightBinding,
  latestOfflineReport, gate3Analysis, verifyDiagnosticBuild, verifyProductionBuild, verifyParentExperiment01,
  parentInventory, verifyParentInventoryUnchanged, preflightExperiment, recoverPreparedExperiment,
  recoverPreparedContinuation02, recoverPreparedContinuation03, recoverPreparedContinuation04,
  recoverPreparedContinuation05, recoverPreparedContinuation06, prepareExperiment,
  recoverPreparedContinuation07,
  combinedExperimentCharge, combinedExperimentCalls,
  frozenSourceSnapshot, frozenSnapshotSha256, assertFrozenSnapshotMatches, sourceSnapshot, readExperimentState, writeFloatWav,
  officialMetricPayload, normalizeAnalyzerMetrics, analyzerFixture, assertAnalyzerContract, captureMetadata, renderCall, referenceRows,
  scoreAlpha, scoreCompletedAlpha, verifiedReceipt, runBounded, verifyStoredAlphaResults, verifyExperiment,
  verifySelectionAfterPromotion, PROMOTION_PATHS, commitChangedPaths, assertPromotionCommit, verifyPromotedAuthority, promoteSelected,
  buildPromotedPair, renderPromotedCell, renderReleaseCell, releaseEquivalenceReport, estimateDualEvidenceBytes,
  assertEvidenceCapacity, stage3Cells,
  stage3Report, renderLifecycleWithAudio, stage4Report, stage4LegacyDocument, runPostStage4FullCTest,
  verifyAcceptanceProgress, continuationDecision, continueApproved,
  status, parseMode, main, summarizePassingCtest};
