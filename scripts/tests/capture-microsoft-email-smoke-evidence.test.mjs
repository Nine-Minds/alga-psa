import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTemporarySessionCleanupProof,
  buildTemporarySessionsCreatedProof,
  exactComparison,
  secretInventory,
} from '../capture-microsoft-email-smoke-evidence.mjs';
import {
  CREATED_SESSIONS_FILE,
  EXPECTED_TEMPORARY_SESSION_COUNT,
  SESSION_CLEANUP_FILE,
} from '../verify-microsoft-email-smoke-evidence.mjs';
import {
  CTIME_NON_RESTORABLE_REASON,
  ctimeDisclosure,
  directoryTimestampSnapshot,
  restorableInventory,
  restoreDirectoryTimestamps,
} from '../microsoft-email-smoke-timestamps.mjs';
import {
  DATABASE_SNAPSHOT,
  CREATED_SESSION_ROWS,
  EXTERNAL_GRAPH_LIMITATION,
  FIDELITY_NOTE,
  PROVENANCE,
  REPO_ROOT,
  RESTORED,
  TEMPORARY_SESSIONS_CREATED,
  TEMPORARY_SESSION_IDS,
  TENANT_ID,
  invoke,
  setupEvidence,
  writeCapture,
  writeJson,
  writePhaseMarker,
} from './helpers/microsoft-smoke-evidence-fixture.mjs';

function assertFailure(result, message) {
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, message);
}

const SECRET_TENANT_ID = TENANT_ID;

const SESSION_PROOF_METADATA = {
  workflowRunId: '11111111-1111-4111-8111-111111111111',
  tenantId: TENANT_ID,
  startedAt: '2026-08-04T22:59:00.000Z',
  temporarySessionCleanup: {
    expectedCreatedSessionCount: EXPECTED_TEMPORARY_SESSION_COUNT,
    createdEvidenceFile: CREATED_SESSIONS_FILE,
    cleanupEvidenceFile: SESSION_CLEANUP_FILE,
  },
};

test('temporary-session proof identifies exactly two newly created rows and their deletion', () => {
  const observedDatabase = {
    ...DATABASE_SNAPSHOT,
    sessions: [...DATABASE_SNAPSHOT.sessions, ...CREATED_SESSION_ROWS],
  };
  const creation = buildTemporarySessionsCreatedProof(
    SESSION_PROOF_METADATA,
    DATABASE_SNAPSHOT,
    observedDatabase,
    TEMPORARY_SESSIONS_CREATED.capturedAt
  );
  assert.deepEqual(
    creation.createdSessions.map((session) => session.session_id),
    TEMPORARY_SESSION_IDS
  );

  const cleanup = buildTemporarySessionCleanupProof(
    SESSION_PROOF_METADATA,
    creation,
    DATABASE_SNAPSHOT,
    { file: CREATED_SESSIONS_FILE, bytes: 1, sha256: 'ab'.repeat(32) }
  );
  assert.equal(cleanup.allDeleted, true);
  assert.deepEqual(cleanup.deletedSessionIds, TEMPORARY_SESSION_IDS);
  assert.deepEqual(cleanup.remainingSessionRows, []);
});

test('temporary-session proof rejects the wrong creation count and reports a surviving row', () => {
  assert.throws(
    () => buildTemporarySessionsCreatedProof(
      SESSION_PROOF_METADATA,
      DATABASE_SNAPSHOT,
      {
        ...DATABASE_SNAPSHOT,
        sessions: [...DATABASE_SNAPSHOT.sessions, CREATED_SESSION_ROWS[0]],
      },
      TEMPORARY_SESSIONS_CREATED.capturedAt
    ),
    /Expected exactly 2 temporary session rows, observed 1/
  );

  const afterWithResidue = {
    ...DATABASE_SNAPSHOT,
    sessions: [...DATABASE_SNAPSHOT.sessions, CREATED_SESSION_ROWS[1]],
  };
  const cleanup = buildTemporarySessionCleanupProof(
    SESSION_PROOF_METADATA,
    TEMPORARY_SESSIONS_CREATED,
    afterWithResidue,
    { file: CREATED_SESSIONS_FILE, bytes: 1, sha256: 'ab'.repeat(32) }
  );
  assert.equal(cleanup.allDeleted, false);
  assert.deepEqual(cleanup.deletedSessionIds, [TEMPORARY_SESSION_IDS[0]]);
  assert.deepEqual(cleanup.remainingSessionRows, [CREATED_SESSION_ROWS[1]]);
});

function setupSecretBase() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'microsoft-smoke-secret-test-'));
  const tenantDirectory = path.join(base, 'tenants', SECRET_TENANT_ID);
  fs.mkdirSync(tenantDirectory, { recursive: true });
  fs.writeFileSync(path.join(tenantDirectory, 'existing_secret'), 'value\n', { mode: 0o600 });
  return { base, tenantDirectory };
}

function inventory(base) {
  return secretInventory(
    REPO_ROOT,
    { SECRET_WRITE_PROVIDER: 'filesystem', SECRET_FS_BASE_PATH: base },
    SECRET_TENANT_ID
  );
}

test('secret inventory records file mtimes, the truncated directory mtime, and ctime', (t) => {
  const { base, tenantDirectory } = setupSecretBase();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const recorded = inventory(base);
  assert.equal(recorded.files.length, 1);
  const secretStat = fs.statSync(path.join(tenantDirectory, 'existing_secret'));
  assert.equal(recorded.files[0].mtimeMs, secretStat.mtimeMs);
  assert.equal(recorded.files[0].ctimeMs, secretStat.ctimeMs);
  assert.equal(recorded.directoryExists, true);
  assert.equal(recorded.directoryMtimeMs, Math.trunc(fs.statSync(tenantDirectory).mtimeMs));
  assert.equal(recorded.directoryCtimeMs, fs.statSync(tenantDirectory).ctimeMs);
  assert.equal(
    recorded.parentDirectoryCtimeMs,
    fs.statSync(path.dirname(tenantDirectory)).ctimeMs
  );

  const emptyBase = fs.mkdtempSync(path.join(os.tmpdir(), 'microsoft-smoke-secret-empty-'));
  t.after(() => fs.rmSync(emptyBase, { recursive: true, force: true }));
  const absent = inventory(emptyBase);
  assert.equal(absent.directoryExists, false);
  assert.equal(absent.directoryMtimeMs, null);
  assert.equal(absent.directoryCtimeMs, null);
  assert.equal(absent.parentDirectoryCtimeMs, null);
  assert.deepEqual(absent.files, []);
});

test('an mtime-only difference fails the restoration exactness comparison', (t) => {
  const { base, tenantDirectory } = setupSecretBase();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const secretFile = path.join(tenantDirectory, 'existing_secret');

  const baseline = inventory(base);
  fs.utimesSync(secretFile, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
  const fileTouched = inventory(base);
  assert.equal(
    exactComparison(restorableInventory(baseline), restorableInventory(fileTouched)).exactMatch,
    false
  );
  assert.deepEqual(ctimeDisclosure(baseline, fileTouched).unexpectedChanges, ['existing_secret']);

  fs.utimesSync(
    tenantDirectory,
    new Date('2026-02-02T00:00:00Z'),
    new Date('2026-02-02T00:00:00Z')
  );
  const directoryTouched = inventory(base);
  assert.equal(
    exactComparison(
      restorableInventory(fileTouched),
      restorableInventory(directoryTouched)
    ).exactMatch,
    false
  );
});

test('directory timestamp restoration restores mtime exactly while ctime is disclosed', (t) => {
  const { base, tenantDirectory } = setupSecretBase();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  fs.utimesSync(
    tenantDirectory,
    new Date('2026-03-03T03:03:03.123Z'),
    new Date('2026-03-03T03:03:03.123Z')
  );
  fs.utimesSync(
    path.join(tenantDirectory, 'existing_secret'),
    new Date('2026-03-03T03:03:03.200Z'),
    new Date('2026-03-03T03:03:03.200Z')
  );
  const baseline = inventory(base);
  const snapshot = directoryTimestampSnapshot(tenantDirectory);

  const churnFile = path.join(tenantDirectory, 'transient_secret');
  fs.writeFileSync(churnFile, 'transient\n', { mode: 0o600 });
  fs.rmSync(churnFile);
  const churned = inventory(base);
  assert.equal(
    exactComparison(restorableInventory(baseline), restorableInventory(churned)).exactMatch,
    false
  );

  restoreDirectoryTimestamps(snapshot);
  assert.equal(
    Math.trunc(fs.statSync(tenantDirectory).mtimeMs),
    Math.trunc(snapshot.mtimeMs)
  );
  const restored = inventory(base);
  assert.equal(
    exactComparison(restorableInventory(baseline), restorableInventory(restored)).exactMatch,
    true
  );
  assert.equal(snapshot.ctimeMs, baseline.directoryCtimeMs);

  const disclosure = ctimeDisclosure(baseline, restored);
  assert.equal(disclosure.reason, CTIME_NON_RESTORABLE_REASON);
  assert.ok(
    disclosure.changedPaths.includes(tenantDirectory),
    'the mutated tenant directory ctime should be disclosed as changed'
  );
  assert.deepEqual(disclosure.unexpectedChanges, []);
});

test('ctime changes only where the fixture mutated pass the gate', (t) => {
  const { base, tenantDirectory } = setupSecretBase();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  // Pin timestamps to a fixed past date so the churn is guaranteed to move
  // the truncated directory mtime away from the baseline value.
  fs.utimesSync(
    tenantDirectory,
    new Date('2026-03-03T03:03:03.123Z'),
    new Date('2026-03-03T03:03:03.123Z')
  );
  fs.utimesSync(
    path.join(tenantDirectory, 'existing_secret'),
    new Date('2026-03-03T03:03:03.200Z'),
    new Date('2026-03-03T03:03:03.200Z')
  );
  const baseline = inventory(base);
  const churnFile = path.join(tenantDirectory, 'transient_secret');
  fs.writeFileSync(churnFile, 'transient\n', { mode: 0o600 });
  fs.rmSync(churnFile);
  const after = inventory(base);

  const disclosure = ctimeDisclosure(baseline, after);
  assert.equal(disclosure.reason, CTIME_NON_RESTORABLE_REASON);
  assert.ok(
    disclosure.changedPaths.includes(tenantDirectory),
    'the mutated tenant directory ctime should be disclosed as changed'
  );
  assert.deepEqual(disclosure.unexpectedChanges, []);
  const expectedChangedPath = disclosure.paths.find(
    (entry) => entry.changed && entry.kind === 'directory'
  );
  assert.equal(expectedChangedPath.expected, true);
  assert.equal(
    exactComparison(restorableInventory(baseline), restorableInventory(after)).exactMatch,
    false
  );
});

test('a ctime change on an untouched path fails the disclosure gate', (t) => {
  const { base, tenantDirectory } = setupSecretBase();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const secretFile = path.join(tenantDirectory, 'existing_secret');

  const baseline = inventory(base);
  // chmod to the same mode moves ctime without changing content, size, or mtime,
  // simulating an unexpected touch of a pre-existing secret file.
  fs.chmodSync(secretFile, 0o600);
  const after = inventory(base);
  assert.equal(after.files[0].mode, baseline.files[0].mode);
  assert.equal(after.files[0].mtimeMs, baseline.files[0].mtimeMs);
  assert.notEqual(after.files[0].ctimeMs, baseline.files[0].ctimeMs);

  const disclosure = ctimeDisclosure(baseline, after);
  assert.deepEqual(disclosure.unexpectedChanges, ['existing_secret']);
  assert.equal(
    exactComparison(restorableInventory(baseline), restorableInventory(after)).exactMatch,
    true,
    'restorable fields still match; only ctime drifted'
  );
});

test('a restorable-field mismatch still fails alongside the ctime disclosure', (t) => {
  const { base, tenantDirectory } = setupSecretBase();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const secretFile = path.join(tenantDirectory, 'existing_secret');

  const baseline = inventory(base);
  fs.writeFileSync(secretFile, 'different value\n', { mode: 0o600 });
  const after = inventory(base);

  const disclosure = ctimeDisclosure(baseline, after);
  assert.deepEqual(disclosure.unexpectedChanges, ['existing_secret']);
  assert.equal(
    exactComparison(restorableInventory(baseline), restorableInventory(after)).exactMatch,
    false,
    'a content change must fail the restorable exactness gate'
  );
});

test('a parent-directory ctime change is disclosed when the tenant directory is created fresh', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'microsoft-smoke-secret-parent-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const parentDirectory = path.join(base, 'tenants');
  fs.mkdirSync(parentDirectory);
  const tenantDirectory = path.join(parentDirectory, SECRET_TENANT_ID);

  const baseline = inventory(base);
  assert.equal(baseline.directoryExists, false);
  fs.mkdirSync(tenantDirectory);
  const after = inventory(base);
  assert.equal(after.directoryExists, true);

  const disclosure = ctimeDisclosure(baseline, after);
  assert.equal(disclosure.reason, CTIME_NON_RESTORABLE_REASON);
  const parentEntry = disclosure.paths.find((entry) => entry.kind === 'directory'
    && entry.path === parentDirectory);
  assert.ok(parentEntry, 'the parent directory should be part of the disclosure');
  assert.equal(parentEntry.changed, true);
  assert.equal(parentEntry.expected, true);
  assert.deepEqual(disclosure.unexpectedChanges, []);
});

test('correlate requires shared capture identity, a fidelity note, and the Graph limitation', (t) => {
  const directory = setupEvidence();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  writeCapture(directory, {
    ...PROVENANCE,
    captureNonce: '55555555-5555-4555-8555-555555555555',
  });
  assertFailure(invoke(directory, 'correlate'), /do not share the same nonce/);

  writeCapture(directory, PROVENANCE, undefined);
  const withoutFidelityNote = JSON.parse(
    fs.readFileSync(path.join(directory, 'browser-capture.json'), 'utf8')
  );
  delete withoutFidelityNote.crossHostFidelityNote;
  writeJson(directory, 'browser-capture.json', withoutFidelityNote);
  assertFailure(invoke(directory, 'correlate'), /Cross-host fidelity note/);

  writeCapture(directory, PROVENANCE);
  const withoutGraphLimitation = JSON.parse(
    fs.readFileSync(path.join(directory, 'browser-capture.json'), 'utf8')
  );
  delete withoutGraphLimitation.externalGraphLimitation;
  writeJson(directory, 'browser-capture.json', withoutGraphLimitation);
  assertFailure(invoke(directory, 'correlate'), /no-external-Graph limitation/);

  writeCapture(directory, PROVENANCE);
  assert.equal(invoke(directory, 'correlate').status, 0);
});

test('manifest cannot seal tampered or failed after assertions', (t) => {
  const directory = setupEvidence();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  writeCapture(directory, PROVENANCE);
  assert.equal(invoke(directory, 'correlate').status, 0);

  fs.appendFileSync(path.join(directory, '90-after-database.json'), 'tamper');
  assertFailure(invoke(directory, 'manifest'), /changed after its assertions passed/);

  writeJson(directory, '90-after-database.json', DATABASE_SNAPSHOT);
  writeJson(directory, '91-restoration-comparison.json', { ...RESTORED, exactMatch: false });
  writePhaseMarker(directory, 'after');
  assertFailure(invoke(directory, 'manifest'), /were not restored exactly/);

  writeJson(directory, '91-restoration-comparison.json', {
    ...RESTORED,
    ctimeDisclosure: {
      ...RESTORED.ctimeDisclosure,
      unexpectedChanges: ['existing_secret'],
    },
  });
  writePhaseMarker(directory, 'after');
  assertFailure(invoke(directory, 'manifest'), /reports unexpected ctime changes/);

  writeJson(directory, '91-restoration-comparison.json', RESTORED);
  const sessionCleanup = JSON.parse(
    fs.readFileSync(path.join(directory, SESSION_CLEANUP_FILE), 'utf8')
  );
  writeJson(directory, SESSION_CLEANUP_FILE, {
    ...sessionCleanup,
    deletedSessionIds: [TEMPORARY_SESSION_IDS[0]],
    allDeleted: false,
  });
  writePhaseMarker(directory, 'after');
  assertFailure(invoke(directory, 'manifest'), /does not show both temporary session rows/);

  writeJson(directory, SESSION_CLEANUP_FILE, sessionCleanup);
  writePhaseMarker(directory, 'after');
  const sealed = invoke(directory, 'manifest');
  assert.equal(sealed.status, 0, `${sealed.stdout}${sealed.stderr}`);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, '98-sha256-manifest.json'), 'utf8')
  );
  assert.equal(manifest.assertionsPassed, true);
  assert.equal(manifest.restorationExact, true);
  assert.equal(manifest.temporarySessionRowsDeleted, true);
  assert.equal(manifest.temporarySessionRowsDeletedCount, 2);
  assert.equal(manifest.ctimeDisclosed, true);
  assert.equal(manifest.ctimeNonRestorableReason, CTIME_NON_RESTORABLE_REASON);
  assert.deepEqual(manifest.ctimeUnexpectedChanges, []);
  assert.equal(manifest.sameCaptureProven, true);
  assert.equal(manifest.externalGraphLimitation, EXTERNAL_GRAPH_LIMITATION);
  assert.equal(manifest.crossHostFidelityNote, FIDELITY_NOTE);
});
