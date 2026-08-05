#!/usr/bin/env node

/**
 * Capture auditable evidence around the Microsoft Email setup smoke test.
 *
 * The helper deliberately records secret presence, never secret contents. Run
 * `before` before any fixture mutation, `sessions-created` after the smoke run
 * has created its two temporary login sessions, and `after` after cleanup.
 * Then attach a final full-DOM export to its rendered screenshot with
 * `correlate` and seal the directory with `manifest`.
 *
 * Sealing requires the four structured UI captures the smoke run produces
 * (01-self-hosted-providers-wizard, 01b-manual-setup-derived-redirect,
 * 02-pending-consent-mailbox, 03-restored-not-configured-mailbox, each as
 * .json + .png) and additionally writes `96-verification-index.json` — the
 * machine-readable map from every required smoke claim to its exact evidence
 * files, sealed identities, and assertions — plus `00-REVIEW.md`, the human
 * review entrypoint rendered deterministically from that sealed evidence
 * (the verifier re-renders it and fails on any byte difference), and
 * `97-verify-evidence.mjs`, a sealed copy of
 * scripts/verify-microsoft-email-smoke-evidence.mjs. After sealing, the
 * manifest stage runs that verifier against its own output and fails unless
 * every claim passes, so a sealed bundle is by construction independently
 * verifiable with:
 *
 *   node <evidence-dir>/97-verify-evidence.mjs <evidence-dir>
 *
 * Usage:
 *   node scripts/capture-microsoft-email-smoke-evidence.mjs before \
 *     --evidence-dir=/tmp/alga-smoke-evidence/<run> \
 *     --workflow-run-id=<uuid> --tenant-id=<uuid> --profile-id=<uuid>
 *   node scripts/capture-microsoft-email-smoke-evidence.mjs sessions-created \
 *     --evidence-dir=<dir>
 *   node scripts/capture-microsoft-email-smoke-evidence.mjs after <same options>
 *   node scripts/capture-microsoft-email-smoke-evidence.mjs correlate \
 *     --evidence-dir=<dir> --dom-file=<full-dom.html> \
 *     --screenshot-file=<cleanup.png> \
 *     --capture-provenance-file=<browser-capture.json>
 *   node scripts/capture-microsoft-email-smoke-evidence.mjs manifest \
 *     --evidence-dir=<dir>
 *
 * The browser capture provenance file must contain the same `provenance`
 * object embedded in the DOM as JSON in
 * `<script id="alga-smoke-capture-provenance" type="application/json">`.
 * It must also bind the exact exported DOM and PNG by filename and SHA-256:
 * {
 *   "provenance": {
 *     "workflowRunId": "<uuid>",
 *     "captureNonce": "<uuid>",
 *     "capturedAt": "<ISO timestamp>",
 *     "browser": { "userAgent": "...", "url": "...", "platform": "..." }
 *   },
 *   "artifacts": {
 *     "dom": { "file": "final.html", "sha256": "..." },
 *     "screenshot": { "file": "final.png", "sha256": "..." }
 *   },
 *   "renderMethod": "...",
 *   "crossHostFidelityNote": "...",
 *   "externalGraphLimitation": "No external Microsoft Graph or Entra OAuth call is performed by this evidence helper."
 * }
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parse as parseDotenv } from 'dotenv';
import pg from 'pg';
import {
  CTIME_NON_RESTORABLE_REASON,
  ctimeDisclosure,
  restorableInventory,
  truncatedMtimeMs,
} from './microsoft-email-smoke-timestamps.mjs';
import {
  CREATED_SESSIONS_FILE,
  EXPECTED_TEMPORARY_SESSION_COUNT,
  INDEX_FILE,
  REQUIRED_CLAIMS,
  REVIEW_FILE,
  SESSION_CLEANUP_FILE,
  VERIFIER_COPY_FILE,
  VERIFIER_SOURCE_PATH,
  buildReviewDocument,
  buildVerificationIndex,
  createContext as createVerificationContext,
  evaluateClaim,
  verifyBundle,
} from './verify-microsoft-email-smoke-evidence.mjs';

const { Client } = pg;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const COMMANDS = new Set(['before', 'sessions-created', 'after', 'correlate', 'manifest']);
const EXTERNAL_GRAPH_LIMITATION = 'No external Microsoft Graph or Entra OAuth call is performed by this evidence helper.';
const CROSS_HOST_CONTEXT = 'The card browser is Mac-hosted while the worktree server runs on Linux through a localhost-to-Tailscale relay.';
const PHASE_FILES = {
  before: [
    '01-before-git-status.txt',
    '01-before-secret-inventory.json',
    '01-before-runtime-build.json',
    '01-before-port-route-health.json',
    '01-before-database.json',
  ],
  after: [
    '90-after-git-status.txt',
    '90-after-secret-inventory.json',
    '90-after-runtime-build.json',
    '90-after-port-route-health.json',
    '90-after-database.json',
    '91-restoration-comparison.json',
    SESSION_CLEANUP_FILE,
  ],
};
const PHASE_MARKERS = {
  before: '02-before-assertions-passed.json',
  after: '92-after-assertions-passed.json',
};
const [command, ...rawArguments] = process.argv.slice(2);

function fail(message) {
  throw new Error(message);
}

function parseArguments(values) {
  const result = {};
  for (const value of values) {
    const match = /^--([a-z0-9-]+)=(.*)$/i.exec(value);
    if (!match) {
      fail(`Arguments must use --name=value syntax; received: ${value}`);
    }
    result[match[1]] = match[2];
  }
  return result;
}

function requireArgument(argumentsByName, name) {
  const value = argumentsByName[name];
  if (!value) {
    fail(`Missing required argument --${name}=...`);
  }
  return value;
}

function run(executable, args, cwd) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  return {
    command: [executable, ...args],
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function requireSuccessful(result) {
  if (result.exitCode !== 0) {
    fail(
      `Command failed (${result.command.join(' ')}):\n${result.stderr || result.stdout}`
    );
  }
  return result.stdout.trim();
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function deterministicFixtureProfileId(tenantId) {
  const bytes = createHash('sha256')
    .update(`alga0002215:${tenantId}:ready-false-profile`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function writeNew(filePath, contents) {
  fs.writeFileSync(filePath, contents, { encoding: 'utf8', flag: 'wx' });
}

function writeJsonNew(filePath, value) {
  writeNew(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath, label = path.basename(filePath)) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`Could not read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function transcript(result) {
  return [
    `$ ${result.command.join(' ')}`,
    `exit_code=${result.exitCode}`,
    `signal=${result.signal ?? ''}`,
    '--- stdout ---',
    result.stdout,
    '--- stderr ---',
    result.stderr,
  ].join('\n');
}

function resolveEvidenceDirectory(value) {
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) {
    fail('The evidence directory cannot be a filesystem root');
  }
  return resolved;
}

function assertInsideEvidenceDirectory(evidenceDirectory, filePath, label) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(evidenceDirectory, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label} must be inside the evidence directory`);
  }
  if (!fs.statSync(resolved).isFile()) {
    fail(`${label} is not a regular file: ${resolved}`);
  }
  return resolved;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function fileIdentity(filePath) {
  return {
    file: path.basename(filePath),
    bytes: fs.statSync(filePath).size,
    sha256: sha256File(filePath),
  };
}

function exactComparison(baseline, after) {
  return {
    exactMatch: isDeepStrictEqual(baseline, after),
    baseline,
    after,
  };
}

function repositoryRoot() {
  const result = run('git', ['rev-parse', '--show-toplevel'], process.cwd());
  return requireSuccessful(result);
}

function readEnvironment(repoRoot) {
  const fileValues = {};
  for (const relativePath of ['server/.env', 'server/.env.local']) {
    const filePath = path.join(repoRoot, relativePath);
    if (fs.existsSync(filePath)) {
      Object.assign(fileValues, parseDotenv(fs.readFileSync(filePath, 'utf8')));
    }
  }
  return { ...fileValues, ...process.env };
}

function findListeningProcess(port) {
  const result = run('fuser', [`${port}/tcp`], process.cwd());
  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const pids = [...combinedOutput.matchAll(/\b\d+\b/g)]
    .map((match) => Number(match[0]))
    .filter((value) => value !== port);
  return {
    commandResult: result,
    processes: [...new Set(pids)].map((pid) => {
      const processDirectory = `/proc/${pid}`;
      return {
        pid,
        cwd: fs.existsSync(`${processDirectory}/cwd`)
          ? fs.realpathSync(`${processDirectory}/cwd`)
          : null,
        command: fs.existsSync(`${processDirectory}/cmdline`)
          ? fs.readFileSync(`${processDirectory}/cmdline`, 'utf8').replaceAll('\0', ' ').trim()
          : null,
      };
    }),
  };
}

function buildIdentity(repoRoot) {
  const candidates = [
    'server/.next/BUILD_ID',
    'server/.next/build-manifest.json',
    'server/.next/routes-manifest.json',
    'server/.next/dev/build-manifest.json',
    'server/.next/dev/routes-manifest.json',
    'server/.next/dev/server/app-paths-manifest.json',
  ];
  return candidates.flatMap((relativePath) => {
    const filePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const stat = fs.statSync(filePath);
    return [{
      path: relativePath,
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      sha256: sha256File(filePath),
    }];
  });
}

async function routeHealth(appUrl) {
  const baseUrl = new URL(appUrl);
  const routes = ['/', '/auth/signin', '/auth/msp/signin'];
  return Promise.all(routes.map((route) => new Promise((resolve, reject) => {
    const request = http.get(new URL(route, baseUrl), (response) => {
      response.resume();
      response.on('end', () => resolve({
        route,
        status: response.statusCode,
        location: response.headers.location ?? null,
        contentType: response.headers['content-type'] ?? null,
      }));
    });
    request.setTimeout(10_000, () => request.destroy(new Error(`Timed out requesting ${route}`)));
    request.on('error', reject);
  })));
}

async function databaseSnapshot(environment, tenantId) {
  const connection = {
    host: environment.DB_HOST || '127.0.0.1',
    port: Number(environment.DB_PORT || 5432),
    user: environment.DB_USER_SERVER || 'app_user',
    password: environment.DB_PASSWORD_SERVER,
    database: environment.DB_NAME_SERVER || 'server',
  };
  const client = new Client(connection);
  await client.connect();
  try {
    const identityResult = await client.query(`
      SELECT current_database() AS database,
             current_user AS database_user,
             inet_server_addr()::text AS server_address,
             inet_server_port() AS server_port,
             version() AS postgres_version
    `);
    const profileResult = await client.query(
      `SELECT row_to_json(profile) AS profile
         FROM microsoft_profiles AS profile
        WHERE tenant = $1
        ORDER BY profile_id`,
      [tenantId]
    );
    const bindingResult = await client.query(
      `SELECT row_to_json(binding) AS binding
         FROM microsoft_profile_consumer_bindings AS binding
        WHERE tenant = $1
        ORDER BY consumer_type, profile_id`,
      [tenantId]
    );
    // Deliberately omit the legacy token and all mutable activity/device
    // fields. The evidence needs stable row identity and creation provenance,
    // never authentication material.
    const sessionResult = await client.query(
      `SELECT row_to_json(session_evidence) AS session
         FROM (
           SELECT tenant, session_id, user_id, created_at
             FROM sessions
            WHERE tenant = $1
            ORDER BY session_id
         ) AS session_evidence`,
      [tenantId]
    );
    return {
      connection: {
        host: connection.host,
        port: connection.port,
        user: connection.user,
        database: connection.database,
      },
      identity: identityResult.rows[0],
      microsoftProfiles: profileResult.rows.map((row) => row.profile),
      microsoftConsumerBindings: bindingResult.rows.map((row) => row.binding),
      sessions: sessionResult.rows.map((row) => row.session),
    };
  } finally {
    await client.end();
  }
}

function requireSessionRows(snapshot, label) {
  if (!snapshot || !Array.isArray(snapshot.sessions)) {
    fail(`${label} must include a sessions array`);
  }
  const seen = new Set();
  for (const session of snapshot.sessions) {
    if (!session || !UUID_PATTERN.test(session.session_id || '')) {
      fail(`${label} contains a session without a UUID session_id`);
    }
    if (seen.has(session.session_id)) {
      fail(`${label} contains duplicate session_id ${session.session_id}`);
    }
    seen.add(session.session_id);
  }
  return snapshot.sessions;
}

function buildTemporarySessionsCreatedProof(metadata, baselineDatabase, observedDatabase, capturedAt) {
  const expectedCount = metadata.temporarySessionCleanup?.expectedCreatedSessionCount;
  if (expectedCount !== EXPECTED_TEMPORARY_SESSION_COUNT
    || metadata.temporarySessionCleanup?.createdEvidenceFile !== CREATED_SESSIONS_FILE
    || metadata.temporarySessionCleanup?.cleanupEvidenceFile !== SESSION_CLEANUP_FILE) {
    fail('Workflow metadata does not declare the required two-session cleanup proof');
  }
  const baselineIds = new Set(
    requireSessionRows(baselineDatabase, 'Before database snapshot')
      .map((session) => session.session_id)
  );
  const createdSessions = requireSessionRows(observedDatabase, 'Created-session database snapshot')
    .filter((session) => !baselineIds.has(session.session_id));
  if (createdSessions.length !== expectedCount) {
    fail(`Expected exactly ${expectedCount} temporary session rows, observed ${createdSessions.length}`);
  }
  const startedAt = new Date(metadata.startedAt);
  const observedAt = new Date(capturedAt);
  for (const session of createdSessions) {
    const createdAt = new Date(session.created_at);
    if (session.tenant !== metadata.tenantId
      || !UUID_PATTERN.test(session.user_id || '')
      || Number.isNaN(createdAt.valueOf())
      || createdAt < startedAt
      || createdAt > observedAt) {
      fail(`Temporary session ${session.session_id} is not attributable to this smoke run`);
    }
  }
  return {
    workflowRunId: metadata.workflowRunId,
    tenantId: metadata.tenantId,
    capturedAt,
    expectedCreatedSessionCount: expectedCount,
    assertionsPassed: true,
    createdSessions,
  };
}

function buildTemporarySessionCleanupProof(metadata, creation, afterDatabase, createdEvidence) {
  const expectedCount = metadata.temporarySessionCleanup?.expectedCreatedSessionCount;
  if (creation.workflowRunId !== metadata.workflowRunId
    || creation.tenantId !== metadata.tenantId
    || creation.expectedCreatedSessionCount !== expectedCount
    || creation.assertionsPassed !== true
    || !Array.isArray(creation.createdSessions)
    || creation.createdSessions.length !== expectedCount) {
    fail('The temporary-session creation evidence is invalid');
  }
  const createdSessionIds = creation.createdSessions
    .map((session) => session.session_id)
    .sort((left, right) => left.localeCompare(right));
  if (new Set(createdSessionIds).size !== expectedCount
    || createdSessionIds.some((sessionId) => !UUID_PATTERN.test(sessionId))) {
    fail('The temporary-session creation evidence does not identify two distinct rows');
  }
  const createdIdSet = new Set(createdSessionIds);
  const remainingSessionRows = requireSessionRows(afterDatabase, 'After database snapshot')
    .filter((session) => createdIdSet.has(session.session_id));
  const deletedSessionIds = createdSessionIds.filter(
    (sessionId) => !remainingSessionRows.some((session) => session.session_id === sessionId)
  );
  return {
    workflowRunId: metadata.workflowRunId,
    tenantId: metadata.tenantId,
    verifiedAt: new Date().toISOString(),
    createdEvidence,
    expectedCreatedSessionCount: expectedCount,
    createdSessionIds,
    deletedSessionIds,
    remainingSessionRows,
    allDeleted: deletedSessionIds.length === expectedCount && remainingSessionRows.length === 0,
  };
}

async function captureCreatedSessions(args) {
  const evidenceDirectory = resolveEvidenceDirectory(requireArgument(args, 'evidence-dir'));
  const metadata = readJson(
    path.join(evidenceDirectory, '00-workflow-run.json'),
    'workflow metadata'
  );
  if (metadata.externalGraphLimitation !== EXTERNAL_GRAPH_LIMITATION
    || metadata.crossHostContext !== CROSS_HOST_CONTEXT) {
    fail('Workflow metadata is missing the required limitations');
  }
  verifyPhaseMarker(evidenceDirectory, 'before', metadata.workflowRunId);
  const repoRoot = repositoryRoot();
  const observedDatabase = await databaseSnapshot(readEnvironment(repoRoot), metadata.tenantId);
  const baselineDatabase = readJson(
    path.join(evidenceDirectory, '01-before-database.json'),
    'before database snapshot'
  );
  const capturedAt = new Date().toISOString();
  writeJsonNew(
    path.join(evidenceDirectory, CREATED_SESSIONS_FILE),
    buildTemporarySessionsCreatedProof(
      metadata,
      baselineDatabase,
      observedDatabase,
      capturedAt
    )
  );
  console.log(JSON.stringify({
    phase: 'sessions-created',
    workflowRunId: metadata.workflowRunId,
    evidenceDirectory,
    temporarySessions: EXPECTED_TEMPORARY_SESSION_COUNT,
  }, null, 2));
}

function resolveFilesystemSecretBase(repoRoot, environment) {
  const writeProvider = environment.SECRET_WRITE_PROVIDER || 'filesystem';
  if (writeProvider !== 'filesystem') {
    fail(
      `This local evidence helper requires SECRET_WRITE_PROVIDER=filesystem to inventory every mutated tenant secret; received ${writeProvider}`
    );
  }

  const configured = environment.SECRET_FS_BASE_PATH?.trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(repoRoot, configured);
  }
  if (fs.existsSync('/run/secrets')) {
    return '/run/secrets';
  }
  for (const candidate of [path.join(repoRoot, 'secrets'), path.resolve(repoRoot, '../secrets')]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.resolve(repoRoot, '../secrets');
}

function secretInventory(repoRoot, environment, tenantId) {
  const basePath = resolveFilesystemSecretBase(repoRoot, environment);
  const tenantSecretDirectory = path.join(basePath, 'tenants', tenantId);
  const files = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        fail(`Refusing to inventory symbolic link in tenant secrets: ${entryPath}`);
      }
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(entryPath);
        files.push({
          name: path.relative(tenantSecretDirectory, entryPath),
          bytes: stat.size,
          mode: stat.mode & 0o777,
          // Pre-existing secret files are never mutated by the fixture, so
          // their timestamps are compared at full stat fidelity.
          mtimeMs: stat.mtimeMs,
          // ctime is kernel-managed and not restorable from userspace; the
          // fixture never touches pre-existing files, so it must not move.
          ctimeMs: stat.ctimeMs,
          sha256: sha256File(entryPath),
        });
      } else {
        fail(`Unsupported tenant secret entry: ${entryPath}`);
      }
    }
  }

  if (fs.existsSync(tenantSecretDirectory)) {
    if (!fs.statSync(tenantSecretDirectory).isDirectory()) {
      fail(`Tenant secret path is not a directory: ${tenantSecretDirectory}`);
    }
    visit(tenantSecretDirectory);
  }
  files.sort((left, right) => left.name.localeCompare(right.name));
  const directoryExists = fs.existsSync(tenantSecretDirectory);
  // The parent directory's ctime is recorded because, when the tenant secret
  // directory does not pre-exist, the fixture creates then removes the tenant
  // directory and it is the parent whose ctime must be disclosed as changed.
  const parentSecretDirectory = path.dirname(tenantSecretDirectory);
  const parentDirectoryExists = fs.existsSync(parentSecretDirectory);
  return {
    provider: 'filesystem',
    basePath,
    tenantDirectory: tenantSecretDirectory,
    directoryExists,
    // The tenant directory's mtime churns when the fixture writes or deletes
    // its secret file and is restored through fs.utimes, which is faithful to
    // the millisecond but not the nanosecond; compare at whole milliseconds.
    directoryMtimeMs: directoryExists
      ? truncatedMtimeMs(fs.statSync(tenantSecretDirectory))
      : null,
    // ctime cannot be restored from userspace at any precision; it is captured
    // so the after capture can disclose the unavoidable delta, not compare it.
    directoryCtimeMs: directoryExists
      ? fs.statSync(tenantSecretDirectory).ctimeMs
      : null,
    parentDirectoryCtimeMs: parentDirectoryExists
      ? fs.statSync(parentSecretDirectory).ctimeMs
      : null,
    files,
  };
}

function provenance(repoRoot, port) {
  const head = requireSuccessful(run('git', ['rev-parse', 'HEAD'], repoRoot));
  const branch = requireSuccessful(run('git', ['branch', '--show-current'], repoRoot));
  const listening = findListeningProcess(port);
  return {
    capturedAt: new Date().toISOString(),
    commit: head,
    branch,
    worktree: repoRoot,
    commandCwd: process.cwd(),
    port,
    listenerProbe: listening.commandResult,
    listeningProcesses: listening.processes,
    buildFiles: buildIdentity(repoRoot),
  };
}

function writePhaseMarker(evidenceDirectory, phase, workflowRunId) {
  const files = PHASE_FILES[phase].map((name) => {
    const filePath = path.join(evidenceDirectory, name);
    if (!fs.existsSync(filePath)) {
      fail(`Cannot mark ${phase} successful because ${name} is missing`);
    }
    return fileIdentity(filePath);
  });
  writeJsonNew(path.join(evidenceDirectory, PHASE_MARKERS[phase]), {
    workflowRunId,
    phase,
    assertionsPassed: true,
    recordedAt: new Date().toISOString(),
    externalGraphLimitation: EXTERNAL_GRAPH_LIMITATION,
    files,
  });
}

function verifyPhaseMarker(evidenceDirectory, phase, workflowRunId) {
  const markerPath = path.join(evidenceDirectory, PHASE_MARKERS[phase]);
  if (!fs.existsSync(markerPath)) {
    fail(`The ${phase} assertions-passed marker is missing`);
  }
  const marker = readJson(markerPath, `${phase} assertions-passed marker`);
  if (marker.workflowRunId !== workflowRunId
    || marker.phase !== phase
    || marker.assertionsPassed !== true
    || marker.externalGraphLimitation !== EXTERNAL_GRAPH_LIMITATION) {
    fail(`The ${phase} assertions-passed marker is invalid`);
  }
  if (!Array.isArray(marker.files)
    || marker.files.length !== PHASE_FILES[phase].length
    || !isDeepStrictEqual(marker.files.map((file) => file.file), PHASE_FILES[phase])) {
    fail(`The ${phase} assertions-passed marker has an incomplete file inventory`);
  }
  for (const expected of marker.files) {
    const filePath = path.join(evidenceDirectory, expected.file);
    if (!fs.existsSync(filePath) || !isDeepStrictEqual(fileIdentity(filePath), expected)) {
      fail(`The ${phase} artifact changed after its assertions passed: ${expected.file}`);
    }
  }
  return marker;
}

async function capturePhase(phase, args) {
  const evidenceDirectory = resolveEvidenceDirectory(requireArgument(args, 'evidence-dir'));
  const workflowRunId = requireArgument(args, 'workflow-run-id');
  const tenantId = requireArgument(args, 'tenant-id');
  const profileId = requireArgument(args, 'profile-id');
  if (!UUID_PATTERN.test(workflowRunId) || !UUID_PATTERN.test(tenantId) || !UUID_PATTERN.test(profileId)) {
    fail('workflow-run-id, tenant-id, and profile-id must be UUIDs');
  }
  const expectedProfileId = deterministicFixtureProfileId(tenantId);
  if (profileId !== expectedProfileId) {
    fail(`profile-id must identify this tenant's smoke fixture: ${expectedProfileId}`);
  }

  const repoRoot = repositoryRoot();
  const environment = readEnvironment(repoRoot);
  const port = Number(args.port || environment.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    fail(`Invalid port: ${args.port}`);
  }
  const appUrl = args['app-url'] || `http://localhost:${port}`;
  fs.mkdirSync(evidenceDirectory, { recursive: true });

  let metadata;
  if (phase === 'before') {
    writeJsonNew(path.join(evidenceDirectory, '00-workflow-run.json'), {
      workflowRunId,
      evidenceDirectory,
      startedAt: new Date().toISOString(),
      appUrl,
      tenantId,
      profileId,
      temporarySessionCleanup: {
        expectedCreatedSessionCount: EXPECTED_TEMPORARY_SESSION_COUNT,
        createdEvidenceFile: CREATED_SESSIONS_FILE,
        cleanupEvidenceFile: SESSION_CLEANUP_FILE,
      },
      externalGraphLimitation: EXTERNAL_GRAPH_LIMITATION,
      crossHostContext: CROSS_HOST_CONTEXT,
    });
  } else {
    const metadataPath = path.join(evidenceDirectory, '00-workflow-run.json');
    metadata = readJson(metadataPath, 'workflow metadata');
    if (metadata.workflowRunId !== workflowRunId
      || metadata.tenantId !== tenantId
      || metadata.profileId !== profileId
      || metadata.temporarySessionCleanup?.expectedCreatedSessionCount !== EXPECTED_TEMPORARY_SESSION_COUNT
      || metadata.temporarySessionCleanup?.createdEvidenceFile !== CREATED_SESSIONS_FILE
      || metadata.temporarySessionCleanup?.cleanupEvidenceFile !== SESSION_CLEANUP_FILE
      || metadata.externalGraphLimitation !== EXTERNAL_GRAPH_LIMITATION
      || metadata.crossHostContext !== CROSS_HOST_CONTEXT) {
      fail('The after arguments do not match the before metadata');
    }
    verifyPhaseMarker(evidenceDirectory, 'before', workflowRunId);
  }

  const prefix = phase === 'before' ? '01-before' : '90-after';
  const gitStatus = run('git', ['status', '--short'], repoRoot);
  const secrets = secretInventory(repoRoot, environment, tenantId);
  const runtime = provenance(repoRoot, port);
  const routes = await routeHealth(appUrl);
  const database = await databaseSnapshot(environment, tenantId);
  let restoration;
  let sessionCleanup;
  if (phase === 'after') {
    const baselineDatabase = readJson(
      path.join(evidenceDirectory, '01-before-database.json'),
      'before database snapshot'
    );
    const baselineSecrets = readJson(
      path.join(evidenceDirectory, '01-before-secret-inventory.json'),
      'before secret inventory'
    );
    const createdSessionsPath = path.join(evidenceDirectory, CREATED_SESSIONS_FILE);
    const createdSessions = readJson(createdSessionsPath, 'temporary-session creation evidence');
    sessionCleanup = buildTemporarySessionCleanupProof(
      metadata,
      createdSessions,
      database,
      fileIdentity(createdSessionsPath)
    );
    if (!sessionCleanup.allDeleted) {
      fail(
        `Cleanup left ${sessionCleanup.remainingSessionRows.length} of the two temporary session rows behind`
      );
    }
    const disclosure = ctimeDisclosure(baselineSecrets, secrets);
    restoration = {
      microsoftProfiles: exactComparison(
        baselineDatabase.microsoftProfiles,
        database.microsoftProfiles
      ),
      microsoftConsumerBindings: exactComparison(
        baselineDatabase.microsoftConsumerBindings,
        database.microsoftConsumerBindings
      ),
      // The tenant secret inventory is compared on its restorable fields only:
      // content hashes, names, sizes, modes, per-file mtime, and the directory
      // mtime. ctime is kernel-managed and cannot be restored from userspace,
      // so it is compared and disclosed separately below.
      tenantSecrets: exactComparison(
        restorableInventory(baselineSecrets),
        restorableInventory(secrets)
      ),
      ctimeDisclosure: disclosure,
    };
    restoration.exactMatch = [
      restoration.microsoftProfiles,
      restoration.microsoftConsumerBindings,
      restoration.tenantSecrets,
    ].every((comparison) => comparison.exactMatch === true)
      && disclosure.unexpectedChanges.length === 0;
    if (!restoration.exactMatch) {
      const failures = [
        'microsoftProfiles',
        'microsoftConsumerBindings',
        'tenantSecrets',
      ].filter((name) => restoration[name].exactMatch !== true);
      if (disclosure.unexpectedChanges.length > 0) {
        failures.push(
          `unexpected ctime changes on untouched paths: ${disclosure.unexpectedChanges.join(', ')}`
        );
      }
      fail(`Cleanup did not restore the complete restorable baseline inventories: ${failures.join(', ')}`);
    }
  }

  if (gitStatus.exitCode !== 0) {
    fail('git status failed');
  }
  const fixtureSecretName = `microsoft_profile_${profileId}_client_secret`;
  if (database.microsoftProfiles.some((profile) => profile.profile_id === profileId)) {
    fail(`The smoke fixture profile exists during the ${phase} capture`);
  }
  if (secrets.files.some((file) => file.name === fixtureSecretName)) {
    fail(`The smoke fixture secret exists during the ${phase} capture`);
  }
  if (runtime.listeningProcesses.length === 0 || routes.some((route) => !route.status)) {
    fail('The application listener or route health check failed');
  }

  writeNew(path.join(evidenceDirectory, `${prefix}-git-status.txt`), transcript(gitStatus));
  writeJsonNew(path.join(evidenceDirectory, `${prefix}-secret-inventory.json`), secrets);
  writeJsonNew(path.join(evidenceDirectory, `${prefix}-runtime-build.json`), runtime);
  writeJsonNew(path.join(evidenceDirectory, `${prefix}-port-route-health.json`), {
    appUrl,
    listeningProcesses: runtime.listeningProcesses,
    routes,
  });
  writeJsonNew(path.join(evidenceDirectory, `${prefix}-database.json`), database);
  if (phase === 'after') {
    writeJsonNew(path.join(evidenceDirectory, '91-restoration-comparison.json'), restoration);
    writeJsonNew(path.join(evidenceDirectory, SESSION_CLEANUP_FILE), sessionCleanup);
  }
  writePhaseMarker(evidenceDirectory, phase, workflowRunId);

  console.log(JSON.stringify({ phase, workflowRunId, evidenceDirectory }, null, 2));
}

function validateCaptureProvenance(value, metadata) {
  if (!value || typeof value !== 'object') {
    fail('Capture provenance must be a JSON object');
  }
  if (value.workflowRunId !== metadata.workflowRunId) {
    fail('Capture provenance workflowRunId does not match the evidence run');
  }
  if (!UUID_PATTERN.test(value.captureNonce || '')) {
    fail('Capture provenance captureNonce must be a UUID');
  }
  const capturedAt = new Date(value.capturedAt);
  if (typeof value.capturedAt !== 'string' || Number.isNaN(capturedAt.valueOf())) {
    fail('Capture provenance capturedAt must be an ISO timestamp');
  }
  if (capturedAt.toISOString() !== value.capturedAt) {
    fail('Capture provenance capturedAt must use canonical ISO format');
  }
  if (!value.browser || typeof value.browser !== 'object') {
    fail('Capture provenance must include browser details');
  }
  assertNonEmptyString(value.browser.userAgent, 'Browser userAgent');
  assertNonEmptyString(value.browser.url, 'Browser URL');
  assertNonEmptyString(value.browser.platform, 'Browser platform');
  let browserUrl;
  try {
    browserUrl = new URL(value.browser.url);
  } catch {
    fail('Browser provenance URL must be valid');
  }
  if (browserUrl.origin !== new URL(metadata.appUrl).origin) {
    fail('Browser provenance URL does not belong to the recorded application origin');
  }
  return value;
}

function captureArtifactMatches(actualPath, declared, label) {
  if (!declared || typeof declared !== 'object') {
    fail(`Capture provenance is missing the ${label} artifact identity`);
  }
  if (declared.file !== path.basename(actualPath)
    || !SHA256_PATTERN.test(declared.sha256 || '')
    || declared.sha256 !== sha256File(actualPath)) {
    fail(`Capture provenance does not bind the exact ${label} artifact`);
  }
}

function correlate(args) {
  const evidenceDirectory = resolveEvidenceDirectory(requireArgument(args, 'evidence-dir'));
  const domFile = assertInsideEvidenceDirectory(
    evidenceDirectory,
    requireArgument(args, 'dom-file'),
    'DOM file'
  );
  const screenshotFile = assertInsideEvidenceDirectory(
    evidenceDirectory,
    requireArgument(args, 'screenshot-file'),
    'Screenshot file'
  );
  const captureProvenanceFile = assertInsideEvidenceDirectory(
    evidenceDirectory,
    requireArgument(args, 'capture-provenance-file'),
    'Capture provenance file'
  );
  const metadata = readJson(
    path.join(evidenceDirectory, '00-workflow-run.json'),
    'workflow metadata'
  );
  if (metadata.externalGraphLimitation !== EXTERNAL_GRAPH_LIMITATION
    || metadata.crossHostContext !== CROSS_HOST_CONTEXT) {
    fail('Workflow metadata is missing the required limitations');
  }
  verifyPhaseMarker(evidenceDirectory, 'before', metadata.workflowRunId);
  verifyPhaseMarker(evidenceDirectory, 'after', metadata.workflowRunId);

  const captureRecord = readJson(captureProvenanceFile, 'browser capture provenance');
  const captureProvenance = validateCaptureProvenance(captureRecord.provenance, metadata);
  if (!captureRecord.artifacts || typeof captureRecord.artifacts !== 'object') {
    fail('Capture provenance must include artifact identities');
  }
  captureArtifactMatches(domFile, captureRecord.artifacts.dom, 'DOM');
  captureArtifactMatches(screenshotFile, captureRecord.artifacts.screenshot, 'screenshot');
  const renderMethod = assertNonEmptyString(captureRecord.renderMethod, 'Render method');
  const crossHostFidelityNote = assertNonEmptyString(
    captureRecord.crossHostFidelityNote,
    'Cross-host fidelity note'
  );
  if (captureRecord.externalGraphLimitation !== EXTERNAL_GRAPH_LIMITATION) {
    fail('Capture provenance must preserve the no-external-Graph limitation');
  }

  const domContents = fs.readFileSync(domFile, 'utf8');
  if (!/<html[\s>]/i.test(domContents) || !/<\/html>/i.test(domContents)) {
    fail('The DOM artifact must contain a complete HTML document');
  }
  const embeddedMatch = /<script\b[^>]*\bid=["']alga-smoke-capture-provenance["'][^>]*>([\s\S]*?)<\/script>/i
    .exec(domContents);
  if (!embeddedMatch) {
    fail('The DOM artifact is missing its embedded capture provenance');
  }
  let embeddedProvenance;
  try {
    embeddedProvenance = JSON.parse(embeddedMatch[1]);
  } catch (error) {
    fail(`The DOM capture provenance is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  validateCaptureProvenance(embeddedProvenance, metadata);
  if (!isDeepStrictEqual(embeddedProvenance, captureProvenance)) {
    fail('The DOM and PNG capture record do not share the same nonce, timestamp, and browser provenance');
  }
  const pngSignature = fs.readFileSync(screenshotFile).subarray(0, 8).toString('hex');
  if (pngSignature !== '89504e470d0a1a0a') {
    fail('The correlated cleanup screenshot must be a PNG');
  }
  writeJsonNew(path.join(evidenceDirectory, '95-final-dom-screenshot-correlation.json'), {
    workflowRunId: metadata.workflowRunId,
    correlatedAt: new Date().toISOString(),
    sameCaptureProven: true,
    provenance: captureProvenance,
    dom: fileIdentity(domFile),
    screenshot: fileIdentity(screenshotFile),
    captureProvenanceFile: fileIdentity(captureProvenanceFile),
    renderMethod,
    crossHostContext: CROSS_HOST_CONTEXT,
    crossHostFidelityNote,
    externalGraphLimitation: EXTERNAL_GRAPH_LIMITATION,
  });
}

function createManifest(args) {
  const evidenceDirectory = resolveEvidenceDirectory(requireArgument(args, 'evidence-dir'));
  const metadata = readJson(
    path.join(evidenceDirectory, '00-workflow-run.json'),
    'workflow metadata'
  );
  if (metadata.externalGraphLimitation !== EXTERNAL_GRAPH_LIMITATION
    || metadata.crossHostContext !== CROSS_HOST_CONTEXT) {
    fail('Workflow metadata is missing the required limitations');
  }
  verifyPhaseMarker(evidenceDirectory, 'before', metadata.workflowRunId);
  verifyPhaseMarker(evidenceDirectory, 'after', metadata.workflowRunId);

  const correlationPath = path.join(
    evidenceDirectory,
    '95-final-dom-screenshot-correlation.json'
  );
  if (!fs.existsSync(correlationPath)) {
    fail('Run correlate before creating the manifest');
  }
  const restorationPath = path.join(evidenceDirectory, '91-restoration-comparison.json');
  if (!fs.existsSync(restorationPath)) {
    fail('Run the after capture before creating the manifest');
  }
  const restoration = readJson(restorationPath, 'restoration comparison');
  const restorationSections = [
    restoration.microsoftProfiles,
    restoration.microsoftConsumerBindings,
    restoration.tenantSecrets,
  ];
  if (restoration.exactMatch !== true
    || restorationSections.some((comparison) => comparison?.exactMatch !== true)) {
    fail('The restorable profile, binding, and secret inventories were not restored exactly');
  }
  if (restoration.ctimeDisclosure?.reason !== CTIME_NON_RESTORABLE_REASON
    || !Array.isArray(restoration.ctimeDisclosure.unexpectedChanges)
    || restoration.ctimeDisclosure.unexpectedChanges.length !== 0) {
    fail('The ctime disclosure is missing, mislabeled, or reports unexpected ctime changes');
  }
  const sessionCleanup = readJson(
    path.join(evidenceDirectory, SESSION_CLEANUP_FILE),
    'temporary-session cleanup proof'
  );
  if (sessionCleanup.workflowRunId !== metadata.workflowRunId
    || sessionCleanup.tenantId !== metadata.tenantId
    || sessionCleanup.expectedCreatedSessionCount !== EXPECTED_TEMPORARY_SESSION_COUNT
    || !Array.isArray(sessionCleanup.createdSessionIds)
    || sessionCleanup.createdSessionIds.length !== EXPECTED_TEMPORARY_SESSION_COUNT
    || !Array.isArray(sessionCleanup.deletedSessionIds)
    || sessionCleanup.deletedSessionIds.length !== EXPECTED_TEMPORARY_SESSION_COUNT
    || !Array.isArray(sessionCleanup.remainingSessionRows)
    || sessionCleanup.remainingSessionRows.length !== 0
    || sessionCleanup.allDeleted !== true) {
    fail('The proof does not show both temporary session rows were deleted');
  }
  const correlation = readJson(correlationPath, 'final DOM/PNG correlation');
  if (correlation.workflowRunId !== metadata.workflowRunId
    || correlation.sameCaptureProven !== true
    || correlation.externalGraphLimitation !== EXTERNAL_GRAPH_LIMITATION
    || correlation.crossHostContext !== CROSS_HOST_CONTEXT) {
    fail('The final DOM/PNG correlation is incomplete');
  }
  assertNonEmptyString(correlation.crossHostFidelityNote, 'Cross-host fidelity note');
  assertNonEmptyString(correlation.renderMethod, 'Render method');
  validateCaptureProvenance(correlation.provenance, metadata);
  for (const artifact of [correlation.dom, correlation.screenshot, correlation.captureProvenanceFile]) {
    const artifactPath = path.join(evidenceDirectory, artifact?.file || '');
    if (!artifact?.file
      || !fs.existsSync(artifactPath)
      || !isDeepStrictEqual(fileIdentity(artifactPath), artifact)) {
      fail(`A correlated capture artifact changed before sealing: ${artifact?.file || 'unknown'}`);
    }
  }

  for (const outputName of [REVIEW_FILE, INDEX_FILE, VERIFIER_COPY_FILE, '98-sha256-manifest.json', 'SHA256SUMS']) {
    if (fs.existsSync(path.join(evidenceDirectory, outputName))) {
      fail(`Refusing to overwrite existing sealed artifact: ${outputName}`);
    }
  }

  // Every UI-state claim must hold before the bundle can seal: the wizard
  // licensing gate, the derived read-only Redirect URI, and both mailbox
  // readiness states. The remaining claims are enforced by the existing gates
  // above and re-verified as a whole after sealing.
  const uiClaimIds = new Set([
    'providers-wizard-platform-gating',
    'derived-readonly-redirect-uri',
    'pending-admin-consent-mailbox',
    'restored-not-configured-mailbox',
  ]);
  const sealContext = createVerificationContext(evidenceDirectory);
  for (const claim of REQUIRED_CLAIMS.filter((entry) => uiClaimIds.has(entry.id))) {
    const result = evaluateClaim(claim, sealContext);
    if (!result.passed) {
      fail(`Cannot seal: UI claim ${claim.id} failed: ${result.failures.join('; ')}`);
    }
  }

  fs.copyFileSync(
    VERIFIER_SOURCE_PATH,
    path.join(evidenceDirectory, VERIFIER_COPY_FILE),
    fs.constants.COPYFILE_EXCL
  );
  writeJsonNew(
    path.join(evidenceDirectory, INDEX_FILE),
    buildVerificationIndex(evidenceDirectory, {
      verifierCopySha256: sha256File(path.join(evidenceDirectory, VERIFIER_COPY_FILE)),
    })
  );
  // The human review entrypoint is rendered from the sealed evidence just
  // written, so the sealed verifier can re-render it and reject any edit.
  writeNew(
    path.join(evidenceDirectory, REVIEW_FILE),
    buildReviewDocument(sealContext)
  );

  const excluded = new Set(['98-sha256-manifest.json', 'SHA256SUMS']);
  const files = fs.readdirSync(evidenceDirectory)
    .filter((name) => !excluded.has(name))
    .map((name) => path.join(evidenceDirectory, name))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort((left, right) => left.localeCompare(right))
    .map((filePath) => ({
      file: path.basename(filePath),
      bytes: fs.statSync(filePath).size,
      sha256: sha256File(filePath),
    }));
  writeJsonNew(path.join(evidenceDirectory, '98-sha256-manifest.json'), {
    workflowRunId: metadata.workflowRunId,
    generatedAt: new Date().toISOString(),
    assertionsPassed: true,
    restorationExact: true,
    temporarySessionRowsDeleted: true,
    temporarySessionRowsDeletedCount: sessionCleanup.deletedSessionIds.length,
    ctimeDisclosed: true,
    ctimeNonRestorableReason: CTIME_NON_RESTORABLE_REASON,
    ctimeUnexpectedChanges: restoration.ctimeDisclosure.unexpectedChanges,
    sameCaptureProven: true,
    externalGraphLimitation: EXTERNAL_GRAPH_LIMITATION,
    crossHostContext: CROSS_HOST_CONTEXT,
    crossHostFidelityNote: correlation.crossHostFidelityNote,
    files,
  });

  const checksumFiles = fs.readdirSync(evidenceDirectory)
    .filter((name) => name !== 'SHA256SUMS')
    .map((name) => path.join(evidenceDirectory, name))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort((left, right) => left.localeCompare(right));
  writeNew(
    path.join(evidenceDirectory, 'SHA256SUMS'),
    `${checksumFiles.map((filePath) => `${sha256File(filePath)}  ${path.basename(filePath)}`).join('\n')}\n`
  );

  // A sealed bundle must verify on its own: run the bundled verifier's claim
  // table against the directory that was just sealed and refuse to report
  // success otherwise.
  const verdict = verifyBundle(evidenceDirectory);
  if (!verdict.passed) {
    const failed = verdict.results
      .filter((result) => !result.passed)
      .map((result) => `${result.id}: ${result.failures.join('; ')}`);
    fail(`The sealed bundle failed its own verification: ${failed.join(' | ') || verdict.setupError}`);
  }
  console.log(JSON.stringify({
    workflowRunId: metadata.workflowRunId,
    evidenceDirectory,
    files: checksumFiles.length,
    verification: {
      passed: true,
      claims: verdict.results.length,
      reviewEntrypoint: path.join(evidenceDirectory, REVIEW_FILE),
      command: `node ${path.join(evidenceDirectory, VERIFIER_COPY_FILE)} ${evidenceDirectory}`,
      bundleDigest: verdict.bundleDigest,
    },
  }, null, 2));
}

export {
  buildTemporarySessionCleanupProof,
  buildTemporarySessionsCreatedProof,
  exactComparison,
  secretInventory,
};

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  try {
    if (!COMMANDS.has(command)) {
      fail('Expected command: before, sessions-created, after, correlate, or manifest');
    }
    const args = parseArguments(rawArguments);
    if (command === 'before' || command === 'after') {
      await capturePhase(command, args);
    } else if (command === 'sessions-created') {
      await captureCreatedSessions(args);
    } else if (command === 'correlate') {
      correlate(args);
    } else {
      createManifest(args);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
