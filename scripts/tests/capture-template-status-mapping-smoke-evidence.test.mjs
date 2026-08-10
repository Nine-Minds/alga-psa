import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseDotenvValue,
  resolveOptions,
  utcTimestamp,
} from '../capture-template-status-mapping-smoke-evidence.mjs';
import {
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
  VERIFIER_COPY_FILE,
  createContext,
  verifyBundle,
} from '../verify-template-status-mapping-smoke-evidence.mjs';

const TENANT = 'dd8cb218-d46d-47f3-be27-8aa50aad5fce';
const SEED_TEMPLATE_ID = '7a757765-f26c-4b99-bdb7-f5c919b5dde8';
const KNOWN_MAPPING_ID = 'e757c6dc-d6ab-4ad3-8f53-2117c3d41fcd';
const HEAD_SHA = 'c0818bd08dfa761946a111111111111111111111';
const WORKFLOW_RUN_ID = '22222222-2222-4222-8222-222222222222';

const MAPPING_ROWS = [
  { template_status_mapping_id: 'e757c6dc-d6ab-4ad3-8f53-2117c3d41fcd', status_source: 'tenant', status_id: '314c7eed-5902-48ee-bab2-1cf82983f124', standard_status_id: null, unresolved_status_id: null, unresolved_reason: null, display_order: 1 },
  { template_status_mapping_id: '6f2795ad-05dd-4c44-a502-34dde3ab642c', status_source: 'tenant', status_id: 'acbd615e-3a0b-42f3-97e8-060462d65fdc', standard_status_id: null, unresolved_status_id: null, unresolved_reason: null, display_order: 2 },
  { template_status_mapping_id: '367e48f3-deba-43fe-9934-8c4e55715552', status_source: 'tenant', status_id: 'cdd35782-c266-41d1-99d6-f483aa655a44', standard_status_id: null, unresolved_status_id: null, unresolved_reason: null, display_order: 3 },
  { template_status_mapping_id: '16360d43-6a5d-441c-91d9-e5e2b2f4e9bb', status_source: 'tenant', status_id: '4e75503c-6879-4e61-a5bd-0ecc91c7cabc', standard_status_id: null, unresolved_status_id: null, unresolved_reason: null, display_order: 4 },
];

const TYPED_PROJECT_MAPPINGS = [
  { project_status_mapping_id: 'aaa00001-0000-4000-8000-000000000001', status_id: null, standard_status_id: '90d706a0-1911-460c-9e38-4159e8b059e2', is_standard: true, display_order: 1 },
  { project_status_mapping_id: 'aaa00001-0000-4000-8000-000000000002', status_id: '314c7eed-5902-48ee-bab2-1cf82983f124', standard_status_id: null, is_standard: false, display_order: 2 },
];

function makeStepJson(stepName, structuredData, assertions) {
  return {
    step: stepName,
    startedAt: '2026-08-10T13:00:00.000Z',
    rawOutputFile: EVIDENCE_STEPS[stepName].txt,
    queries: [],
    assertions,
    structuredData,
  };
}

function writeSyntheticBundle(bundleDir, { pendingWithoutInstructions = false, tamperScreenshot = false } = {}) {
  fs.mkdirSync(bundleDir, { recursive: true });

  fs.writeFileSync(path.join(bundleDir, RUN_FILE), JSON.stringify({
    workflowRunId: WORKFLOW_RUN_ID,
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
    dbHost: '127.0.0.1',
    dbPort: 5472,
    dbName: 'server',
    dbUser: 'app_user',
    dbPortSource: 'direct Postgres; app uses pgbouncer DB_PORT 6472',
    credentialsDerivation: 'extracted from server/.env.local keys DB_HOST / DB_USER_SERVER / DB_PASSWORD_SERVER / DB_NAME_SERVER; see README.md',
  }, null, 2));
  fs.writeFileSync(path.join(bundleDir, '10-fixture-seed.sql'), '-- synthetic seed\n');

  const steps = {
    before: {
      structuredData: {
        seedTemplateOriginal: MAPPING_ROWS,
        taskAssignmentCountBefore: 21,
        fixtureBrokenState: MAPPING_ROWS,
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

  for (const [stepName, data] of Object.entries(steps)) {
    const { json, txt } = EVIDENCE_STEPS[stepName];
    fs.writeFileSync(path.join(bundleDir, json), JSON.stringify(makeStepJson(stepName, data.structuredData, data.assertions), null, 2));
    fs.writeFileSync(path.join(bundleDir, txt), `# ${stepName}\n\n$ PGPASSWORD='${REDACTION_PLACEHOLDER}' psql ...\n1\n`);
  }

  const screenshotNotes = {
    workflowRunId: WORKFLOW_RUN_ID,
    slots: SCREENSHOT_SLOTS.map((slot, index) => {
      const filePath = path.join(bundleDir, slot.file);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const bytes = crypto.randomBytes(64);
      fs.writeFileSync(filePath, bytes);
      const entry = {
        ...slot,
        status: 'complete',
        url: 'http://localhost:3517/msp/projects/templates/7a757765-f26c-4b99-bdb7-f5c919b5dde8',
        pageText: 'template details smoke',
        capturedAt: '2026-08-10T13:10:00.000Z',
        instructions: null,
      };
      if (index === 0 && pendingWithoutInstructions) {
        entry.status = 'pending';
        entry.instructions = null;
        entry.url = null;
        entry.pageText = null;
        entry.capturedAt = null;
      }
      return entry;
    }),
  };
  fs.writeFileSync(path.join(bundleDir, SCREENSHOT_NOTES_FILE), JSON.stringify(screenshotNotes, null, 2));

  fs.writeFileSync(path.join(bundleDir, '92-artifacts.json'), JSON.stringify({ workflowRunId: WORKFLOW_RUN_ID, artifacts: [] }, null, 2));
  fs.writeFileSync(path.join(bundleDir, '93-manual-actions.json'), JSON.stringify({ workflowRunId: WORKFLOW_RUN_ID, order: [] }, null, 2));

  const scanCommand = `alga-dev terminal-get-history --sessionId=card-service:dev-server:1`;
  fs.writeFileSync(path.join(bundleDir, DEV_SERVER_SCAN_JSON), JSON.stringify({
    capturedAt: '2026-08-10T13:11:00.000Z',
    scannedFor: ['generic error', 'unhandled rejection'],
    scanCommand,
    rawOutputFile: DEV_SERVER_SCAN_TXT,
    matches: [],
    matchCount: 0,
    ok: true,
  }, null, 2));
  fs.writeFileSync(path.join(bundleDir, DEV_SERVER_SCAN_TXT), `# scan\n\n$ ${scanCommand}\n\n# Matching error-pattern lines (0):\n# (none)\n`);
  fs.writeFileSync(path.join(bundleDir, CONSOLE_FILE), JSON.stringify({ capturedAt: '2026-08-10T13:11:00.000Z', scanCommand: 'alga-dev browser-get-console --level error', entries: [], errors: [] }, null, 2));
  fs.writeFileSync(path.join(bundleDir, NETWORK_FILE), JSON.stringify({ capturedAt: '2026-08-10T13:11:00.000Z', scanCommand: 'alga-dev browser-get-network --failedOnly', failedRequests: [] }, null, 2));

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
      dbHost: '127.0.0.1',
      dbPort: 5472,
      dbName: 'server',
      dbUser: 'app_user',
      dbPortSource: 'direct Postgres; app uses pgbouncer DB_PORT 6472',
      credentialsDerivation: 'extracted from server/.env.local keys DB_HOST / DB_USER_SERVER / DB_PASSWORD_SERVER / DB_NAME_SERVER; see README.md',
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

test('verifyBundle PASSES a complete synthetic bundle', () => {
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-ok-'));
  writeSyntheticBundle(bundleDir);
  const result = verifyBundle(bundleDir);
  assert.equal(result.pass, true, JSON.stringify(result.failures, null, 2));
  assert.equal(result.screenshots.complete, SCREENSHOT_SLOTS.length);
  assert.equal(result.screenshots.pending, 0);
  assert.equal(result.headSha, HEAD_SHA);
  assert.match(result.bundleDigest, /^[0-9a-f]{64}$/);
});

test('verifyBundle FAILS on a tampered screenshot', () => {
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-tamper-'));
  writeSyntheticBundle(bundleDir, { tamperScreenshot: true });
  const result = verifyBundle(bundleDir);
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('does not match its SHA256SUMS entry')));
});

test('verifyBundle FAILS on a PENDING slot without instructions', () => {
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-pending-'));
  writeSyntheticBundle(bundleDir, { pendingWithoutInstructions: true });
  const result = verifyBundle(bundleDir);
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('PENDING without an exact capture instruction')));
});

test('verifyBundle FAILS when restoration does not match the baseline', () => {
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-restore-'));
  writeSyntheticBundle(bundleDir);
  const restoreJson = path.join(bundleDir, EVIDENCE_STEPS.restore.json);
  const record = JSON.parse(fs.readFileSync(restoreJson, 'utf8'));
  record.structuredData.seedTemplateAfterRestore = MAPPING_ROWS.map((row, index) => (index === 0 ? { ...row, status_source: 'unresolved' } : row));
  fs.writeFileSync(restoreJson, JSON.stringify(record, null, 2));
  const result = verifyBundle(bundleDir);
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes('seed template was not restored exactly')));
});

test('createContext rejects path escapes', () => {
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-escape-'));
  writeSyntheticBundle(bundleDir);
  const context = createContext(bundleDir);
  assert.throws(() => context.filePath('..'));
});
