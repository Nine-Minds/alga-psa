import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  parseDotenvValue,
  resolveOptions,
  utcTimestamp,
} from '../capture-template-status-mapping-smoke-evidence.mjs';
import {
  ALLOWED_DIRT_LINE,
  CONSOLE_FILE,
  DEV_SERVER_SCAN_JSON,
  DEV_SERVER_SCAN_TXT,
  EVIDENCE_STEPS,
  MANIFEST_FILE,
  NETWORK_FILE,
  REDACTION_PLACEHOLDER,
  RUN_FILE,
  SCREENSHOT_SLOTS,
  SCREENSHOT_NOTES_FILE,
  README_FILE,
  SEED_SQL_RESTORE_FILE,
  VERIFIER_COPY_FILE,
  createContext,
  isValidPng,
  parseArgv,
  runXoverdict,
  verifyBundle,
} from '../verify-template-status-mapping-smoke-evidence.mjs';

const TENANT = 'dd8cb218-d46d-47f3-be27-8aa50aad5fce';
const SEED_TEMPLATE_ID = '7a757765-f26c-4b99-bdb7-f5c919b5dde8';
const KNOWN_MAPPING_ID = 'e757c6dc-d6ab-4ad3-8f53-2117c3d41fcd';
const HEAD_SHA = 'c0818bd08dfa761946a111111111111111111111';
const WORKFLOW_RUN_ID = '22222222-2222-4222-8222-222222222222';
const APPLIED_PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = 'dd0fc9af-a8e3-4fe6-b0f6-78b9fd67a42c';
const BROWSER_PANE = '43218e9e-e1ea-49b5-9a7b-186dec8a09f4';
const DEV_SERVER_SESSION = 'card-service:dd0fc9af-a8e3-4fe6-b0f6-78b9fd67a42c:dev-server:3';
const WORKTREE = '/home/robert/alga-copies/fix-template-status-mapping-fk';

// A structurally valid 1x1 PNG (base64). Every "complete" screenshot slot must
// carry a real PNG, not arbitrary bytes.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const MAPPING_ROWS = [
  { template_status_mapping_id: 'e757c6dc-d6ab-4ad3-8f53-2117c3d41fcd', status_source: 'tenant', status_id: '314c7eed-5902-48ee-bab2-1cf82983f124', standard_status_id: null, unresolved_status_id: null, unresolved_reason: null, display_order: 1 },
  { template_status_mapping_id: '6f2795ad-05dd-4c44-a502-34dde3ab642c', status_source: 'tenant', status_id: 'acbd615e-3a0b-42f3-97e8-060462d65fdc', standard_status_id: null, unresolved_status_id: null, unresolved_reason: null, display_order: 2 },
  { template_status_mapping_id: '367e48f3-deba-43fe-9934-8c4e55715552', status_source: 'tenant', status_id: 'cdd35782-c266-41d1-99d6-f483aa655a44', standard_status_id: null, unresolved_status_id: null, unresolved_reason: null, display_order: 3 },
  { template_status_mapping_id: '16360d43-6a5d-441c-91d9-e5e2b2f4e9bb', status_source: 'tenant', status_id: '4e75503c-6879-4e61-a5bd-0ecc91c7cabc', standard_status_id: null, unresolved_status_id: null, unresolved_reason: null, display_order: 4 },
];

// The broken fixture: the first mapping quarantined as unresolved/missing, the
// third as unresolved/ambiguous, the second as standard (To Do).
const BROKEN_STATE = [
  { template_status_mapping_id: 'e757c6dc-d6ab-4ad3-8f53-2117c3d41fcd', status_source: 'unresolved', status_id: null, standard_status_id: null, unresolved_status_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', unresolved_reason: 'missing', display_order: 1 },
  { template_status_mapping_id: '6f2795ad-05dd-4c44-a502-34dde3ab642c', status_source: 'standard', status_id: null, standard_status_id: '90d706a0-1911-460c-9e38-4159e8b059e2', unresolved_status_id: null, unresolved_reason: null, display_order: 2 },
  { template_status_mapping_id: '367e48f3-deba-43fe-9934-8c4e55715552', status_source: 'unresolved', status_id: null, standard_status_id: null, unresolved_status_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', unresolved_reason: 'ambiguous', display_order: 3 },
  { template_status_mapping_id: '16360d43-6a5d-441c-91d9-e5e2b2f4e9bb', status_source: 'tenant', status_id: '4e75503c-6879-4e61-a5bd-0ecc91c7cabc', standard_status_id: null, unresolved_status_id: null, unresolved_reason: null, display_order: 4 },
];

const TYPED_PROJECT_MAPPINGS = [
  { project_status_mapping_id: 'aaa00001-0000-4000-8000-000000000001', status_id: null, standard_status_id: '90d706a0-1911-460c-9e38-4159e8b059e2', is_standard: true, display_order: 1 },
  { project_status_mapping_id: 'aaa00001-0000-4000-8000-000000000002', status_id: '314c7eed-5902-48ee-bab2-1cf82983f124', standard_status_id: null, is_standard: false, display_order: 2 },
];

function makeStepJson(stepName, structuredData, assertions, queries) {
  return {
    step: stepName,
    startedAt: '2026-08-10T13:00:00.000Z',
    rawOutputFile: EVIDENCE_STEPS[stepName].txt,
    queries,
    assertions,
    structuredData,
  };
}

function makeQuery(name, description, sql, { expectError = false } = {}) {
  if (expectError) {
    return {
      name,
      description,
      sql,
      command: `PGPASSWORD='${REDACTION_PLACEHOLDER}' psql ...`,
      tuple: null,
      aligned: {
        exitCode: 1,
        stdout: '',
        stderr: 'ERROR: update or delete on table "statuses" violates foreign key constraint "project_template_status_mappings_tenant_status_id_foreign"',
      },
      expectError: true,
      exitCode: 1,
      stderr: 'ERROR: update or delete on table "statuses" violates foreign key constraint',
    };
  }
  return {
    name,
    description,
    sql,
    command: `PGPASSWORD='${REDACTION_PLACEHOLDER}' psql ...`,
    tuple: { exitCode: 0, stdout: '1\n', stderr: '' },
    aligned: { exitCode: 0, stdout: ' 1\n', stderr: '' },
  };
}

function defaultQueries(stepName) {
  if (stepName === 'before') {
    return [
      makeQuery('seed-template-original', 'baseline', 'SELECT 1'),
      makeQuery('task-assignments-before', '21 tasks', 'SELECT count(*)'),
      makeQuery('seed-template-broken-state', 'broken rows', 'SELECT to_jsonb(x)'),
      makeQuery('unresolved-count-broken', 'two unresolved', 'SELECT count(*)'),
      makeQuery('deletion-guard-template-usage', 'usage', 'SELECT ... GROUP BY'),
      makeQuery('deletion-guard-fk-restrict', 'fk guard', 'DELETE FROM statuses', { expectError: true }),
      makeQuery('project-count-at-init', 'baseline count', 'SELECT count(*)'),
      makeQuery('attempted-project-count-before', 'zero', 'SELECT count(*)'),
      makeQuery('valid-template-mappings', 'valid rows', 'SELECT to_jsonb(x)'),
    ];
  }
  if (stepName === 'after-apply') {
    return [
      makeQuery('applied-project-id', 'locate', 'SELECT project_id'),
      makeQuery('typed-project-mappings', 'typed rows', 'SELECT to_jsonb(x)'),
      makeQuery('project-count-after-valid-apply', 'count', 'SELECT count(*)'),
      makeQuery('attempted-project-count-before-global-attempt', 'zero', 'SELECT count(*)'),
    ];
  }
  if (stepName === 'after-replace') {
    return [
      makeQuery('replaced-mapping-row', 'row', 'SELECT to_jsonb(x)'),
      makeQuery('task-assignments-after', '21 tasks', 'SELECT count(*)'),
      makeQuery('unresolved-count-after-replace', 'one', 'SELECT count(*)'),
    ];
  }
  if (stepName === 'after-global-reject') {
    return [
      makeQuery('project-count-after-global-reject', 'count', 'SELECT count(*)'),
      makeQuery('attempted-project-count-after', 'zero', 'SELECT count(*)'),
    ];
  }
  return [
    makeQuery('seed-template-after-restore', 'restored rows', 'SELECT to_jsonb(x)'),
    makeQuery('task-assignments-after-restore', '21 tasks', 'SELECT count(*)'),
    makeQuery('unresolved-count-after-restore', 'zero', 'SELECT count(*)'),
    makeQuery('valid-template-removed', 'gone', 'SELECT count(*)'),
  ];
}

const STEP_FIXTURES = {
  before: {
    structuredData: {
      seedTemplateOriginal: MAPPING_ROWS,
      taskAssignmentCountBefore: 21,
      fixtureBrokenState: BROKEN_STATE,
      unresolvedCountBroken: 2,
      deletionGuardTemplateUsage: { templateCount: 1, rows: [{ templateId: SEED_TEMPLATE_ID, templateName: 'Down the Rabbit Hole Migration', mappingCount: 1 }] },
      deletionGuardFkRestrict: { exitCode: 1, matched: true },
      projectCountAtInit: 12,
      attemptedProjectCountAtInit: 0,
      validTemplateMappings: [],
    },
    assertions: [
      { id: 'task-assignments-before-replacement', description: 'x', passed: true },
      { id: 'unresolved-count-broken', description: 'x', passed: true },
      { id: 'deletion-guard-template-usage', description: 'x', passed: true },
      { id: 'deletion-guard-fk-restrict', description: 'x', passed: true },
      { id: 'attempted-project-count-before', description: 'x', passed: true },
    ],
  },
  'after-apply': {
    structuredData: {
      appliedProjectId: APPLIED_PROJECT_ID,
      typedProjectMappings: TYPED_PROJECT_MAPPINGS,
      projectCountAfterValidApply: 13,
      attemptedProjectCountBefore: 0,
    },
    assertions: [
      { id: 'applied-project-created', description: 'x', passed: true },
      { id: 'typed-project-mappings-standard', description: 'x', passed: true },
      { id: 'typed-project-mappings-tenant', description: 'x', passed: true },
      { id: 'attempted-project-count-before-global-attempt', description: 'x', passed: true },
    ],
  },
  'after-replace': {
    structuredData: {
      replacedMappingRow: { template_status_mapping_id: KNOWN_MAPPING_ID, template_id: SEED_TEMPLATE_ID, status_source: 'tenant', status_id: '314c7eed-5902-48ee-bab2-1cf82983f124', standard_status_id: null, unresolved_status_id: null, unresolved_reason: null, display_order: 1 },
      taskAssignmentCountAfter: 21,
      unresolvedCountAfterReplace: 1,
    },
    assertions: [
      { id: 'mapping-identity-preserved', description: 'x', passed: true },
      { id: 'mapping-now-tenant', description: 'x', passed: true },
      { id: 'task-assignments-after-replacement', description: 'x', passed: true },
      { id: 'unresolved-count-after-replace', description: 'x', passed: true },
    ],
  },
  'after-global-reject': {
    structuredData: {
      projectCountAfter: 13,
      attemptedProjectCountAfter: 0,
    },
    assertions: [
      { id: 'global-apply-zero-projects', description: 'x', passed: true },
      { id: 'global-apply-total-count-unchanged', description: 'x', passed: true },
    ],
  },
  restore: {
    structuredData: {
      seedTemplateAfterRestore: MAPPING_ROWS,
      taskAssignmentCountAfterRestore: 21,
      unresolvedCountAfterRestore: 0,
      validTemplateCountAfter: 0,
    },
    assertions: [
      { id: 'seed-template-restored-exact', description: 'x', passed: true },
      { id: 'task-assignments-after-restore', description: 'x', passed: true },
      { id: 'unresolved-count-after-restore', description: 'x', passed: true },
      { id: 'valid-template-removed', description: 'x', passed: true },
    ],
  },
};

function defaultVerifyOptions(overrides = {}) {
  return {
    expectedRunId: WORKFLOW_RUN_ID,
    expectedHeadSha: HEAD_SHA,
    expectedWorktree: WORKTREE,
    expectedPane: BROWSER_PANE,
    expectedServerUrl: 'http://localhost:3517',
    expectedDevServerSession: DEV_SERVER_SESSION,
    ...overrides,
  };
}

function writeSyntheticBundle(bundleDir, {
  pendingWithoutInstructions = false,
  tamperScreenshot = false,
} = {}) {
  fs.mkdirSync(bundleDir, { recursive: true });

  fs.writeFileSync(path.join(bundleDir, RUN_FILE), JSON.stringify({
    workflowRunId: WORKFLOW_RUN_ID,
    workflowRunIdDiscoveredFrom: 'alga-dev workflow-get-project (single running run)',
    startedAt: '2026-08-10T12:59:00.000Z',
    appUrl: 'http://localhost:3517',
    tenantId: TENANT,
    seedTemplateId: SEED_TEMPLATE_ID,
    knownMappingId: KNOWN_MAPPING_ID,
    expectedTaskCount: 21,
    replaceTargetStatusId: '314c7eed-5902-48ee-bab2-1cf82983f124',
    deletionGuardStatusId: 'acbd615e-3a0b-42f3-97e8-060462d65fdc',
  }, null, 2));

  fs.writeFileSync(path.join(bundleDir, '01-git-head.txt'), `HEAD ${HEAD_SHA}\nbranch fix/template-status-mapping-fk\n`);
  fs.writeFileSync(path.join(bundleDir, '01-git-status.txt'), ' M package-lock.json\n');
  fs.writeFileSync(path.join(bundleDir, '01-environment.json'), JSON.stringify({
    serverUrl: 'http://localhost:3517',
    serverPort: 3517,
    dbHost: '127.0.0.1',
    dbPort: 5472,
    dbName: 'server',
    dbUser: 'app_user',
    worktreePath: WORKTREE,
    devServerService: 'dev-server',
    devServerSessionId: DEV_SERVER_SESSION,
    browserPane: BROWSER_PANE,
    dbPortSource: 'direct Postgres; app uses pgbouncer DB_PORT 6472',
    credentialsDerivation: 'extracted from server/.env.local keys DB_HOST / DB_USER_SERVER / DB_PASSWORD_SERVER / DB_NAME_SERVER; see README.md',
  }, null, 2));
  fs.writeFileSync(path.join(bundleDir, '10-fixture-seed.sql'), '-- synthetic seed\n');
  fs.writeFileSync(path.join(bundleDir, SEED_SQL_RESTORE_FILE), '-- synthetic restore (no retained project id referenced)\n');

  for (const [stepName, data] of Object.entries(STEP_FIXTURES)) {
    const { json, txt } = EVIDENCE_STEPS[stepName];
    fs.writeFileSync(path.join(bundleDir, json), JSON.stringify(makeStepJson(stepName, data.structuredData, data.assertions, defaultQueries(stepName)), null, 2));
    fs.writeFileSync(path.join(bundleDir, txt), `# ${stepName}\n\n$ PGPASSWORD='${REDACTION_PLACEHOLDER}' psql ...\n1\n`);
  }

  const screenshotNotes = {
    workflowRunId: WORKFLOW_RUN_ID,
    slots: SCREENSHOT_SLOTS.map((slot, index) => {
      const filePath = path.join(bundleDir, slot.file);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, PNG_BYTES);
      const entry = {
        ...slot,
        status: 'complete',
        url: 'http://localhost:3517/msp/projects/templates/7a757765-f26c-4b99-bdb7-f5c919b5dde8',
        pageText: 'template details smoke',
        capturedAt: '2026-08-10T13:10:00.000Z',
        sourcePane: BROWSER_PANE,
        instructions: null,
      };
      if (index === 0 && pendingWithoutInstructions) {
        entry.status = 'pending';
        entry.instructions = null;
        entry.url = null;
        entry.pageText = null;
        entry.capturedAt = null;
        entry.sourcePane = null;
      }
      return entry;
    }),
  };
  fs.writeFileSync(path.join(bundleDir, SCREENSHOT_NOTES_FILE), JSON.stringify(screenshotNotes, null, 2));

  fs.writeFileSync(path.join(bundleDir, '92-artifacts.json'), JSON.stringify({ workflowRunId: WORKFLOW_RUN_ID, artifacts: [] }, null, 2));
  fs.writeFileSync(path.join(bundleDir, '93-manual-actions.json'), JSON.stringify({ workflowRunId: WORKFLOW_RUN_ID, order: [] }, null, 2));

  fs.writeFileSync(path.join(bundleDir, DEV_SERVER_SCAN_JSON), JSON.stringify({
    capturedAt: '2026-08-10T13:11:00.000Z',
    scannedFor: ['generic error', 'unhandled rejection'],
    scanCommand: `alga-dev terminal-get-history --sessionId=${DEV_SERVER_SESSION}`,
    rawOutputFile: DEV_SERVER_SCAN_TXT,
    matches: [],
    matchCount: 0,
    ok: true,
    note: 'Raw dev-server scrollback recorded below.',
    serviceName: 'dev-server',
    sessionId: DEV_SERVER_SESSION,
    worktreePath: WORKTREE,
  }, null, 2));
  fs.writeFileSync(path.join(bundleDir, DEV_SERVER_SCAN_TXT), `# scan\n\n$ alga-dev terminal-get-history --sessionId=${DEV_SERVER_SESSION}\n\n# Matching error-pattern lines (0):\n# (none)\n`);
  fs.writeFileSync(path.join(bundleDir, CONSOLE_FILE), JSON.stringify({
    capturedAt: '2026-08-10T13:11:00.000Z',
    scanCommand: 'alga-dev browser-get-console --level error',
    entries: [],
    errors: [],
    rawExitCode: 0,
    paneId: BROWSER_PANE,
  }, null, 2));
  fs.writeFileSync(path.join(bundleDir, NETWORK_FILE), JSON.stringify({
    capturedAt: '2026-08-10T13:11:00.000Z',
    scanCommand: 'alga-dev browser-get-network --failedOnly',
    failedRequests: [],
    rawExitCode: 0,
    paneId: BROWSER_PANE,
  }, null, 2));

  fs.writeFileSync(path.join(bundleDir, README_FILE), [
    '# Template status mapping smoke evidence — README',
    '',
    'Connection derivation: server/.env.local DB_PASSWORD_SERVER, DB_HOST, DB_USER_SERVER, DB_NAME_SERVER;',
    `redacted via ${REDACTION_PLACEHOLDER}; direct Postgres 127.0.0.1:5472; app pgbouncer DB_PORT 6472.`,
    '',
  ].join('\n'));

  fs.writeFileSync(path.join(bundleDir, MANIFEST_FILE), JSON.stringify({
    workflowRunId: WORKFLOW_RUN_ID,
    headSha: HEAD_SHA,
    branch: 'fix/template-status-mapping-fk',
    gitStatus: [' M package-lock.json'],
    gitStatusNote: 'package-lock.json is dirty and is recorded, not touched.',
    timestamp: '2026-08-10T13:12:00.000Z',
    environment: {
      serverUrl: 'http://localhost:3517',
      serverPort: 3517,
      dbHost: '127.0.0.1',
      dbPort: 5472,
      dbName: 'server',
      dbUser: 'app_user',
      worktreePath: WORKTREE,
      devServerService: 'dev-server',
      devServerSessionId: DEV_SERVER_SESSION,
      browserPane: BROWSER_PANE,
      dbPortSource: 'direct Postgres; app uses pgbouncer DB_PORT 6472',
      credentialsDerivation: 'extracted from server/.env.local keys DB_HOST / DB_USER_SERVER / DB_PASSWORD_SERVER / DB_NAME_SERVER; see README.md',
    },
    captureIdentity: {
      projectId: PROJECT_ID,
      workflowRunId: WORKFLOW_RUN_ID,
      worktreePath: WORKTREE,
      serverUrl: 'http://localhost:3517',
      serverPort: 3517,
      devServerService: 'dev-server',
      devServerSessionId: DEV_SERVER_SESSION,
      browserPane: BROWSER_PANE,
    },
    cleanup: {
      seeded: true,
      restored: true,
      restoredAt: '2026-08-10T13:13:00.000Z',
      retainedProjects: [{ id: APPLIED_PROJECT_ID, name: 'SMOKE Template Status Mappings' }],
      retainedNote: 'The applied smoke project is intentionally retained.',
    },
    screenshotSlots: {
      workflowRunId: WORKFLOW_RUN_ID,
      slots: screenshotNotes.slots.map((slot) => ({
        id: slot.id,
        file: slot.file,
        status: slot.status,
        sha256: slot.status === 'complete' ? crypto.createHash('sha256').update(fs.readFileSync(path.join(bundleDir, slot.file))).digest('hex') : null,
      })),
    },
    stepLog: [{ command: 'init', at: '2026-08-10T13:00:00.000Z', result: 'seeded fixture' }],
    artifacts: [],
  }, null, 2));

  fs.copyFileSync(new URL('../verify-template-status-mapping-smoke-evidence.mjs', import.meta.url).pathname, path.join(bundleDir, VERIFIER_COPY_FILE));

  const walk = (dir) => {
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = path.relative(bundleDir, full);
      if (fs.statSync(full).isDirectory()) {
        out.push(...walk(full));
      } else {
        out.push(rel);
      }
    }
    return out;
  };
  const checksumLines = walk(bundleDir)
    .filter((name) => name !== 'SHA256SUMS')
    .map((name) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(bundleDir, name))).digest('hex')}  ${name}`);
  fs.writeFileSync(path.join(bundleDir, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`);

  if (tamperScreenshot) {
    const target = SCREENSHOT_SLOTS[1].file;
    fs.writeFileSync(path.join(bundleDir, target), crypto.randomBytes(64));
  }
}

function makeTempBundle(name, options = {}) {
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), `smoke-${name}-`));
  writeSyntheticBundle(bundleDir, options);
  return bundleDir;
}

function readJson(bundleDir, name) {
  return JSON.parse(fs.readFileSync(path.join(bundleDir, name), 'utf8'));
}

function writeJson(bundleDir, name, value) {
  fs.writeFileSync(path.join(bundleDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function runInit(bundleDir, extraArgs = [], env = {}) {
  const scriptPath = path.join(WORKTREE, 'scripts', 'capture-template-status-mapping-smoke-evidence.mjs');
  return spawnSync(process.execPath, [scriptPath, 'init', '--bundle', bundleDir, ...extraArgs], {
    cwd: WORKTREE,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

// Drive commandInit through the module-load-only concurrent-creator injection
// seam (the second testHooks argument, which the CLI entry path can never
// supply), so the seam is reachable while the rejection/exit behavior stays
// observable as a black box.
function runInitWithInjection(bundleDir, filename) {
  const scriptPath = path.join(WORKTREE, 'scripts', 'capture-template-status-mapping-smoke-evidence.mjs');
  const moduleUrl = pathToFileURL(scriptPath).href;
  const bootstrap = [
    `import { commandInit } from ${JSON.stringify(moduleUrl)};`,
    'const opts = { bundle: process.argv[1] };',
    'const testHooks = {};',
    'if (process.argv[2] !== undefined) { testHooks.concurrentCreatorFilename = process.argv[2]; }',
    'commandInit(opts, testHooks);',
  ].join('\n');
  return spawnSync(process.execPath, ['--input-type=module', '-e', bootstrap, bundleDir, filename], {
    cwd: WORKTREE,
    encoding: 'utf8',
    env: { ...process.env },
  });
}

test('utcTimestamp produces YYYYMMDDTHHMMSSZ', () => {
  assert.match(utcTimestamp(new Date('2026-08-10T13:14:15.123Z')), /^20260810T131415Z$/);
});

test('parseDotenvValue handles quoted and unquoted values', () => {
  assert.equal(parseDotenvValue('A="v1"\nB=\'v2\'\nC=plain\n#D=comment\n', 'B'), 'v2');
  assert.equal(parseDotenvValue('A="v1"', 'A'), 'v1');
  assert.equal(parseDotenvValue('B=secret', 'A'), null);
});

test('resolveOptions parses positionals and booleans', () => {
  const { command, opts } = resolveOptions(['capture', 'after-apply', '--bundle', '/tmp/x', '--force']);
  assert.equal(command, 'capture');
  assert.equal(opts.capture, 'after-apply');
  assert.equal(opts.bundle, '/tmp/x');
  assert.equal(opts.force, true);
});

test('isValidPng accepts a real PNG and rejects arbitrary bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'png-'));
  const good = path.join(dir, 'good.png');
  fs.writeFileSync(good, PNG_BYTES);
  assert.equal(isValidPng(good), true);
  const bad = path.join(dir, 'bad.png');
  fs.writeFileSync(bad, crypto.randomBytes(64));
  assert.equal(isValidPng(bad), false);
  const empty = path.join(dir, 'empty.png');
  fs.writeFileSync(empty, Buffer.alloc(0));
  assert.equal(isValidPng(empty), false);
});

test('verifyBundle PASSES a complete synthetic bundle', () => {
  const bundleDir = makeTempBundle('ok');
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, true, JSON.stringify(result.failures, null, 2));
  assert.equal(result.screenshots.complete, SCREENSHOT_SLOTS.length);
  assert.equal(result.screenshots.pending, 0);
  assert.equal(result.headSha, HEAD_SHA);
  assert.match(result.bundleDigest, /^[0-9a-f]{64}$/);
});

test('verifyBundle REJECTS an invocation against a different workflow run id', () => {
  const bundleDir = makeTempBundle('runmismatch');
  const result = verifyBundle(bundleDir, defaultVerifyOptions({ expectedRunId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }));
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('invoked against')));
});

test('verifyBundle REJECTS a manifest with a different workflow run id', () => {
  const bundleDir = makeTempBundle('runmanifest');
  const manifest = readJson(bundleDir, MANIFEST_FILE);
  manifest.workflowRunId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  writeJson(bundleDir, MANIFEST_FILE, manifest);
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('records run')));
});

test('verifyBundle REJECTS an invocation against a different HEAD sha', () => {
  const bundleDir = makeTempBundle('headmismatch');
  const result = verifyBundle(bundleDir, defaultVerifyOptions({ expectedHeadSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }));
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('invoked against')));
});

test('verifyBundle REJECTS a bundle with missing provenance fields', () => {
  const bundleDir = makeTempBundle('missingprovenance');
  const manifest = readJson(bundleDir, MANIFEST_FILE);
  delete manifest.captureIdentity;
  writeJson(bundleDir, MANIFEST_FILE, manifest);
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('capture source identity')));
});

test('verifyBundle REJECTS a bundle with missing cleanup declarations', () => {
  const bundleDir = makeTempBundle('missingcleanup');
  const manifest = readJson(bundleDir, MANIFEST_FILE);
  delete manifest.cleanup;
  writeJson(bundleDir, MANIFEST_FILE, manifest);
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('cleanup state')));
});

test('verifyBundle REJECTS the verifier itself when invoked without provenance', () => {
  const bundleDir = makeTempBundle('noprov');
  const result = verifyBundle(bundleDir);
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('--run-id')));
  assert.ok(result.failures.some((failure) => failure.includes('--head-sha')));
});

test('verifyBundle REJECTS an empty query result set where evidence SQL must return rows', () => {
  const bundleDir = makeTempBundle('emptyquery');
  const record = readJson(bundleDir, EVIDENCE_STEPS.before.json);
  record.queries[1].tuple = { exitCode: 0, stdout: '', stderr: '' };
  record.queries[1].aligned = { exitCode: 0, stdout: '', stderr: '' };
  writeJson(bundleDir, EVIDENCE_STEPS.before.json, record);
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('empty result set')));
});

test('verifyBundle REJECTS an evidence query that exited nonzero', () => {
  const bundleDir = makeTempBundle('queryfail');
  const record = readJson(bundleDir, EVIDENCE_STEPS['after-apply'].json);
  record.queries[0].tuple = { exitCode: 1, stdout: '', stderr: 'connection refused' };
  record.queries[0].aligned = { exitCode: 1, stdout: '', stderr: 'connection refused' };
  writeJson(bundleDir, EVIDENCE_STEPS['after-apply'].json, record);
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('exited 1')));
});

test('verifyBundle REJECTS a failed browser console capture', () => {
  const bundleDir = makeTempBundle('consolefail');
  const consoleCapture = readJson(bundleDir, CONSOLE_FILE);
  consoleCapture.rawExitCode = 1;
  consoleCapture.rawStderr = 'Error: Multiple browser panes found; pass --paneId';
  writeJson(bundleDir, CONSOLE_FILE, consoleCapture);
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('failed browser capture')));
});

test('verifyBundle REJECTS a browser capture without a pane id', () => {
  const bundleDir = makeTempBundle('nopane');
  const networkCapture = readJson(bundleDir, NETWORK_FILE);
  delete networkCapture.paneId;
  writeJson(bundleDir, NETWORK_FILE, networkCapture);
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('does not record the browser pane')));
});

test('verifyBundle REJECTS a browser capture from a different pane than invoked', () => {
  const bundleDir = makeTempBundle('wrongpane');
  const result = verifyBundle(bundleDir, defaultVerifyOptions({ expectedPane: '00000000-0000-4000-8000-000000000000' }));
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('invoked against')));
});

test('verifyBundle REJECTS a dev-server scan from a different service session than invoked', () => {
  const bundleDir = makeTempBundle('wrongsession');
  const scan = readJson(bundleDir, DEV_SERVER_SCAN_JSON);
  scan.sessionId = 'card-service:other:dev-server:9';
  writeJson(bundleDir, DEV_SERVER_SCAN_JSON, scan);
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('invoked against')));
});

test('verifyBundle REJECTS a dev-server scan that did not succeed', () => {
  const bundleDir = makeTempBundle('scannotok');
  const scan = readJson(bundleDir, DEV_SERVER_SCAN_JSON);
  scan.ok = false;
  scan.note = 'Dev-server scan unavailable: workflow-list-services exited 1';
  writeJson(bundleDir, DEV_SERVER_SCAN_JSON, scan);
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('did not succeed')));
});

test('verifyBundle REJECTS a non-PNG screenshot (arbitrary bytes)', () => {
  const bundleDir = makeTempBundle('nonpng');
  const target = SCREENSHOT_SLOTS[1].file;
  fs.writeFileSync(path.join(bundleDir, target), crypto.randomBytes(64));
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('not a structurally valid PNG')));
});

test('verifyBundle REJECTS a zero-length screenshot', () => {
  const bundleDir = makeTempBundle('zeroshot');
  const target = SCREENSHOT_SLOTS[1].file;
  fs.writeFileSync(path.join(bundleDir, target), Buffer.alloc(0));
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('zero-length')));
});

test('verifyBundle REJECTS an inconsistent cleanup declaration (retained project mismatch)', () => {
  const bundleDir = makeTempBundle('cleanupmismatch');
  const manifest = readJson(bundleDir, MANIFEST_FILE);
  manifest.cleanup.retainedProjects = [{ id: '99999999-9999-4999-8999-999999999999', name: 'Other' }];
  writeJson(bundleDir, MANIFEST_FILE, manifest);
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('retained projects') && failure.includes('applied project')));
});

test('verifyBundle REJECTS cleanup that claims restoration while the seed template differs from baseline', () => {
  const bundleDir = makeTempBundle('cleanuprestore');
  const record = readJson(bundleDir, EVIDENCE_STEPS.restore.json);
  record.structuredData.seedTemplateAfterRestore = BROKEN_STATE;
  writeJson(bundleDir, EVIDENCE_STEPS.restore.json, record);
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('not restored to its original baseline')));
});

test('verifyBundle REJECTS cleanup that claims seeding while the fixture was never actually broken', () => {
  const bundleDir = makeTempBundle('cleanupseed');
  const record = readJson(bundleDir, EVIDENCE_STEPS.before.json);
  record.structuredData.fixtureBrokenState = MAPPING_ROWS;
  record.structuredData.unresolvedCountBroken = 0;
  writeJson(bundleDir, EVIDENCE_STEPS.before.json, record);
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('unresolved mappings')));
});

test('verifyBundle REJECTS a retained project referenced by the restore SQL', () => {
  const bundleDir = makeTempBundle('retaineddeleted');
  fs.writeFileSync(path.join(bundleDir, SEED_SQL_RESTORE_FILE), `DELETE FROM projects WHERE project_id = '${APPLIED_PROJECT_ID}';\n`);
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('restore SQL references it')));
});

test('verifyBundle FAILS on a tampered screenshot', () => {
  const bundleDir = makeTempBundle('tamper', { tamperScreenshot: true });
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('does not match its SHA256SUMS entry')));
});

test('verifyBundle FAILS on a PENDING slot without instructions', () => {
  const bundleDir = makeTempBundle('pending', { pendingWithoutInstructions: true });
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('PENDING without an exact capture instruction')));
});

test('verifyBundle FAILS when restoration does not match the baseline', () => {
  const bundleDir = makeTempBundle('restore');
  const record = readJson(bundleDir, EVIDENCE_STEPS.restore.json);
  record.structuredData.seedTemplateAfterRestore = MAPPING_ROWS.map((row, index) => (index === 0 ? { ...row, status_source: 'unresolved' } : row));
  writeJson(bundleDir, EVIDENCE_STEPS.restore.json, record);
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('seed template was not restored exactly')));
});

test('createContext rejects path escapes', () => {
  const bundleDir = makeTempBundle('escape');
  const context = createContext(bundleDir);
  assert.throws(() => context.filePath('..'));
});

test('init rejects a pre-existing --bundle directory and leaves it untouched', () => {
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preexisting-bundle-'));
  const sentinelPath = path.join(bundleDir, 'sentinel.txt');
  const sentinelContents = 'KEEP';
  fs.writeFileSync(sentinelPath, sentinelContents);

  const result = runInit(bundleDir);

  assert.notEqual(result.status, 0, `expected nonzero exit; stderr: ${result.stderr}`);
  assert.match(result.stderr, /bundle directory already exists/);
  assert.equal(fs.existsSync(bundleDir), true, 'the pre-existing bundle directory must survive the rejection');
  assert.equal(fs.readFileSync(sentinelPath, 'utf8'), sentinelContents);
});

test('init removes a bundle directory it created when a later step fails', () => {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'created-bundle-parent-'));
  const bundleDir = path.join(parentDir, 'harness-created-bundle');
  assert.equal(fs.existsSync(bundleDir), false);

  const result = runInit(bundleDir, ['--db-port', '1']);

  assert.notEqual(result.status, 0, `expected nonzero exit; stderr: ${result.stderr}`);
  assert.equal(fs.existsSync(bundleDir), false, 'a harness-created incomplete bundle must be removed on init failure');
});

test('init treats a concurrently created bundle directory as caller-owned and leaves it and its contents untouched', () => {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'concurrent-bundle-parent-'));
  const bundleDir = path.join(parentDir, 'concurrent-creator-bundle');
  assert.equal(fs.existsSync(bundleDir), false);

  const result = runInitWithInjection(bundleDir, 'sentinel.txt');

  assert.notEqual(result.status, 0, `expected nonzero exit; stderr: ${result.stderr}`);
  assert.match(result.stderr, /bundle directory already exists/);
  assert.equal(fs.existsSync(bundleDir), true, 'the concurrently created bundle directory must survive the rejection');
  assert.equal(fs.readFileSync(path.join(bundleDir, 'sentinel.txt'), 'utf8'), 'KEEP', 'the concurrently written sentinel must survive the rejection');
});

test('test injection rejects a path-traversal filename without writing outside the bundle directory', () => {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'escape-parent-'));
  const bundleDir = path.join(parentDir, 'escape-bundle');
  const escapeTarget = path.join(parentDir, 'escaped.txt');
  assert.equal(fs.existsSync(escapeTarget), false);

  const result = runInitWithInjection(bundleDir, '../escaped.txt');

  assert.notEqual(result.status, 0, `expected nonzero exit; stderr: ${result.stderr}`);
  assert.match(result.stderr, /invalid test injection filename/);
  assert.equal(fs.existsSync(escapeTarget), false, 'the traversal target must not be created outside the bundle directory');
  assert.equal(fs.existsSync(bundleDir), false, 'no bundle directory may be created when the injection is rejected');
});

test('test injection rejects an absolute-path filename without writing at that path', () => {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abs-parent-'));
  const bundleDir = path.join(parentDir, 'abs-bundle');
  const absoluteTarget = path.join(parentDir, 'escaped.txt');

  const result = runInitWithInjection(bundleDir, absoluteTarget);

  assert.notEqual(result.status, 0, `expected nonzero exit; stderr: ${result.stderr}`);
  assert.match(result.stderr, /invalid test injection filename/);
  assert.equal(fs.existsSync(absoluteTarget), false, 'the absolute-path target must not be created');
});

test('test injection rejects a filename containing path separators', () => {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sep-parent-'));
  const bundleDir = path.join(parentDir, 'sep-bundle');

  const result = runInitWithInjection(bundleDir, 'a/b.txt');

  assert.notEqual(result.status, 0, `expected nonzero exit; stderr: ${result.stderr}`);
  assert.match(result.stderr, /invalid test injection filename/);
  assert.equal(fs.existsSync(path.join(bundleDir, 'a')), false, 'no nested directory may be created inside the bundle');
});

test('test injection never overwrites an existing file', () => {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overwrite-parent-'));
  const bundleDir = path.join(parentDir, 'overwrite-bundle');
  fs.mkdirSync(bundleDir);
  const sentinelPath = path.join(bundleDir, 'sentinel.txt');
  fs.writeFileSync(sentinelPath, 'ORIGINAL');

  const result = runInitWithInjection(bundleDir, 'sentinel.txt');

  assert.notEqual(result.status, 0, `expected nonzero exit; stderr: ${result.stderr}`);
  assert.match(result.stderr, /bundle directory already exists/);
  assert.equal(fs.readFileSync(sentinelPath, 'utf8'), 'ORIGINAL', 'the existing file must not be overwritten by the sentinel write');
});

test('SMOKE_TEST_INJECT_CONCURRENT_BUNDLE is inert in normal CLI execution', () => {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inert-parent-'));
  const bundleDir = path.join(parentDir, 'inert-bundle');
  const escapeTarget = path.join(parentDir, 'escaped.txt');

  const result = runInit(bundleDir, ['--db-port', '1'], { SMOKE_TEST_INJECT_CONCURRENT_BUNDLE: '../escaped.txt' });

  assert.notEqual(result.status, 0, `expected nonzero exit; stderr: ${result.stderr}`);
  assert.doesNotMatch(result.stderr, /bundle directory already exists/, 'the env var must not pre-create the bundle directory');
  assert.equal(fs.existsSync(escapeTarget), false, 'the malicious env value must not write outside the bundle directory');
  assert.equal(fs.existsSync(bundleDir), false, 'a harness-created bundle must be cleaned up on init failure');
});

test('the test-concurrent-creator CLI flag cannot reach the injection seam', () => {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliflag-parent-'));
  const bundleDir = path.join(parentDir, 'cliflag-bundle');

  const withFlag = runInit(bundleDir, ['--test-concurrent-creator=evil.txt', '--db-port', '1']);
  const withoutFlag = runInit(bundleDir, ['--db-port', '1']);

  assert.notEqual(withFlag.status, 0, `expected nonzero exit; stderr: ${withFlag.stderr}`);
  assert.doesNotMatch(withFlag.stderr, /bundle directory already exists/, 'the CLI flag must not pre-create the bundle directory');
  assert.equal(fs.existsSync(path.join(bundleDir, 'evil.txt')), false, 'no sentinel file may be created from a CLI flag');
  assert.equal(fs.existsSync(bundleDir), false, 'a harness-created bundle must be cleaned up on init failure');
  assert.equal(withFlag.status, withoutFlag.status, 'the flag must not change the exit code');
  assert.equal(withFlag.stdout, withoutFlag.stdout, 'the flag must not change the stdout');
  assert.equal(withFlag.stderr, withoutFlag.stderr, 'the flag must not change the stderr');
});

// ---------------------------------------------------------------------------
// Compact run-bound verification surface (--xoverdict): hermetic live providers
// ---------------------------------------------------------------------------

// Fake psql dispatcher for the xoverdict live-DB checks. The real queries are
// keyed by the distinctive table aliases / literals in computeLiveChecks.
function fakePsql(sql) {
  if (sql.includes('knex_migrations')) {
    return { tuple: { exitCode: 0, stdout: '1\n', stderr: '' } };
  }
  if (sql.includes('FROM project_template_status_mappings tm')) {
    const stdout = MAPPING_ROWS.map((row) => JSON.stringify(row)).join('\n');
    return { tuple: { exitCode: 0, stdout: `${stdout}\n`, stderr: '' } };
  }
  if (sql.includes("status_source = 'unresolved'")) {
    return { tuple: { exitCode: 0, stdout: '0\n', stderr: '' } };
  }
  if (sql.includes('FROM project_template_tasks t')) {
    return { tuple: { exitCode: 0, stdout: '21\n', stderr: '' } };
  }
  if (sql.includes("SMOKE Mixed Mapping Template%")) {
    return { tuple: { exitCode: 0, stdout: '0\n', stderr: '' } };
  }
  if (sql.includes('FROM project_status_mappings psm')) {
    const rows = [
      { project_status_mapping_id: 'aaa00001-0000-4000-8000-000000000001', status_id: null, standard_status_id: '90d706a0-1911-460c-9e38-4159e8b059e2', is_standard: true, display_order: 1 },
      { project_status_mapping_id: 'aaa00001-0000-4000-8000-000000000002', status_id: '314c7eed-5902-48ee-bab2-1cf82983f124', standard_status_id: null, is_standard: false, display_order: 2 },
    ];
    const stdout = rows.map((row) => JSON.stringify(row)).join('\n');
    return { tuple: { exitCode: 0, stdout: `${stdout}\n`, stderr: '' } };
  }
  if (sql.includes('FROM projects')) {
    return { tuple: { exitCode: 0, stdout: '1\n', stderr: '' } };
  }
  return { tuple: { exitCode: 1, stdout: '', stderr: `unmatched fake SQL: ${sql.slice(0, 80)}` } };
}

function fakeLiveProviders(overrides = {}) {
  return {
    db: { host: '127.0.0.1', port: 5472, user: 'app_user', password: 'not-a-secret-12345678', name: 'server' },
    psql: (db, sql) => fakePsql(sql),
    repoHead: () => HEAD_SHA,
    repoStatus: () => [' M package-lock.json'],
    boardRuns: () => ({ runs: [{ id: WORKFLOW_RUN_ID, status: 'running' }] }),
    secretCandidates: () => ['candidate-not-in-bundle-12345678'],
    ...overrides,
  };
}

function runXoverdictOn(bundleDir, overrides = {}) {
  const providersOverrides = overrides.providers || {};
  return runXoverdict(bundleDir, {
    expectedRunId: overrides.expectedRunId || WORKFLOW_RUN_ID,
    expectedHeadSha: overrides.expectedHeadSha || HEAD_SHA,
    repoRoot: WORKTREE,
    liveProviders: fakeLiveProviders(providersOverrides),
  });
}

test('xoverdict PASSES a valid synthetic bundle with matching live providers', () => {
  const bundleDir = makeTempBundle('xoverdict-ok');
  const result = runXoverdictOn(bundleDir);
  assert.equal(result.pass, true, JSON.stringify(result, null, 2));
  assert.equal(result.claims.length, 9);
  for (const claim of result.claims) {
    assert.equal(claim.pass, true, `${claim.id} should pass: ${JSON.stringify(claim.detail)}`);
  }
  assert.equal(result.runId, WORKFLOW_RUN_ID);
  assert.equal(result.headSha, HEAD_SHA);
  assert.match(result.bundleDigest, /^[0-9a-f]{64}$/);
});

test('xoverdict FAILS closed on a run-id mismatch (invoked vs bundle)', () => {
  const bundleDir = makeTempBundle('xoverdict-runmismatch');
  const result = runXoverdictOn(bundleDir, { expectedRunId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
  assert.equal(result.pass, false);
  const provenance = result.claims.find((claim) => claim.id === 'claim-7-exact-provenance');
  assert.equal(provenance.pass, false);
  assert.ok(provenance.detail.some((detail) => detail.includes('invoked against')));
});

test('xoverdict FAILS closed on a head-sha mismatch (invoked vs bundle)', () => {
  const bundleDir = makeTempBundle('xoverdict-headmismatch');
  const result = runXoverdictOn(bundleDir, { expectedHeadSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  assert.equal(result.pass, false);
  const provenance = result.claims.find((claim) => claim.id === 'claim-7-exact-provenance');
  assert.equal(provenance.pass, false);
  assert.ok(provenance.detail.some((detail) => detail.includes('invoked against')));
});

test('xoverdict FAILS closed when the board is not bound to the invoked run', () => {
  const bundleDir = makeTempBundle('xoverdict-stalerun');
  const result = runXoverdictOn(bundleDir, {
    providers: { boardRuns: () => ({ runs: [{ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', status: 'running' }] }) },
  });
  assert.equal(result.pass, false);
  const provenance = result.claims.find((claim) => claim.id === 'claim-7-exact-provenance');
  assert.equal(provenance.pass, false);
  assert.ok(provenance.detail.some((detail) => detail.includes('running board run')));
});

test('xoverdict FAILS closed on a missing manifest field (capture identity)', () => {
  const bundleDir = makeTempBundle('xoverdict-nocapidentity');
  const manifest = readJson(bundleDir, MANIFEST_FILE);
  delete manifest.captureIdentity;
  writeJson(bundleDir, MANIFEST_FILE, manifest);
  const result = runXoverdictOn(bundleDir);
  assert.equal(result.pass, false);
  const provenance = result.claims.find((claim) => claim.id === 'claim-7-exact-provenance');
  assert.equal(provenance.pass, false);
  assert.ok(provenance.detail.some((detail) => detail.includes('capture source identity')));
});

test('xoverdict FAILS closed on a tampered screenshot registry (checksum mismatch)', () => {
  const bundleDir = makeTempBundle('xoverdict-tamper', { tamperScreenshot: true });
  const result = runXoverdictOn(bundleDir);
  assert.equal(result.pass, false);
  const integrity = result.claims.find((claim) => claim.id === 'claim-8-no-mocks-no-secrets-no-drift');
  assert.equal(integrity.pass, false);
  assert.ok(integrity.detail.some((detail) => detail.includes('SHA256SUMS')));
});

test('xoverdict FAILS closed on an unexpected dirty file in the live repo', () => {
  const bundleDir = makeTempBundle('xoverdict-dirt');
  const result = runXoverdictOn(bundleDir, {
    providers: { repoStatus: () => [' M package-lock.json', ' M unexpected-file.ts'] },
  });
  assert.equal(result.pass, false);
  const dirt = result.claims.find((claim) => claim.id === 'claim-9-known-dirt-unchanged');
  assert.equal(dirt.pass, false);
  assert.ok(dirt.detail.some((detail) => detail.includes('package-lock.json')));
});

test('xoverdict FAILS closed when the live repo HEAD differs from the bundle HEAD', () => {
  const bundleDir = makeTempBundle('xoverdict-livehead');
  const result = runXoverdictOn(bundleDir, {
    providers: { repoHead: () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  });
  assert.equal(result.pass, false);
  const provenance = result.claims.find((claim) => claim.id === 'claim-7-exact-provenance');
  assert.equal(provenance.pass, false);
  assert.ok(provenance.detail.some((detail) => detail.includes('live git HEAD')));
});

test('xoverdict FAILS closed when the live seed template is not at the baseline', () => {
  const bundleDir = makeTempBundle('xoverdict-baseline');
  const result = runXoverdictOn(bundleDir, {
    providers: {
      psql: (db, sql) => (sql.includes('FROM project_template_status_mappings tm')
        ? { tuple: { exitCode: 0, stdout: `${BROKEN_STATE.map((row) => JSON.stringify(row)).join('\n')}\n`, stderr: '' } }
        : fakePsql(sql)),
    },
  });
  assert.equal(result.pass, false);
  const cleanup = result.claims.find((claim) => claim.id === 'claim-6-cleanup-restoration');
  assert.equal(cleanup.pass, false);
  assert.ok(cleanup.detail.some((detail) => detail.includes('baseline')));
});

test('xoverdict FAILS closed when the branch migration is not applied in the live DB', () => {
  const bundleDir = makeTempBundle('xoverdict-migration');
  const result = runXoverdictOn(bundleDir, {
    providers: {
      psql: (db, sql) => (sql.includes('knex_migrations')
        ? { tuple: { exitCode: 0, stdout: '0\n', stderr: '' } }
        : fakePsql(sql)),
    },
  });
  assert.equal(result.pass, false);
  const integrity = result.claims.find((claim) => claim.id === 'claim-8-no-mocks-no-secrets-no-drift');
  assert.equal(integrity.pass, false);
  assert.ok(integrity.detail.some((detail) => detail.includes('branch migration')));
});

test('xoverdict FAILS closed when the bundle leaks a derived secret value', () => {
  const bundleDir = makeTempBundle('xoverdict-secret');
  const readmePath = path.join(bundleDir, README_FILE);
  const original = fs.readFileSync(readmePath, 'utf8');
  fs.writeFileSync(readmePath, `${original}\nLEAKED candidate-not-in-bundle-12345678 here\n`);
  const checksumPath = path.join(bundleDir, 'SHA256SUMS');
  const lines = fs.readFileSync(checksumPath, 'utf8').split('\n').filter((line) => line !== '');
  const kept = lines.filter((line) => !line.endsWith(`  ${README_FILE}`));
  kept.push(`${crypto.createHash('sha256').update(fs.readFileSync(readmePath)).digest('hex')}  ${README_FILE}`);
  fs.writeFileSync(checksumPath, `${kept.join('\n')}\n`);

  const result = runXoverdictOn(bundleDir);
  assert.equal(result.pass, false);
  const integrity = result.claims.find((claim) => claim.id === 'claim-8-no-mocks-no-secrets-no-drift');
  assert.equal(integrity.pass, false);
  assert.ok(integrity.detail.some((detail) => detail.includes('secret')));
});

test('xoverdict FAILS closed on a live psql failure (stack unreachable)', () => {
  const bundleDir = makeTempBundle('xoverdict-dbdown');
  const result = runXoverdictOn(bundleDir, {
    providers: {
      psql: () => ({ tuple: { exitCode: 1, stdout: '', stderr: 'connection refused' } }),
    },
  });
  assert.equal(result.pass, false);
  const cleanup = result.claims.find((claim) => claim.id === 'claim-6-cleanup-restoration');
  assert.equal(cleanup.pass, false);
  assert.ok(cleanup.detail.some((detail) => detail.includes('psql exited 1')));
});

test('xoverdict FAILS closed when invoked without the required flags', () => {
  const bundleDir = makeTempBundle('xoverdict-usage');
  const result = runXoverdict(bundleDir, {
    expectedRunId: '',
    expectedHeadSha: HEAD_SHA,
    repoRoot: WORKTREE,
  });
  assert.equal(result.pass, false);
  assert.equal(result.claims, null);
  assert.ok(result.failures.some((failure) => failure.includes('--run-id')));
  const withoutHead = runXoverdict(bundleDir, {
    expectedRunId: WORKFLOW_RUN_ID,
    expectedHeadSha: '',
    repoRoot: WORKTREE,
  });
  assert.equal(withoutHead.pass, false);
  assert.ok(withoutHead.failures.some((failure) => failure.includes('--head-sha')));
  const withoutRepo = runXoverdict(bundleDir, {
    expectedRunId: WORKFLOW_RUN_ID,
    expectedHeadSha: HEAD_SHA,
    repoRoot: '',
  });
  assert.equal(withoutRepo.pass, false);
  assert.ok(withoutRepo.failures.some((failure) => failure.includes('--repo-root')));
});

// ---------------------------------------------------------------------------
// Deploy-fix round: executable bit, order-independent parsing, fail-closed
// dirt-line and secret-candidate handling
// ---------------------------------------------------------------------------

const VERIFIER_PATH = path.join(WORKTREE, 'scripts', 'verify-template-status-mapping-smoke-evidence.mjs');

function runVerifier(args) {
  return spawnSync(process.execPath, [VERIFIER_PATH, ...args], {
    cwd: WORKTREE,
    encoding: 'utf8',
    env: { ...process.env },
  });
}

test('verifier is directly executable and prints usage (exit 2) when invoked bare', () => {
  const result = spawnSync(VERIFIER_PATH, [], {
    cwd: WORKTREE,
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.notEqual(result.status, null, 'the script must spawn via its shebang (not EACCES/126)');
  assert.equal(result.status, 2, `expected usage exit 2; got ${result.status}, stderr: ${result.stderr}`);
  assert.match(result.stderr, /Usage:/);
});

test('parseArgv accepts both documented flag orders', () => {
  const bundleDir = '/tmp/some-bundle';
  const docOrder = parseArgv([
    bundleDir, '--xoverdict', '--run-id', WORKFLOW_RUN_ID,
    '--head-sha', HEAD_SHA, '--repo-root', WORKTREE,
  ]);
  assert.equal(docOrder.positional.length, 1);
  assert.equal(docOrder.positional[0], bundleDir);
  assert.equal(docOrder.flags.xoverdict, true);
  assert.equal(docOrder.flags['run-id'], WORKFLOW_RUN_ID);
  assert.equal(docOrder.flags['head-sha'], HEAD_SHA);
  assert.equal(docOrder.flags['repo-root'], WORKTREE);

  const prescribedOrder = parseArgv([
    '--xoverdict', bundleDir, '--run-id', WORKFLOW_RUN_ID,
    '--head-sha', HEAD_SHA, '--repo-root', WORKTREE,
  ]);
  assert.equal(prescribedOrder.positional.length, 1);
  assert.equal(prescribedOrder.positional[0], bundleDir);
  assert.equal(prescribedOrder.flags.xoverdict, true);
  assert.equal(prescribedOrder.flags['run-id'], WORKFLOW_RUN_ID);
  assert.equal(prescribedOrder.flags['head-sha'], HEAD_SHA);
  assert.equal(prescribedOrder.flags['repo-root'], WORKTREE);
});

test('parseArgv keeps positional parsing order-independent for malformed invocations', () => {
  const missingBundle = parseArgv([
    '--xoverdict', '--run-id', WORKFLOW_RUN_ID, '--head-sha', HEAD_SHA, '--repo-root', WORKTREE,
  ]);
  assert.equal(missingBundle.positional.length, 0);
  assert.equal(missingBundle.flags.xoverdict, true);
  assert.equal(missingBundle.flags['run-id'], WORKFLOW_RUN_ID);

  const missingRunId = parseArgv([
    '/tmp/some-bundle', '--xoverdict', '--head-sha', HEAD_SHA, '--repo-root', WORKTREE,
  ]);
  assert.equal(missingRunId.positional.length, 1);
  assert.equal(missingRunId.flags['run-id'], undefined);
});

test('the prescribed flag order (--xoverdict first) reaches xoverdict, not usage', () => {
  const bundleDir = makeTempBundle('flagorder-prescribed');
  const result = runVerifier([
    '--xoverdict', bundleDir, '--run-id', WORKFLOW_RUN_ID, '--head-sha', HEAD_SHA, '--repo-root', WORKTREE,
  ]);
  assert.equal(result.status, 1, `expected xoverdict FAIL (HEAD stale) exit 1; got ${result.status}; stdout: ${result.stdout}; stderr: ${result.stderr}`);
  assert.doesNotMatch(result.stderr, /Usage:/);
  assert.match(result.stdout, /^XOVERDICT: FAIL/);
});

test('the documented flag order (bundle dir first) reaches xoverdict, not usage', () => {
  const bundleDir = makeTempBundle('flagorder-doc');
  const result = runVerifier([
    bundleDir, '--xoverdict', '--run-id', WORKFLOW_RUN_ID, '--head-sha', HEAD_SHA, '--repo-root', WORKTREE,
  ]);
  assert.equal(result.status, 1, `expected xoverdict FAIL (HEAD stale) exit 1; got ${result.status}; stdout: ${result.stdout}; stderr: ${result.stderr}`);
  assert.doesNotMatch(result.stderr, /Usage:/);
  assert.match(result.stdout, /^XOVERDICT: FAIL/);
});

test('a genuinely malformed invocation with no bundle directory still exits 2', () => {
  const result = runVerifier([
    '--xoverdict', '--run-id', WORKFLOW_RUN_ID, '--head-sha', HEAD_SHA, '--repo-root', WORKTREE,
  ]);
  assert.equal(result.status, 2, `expected usage exit 2; got ${result.status}; stdout: ${result.stdout}; stderr: ${result.stderr}`);
  assert.match(result.stderr, /Usage:/);
});

test('a genuinely malformed invocation with no --run-id still exits 2', () => {
  const bundleDir = makeTempBundle('flagorder-norunid');
  const result = runVerifier([
    bundleDir, '--xoverdict', '--head-sha', HEAD_SHA, '--repo-root', WORKTREE,
  ]);
  assert.equal(result.status, 2, `expected usage exit 2; got ${result.status}; stdout: ${result.stdout}; stderr: ${result.stderr}`);
  assert.match(result.stdout, /xoverdict requires the --run-id flag/);
});

test('xoverdict PASSES when the live repo shows exactly the allowed dirt line', () => {
  const bundleDir = makeTempBundle('dirt-exact');
  const result = runXoverdictOn(bundleDir, {
    providers: { repoStatus: () => [ALLOWED_DIRT_LINE] },
  });
  const dirt = result.claims.find((claim) => claim.id === 'claim-9-known-dirt-unchanged');
  assert.equal(dirt.pass, true, JSON.stringify(dirt, null, 2));
});

test('xoverdict FAILS closed when the live repo shows server/package-lock.json dirt', () => {
  const bundleDir = makeTempBundle('dirt-subdir');
  const result = runXoverdictOn(bundleDir, {
    providers: { repoStatus: () => [' M server/package-lock.json'] },
  });
  assert.equal(result.pass, false);
  const dirt = result.claims.find((claim) => claim.id === 'claim-9-known-dirt-unchanged');
  assert.equal(dirt.pass, false);
  assert.ok(dirt.detail.some((detail) => detail.includes(' M server/package-lock.json')));
});

test('xoverdict FAILS closed when the live repo shows an untracked *-package-lock.json file', () => {
  const bundleDir = makeTempBundle('dirt-untracked');
  const result = runXoverdictOn(bundleDir, {
    providers: { repoStatus: () => ['?? something-package-lock.json'] },
  });
  assert.equal(result.pass, false);
  const dirt = result.claims.find((claim) => claim.id === 'claim-9-known-dirt-unchanged');
  assert.equal(dirt.pass, false);
});

test('xoverdict FAILS closed when the live repo shows the allowed line plus any other dirt', () => {
  const bundleDir = makeTempBundle('dirt-plus');
  const result = runXoverdictOn(bundleDir, {
    providers: { repoStatus: () => [ALLOWED_DIRT_LINE, ' M server/package-lock.json'] },
  });
  assert.equal(result.pass, false);
  const dirt = result.claims.find((claim) => claim.id === 'claim-9-known-dirt-unchanged');
  assert.equal(dirt.pass, false);
});

test('verifyBundle REJECTS a manifest recording a substring-matching impostor dirt line', () => {
  const bundleDir = makeTempBundle('manifest-dirt-impostor');
  const manifest = readJson(bundleDir, MANIFEST_FILE);
  manifest.gitStatus = [' M server/package-lock.json'];
  writeJson(bundleDir, MANIFEST_FILE, manifest);
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('git status must record exactly')));
});

test('verifyBundle REJECTS a manifest recording extra dirt alongside the allowed line', () => {
  const bundleDir = makeTempBundle('manifest-dirt-extra');
  const manifest = readJson(bundleDir, MANIFEST_FILE);
  manifest.gitStatus = [ALLOWED_DIRT_LINE, '?? something-package-lock.json'];
  writeJson(bundleDir, MANIFEST_FILE, manifest);
  const result = verifyBundle(bundleDir, defaultVerifyOptions());
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('git status must record exactly')));
});

test('xoverdict FAILS closed when zero secret candidates can be derived', () => {
  const bundleDir = makeTempBundle('secret-nocandidates');
  const result = runXoverdictOn(bundleDir, {
    providers: { secretCandidates: () => [] },
  });
  assert.equal(result.pass, false);
  const integrity = result.claims.find((claim) => claim.id === 'claim-8-no-mocks-no-secrets-no-drift');
  assert.equal(integrity.pass, false);
  assert.ok(integrity.detail.some((detail) => detail.includes('no secret candidates')));
});

test('xoverdict FAILS closed when every secret candidate is too short to scan for', () => {
  const bundleDir = makeTempBundle('secret-short');
  const result = runXoverdictOn(bundleDir, {
    providers: { secretCandidates: () => ['x', 'short'] },
  });
  assert.equal(result.pass, false);
  const integrity = result.claims.find((claim) => claim.id === 'claim-8-no-mocks-no-secrets-no-drift');
  assert.equal(integrity.pass, false);
  assert.ok(integrity.detail.some((detail) => detail.includes('no secret candidates')));
});

test('xoverdict FAILS closed naming the file when the bundle leaks a derived secret', () => {
  const bundleDir = makeTempBundle('secret-named');
  const readmePath = path.join(bundleDir, README_FILE);
  const original = fs.readFileSync(readmePath, 'utf8');
  fs.writeFileSync(readmePath, `${original}\nLEAKED candidate-not-in-bundle-12345678 here\n`);
  const checksumPath = path.join(bundleDir, 'SHA256SUMS');
  const lines = fs.readFileSync(checksumPath, 'utf8').split('\n').filter((line) => line !== '');
  const kept = lines.filter((line) => !line.endsWith(`  ${README_FILE}`));
  kept.push(`${crypto.createHash('sha256').update(fs.readFileSync(readmePath)).digest('hex')}  ${README_FILE}`);
  fs.writeFileSync(checksumPath, `${kept.join('\n')}\n`);

  const result = runXoverdictOn(bundleDir);
  assert.equal(result.pass, false);
  const integrity = result.claims.find((claim) => claim.id === 'claim-8-no-mocks-no-secrets-no-drift');
  assert.equal(integrity.pass, false);
  assert.ok(integrity.detail.some((detail) => detail.includes(README_FILE)));
});

test('xoverdict PASSES the secret scan when derived candidates are absent from the bundle', () => {
  const bundleDir = makeTempBundle('secret-clean');
  const result = runXoverdictOn(bundleDir, {
    providers: { secretCandidates: () => ['absent-candidate-12345678'] },
  });
  const integrity = result.claims.find((claim) => claim.id === 'claim-8-no-mocks-no-secrets-no-drift');
  assert.equal(integrity.pass, true, JSON.stringify(integrity, null, 2));
});

// ---------------------------------------------------------------------------
// Deploy-fix round: malformed --run-id and nonexistent --repo-root are usage
// errors (exit 2), never provenance/claim failures or a crash
// ---------------------------------------------------------------------------

test('a malformed --run-id exits 2 (usage) in xoverdict mode before any bundle or live work', () => {
  const bundleDir = makeTempBundle('usage-badrunid-xov');
  const result = runVerifier([
    '--xoverdict', bundleDir, '--run-id', 'not-a-uuid',
    '--head-sha', HEAD_SHA, '--repo-root', WORKTREE,
  ]);
  assert.equal(result.status, 2, `expected usage exit 2; got ${result.status}; stdout: ${result.stdout}; stderr: ${result.stderr}`);
  assert.match(result.stderr, /Usage:/);
  assert.match(result.stderr, /--run-id must be a UUID/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /claim-/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /invoked against/);
  assert.doesNotMatch(result.stdout, /^XOVERDICT: FAIL/);
});

test('a malformed --run-id exits 2 (usage) in plain mode, not VERDICT: FAIL', () => {
  const bundleDir = makeTempBundle('usage-badrunid-plain');
  const result = runVerifier([
    bundleDir, '--run-id', 'not-a-uuid', '--head-sha', HEAD_SHA,
  ]);
  assert.equal(result.status, 2, `expected usage exit 2; got ${result.status}; stdout: ${result.stdout}; stderr: ${result.stderr}`);
  assert.match(result.stderr, /Usage:/);
  assert.match(result.stderr, /--run-id must be a UUID/);
  assert.doesNotMatch(result.stdout, /VERDICT: FAIL/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /invoked against/);
});

test('a nonexistent --repo-root exits 2 (usage) in xoverdict mode without crashing', () => {
  const bundleDir = makeTempBundle('usage-badroot');
  const result = runVerifier([
    '--xoverdict', bundleDir, '--run-id', WORKFLOW_RUN_ID,
    '--head-sha', HEAD_SHA, '--repo-root', '/nonexistent/path/xyz',
  ]);
  assert.equal(result.status, 2, `expected usage exit 2; got ${result.status}; stdout: ${result.stdout}; stderr: ${result.stderr}`);
  assert.match(result.stderr, /Usage:/);
  assert.match(result.stderr, /--repo-root must be an existing directory/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /TypeError/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /\n\s+at /);
});

test('repo-root and run-id usage validation are order-independent', () => {
  const bundleDir = makeTempBundle('usage-badroot-order');
  const repoFirst = runVerifier([
    '--repo-root', '/nonexistent/path/xyz', '--xoverdict', bundleDir,
    '--run-id', WORKFLOW_RUN_ID, '--head-sha', HEAD_SHA,
  ]);
  const xoverdictFirst = runVerifier([
    '--xoverdict', bundleDir, '--run-id', WORKFLOW_RUN_ID,
    '--head-sha', HEAD_SHA, '--repo-root', '/nonexistent/path/xyz',
  ]);
  assert.equal(repoFirst.status, 2, `stdout: ${repoFirst.stdout}; stderr: ${repoFirst.stderr}`);
  assert.equal(xoverdictFirst.status, 2, `stdout: ${xoverdictFirst.stdout}; stderr: ${xoverdictFirst.stderr}`);
  assert.equal(repoFirst.stdout, xoverdictFirst.stdout, 'stdout must be identical across flag orders');
  assert.equal(repoFirst.stderr, xoverdictFirst.stderr, 'stderr must be identical across flag orders');
  assert.match(repoFirst.stderr, /--repo-root must be an existing directory/);

  const runIdLast = runVerifier([
    bundleDir, '--xoverdict', '--head-sha', HEAD_SHA,
    '--repo-root', WORKTREE, '--run-id', 'not-a-uuid',
  ]);
  const runIdFirst = runVerifier([
    '--run-id', 'not-a-uuid', bundleDir, '--xoverdict',
    '--head-sha', HEAD_SHA, '--repo-root', WORKTREE,
  ]);
  assert.equal(runIdLast.status, 2, `stdout: ${runIdLast.stdout}; stderr: ${runIdLast.stderr}`);
  assert.equal(runIdFirst.status, 2, `stdout: ${runIdFirst.stdout}; stderr: ${runIdFirst.stderr}`);
  assert.equal(runIdLast.stdout, runIdFirst.stdout, 'stdout must be identical across flag orders');
  assert.equal(runIdLast.stderr, runIdFirst.stderr, 'stderr must be identical across flag orders');
  assert.match(runIdLast.stderr, /--run-id must be a UUID/);
});
