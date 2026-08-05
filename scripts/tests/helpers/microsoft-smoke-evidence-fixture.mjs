/**
 * Shared fixture for the Microsoft Email smoke-evidence tests: builds a
 * complete, internally consistent evidence directory that the capture script
 * can correlate and seal, and that the bundle verifier can verify.
 *
 * Every JSON artifact here mirrors the structure the live capture produces —
 * the verifier recomputes restoration comparisons from the database and
 * secret-inventory snapshots, so the fixture derives the restoration file
 * from the same objects it writes into those snapshots.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CTIME_NON_RESTORABLE_REASON,
  restorableInventory,
} from '../../microsoft-email-smoke-timestamps.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const CAPTURE_SCRIPT = path.join(REPO_ROOT, 'scripts/capture-microsoft-email-smoke-evidence.mjs');
export const VERIFY_SCRIPT = path.join(REPO_ROOT, 'scripts/verify-microsoft-email-smoke-evidence.mjs');
export const WORKFLOW_RUN_ID = '11111111-1111-4111-8111-111111111111';
export const CAPTURE_NONCE = '22222222-2222-4222-8222-222222222222';
export const TENANT_ID = '33333333-3333-4333-8333-333333333333';
export const PROFILE_ID = '44444444-4444-4444-8444-444444444444';
export const EXISTING_PROFILE_ID = '55555555-5555-4555-8555-555555555555';
export const EXTERNAL_GRAPH_LIMITATION = 'No external Microsoft Graph or Entra OAuth call is performed by this evidence helper.';
export const CROSS_HOST_CONTEXT = 'The card browser is Mac-hosted while the worktree server runs on Linux through a localhost-to-Tailscale relay.';
export const FIDELITY_NOTE = 'React handlers were driven from the card-scoped Mac terminal; the exported live DOM was rendered to the attached PNG.';
export const PHASE_FILES = {
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
  ],
};
export const PHASE_MARKERS = {
  before: '02-before-assertions-passed.json',
  after: '92-after-assertions-passed.json',
};

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

export const DATABASE_SNAPSHOT = {
  connection: { host: '127.0.0.1', port: 5432, user: 'app_user', database: 'server' },
  identity: {
    database: 'server',
    database_user: 'app_user',
    server_address: '127.0.0.1',
    server_port: 5432,
    postgres_version: 'PostgreSQL 17.0 (test fixture)',
  },
  microsoftProfiles: [
    {
      profile_id: EXISTING_PROFILE_ID,
      tenant: TENANT_ID,
      display_name: 'Pre-existing profile',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ],
  microsoftConsumerBindings: [
    {
      tenant: TENANT_ID,
      consumer_type: 'email_provider',
      profile_id: EXISTING_PROFILE_ID,
      created_at: '2026-01-02T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    },
  ],
};

export const SECRET_INVENTORY_SNAPSHOT = {
  provider: 'filesystem',
  basePath: '/tmp/secret-base',
  tenantDirectory: `/tmp/secret-base/tenants/${TENANT_ID}`,
  directoryExists: true,
  directoryMtimeMs: 1785886890527,
  directoryCtimeMs: 1785886890527.123,
  parentDirectoryCtimeMs: 1785886890000.5,
  files: [
    {
      name: 'existing_secret',
      bytes: 6,
      mode: 0o600,
      mtimeMs: 1785886880000.25,
      ctimeMs: 1785886880000.25,
      sha256: 'ab'.repeat(32),
    },
  ],
};

export const RUNTIME_BUILD_SNAPSHOT = {
  capturedAt: '2026-08-04T23:00:00.000Z',
  commit: '0123456789abcdef0123456789abcdef01234567',
  branch: 'chore/microsoft-graph-cleanup-test',
  worktree: '/tmp/test-worktree',
  commandCwd: '/tmp/test-worktree',
  port: 3100,
  listenerProbe: { exitCode: 0 },
  listeningProcesses: [{ pid: 4242, cwd: '/tmp/test-worktree', command: 'node server' }],
  buildFiles: [],
};

export const RESTORED = {
  exactMatch: true,
  microsoftProfiles: {
    exactMatch: true,
    baseline: DATABASE_SNAPSHOT.microsoftProfiles,
    after: DATABASE_SNAPSHOT.microsoftProfiles,
  },
  microsoftConsumerBindings: {
    exactMatch: true,
    baseline: DATABASE_SNAPSHOT.microsoftConsumerBindings,
    after: DATABASE_SNAPSHOT.microsoftConsumerBindings,
  },
  tenantSecrets: {
    exactMatch: true,
    baseline: restorableInventory(SECRET_INVENTORY_SNAPSHOT),
    after: restorableInventory(SECRET_INVENTORY_SNAPSHOT),
  },
  ctimeDisclosure: {
    reason: CTIME_NON_RESTORABLE_REASON,
    paths: [
      {
        path: SECRET_INVENTORY_SNAPSHOT.tenantDirectory,
        kind: 'directory',
        expected: true,
        baselineCtimeMs: SECRET_INVENTORY_SNAPSHOT.directoryCtimeMs,
        afterCtimeMs: SECRET_INVENTORY_SNAPSHOT.directoryCtimeMs,
        changed: false,
      },
    ],
    changedPaths: [],
    unexpectedChanges: [],
  },
};

export const PROVENANCE = {
  workflowRunId: WORKFLOW_RUN_ID,
  captureNonce: CAPTURE_NONCE,
  capturedAt: '2026-08-04T23:00:00.000Z',
  browser: {
    userAgent: 'Smoke Browser 1',
    url: 'http://localhost:3100/msp/settings?category=communication',
    platform: 'macOS',
  },
};

export const UI_CAPTURES = {
  '01-self-hosted-providers-wizard.json': {
    url: 'http://localhost:3100/msp/settings/integrations?category=providers',
    text: 'Set up Microsoft — automated Entra creation Unavailable, manual setup Advanced',
    platformOptionPresent: false,
    automatedFirst: true,
    automatedUnavailable: true,
    manualAdvanced: true,
  },
  '01b-manual-setup-derived-redirect.json': {
    url: 'http://localhost:3100/msp/settings/integrations?category=providers',
    redirectUri: 'http://localhost:3100/api/auth/microsoft/callback',
    readOnly: true,
    mailboxRedirectInputPresent: false,
    text: 'Redirect URI to add in Entra',
  },
  '02-pending-consent-mailbox.json': {
    pointer: 'Microsoft app setup is managed in Providers.',
    url: 'http://localhost:3100/msp/settings/integrations?category=communication',
    text: 'Waiting for your Microsoft 365 administrator. Setup was started in Providers but has not been approved yet.',
    redirectInputs: 0,
    byoTextPresent: false,
    signInText: 'Sign in with Microsoft',
    signInDisabled: true,
  },
  '03-restored-not-configured-mailbox.json': {
    pointer: 'Microsoft app setup is managed in Providers.',
    url: 'http://localhost:3100/msp/settings/integrations?category=communication',
    text: "Microsoft isn't set up yet. Set it up once in Providers, then come back.",
    redirectInputs: 0,
    byoTextPresent: false,
    signInText: 'Sign in with Microsoft',
    signInDisabled: true,
  },
};

export function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function writeJson(directory, name, value) {
  fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
}

export function fileIdentity(directory, name) {
  const filePath = path.join(directory, name);
  return {
    file: name,
    bytes: fs.statSync(filePath).size,
    sha256: sha256(filePath),
  };
}

export function writePhaseMarker(directory, phase) {
  writeJson(directory, PHASE_MARKERS[phase], {
    workflowRunId: WORKFLOW_RUN_ID,
    phase,
    assertionsPassed: true,
    recordedAt: '2026-08-04T23:00:00.000Z',
    externalGraphLimitation: EXTERNAL_GRAPH_LIMITATION,
    files: PHASE_FILES[phase].map((name) => fileIdentity(directory, name)),
  });
}

/**
 * Build a complete pre-seal evidence directory. Pass overrides to corrupt
 * specific UI captures for negative tests, e.g.
 * `{ uiCaptures: { '02-pending-consent-mailbox.json': { byoTextPresent: true } } }`.
 */
export function setupEvidence({ uiCaptures = {}, omitUiFiles = [] } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'microsoft-smoke-evidence-test-'));
  writeJson(directory, '00-workflow-run.json', {
    workflowRunId: WORKFLOW_RUN_ID,
    evidenceDirectory: directory,
    startedAt: '2026-08-04T22:59:00.000Z',
    appUrl: 'http://localhost:3100',
    tenantId: TENANT_ID,
    profileId: PROFILE_ID,
    externalGraphLimitation: EXTERNAL_GRAPH_LIMITATION,
    crossHostContext: CROSS_HOST_CONTEXT,
  });

  for (const prefix of ['01-before', '90-after']) {
    fs.writeFileSync(
      path.join(directory, `${prefix}-git-status.txt`),
      '$ git status --short\nexit_code=0\nsignal=\n--- stdout ---\n\n--- stderr ---\n'
    );
    writeJson(directory, `${prefix}-secret-inventory.json`, SECRET_INVENTORY_SNAPSHOT);
    writeJson(directory, `${prefix}-runtime-build.json`, RUNTIME_BUILD_SNAPSHOT);
    writeJson(directory, `${prefix}-port-route-health.json`, {
      appUrl: 'http://localhost:3100',
      listeningProcesses: RUNTIME_BUILD_SNAPSHOT.listeningProcesses,
      routes: [{ route: '/', status: 200, location: null, contentType: 'text/html' }],
    });
    writeJson(directory, `${prefix}-database.json`, DATABASE_SNAPSHOT);
  }
  writeJson(directory, '91-restoration-comparison.json', RESTORED);
  writePhaseMarker(directory, 'before');
  writePhaseMarker(directory, 'after');

  for (const [name, capture] of Object.entries(UI_CAPTURES)) {
    if (omitUiFiles.includes(name)) {
      continue;
    }
    writeJson(directory, name, { ...capture, ...(uiCaptures[name] || {}) });
    const pngName = name.replace(/\.json$/, '.png');
    if (!omitUiFiles.includes(pngName)) {
      fs.writeFileSync(path.join(directory, pngName), ONE_PIXEL_PNG);
    }
  }

  fs.writeFileSync(path.join(directory, 'final.png'), ONE_PIXEL_PNG);
  return directory;
}

export function writeCapture(directory, embeddedProvenance, crossHostFidelityNote = FIDELITY_NOTE) {
  fs.writeFileSync(
    path.join(directory, 'final.html'),
    `<html><body>cleanup</body><script id="alga-smoke-capture-provenance" type="application/json">${JSON.stringify(embeddedProvenance)}</script></html>`
  );
  writeJson(directory, 'browser-capture.json', {
    provenance: PROVENANCE,
    artifacts: {
      dom: { file: 'final.html', sha256: sha256(path.join(directory, 'final.html')) },
      screenshot: { file: 'final.png', sha256: sha256(path.join(directory, 'final.png')) },
    },
    renderMethod: 'Live DOM rendered by the card-scoped Mac browser',
    crossHostFidelityNote,
    externalGraphLimitation: EXTERNAL_GRAPH_LIMITATION,
  });
}

export function invoke(directory, command) {
  const args = command === 'correlate'
    ? [
      CAPTURE_SCRIPT,
      command,
      `--evidence-dir=${directory}`,
      `--dom-file=${path.join(directory, 'final.html')}`,
      `--screenshot-file=${path.join(directory, 'final.png')}`,
      `--capture-provenance-file=${path.join(directory, 'browser-capture.json')}`,
    ]
    : [CAPTURE_SCRIPT, command, `--evidence-dir=${directory}`];
  return spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

/**
 * Build, correlate, and seal a bundle in one step for verifier tests.
 * Throws if sealing fails so tests surface the capture script's message.
 */
export function sealedBundle(options = {}) {
  const directory = setupEvidence(options);
  writeCapture(directory, PROVENANCE);
  for (const command of ['correlate', 'manifest']) {
    const result = invoke(directory, command);
    if (result.status !== 0) {
      fs.rmSync(directory, { recursive: true, force: true });
      throw new Error(`${command} failed: ${result.stdout}${result.stderr}`);
    }
  }
  return directory;
}
