import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import {
  CREATED_SESSIONS_FILE,
  INDEX_FILE,
  MANIFEST_FILE,
  REQUIRED_CLAIMS,
  REVIEW_FILE,
  REVIEW_SECTIONS,
  SESSION_CLEANUP_FILE,
  VERIFIER_COPY_FILE,
  verifyBundle,
} from '../verify-microsoft-email-smoke-evidence.mjs';
import {
  CREATED_SESSION_ROWS,
  DATABASE_SNAPSHOT,
  PHASE_MARKERS,
  REPO_ROOT,
  VERIFY_SCRIPT,
  sealedBundle,
  writeJson,
  writePhaseMarker,
} from './helpers/microsoft-smoke-evidence-fixture.mjs';

let sealedSource;

before(() => {
  sealedSource = sealedBundle();
});

after(() => {
  if (sealedSource) {
    fs.rmSync(sealedSource, { recursive: true, force: true });
  }
});

function copyOfSealedBundle(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'microsoft-smoke-verify-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.cpSync(sealedSource, directory, { recursive: true });
  return directory;
}

function runVerifier(directory, extraArguments = [], script = VERIFY_SCRIPT) {
  return spawnSync(
    process.execPath,
    [script, directory, ...extraArguments],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  );
}

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fileIdentity(directory, name) {
  const filePath = path.join(directory, name);
  return {
    file: name,
    bytes: fs.statSync(filePath).size,
    sha256: sha256(filePath),
  };
}

/**
 * Re-seal a deliberately tampered bundle: recompute the manifest file entries
 * and SHA256SUMS so integrity checks pass and only the hardcoded claim logic
 * can catch the tamper.
 */
function resealDishonestly(directory) {
  const names = fs.readdirSync(directory)
    .filter((name) => fs.statSync(path.join(directory, name)).isFile())
    .sort((left, right) => left.localeCompare(right));
  const manifestPath = path.join(directory, MANIFEST_FILE);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files = names
    .filter((name) => name !== MANIFEST_FILE && name !== 'SHA256SUMS')
    .map((name) => fileIdentity(directory, name));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const checksumNames = names.filter((name) => name !== 'SHA256SUMS');
  fs.writeFileSync(
    path.join(directory, 'SHA256SUMS'),
    `${checksumNames.map((name) => `${sha256(path.join(directory, name))}  ${name}`).join('\n')}\n`
  );
}

function rewriteIndex(directory, mutate) {
  const indexPath = path.join(directory, INDEX_FILE);
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  mutate(index);
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
}

function repinIndexEvidence(directory, names) {
  rewriteIndex(directory, (index) => {
    for (const claim of index.claims) {
      claim.evidence = claim.evidence.map((evidence) => (
        !evidence.sealedAfterIndex && names.has(evidence.file)
          ? fileIdentity(directory, evidence.file)
          : evidence
      ));
    }
  });
}

test('a sealed bundle passes both the repo verifier and its bundled copy', (t) => {
  const directory = copyOfSealedBundle(t);

  const repoRun = runVerifier(directory);
  assert.equal(repoRun.status, 0, `${repoRun.stdout}${repoRun.stderr}`);
  for (const claim of REQUIRED_CLAIMS) {
    assert.match(repoRun.stdout, new RegExp(`PASS ${claim.id}`));
  }
  assert.match(repoRun.stdout, /VERIFIED: \d+\/\d+ claims passed/);
  assert.match(repoRun.stdout, /bundleDigest sha256\(SHA256SUMS\)=[0-9a-f]{64}/);

  const bundledRun = runVerifier(directory, [], path.join(directory, VERIFIER_COPY_FILE));
  assert.equal(bundledRun.status, 0, `${bundledRun.stdout}${bundledRun.stderr}`);
});

test('the verification index maps every required claim to sealed evidence', (t) => {
  const directory = copyOfSealedBundle(t);
  const index = JSON.parse(fs.readFileSync(path.join(directory, INDEX_FILE), 'utf8'));

  assert.deepEqual(
    index.claims.map((claim) => claim.id),
    REQUIRED_CLAIMS.map((claim) => claim.id)
  );
  assert.equal(index.verification.verifier.file, VERIFIER_COPY_FILE);
  assert.equal(
    index.verification.verifier.sha256,
    sha256(path.join(directory, VERIFIER_COPY_FILE))
  );
  assert.equal(index.provenance.observedWizardMode, 'self-host');
  assert.ok(index.disclosures.externalGraphLimitation.length > 0);
  assert.ok(index.disclosures.crossHostFidelityNote.length > 0);
  assert.ok(index.disclosures.ctimeNonRestorableReason.length > 0);
  assert.ok(index.disclosures.integrityAnchor.length > 0);
  const cleanupClaim = index.claims.find((claim) => claim.id === 'temporary-session-cleanup');
  assert.deepEqual(
    cleanupClaim.evidence.map((evidence) => evidence.file),
    [
      '00-workflow-run.json',
      '01-before-database.json',
      CREATED_SESSIONS_FILE,
      '90-after-database.json',
      SESSION_CLEANUP_FILE,
      MANIFEST_FILE,
    ]
  );
  for (const claim of index.claims) {
    for (const evidence of claim.evidence) {
      const filePath = path.join(directory, evidence.file);
      assert.ok(fs.existsSync(filePath), `${evidence.file} is missing`);
      if (!evidence.sealedAfterIndex) {
        assert.equal(evidence.sha256, sha256(filePath), `${evidence.file} pin mismatch`);
      }
    }
  }
});

test('the review sections cover every required claim exactly once', () => {
  const sectionIds = REVIEW_SECTIONS.flatMap((section) => section.claimIds);
  assert.equal(new Set(sectionIds).size, sectionIds.length);
  assert.deepEqual(
    [...sectionIds].sort(),
    REQUIRED_CLAIMS.map((claim) => claim.id).sort()
  );
});

test('sealing writes a self-contained review entrypoint covered by the checksums', (t) => {
  const directory = copyOfSealedBundle(t);
  const reviewPath = path.join(directory, REVIEW_FILE);
  assert.ok(fs.existsSync(reviewPath), `${REVIEW_FILE} is missing from the sealed bundle`);

  const review = fs.readFileSync(reviewPath, 'utf8');
  assert.match(review, new RegExp(`node <bundle-dir>/${VERIFIER_COPY_FILE} <bundle-dir>`));
  assert.match(review, /sha256sum -c SHA256SUMS/);
  assert.match(
    review,
    new RegExp(`VERIFIED: ${REQUIRED_CLAIMS.length}/${REQUIRED_CLAIMS.length} claims passed`)
  );
  for (const claim of REQUIRED_CLAIMS) {
    assert.match(review, new RegExp(`\\*\\*${claim.id}\\*\\*`), `${claim.id} missing from claim table`);
  }
  for (const section of REVIEW_SECTIONS) {
    assert.ok(review.includes(`### ${section.title}`), `section "${section.title}" missing`);
  }
  const cleanup = JSON.parse(fs.readFileSync(path.join(directory, SESSION_CLEANUP_FILE), 'utf8'));
  for (const sessionId of cleanup.createdSessionIds) {
    assert.ok(review.includes(sessionId), `temporary session ${sessionId} missing from review`);
  }
  assert.match(review, /Do not\ninvestigate the repository/);

  const checksums = fs.readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8');
  assert.match(checksums, new RegExp(`^[0-9a-f]{64}  ${REVIEW_FILE}$`, 'm'));
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, MANIFEST_FILE), 'utf8'));
  assert.ok(
    manifest.files.some((entry) => entry.file === REVIEW_FILE),
    `${REVIEW_FILE} missing from the sealed manifest`
  );
});

test('an edited review entrypoint fails verification even after a dishonest re-seal', (t) => {
  const directory = copyOfSealedBundle(t);
  const reviewPath = path.join(directory, REVIEW_FILE);
  const review = fs.readFileSync(reviewPath, 'utf8');
  fs.writeFileSync(
    reviewPath,
    review.replace('Do not\ninvestigate the repository', 'Feel free to\ninvestigate the repository')
  );
  resealDishonestly(directory);

  const result = runVerifier(directory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL verification-index/);
  assert.match(result.stdout, /00-REVIEW\.md does not byte-match/);
});

test('a deleted review entrypoint fails verification even after a dishonest re-seal', (t) => {
  const directory = copyOfSealedBundle(t);
  fs.rmSync(path.join(directory, REVIEW_FILE));
  resealDishonestly(directory);

  const result = runVerifier(directory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL verification-index/);
  assert.match(result.stdout, /00-REVIEW\.md/);
});

test('a missing evidence file fails verification', (t) => {
  const directory = copyOfSealedBundle(t);
  fs.rmSync(path.join(directory, '02-pending-consent-mailbox.png'));

  const result = runVerifier(directory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL/);
  assert.match(result.stdout, /02-pending-consent-mailbox\.png/);
});

test('a tampered evidence file fails verification', (t) => {
  const directory = copyOfSealedBundle(t);
  fs.appendFileSync(path.join(directory, '01b-manual-setup-derived-redirect.json'), '\n');

  const result = runVerifier(directory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /01b-manual-setup-derived-redirect\.json/);
});

test('a dishonest re-seal cannot hide a failed claim assertion', (t) => {
  const directory = copyOfSealedBundle(t);
  const captureName = '02-pending-consent-mailbox.json';
  const capture = JSON.parse(fs.readFileSync(path.join(directory, captureName), 'utf8'));
  capture.byoTextPresent = true;
  fs.writeFileSync(path.join(directory, captureName), `${JSON.stringify(capture, null, 2)}\n`);
  rewriteIndex(directory, (index) => {
    for (const claim of index.claims) {
      claim.evidence = claim.evidence.map((evidence) => (
        evidence.file === captureName ? fileIdentity(directory, captureName) : evidence
      ));
    }
  });
  resealDishonestly(directory);

  const result = runVerifier(directory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL pending-admin-consent-mailbox/);
  assert.match(result.stdout, /byoTextPresent/);
});

test('a dishonest re-seal cannot drop a required claim from the index', (t) => {
  const directory = copyOfSealedBundle(t);
  rewriteIndex(directory, (index) => {
    index.claims = index.claims.filter((claim) => claim.id !== 'restoration-secrets');
  });
  resealDishonestly(directory);

  const result = runVerifier(directory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /does not declare exactly the required claims/);
  assert.match(result.stdout, /missing: restoration-secrets/);
});

test('a dishonest re-seal cannot weaken a declared assertion', (t) => {
  const directory = copyOfSealedBundle(t);
  rewriteIndex(directory, (index) => {
    const claim = index.claims.find((entry) => entry.id === 'derived-readonly-redirect-uri');
    claim.assertions = claim.assertions.filter(
      (assertion) => !(assertion.path && assertion.path[0] === 'readOnly')
    );
  });
  resealDishonestly(directory);

  const result = runVerifier(directory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /declares different assertions for claim derived-readonly-redirect-uri/);
});

test('a dishonest re-seal cannot hide one surviving temporary session row', (t) => {
  const directory = copyOfSealedBundle(t);
  writeJson(directory, '90-after-database.json', {
    ...DATABASE_SNAPSHOT,
    sessions: [...DATABASE_SNAPSHOT.sessions, CREATED_SESSION_ROWS[0]],
  });
  writePhaseMarker(directory, 'after');
  repinIndexEvidence(directory, new Set([
    '90-after-database.json',
    PHASE_MARKERS.after,
  ]));
  resealDishonestly(directory);

  const result = runVerifier(directory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL temporary-session-cleanup/);
  assert.match(result.stdout, /remains in the after snapshot/);
});

test('the verifier deadline bounds execution', (t) => {
  const directory = copyOfSealedBundle(t);
  const result = runVerifier(directory, ['--timeout-ms=0']);
  assert.equal(result.status, 2);
  assert.match(`${result.stdout}${result.stderr}`, /deadline/);
});

test('the verifier rejects usage errors with exit code 2', () => {
  const missingDirectory = runVerifier(path.join(os.tmpdir(), 'does-not-exist-microsoft-smoke'));
  assert.equal(missingDirectory.status, 2);

  const noArguments = spawnSync(process.execPath, [VERIFY_SCRIPT], { encoding: 'utf8' });
  assert.equal(noArguments.status, 2);
  assert.match(noArguments.stderr, /Usage/);
});

test('sealing refuses a bundle whose UI captures fail their claims', () => {
  assert.throws(
    () => sealedBundle({
      uiCaptures: { '02-pending-consent-mailbox.json': { byoTextPresent: true } },
    }),
    /UI claim pending-admin-consent-mailbox failed/
  );
  assert.throws(
    () => sealedBundle({ omitUiFiles: ['01-self-hosted-providers-wizard.json'] }),
    /Evidence file is missing: 01-self-hosted-providers-wizard\.json/
  );
});

test('verifyBundle returns structured results for programmatic use', (t) => {
  const directory = copyOfSealedBundle(t);
  const verdict = verifyBundle(directory);
  assert.equal(verdict.passed, true);
  assert.equal(verdict.exitCode, 0);
  assert.equal(verdict.results.length, REQUIRED_CLAIMS.length);
  assert.match(verdict.bundleDigest, /^[0-9a-f]{64}$/);
  const wizard = verdict.results.find((result) => result.id === 'providers-wizard-platform-gating');
  assert.equal(wizard.matchedBranch, 'self-host');
});
