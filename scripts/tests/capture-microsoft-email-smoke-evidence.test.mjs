import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/capture-microsoft-email-smoke-evidence.mjs');
const WORKFLOW_RUN_ID = '11111111-1111-4111-8111-111111111111';
const CAPTURE_NONCE = '22222222-2222-4222-8222-222222222222';
const EXTERNAL_GRAPH_LIMITATION = 'No external Microsoft Graph or Entra OAuth call is performed by this evidence helper.';
const CROSS_HOST_CONTEXT = 'The card browser is Mac-hosted while the worktree server runs on Linux through a localhost-to-Tailscale relay.';
const FIDELITY_NOTE = 'React handlers were driven from the card-scoped Mac terminal; the exported live DOM was rendered to the attached PNG.';
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
  ],
};
const PHASE_MARKERS = {
  before: '02-before-assertions-passed.json',
  after: '92-after-assertions-passed.json',
};
const RESTORED = {
  exactMatch: true,
  microsoftProfiles: { exactMatch: true, baseline: [], after: [] },
  microsoftConsumerBindings: { exactMatch: true, baseline: [], after: [] },
  tenantSecrets: { exactMatch: true, baseline: { files: [] }, after: { files: [] } },
};
const PROVENANCE = {
  workflowRunId: WORKFLOW_RUN_ID,
  captureNonce: CAPTURE_NONCE,
  capturedAt: '2026-08-04T23:00:00.000Z',
  browser: {
    userAgent: 'Smoke Browser 1',
    url: 'http://localhost:3100/msp/settings?category=communication',
    platform: 'macOS',
  },
};

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeJson(directory, name, value) {
  fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
}

function fileIdentity(directory, name) {
  const filePath = path.join(directory, name);
  return {
    file: name,
    bytes: fs.statSync(filePath).size,
    sha256: sha256(filePath),
  };
}

function writePhaseMarker(directory, phase) {
  writeJson(directory, PHASE_MARKERS[phase], {
    workflowRunId: WORKFLOW_RUN_ID,
    phase,
    assertionsPassed: true,
    recordedAt: '2026-08-04T23:00:00.000Z',
    externalGraphLimitation: EXTERNAL_GRAPH_LIMITATION,
    files: PHASE_FILES[phase].map((name) => fileIdentity(directory, name)),
  });
}

function setupEvidence() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'microsoft-smoke-evidence-test-'));
  writeJson(directory, '00-workflow-run.json', {
    workflowRunId: WORKFLOW_RUN_ID,
    appUrl: 'http://localhost:3100',
    tenantId: '33333333-3333-4333-8333-333333333333',
    profileId: '44444444-4444-4444-8444-444444444444',
    externalGraphLimitation: EXTERNAL_GRAPH_LIMITATION,
    crossHostContext: CROSS_HOST_CONTEXT,
  });
  for (const name of [...PHASE_FILES.before, ...PHASE_FILES.after]) {
    fs.writeFileSync(path.join(directory, name), 'fixture\n');
  }
  writeJson(directory, '91-restoration-comparison.json', RESTORED);
  writePhaseMarker(directory, 'before');
  writePhaseMarker(directory, 'after');
  fs.writeFileSync(
    path.join(directory, 'final.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
  );
  return directory;
}

function writeCapture(directory, embeddedProvenance, crossHostFidelityNote = FIDELITY_NOTE) {
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

function invoke(directory, command) {
  const args = command === 'correlate'
    ? [
      SCRIPT,
      command,
      `--evidence-dir=${directory}`,
      `--dom-file=${path.join(directory, 'final.html')}`,
      `--screenshot-file=${path.join(directory, 'final.png')}`,
      `--capture-provenance-file=${path.join(directory, 'browser-capture.json')}`,
    ]
    : [SCRIPT, command, `--evidence-dir=${directory}`];
  return spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

function assertFailure(result, message) {
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, message);
}

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

  fs.writeFileSync(path.join(directory, '90-after-database.json'), 'fixture\n');
  writeJson(directory, '91-restoration-comparison.json', { ...RESTORED, exactMatch: false });
  writePhaseMarker(directory, 'after');
  assertFailure(invoke(directory, 'manifest'), /were not restored exactly/);

  writeJson(directory, '91-restoration-comparison.json', RESTORED);
  writePhaseMarker(directory, 'after');
  assert.equal(invoke(directory, 'manifest').status, 0);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, '98-sha256-manifest.json'), 'utf8')
  );
  assert.equal(manifest.assertionsPassed, true);
  assert.equal(manifest.restorationExact, true);
  assert.equal(manifest.sameCaptureProven, true);
  assert.equal(manifest.externalGraphLimitation, EXTERNAL_GRAPH_LIMITATION);
  assert.equal(manifest.crossHostFidelityNote, FIDELITY_NOTE);
});
