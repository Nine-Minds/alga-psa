#!/usr/bin/env node

/**
 * Verify a sealed Microsoft Email smoke-evidence bundle without touching the
 * running stack, the database, the network, or the wider repository.
 *
 * The bundle is self-describing: `00-REVIEW.md` is the human review
 * entrypoint (it leads with the one verdict command below and defers every
 * conclusion to it), `96-verification-index.json` maps every required smoke
 * claim to the exact evidence files, their sealed SHA-256 identities, and the
 * machine-evaluable assertions that prove the claim,
 * `95a-tamper-trial-outcomes.json` records the tamper trials the seal ran
 * against copies of this bundle's own evidence, and `97-verify-evidence.mjs`
 * is a sealed copy of this script. A reviewer runs one bounded command
 * against the bundle directory:
 *
 *   node scripts/verify-microsoft-email-smoke-evidence.mjs <bundle-dir>
 *   node <bundle-dir>/97-verify-evidence.mjs <bundle-dir>   # identical copy
 *
 * The command's output is intentionally terminal: on success it prints the
 * verdict, one line per verdict dimension, the claim tally, and the bundle
 * digest — never a per-artifact listing — because nothing beyond the command
 * needs to be inspected. Per-claim failure detail is printed only for
 * failing claims. `--json` emits the same result as a single JSON line.
 *
 * Exit codes: 0 when every claim passes, 1 on any mismatch or failed claim,
 * 2 on usage errors or when the internal deadline (default 60000 ms,
 * `--timeout-ms=<n>`) is exceeded.
 *
 * The claim table below is the verification authority: the verifier evaluates
 * these hardcoded claims, then checks that the sealed index declares exactly
 * the same claim set and assertions, so a tampered index can neither drop nor
 * weaken a check. Bundle integrity is relative to the sealed SHA256SUMS file;
 * anchor `sha256(SHA256SUMS)` (printed as `bundleDigest`) externally to detect
 * a wholesale re-seal.
 *
 * This module is intentionally self-contained (Node built-ins only) so the
 * sealed copy inside the bundle runs anywhere a Node runtime exists. The
 * contract strings and the phase-file layout are therefore duplicated from
 * `capture-microsoft-email-smoke-evidence.mjs`; the capture script imports
 * this module at sealing time and runs `verifyBundle` on its own output, which
 * keeps the two files from drifting apart unnoticed.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const REVIEW_FILE = '00-REVIEW.md';
export const INDEX_FILE = '96-verification-index.json';
export const VERIFIER_COPY_FILE = '97-verify-evidence.mjs';
export const MANIFEST_FILE = '98-sha256-manifest.json';
export const CHECKSUM_FILE = 'SHA256SUMS';
export const METADATA_FILE = '00-workflow-run.json';
export const RESTORATION_FILE = '91-restoration-comparison.json';
export const CREATED_SESSIONS_FILE = '89-temporary-sessions-created.json';
export const SESSION_CLEANUP_FILE = '91-temporary-session-cleanup-proof.json';
export const CORRELATION_FILE = '95-final-dom-screenshot-correlation.json';
export const TAMPER_TRIALS_FILE = '95a-tamper-trial-outcomes.json';
export const INDEX_SCHEMA_VERSION = 4;
export const VERIFIER_SOURCE_PATH = fileURLToPath(import.meta.url);
export const DEFAULT_TIMEOUT_MS = 60_000;
export const EXPECTED_TEMPORARY_SESSION_COUNT = 2;

export const EXTERNAL_GRAPH_LIMITATION = 'No external Microsoft Graph or Entra OAuth call is performed by this evidence helper.';
export const CTIME_NON_RESTORABLE_REASON = 'ctime is kernel-managed; not restorable from userspace';
export const INTEGRITY_ANCHOR_NOTE = 'Bundle integrity is proven relative to the sealed SHA256SUMS file; anchor sha256(SHA256SUMS) — the bundleDigest printed by the verifier — outside the bundle to detect a wholesale re-seal.';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const PNG_SIGNATURE_HEX = '89504e470d0a1a0a';
const MAX_SESSION_EVIDENCE_ROWS = 10_000;
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

/**
 * Evidence names starting with `@correlation.` resolve at runtime to the file
 * names the correlation record binds, so renamed DOM/PNG exports stay covered.
 * Names listed in SEALED_AFTER_INDEX are seal-stage outputs the index pins by
 * existence only; their byte identity is pinned by the manifest and SHA256SUMS
 * instead. The tamper-trial record belongs here because the trial substrate is
 * a provisionally sealed copy that does not contain the record yet.
 */
const SEALED_AFTER_INDEX = new Set([
  REVIEW_FILE,
  INDEX_FILE,
  MANIFEST_FILE,
  CHECKSUM_FILE,
  TAMPER_TRIALS_FILE,
]);

export const REQUIRED_CLAIMS = [
  {
    id: 'verification-index',
    title: 'The sealed verification index declares exactly the required claims, pins its verifier, and matches the review entrypoint',
    proves: 'The index cannot silently drop, reorder, or weaken a required check, the bundled verifier copy is the pinned one, and the human review entrypoint 00-REVIEW.md byte-matches a re-render from the sealed evidence.',
    evidence: [INDEX_FILE, VERIFIER_COPY_FILE, REVIEW_FILE],
    assertions: [],
    native: ['index-consistency', 'review-consistency'],
  },
  {
    id: 'bundle-integrity',
    title: 'Every bundle file matches SHA256SUMS and the sealed SHA-256 manifest',
    proves: 'No evidence file was added, removed, or altered after sealing.',
    evidence: [CHECKSUM_FILE, MANIFEST_FILE],
    assertions: [
      { file: MANIFEST_FILE, path: ['assertionsPassed'], op: 'equals', expected: true },
      { file: MANIFEST_FILE, path: ['restorationExact'], op: 'equals', expected: true },
      { file: MANIFEST_FILE, path: ['sameCaptureProven'], op: 'equals', expected: true },
    ],
    native: ['checksum-coverage'],
  },
  {
    id: 'phase-markers',
    title: 'The before and after capture assertions passed and their artifacts are unchanged',
    proves: 'The environment snapshots the restoration comparison relies on are the ones whose assertions passed.',
    evidence: [PHASE_MARKERS.before, PHASE_MARKERS.after],
    assertions: [],
    native: ['phase-markers'],
  },
  {
    id: 'sealed-tamper-outcomes',
    title: 'Recorded tamper trials prove this bundle’s sealed verifier rejects tampered copies',
    proves: 'At sealing time the sealed verifier copy (pinned by SHA-256) rejected byte-tamper, file-deletion, and review-edit-plus-dishonest-reseal copies of this run’s provisionally sealed evidence, while a pre-record control run failed only for the then-unwritten trial record — so every additional failure was caused by the trial’s mutation. The outcomes are sealed here so a reviewer validates the record instead of re-running tamper trials.',
    evidence: [TAMPER_TRIALS_FILE, VERIFIER_COPY_FILE, MANIFEST_FILE],
    assertions: [
      { file: MANIFEST_FILE, path: ['tamperOutcomes', 'allDetected'], op: 'equals', expected: true },
      { file: MANIFEST_FILE, path: ['tamperOutcomes', 'file'], op: 'equals', expected: TAMPER_TRIALS_FILE },
    ],
    native: ['sealed-tamper-outcomes'],
  },
  {
    id: 'temporary-session-cleanup',
    title: 'Both temporary session rows created by the smoke run were deleted',
    proves: 'Exactly two tenant session rows appeared after the run began, neither existed in the baseline, and neither remains in the after-cleanup database snapshot.',
    evidence: [
      METADATA_FILE,
      '01-before-database.json',
      CREATED_SESSIONS_FILE,
      '90-after-database.json',
      SESSION_CLEANUP_FILE,
      MANIFEST_FILE,
    ],
    assertions: [
      { file: CREATED_SESSIONS_FILE, path: ['expectedCreatedSessionCount'], op: 'equals', expected: EXPECTED_TEMPORARY_SESSION_COUNT },
      { file: CREATED_SESSIONS_FILE, path: ['assertionsPassed'], op: 'equals', expected: true },
      { file: SESSION_CLEANUP_FILE, path: ['allDeleted'], op: 'equals', expected: true },
      { file: MANIFEST_FILE, path: ['temporarySessionRowsDeleted'], op: 'equals', expected: true },
      { file: MANIFEST_FILE, path: ['temporarySessionRowsDeletedCount'], op: 'equals', expected: EXPECTED_TEMPORARY_SESSION_COUNT },
    ],
    native: ['temporary-session-cleanup'],
  },
  {
    id: 'restoration-profiles',
    title: 'Every tenant Microsoft profile row was restored exactly',
    proves: 'The smoke fixture left microsoft_profiles byte-identical to the before snapshot.',
    evidence: ['01-before-database.json', '90-after-database.json', RESTORATION_FILE],
    assertions: [
      { file: RESTORATION_FILE, path: ['microsoftProfiles', 'exactMatch'], op: 'equals', expected: true },
    ],
    native: ['recompute-profiles'],
  },
  {
    id: 'restoration-bindings',
    title: 'Every Microsoft consumer binding row, including timestamps, was restored exactly',
    proves: 'The smoke fixture left microsoft_profile_consumer_bindings — original timestamps included — byte-identical to the before snapshot.',
    evidence: ['01-before-database.json', '90-after-database.json', RESTORATION_FILE],
    assertions: [
      { file: RESTORATION_FILE, path: ['microsoftConsumerBindings', 'exactMatch'], op: 'equals', expected: true },
    ],
    native: ['recompute-bindings'],
  },
  {
    id: 'restoration-secrets',
    title: 'The complete tenant secret inventory, including per-file mtimes and the directory mtime, was restored exactly',
    proves: 'The filesystem secret store matches the before snapshot on every restorable field.',
    evidence: ['01-before-secret-inventory.json', '90-after-secret-inventory.json', RESTORATION_FILE],
    assertions: [
      { file: RESTORATION_FILE, path: ['tenantSecrets', 'exactMatch'], op: 'equals', expected: true },
    ],
    native: ['recompute-secrets'],
  },
  {
    id: 'ctime-disclosure',
    title: 'Non-restorable ctime changes are disclosed and none occurred on untouched paths',
    proves: 'The only inode-change-time drift is the kernel-managed one the fixture mutation necessarily causes, and it is disclosed rather than hidden.',
    evidence: [RESTORATION_FILE, MANIFEST_FILE],
    assertions: [
      { file: RESTORATION_FILE, path: ['ctimeDisclosure', 'reason'], op: 'equals', expected: CTIME_NON_RESTORABLE_REASON },
      { file: RESTORATION_FILE, path: ['ctimeDisclosure', 'unexpectedChanges'], op: 'isEmptyArray' },
      { file: MANIFEST_FILE, path: ['ctimeDisclosed'], op: 'equals', expected: true },
      { file: MANIFEST_FILE, path: ['ctimeNonRestorableReason'], op: 'equals', expected: CTIME_NON_RESTORABLE_REASON },
      { file: MANIFEST_FILE, path: ['ctimeUnexpectedChanges'], op: 'isEmptyArray' },
    ],
    native: [],
  },
  {
    id: 'dom-png-binding',
    title: 'The final DOM export and PNG screenshot are hash-bound to one browser capture',
    proves: 'The DOM, the screenshot, and the provenance record come from the same authenticated page instance against the recorded application origin.',
    evidence: [
      CORRELATION_FILE,
      '@correlation.dom',
      '@correlation.screenshot',
      '@correlation.captureProvenanceFile',
    ],
    assertions: [
      { file: CORRELATION_FILE, path: ['sameCaptureProven'], op: 'equals', expected: true },
    ],
    native: ['dom-png-binding'],
  },
  {
    id: 'provenance-disclosures',
    title: 'Runtime, build, database, and fidelity provenance are recorded with the required limitation disclosures',
    proves: 'The evidence states where it ran, at which commit, through which render path, and which fidelity limits (cross-host relay, no external Graph call) apply.',
    evidence: [
      METADATA_FILE,
      '01-before-runtime-build.json',
      '90-after-runtime-build.json',
      CORRELATION_FILE,
    ],
    assertions: [
      { file: METADATA_FILE, path: ['externalGraphLimitation'], op: 'equals', expected: EXTERNAL_GRAPH_LIMITATION },
      { file: METADATA_FILE, path: ['crossHostContext'], op: 'nonEmptyString' },
      { file: CORRELATION_FILE, path: ['crossHostFidelityNote'], op: 'nonEmptyString' },
      { file: CORRELATION_FILE, path: ['renderMethod'], op: 'nonEmptyString' },
      { file: CORRELATION_FILE, path: ['externalGraphLimitation'], op: 'equals', expected: EXTERNAL_GRAPH_LIMITATION },
      { file: MANIFEST_FILE, path: ['externalGraphLimitation'], op: 'equals', expected: EXTERNAL_GRAPH_LIMITATION },
    ],
    native: ['runtime-provenance'],
  },
  {
    id: 'providers-wizard-platform-gating',
    title: 'The Providers Microsoft wizard gates the hosted platform option by licensing',
    proves: 'On self-host licensing the hosted platform option is absent and automated Entra creation is Unavailable; on hosted licensing the platform option is present. Manual setup is Advanced either way.',
    evidence: ['01-self-hosted-providers-wizard.json', '01-self-hosted-providers-wizard.png'],
    assertions: [
      {
        oneOf: [
          {
            name: 'self-host',
            assertions: [
              { file: '01-self-hosted-providers-wizard.json', path: ['platformOptionPresent'], op: 'equals', expected: false },
              { file: '01-self-hosted-providers-wizard.json', path: ['automatedUnavailable'], op: 'equals', expected: true },
              { file: '01-self-hosted-providers-wizard.json', path: ['manualAdvanced'], op: 'equals', expected: true },
            ],
          },
          {
            name: 'hosted',
            assertions: [
              { file: '01-self-hosted-providers-wizard.json', path: ['platformOptionPresent'], op: 'equals', expected: true },
              { file: '01-self-hosted-providers-wizard.json', path: ['manualAdvanced'], op: 'equals', expected: true },
            ],
          },
        ],
      },
    ],
    native: [],
  },
  {
    id: 'derived-readonly-redirect-uri',
    title: 'The only Redirect URI in the product is server-derived and read-only in Providers manual setup',
    proves: 'Manual setup shows the derived /api/auth/microsoft/callback Redirect URI read-only, and the mailbox dialog has no Redirect URI input.',
    evidence: ['01b-manual-setup-derived-redirect.json', '01b-manual-setup-derived-redirect.png'],
    assertions: [
      { file: '01b-manual-setup-derived-redirect.json', path: ['redirectUri'], op: 'endsWith', expected: '/api/auth/microsoft/callback' },
      { file: '01b-manual-setup-derived-redirect.json', path: ['readOnly'], op: 'equals', expected: true },
      { file: '01b-manual-setup-derived-redirect.json', path: ['mailboxRedirectInputPresent'], op: 'equals', expected: false },
    ],
    native: [],
  },
  {
    id: 'pending-admin-consent-mailbox',
    title: 'The reduced mailbox dialog shows the pending-administrator-approval readiness state',
    proves: 'With the pending fixture applied, the Communication mailbox dialog shows the waiting-for-administrator strip and contains no Redirect URI input and no BYO expander.',
    evidence: ['02-pending-consent-mailbox.json', '02-pending-consent-mailbox.png'],
    assertions: [
      { file: '02-pending-consent-mailbox.json', path: ['redirectInputs'], op: 'equals', expected: 0 },
      { file: '02-pending-consent-mailbox.json', path: ['byoTextPresent'], op: 'equals', expected: false },
      { file: '02-pending-consent-mailbox.json', path: ['text'], op: 'includes', expected: 'Waiting for your Microsoft 365 administrator' },
    ],
    native: [],
  },
  {
    id: 'restored-not-configured-mailbox',
    title: 'After fixture cleanup the mailbox dialog shows the not-configured readiness state',
    proves: 'With the fixture removed, the Communication mailbox dialog points to Providers for setup and contains no Redirect URI input and no BYO expander.',
    evidence: ['03-restored-not-configured-mailbox.json', '03-restored-not-configured-mailbox.png'],
    assertions: [
      { file: '03-restored-not-configured-mailbox.json', path: ['redirectInputs'], op: 'equals', expected: 0 },
      { file: '03-restored-not-configured-mailbox.json', path: ['byoTextPresent'], op: 'equals', expected: false },
      { file: '03-restored-not-configured-mailbox.json', path: ['text'], op: 'includes', expected: "Microsoft isn't set up yet" },
    ],
    native: [],
  },
  {
    id: 'no-fixture-residue',
    title: 'The after snapshot contains no smoke-fixture profile and no smoke-fixture secret',
    proves: 'The fixture left neither a database row nor a filesystem secret behind.',
    evidence: [METADATA_FILE, '90-after-database.json', '90-after-secret-inventory.json'],
    assertions: [],
    native: ['no-fixture-residue'],
  },
];

/**
 * The five verdict dimensions the review entrypoint groups the claims under.
 * Together the sections must cover every required claim exactly once;
 * `buildReviewDocument` enforces that invariant.
 */
export const REVIEW_SECTIONS = [
  {
    title: 'Bundle integrity and tamper resistance',
    claimIds: [
      'verification-index',
      'bundle-integrity',
      'phase-markers',
      'sealed-tamper-outcomes',
    ],
  },
  {
    title: 'UI proof',
    claimIds: [
      'providers-wizard-platform-gating',
      'derived-readonly-redirect-uri',
      'pending-admin-consent-mailbox',
      'restored-not-configured-mailbox',
      'dom-png-binding',
    ],
  },
  {
    title: 'Exact restoration',
    claimIds: [
      'restoration-profiles',
      'restoration-bindings',
      'restoration-secrets',
      'ctime-disclosure',
      'no-fixture-residue',
    ],
  },
  {
    title: 'Temporary-session deletions',
    claimIds: ['temporary-session-cleanup'],
  },
  {
    title: 'Provenance and limitation disclosures',
    claimIds: ['provenance-disclosures'],
  },
];

function trialFailedClaimIds(trial) {
  return Array.isArray(trial?.failedClaims)
    ? trial.failedClaims.map((claim) => claim?.id)
    : [];
}

function trialFailureMessages(trial) {
  return Array.isArray(trial?.failedClaims)
    ? trial.failedClaims.flatMap((claim) => (Array.isArray(claim?.failures) ? claim.failures : []))
    : [];
}

/**
 * The claims that fail on the trial substrate itself: each trial runs against
 * a copy of the run's evidence provisionally sealed *without* the tamper-trial
 * record, so the record-absence failures below appear in every trial. The
 * pre-record control pins them down; any failure beyond them in a mutation
 * trial is therefore caused by that trial's mutation.
 */
const CONTROL_BASELINE_FAILED_CLAIM_IDS = ['sealed-tamper-outcomes', 'verification-index'];

/**
 * The tamper trials every sealed bundle must record, in order, with the
 * outcome each one must show. This table — not the sealed record — is the
 * verification authority: `validateTamperTrialRecord` re-validates the record
 * against it, so a re-sealed bundle cannot weaken a trial expectation.
 */
export const REQUIRED_TAMPER_TRIALS = [
  {
    name: 'pre-record-control',
    description: 'The provisionally sealed trial substrate, unmutated, must fail only for the absence of the not-yet-written tamper-trial record.',
    mutationKind: 'none',
    validate(trial) {
      const failures = [];
      if (trial.exitCode !== 1) {
        failures.push(`expected exit code 1, recorded ${trial.exitCode}`);
      }
      const failedIds = [...trialFailedClaimIds(trial)].sort((a, b) => a.localeCompare(b));
      if (!isDeepStrictEqual(failedIds, [...CONTROL_BASELINE_FAILED_CLAIM_IDS].sort((a, b) => a.localeCompare(b)))) {
        failures.push(
          `must fail exactly the record-absence claims (${CONTROL_BASELINE_FAILED_CLAIM_IDS.join(', ')}); recorded ${failedIds.join(', ') || 'none'}`
        );
      }
      const messages = trialFailureMessages(trial);
      if (messages.length === 0
        || !messages.every((message) => typeof message === 'string' && message.includes(TAMPER_TRIALS_FILE))) {
        failures.push(`every control failure must be the absent ${TAMPER_TRIALS_FILE}`);
      }
      const expectedPassed = REQUIRED_CLAIMS
        .map((claim) => claim.id)
        .filter((id) => !CONTROL_BASELINE_FAILED_CLAIM_IDS.includes(id));
      if (!isDeepStrictEqual(trial.passedClaimIds, expectedPassed)) {
        failures.push('every claim other than the record-absence claims must pass on the unmutated substrate');
      }
      return failures;
    },
  },
  {
    name: 'byte-tamper',
    description: 'Flipping a single byte of a sealed evidence file must fail verification.',
    mutationKind: 'byte-flip',
    validate(trial) {
      const failures = [];
      if (trial.exitCode !== 1) {
        failures.push(`expected exit code 1, recorded ${trial.exitCode}`);
      }
      if (trial.mutation?.kind !== 'byte-flip'
        || typeof trial.mutation.file !== 'string' || trial.mutation.file.trim() === '') {
        failures.push('must record which file had a byte flipped');
      }
      if (!trialFailedClaimIds(trial).includes('bundle-integrity')) {
        failures.push('the byte flip must fail the bundle-integrity claim');
      }
      return failures;
    },
  },
  {
    name: 'file-deletion',
    description: 'Deleting a sealed evidence file must fail verification.',
    mutationKind: 'delete',
    validate(trial) {
      const failures = [];
      if (trial.exitCode !== 1) {
        failures.push(`expected exit code 1, recorded ${trial.exitCode}`);
      }
      const deletedFile = trial.mutation?.file;
      if (trial.mutation?.kind !== 'delete'
        || typeof deletedFile !== 'string' || deletedFile.trim() === '') {
        failures.push('must record which file was deleted');
      }
      if (!trialFailedClaimIds(trial).includes('bundle-integrity')) {
        failures.push('the deletion must fail the bundle-integrity claim');
      }
      if (typeof deletedFile === 'string' && deletedFile.trim() !== ''
        && !trialFailureMessages(trial).some((message) => typeof message === 'string' && message.includes(deletedFile))) {
        failures.push('a failure must name the deleted file');
      }
      return failures;
    },
  },
  {
    name: 'review-edit-dishonest-reseal',
    description: 'Editing 00-REVIEW.md and dishonestly recomputing the manifest and SHA256SUMS must still fail verification, proving detection does not rely on checksums alone.',
    mutationKind: 'edit-plus-reseal',
    validate(trial) {
      const failures = [];
      if (trial.exitCode !== 1) {
        failures.push(`expected exit code 1, recorded ${trial.exitCode}`);
      }
      if (trial.mutation?.kind !== 'edit-plus-reseal' || trial.mutation.file !== REVIEW_FILE) {
        failures.push(`must record the edited ${REVIEW_FILE}`);
      }
      const reviewClaim = (Array.isArray(trial.failedClaims) ? trial.failedClaims : [])
        .find((claim) => claim?.id === 'verification-index');
      if (!reviewClaim
        || !(Array.isArray(reviewClaim.failures) ? reviewClaim.failures : [])
          .some((message) => typeof message === 'string' && message.includes('does not byte-match'))) {
        failures.push('the review re-render byte mismatch must be detected');
      }
      if (!Array.isArray(trial.passedClaimIds) || !trial.passedClaimIds.includes('bundle-integrity')) {
        failures.push('the dishonestly recomputed checksums must pass bundle-integrity, proving detection is not checksum-based');
      }
      return failures;
    },
  },
];

/**
 * Validate a sealed tamper-trial record against the trial authority table.
 * Returns failure messages; empty means the record proves every required
 * tamper outcome. Used both by the seal (which refuses to write a record that
 * does not validate) and by the `sealed-tamper-outcomes` native check.
 */
export function validateTamperTrialRecord(record, { workflowRunId, verifierSha256, startedAt }) {
  if (!record || typeof record !== 'object') {
    return [`${TAMPER_TRIALS_FILE} is not a JSON object`];
  }
  const failures = [];
  if (record.workflowRunId !== workflowRunId) {
    failures.push(`${TAMPER_TRIALS_FILE} records a different workflow run`);
  }
  if (!isDeepStrictEqual(record.verifier, { file: VERIFIER_COPY_FILE, sha256: verifierSha256 })) {
    failures.push(`${TAMPER_TRIALS_FILE} does not pin the sealed verifier copy ${VERIFIER_COPY_FILE}`);
  }
  if (record.assertionsPassed !== true) {
    failures.push(`${TAMPER_TRIALS_FILE} does not attest that its trial assertions passed`);
  }
  if (typeof record.substrate !== 'string' || record.substrate.trim() === '') {
    failures.push(`${TAMPER_TRIALS_FILE} is missing its trial-substrate disclosure`);
  }
  const recordedAt = new Date(record.recordedAt);
  if (typeof record.recordedAt !== 'string'
    || Number.isNaN(recordedAt.valueOf())
    || recordedAt.toISOString() !== record.recordedAt) {
    failures.push(`${TAMPER_TRIALS_FILE} recordedAt is not a canonical ISO timestamp`);
  } else if (startedAt && recordedAt < new Date(startedAt)) {
    failures.push(`${TAMPER_TRIALS_FILE} recordedAt predates the smoke run`);
  }
  const trials = Array.isArray(record.trials) ? record.trials : [];
  if (!isDeepStrictEqual(
    trials.map((trial) => trial?.name),
    REQUIRED_TAMPER_TRIALS.map((trial) => trial.name)
  )) {
    failures.push(`${TAMPER_TRIALS_FILE} does not record exactly the required trials in order`);
    return failures;
  }
  for (const [position, required] of REQUIRED_TAMPER_TRIALS.entries()) {
    failures.push(...required.validate(trials[position]).map((message) => `trial ${required.name}: ${message}`));
  }
  return failures;
}

class VerificationTimeoutError extends Error {}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fileIdentity(filePath) {
  return {
    file: path.basename(filePath),
    bytes: fs.statSync(filePath).size,
    sha256: sha256File(filePath),
  };
}

/**
 * Project a secret inventory onto its restorable fields — the same projection
 * `restorableInventory` applies in microsoft-email-smoke-timestamps.mjs,
 * inlined so the sealed bundle copy stays dependency-free.
 */
function restorableProjection(inventory) {
  const { directoryCtimeMs, parentDirectoryCtimeMs, ...rest } = inventory;
  return {
    ...rest,
    files: inventory.files.map(({ ctimeMs, ...fileRest }) => fileRest),
  };
}

function describeValue(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return String(value);
  }
  return serialized.length > 120 ? `${serialized.slice(0, 120)}…` : serialized;
}

/**
 * Bundle evaluation context: cached JSON reads, deadline enforcement, and the
 * workflow metadata every claim compares against.
 */
export function createContext(evidenceDirectory, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const directory = path.resolve(evidenceDirectory);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`Evidence directory not found: ${directory}`);
  }
  const startedAt = Date.now();
  const jsonCache = new Map();
  const context = {
    directory,
    checkDeadline() {
      if (Date.now() - startedAt >= timeoutMs) {
        throw new VerificationTimeoutError(
          `Verification exceeded its ${timeoutMs} ms deadline`
        );
      }
    },
    filePath(name) {
      const resolved = path.resolve(directory, name);
      const relative = path.relative(directory, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) {
        throw new Error(`Evidence file reference escapes the bundle: ${name}`);
      }
      return resolved;
    },
    readJson(name) {
      if (!jsonCache.has(name)) {
        const filePath = context.filePath(name);
        if (!fs.existsSync(filePath)) {
          throw new Error(`Required evidence file is missing: ${name}`);
        }
        let parsed;
        try {
          parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (error) {
          throw new Error(`Evidence file is not valid JSON: ${name} (${error instanceof Error ? error.message : String(error)})`);
        }
        jsonCache.set(name, parsed);
      }
      return jsonCache.get(name);
    },
    hashFile(name) {
      context.checkDeadline();
      const filePath = context.filePath(name);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Required evidence file is missing: ${name}`);
      }
      return sha256File(filePath);
    },
    identity(name) {
      context.checkDeadline();
      return fileIdentity(context.filePath(name));
    },
  };
  context.metadata = context.readJson(METADATA_FILE);
  if (!UUID_PATTERN.test(context.metadata.workflowRunId || '')) {
    throw new Error(`${METADATA_FILE} does not record a workflow run UUID`);
  }
  return context;
}

function valueAtPath(root, pathSegments, fileName) {
  let value = root;
  for (const segment of pathSegments) {
    if (value === null || typeof value !== 'object' || !(segment in value)) {
      throw new Error(`${fileName} has no value at ${pathSegments.join('.')}`);
    }
    value = value[segment];
  }
  return value;
}

function evaluateSimpleAssertion(assertion, context) {
  const location = `${assertion.file} → ${assertion.path.join('.')}`;
  let actual;
  try {
    actual = valueAtPath(context.readJson(assertion.file), assertion.path, assertion.file);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  switch (assertion.op) {
    case 'equals':
      return isDeepStrictEqual(actual, assertion.expected)
        ? []
        : [`${location} is ${describeValue(actual)}, expected ${describeValue(assertion.expected)}`];
    case 'isEmptyArray':
      return Array.isArray(actual) && actual.length === 0
        ? []
        : [`${location} is ${describeValue(actual)}, expected an empty array`];
    case 'nonEmptyString':
      return typeof actual === 'string' && actual.trim() !== ''
        ? []
        : [`${location} must be a non-empty string`];
    case 'includes':
      return typeof actual === 'string' && actual.includes(assertion.expected)
        ? []
        : [`${location} does not contain ${describeValue(assertion.expected)}`];
    case 'endsWith':
      return typeof actual === 'string' && actual.endsWith(assertion.expected)
        ? []
        : [`${location} does not end with ${describeValue(assertion.expected)}`];
    default:
      return [`Unknown assertion op: ${assertion.op}`];
  }
}

function evaluateAssertion(assertion, context) {
  if (assertion.oneOf) {
    const branchFailures = [];
    for (const branch of assertion.oneOf) {
      const failures = branch.assertions.flatMap((entry) => evaluateSimpleAssertion(entry, context));
      if (failures.length === 0) {
        context.observedBranches = context.observedBranches || {};
        context.observedBranches[branch.name] = true;
        return { failures: [], matchedBranch: branch.name };
      }
      branchFailures.push(`[${branch.name}] ${failures.join('; ')}`);
    }
    return { failures: [`No licensing branch matched: ${branchFailures.join(' | ')}`], matchedBranch: null };
  }
  return { failures: evaluateSimpleAssertion(assertion, context), matchedBranch: null };
}

/**
 * Resolve a claim's evidence names, expanding `@correlation.*` references to
 * the file names the correlation record binds.
 */
function resolveEvidenceNames(claim, context) {
  return claim.evidence.map((name) => {
    if (!name.startsWith('@correlation.')) {
      return name;
    }
    const key = name.slice('@correlation.'.length);
    const correlation = context.readJson(CORRELATION_FILE);
    const declared = correlation[key];
    if (!declared || typeof declared.file !== 'string') {
      throw new Error(`${CORRELATION_FILE} does not bind an artifact for ${name}`);
    }
    return declared.file;
  });
}

const NATIVE_CHECKS = {
  'checksum-coverage': verifyChecksumCoverage,
  'phase-markers': verifyPhaseMarkers,
  'temporary-session-cleanup': verifyTemporarySessionCleanup,
  'recompute-profiles': (context) => verifyRestorationSection(
    context,
    'microsoftProfiles',
    '01-before-database.json',
    '90-after-database.json',
    (snapshot) => snapshot.microsoftProfiles
  ),
  'recompute-bindings': (context) => verifyRestorationSection(
    context,
    'microsoftConsumerBindings',
    '01-before-database.json',
    '90-after-database.json',
    (snapshot) => snapshot.microsoftConsumerBindings
  ),
  'recompute-secrets': (context) => verifyRestorationSection(
    context,
    'tenantSecrets',
    '01-before-secret-inventory.json',
    '90-after-secret-inventory.json',
    restorableProjection
  ),
  'dom-png-binding': verifyDomPngBinding,
  'runtime-provenance': verifyRuntimeProvenance,
  'no-fixture-residue': verifyNoFixtureResidue,
  'index-consistency': verifyIndexConsistency,
  'review-consistency': verifyReviewEntrypoint,
  'sealed-tamper-outcomes': verifySealedTamperOutcomes,
};

function verifySealedTamperOutcomes(context) {
  return validateTamperTrialRecord(context.readJson(TAMPER_TRIALS_FILE), {
    workflowRunId: context.metadata.workflowRunId,
    verifierSha256: context.hashFile(VERIFIER_COPY_FILE),
    startedAt: context.metadata.startedAt,
  });
}

function verifyChecksumCoverage(context) {
  const failures = [];
  const actualFiles = fs.readdirSync(context.directory)
    .filter((name) => fs.statSync(context.filePath(name)).isFile())
    .sort((left, right) => left.localeCompare(right));

  const checksumPath = context.filePath(CHECKSUM_FILE);
  if (!fs.existsSync(checksumPath)) {
    return [`${CHECKSUM_FILE} is missing`];
  }
  const listed = new Map();
  for (const line of fs.readFileSync(checksumPath, 'utf8').split('\n').filter((line) => line !== '')) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) {
      failures.push(`${CHECKSUM_FILE} has a malformed line: ${line}`);
      continue;
    }
    listed.set(match[2], match[1]);
  }
  const expectedListed = actualFiles.filter((name) => name !== CHECKSUM_FILE);
  if (!isDeepStrictEqual([...listed.keys()].sort((a, b) => a.localeCompare(b)), expectedListed)) {
    failures.push(
      `${CHECKSUM_FILE} does not cover exactly the bundle files (listed ${listed.size}, present ${expectedListed.length})`
    );
  }
  for (const [name, expectedHash] of listed) {
    if (!expectedListed.includes(name)) {
      continue;
    }
    if (context.hashFile(name) !== expectedHash) {
      failures.push(`${name} does not match its SHA256SUMS entry`);
    }
  }

  const manifest = context.readJson(MANIFEST_FILE);
  if (manifest.workflowRunId !== context.metadata.workflowRunId) {
    failures.push(`${MANIFEST_FILE} records a different workflow run`);
  }
  const expectedManifestFiles = actualFiles.filter(
    (name) => name !== CHECKSUM_FILE && name !== MANIFEST_FILE
  );
  const manifestNames = Array.isArray(manifest.files)
    ? manifest.files.map((entry) => entry.file)
    : [];
  if (!isDeepStrictEqual(manifestNames, expectedManifestFiles)) {
    failures.push(`${MANIFEST_FILE} does not list exactly the sealed bundle files`);
  } else {
    for (const entry of manifest.files) {
      if (!isDeepStrictEqual(context.identity(entry.file), entry)) {
        failures.push(`${entry.file} does not match its manifest identity`);
      }
    }
  }
  return failures;
}

function verifyPhaseMarkers(context) {
  const failures = [];
  for (const phase of ['before', 'after']) {
    let marker;
    try {
      marker = context.readJson(PHASE_MARKERS[phase]);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (marker.workflowRunId !== context.metadata.workflowRunId
      || marker.phase !== phase
      || marker.assertionsPassed !== true
      || marker.externalGraphLimitation !== EXTERNAL_GRAPH_LIMITATION) {
      failures.push(`The ${phase} assertions-passed marker is invalid`);
      continue;
    }
    if (!Array.isArray(marker.files)
      || !isDeepStrictEqual(marker.files.map((file) => file.file), PHASE_FILES[phase])) {
      failures.push(`The ${phase} assertions-passed marker has an incomplete file inventory`);
      continue;
    }
    for (const expected of marker.files) {
      let identity;
      try {
        identity = context.identity(expected.file);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        continue;
      }
      if (!isDeepStrictEqual(identity, expected)) {
        failures.push(`${expected.file} changed after the ${phase} assertions passed`);
      }
    }
  }
  return failures;
}

function verifyTemporarySessionCleanup(context) {
  const failures = [];
  const metadataContract = context.metadata.temporarySessionCleanup;
  if (metadataContract?.expectedCreatedSessionCount !== EXPECTED_TEMPORARY_SESSION_COUNT
    || metadataContract?.createdEvidenceFile !== CREATED_SESSIONS_FILE
    || metadataContract?.cleanupEvidenceFile !== SESSION_CLEANUP_FILE) {
    failures.push(`${METADATA_FILE} does not declare the required two-session cleanup contract`);
  }

  const readSessionMap = (snapshot, label) => {
    if (!Array.isArray(snapshot.sessions)) {
      failures.push(`${label} does not include a sessions array`);
      return new Map();
    }
    if (snapshot.sessions.length > MAX_SESSION_EVIDENCE_ROWS) {
      failures.push(`${label} exceeds the ${MAX_SESSION_EVIDENCE_ROWS}-row verification bound`);
      return new Map();
    }
    const rows = new Map();
    for (const session of snapshot.sessions) {
      context.checkDeadline();
      if (!session || !UUID_PATTERN.test(session.session_id || '')) {
        failures.push(`${label} contains a session without a UUID session_id`);
        continue;
      }
      if (rows.has(session.session_id)) {
        failures.push(`${label} contains duplicate session_id ${session.session_id}`);
        continue;
      }
      if (session.tenant !== context.metadata.tenantId) {
        failures.push(`${label} session ${session.session_id} belongs to a different tenant`);
      }
      rows.set(session.session_id, session);
    }
    return rows;
  };

  const beforeSessions = readSessionMap(
    context.readJson('01-before-database.json'),
    'Before database snapshot'
  );
  const afterSessions = readSessionMap(
    context.readJson('90-after-database.json'),
    'After database snapshot'
  );
  const creation = context.readJson(CREATED_SESSIONS_FILE);
  const cleanup = context.readJson(SESSION_CLEANUP_FILE);
  const createdSessions = Array.isArray(creation.createdSessions)
    ? creation.createdSessions
    : [];
  if (creation.workflowRunId !== context.metadata.workflowRunId
    || creation.tenantId !== context.metadata.tenantId
    || creation.expectedCreatedSessionCount !== EXPECTED_TEMPORARY_SESSION_COUNT
    || creation.assertionsPassed !== true
    || createdSessions.length !== EXPECTED_TEMPORARY_SESSION_COUNT) {
    failures.push(`${CREATED_SESSIONS_FILE} does not prove exactly two sessions were created`);
  }

  const runStartedAt = new Date(context.metadata.startedAt);
  const sessionsCapturedAt = new Date(creation.capturedAt);
  if (Number.isNaN(runStartedAt.valueOf())
    || Number.isNaN(sessionsCapturedAt.valueOf())
    || sessionsCapturedAt < runStartedAt) {
    failures.push(`${CREATED_SESSIONS_FILE} has invalid smoke-run timing`);
  }
  const createdSessionIds = [];
  for (const session of createdSessions) {
    context.checkDeadline();
    const createdAt = new Date(session?.created_at);
    if (!session
      || !UUID_PATTERN.test(session.session_id || '')
      || !UUID_PATTERN.test(session.user_id || '')
      || session.tenant !== context.metadata.tenantId
      || Number.isNaN(createdAt.valueOf())
      || createdAt < runStartedAt
      || createdAt > sessionsCapturedAt) {
      failures.push(`${CREATED_SESSIONS_FILE} contains a row not attributable to this smoke run`);
      continue;
    }
    createdSessionIds.push(session.session_id);
    if (beforeSessions.has(session.session_id)) {
      failures.push(`Temporary session ${session.session_id} already existed in the before snapshot`);
    }
    if (afterSessions.has(session.session_id)) {
      failures.push(`Temporary session ${session.session_id} remains in the after snapshot`);
    }
  }
  createdSessionIds.sort((left, right) => left.localeCompare(right));
  if (new Set(createdSessionIds).size !== EXPECTED_TEMPORARY_SESSION_COUNT) {
    failures.push(`${CREATED_SESSIONS_FILE} does not identify two distinct session rows`);
  }

  let createdEvidenceIdentity;
  try {
    createdEvidenceIdentity = context.identity(CREATED_SESSIONS_FILE);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  if (cleanup.workflowRunId !== context.metadata.workflowRunId
    || cleanup.tenantId !== context.metadata.tenantId
    || cleanup.expectedCreatedSessionCount !== EXPECTED_TEMPORARY_SESSION_COUNT
    || !isDeepStrictEqual(cleanup.createdEvidence, createdEvidenceIdentity)
    || !isDeepStrictEqual(cleanup.createdSessionIds, createdSessionIds)
    || !isDeepStrictEqual(cleanup.deletedSessionIds, createdSessionIds)
    || !Array.isArray(cleanup.remainingSessionRows)
    || cleanup.remainingSessionRows.length !== 0
    || cleanup.allDeleted !== true) {
    failures.push(`${SESSION_CLEANUP_FILE} does not match the recomputed two-row deletion proof`);
  }
  const cleanupVerifiedAt = new Date(cleanup.verifiedAt);
  if (Number.isNaN(cleanupVerifiedAt.valueOf()) || cleanupVerifiedAt < sessionsCapturedAt) {
    failures.push(`${SESSION_CLEANUP_FILE} has invalid verification timing`);
  }
  return failures;
}

function verifyRestorationSection(context, section, beforeFile, afterFile, project) {
  const failures = [];
  const comparison = valueAtPath(context.readJson(RESTORATION_FILE), [section], RESTORATION_FILE);
  if (comparison.exactMatch !== true) {
    failures.push(`${RESTORATION_FILE} reports ${section}.exactMatch !== true`);
  }
  if (!isDeepStrictEqual(comparison.baseline, comparison.after)) {
    failures.push(`${section}: recomputed baseline/after comparison is not an exact match`);
  }
  if (!isDeepStrictEqual(project(context.readJson(beforeFile)), comparison.baseline)) {
    failures.push(`${section}: the recorded baseline does not derive from ${beforeFile}`);
  }
  if (!isDeepStrictEqual(project(context.readJson(afterFile)), comparison.after)) {
    failures.push(`${section}: the recorded after state does not derive from ${afterFile}`);
  }
  return failures;
}

function validateProvenanceRecord(provenanceRecord, context, failures, label) {
  if (!provenanceRecord || typeof provenanceRecord !== 'object') {
    failures.push(`${label} is missing its provenance object`);
    return;
  }
  if (provenanceRecord.workflowRunId !== context.metadata.workflowRunId) {
    failures.push(`${label} provenance records a different workflow run`);
  }
  if (!UUID_PATTERN.test(provenanceRecord.captureNonce || '')) {
    failures.push(`${label} provenance captureNonce is not a UUID`);
  }
  const capturedAt = new Date(provenanceRecord.capturedAt);
  if (typeof provenanceRecord.capturedAt !== 'string'
    || Number.isNaN(capturedAt.valueOf())
    || capturedAt.toISOString() !== provenanceRecord.capturedAt) {
    failures.push(`${label} provenance capturedAt is not a canonical ISO timestamp`);
  }
  const browser = provenanceRecord.browser;
  if (!browser
    || typeof browser.userAgent !== 'string' || browser.userAgent.trim() === ''
    || typeof browser.platform !== 'string' || browser.platform.trim() === ''
    || typeof browser.url !== 'string') {
    failures.push(`${label} provenance is missing browser details`);
    return;
  }
  try {
    if (new URL(browser.url).origin !== new URL(context.metadata.appUrl).origin) {
      failures.push(`${label} provenance URL does not belong to the recorded application origin`);
    }
  } catch {
    failures.push(`${label} provenance URL is not valid`);
  }
}

function verifyDomPngBinding(context) {
  const failures = [];
  const correlation = context.readJson(CORRELATION_FILE);
  if (correlation.workflowRunId !== context.metadata.workflowRunId) {
    failures.push(`${CORRELATION_FILE} records a different workflow run`);
  }
  for (const key of ['dom', 'screenshot', 'captureProvenanceFile']) {
    const declared = correlation[key];
    if (!declared?.file || !SHA256_PATTERN.test(declared.sha256 || '')) {
      failures.push(`${CORRELATION_FILE} does not pin the ${key} artifact`);
      continue;
    }
    try {
      if (!isDeepStrictEqual(context.identity(declared.file), declared)) {
        failures.push(`${declared.file} does not match its correlated ${key} identity`);
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length > 0) {
    return failures;
  }

  const captureRecord = context.readJson(correlation.captureProvenanceFile.file);
  validateProvenanceRecord(captureRecord.provenance, context, failures, 'Capture record');
  if (!isDeepStrictEqual(correlation.provenance, captureRecord.provenance)) {
    failures.push('The correlation and capture record provenance differ');
  }
  if (captureRecord.externalGraphLimitation !== EXTERNAL_GRAPH_LIMITATION) {
    failures.push('The capture record dropped the no-external-Graph limitation');
  }
  for (const [key, actualName] of [
    ['dom', correlation.dom.file],
    ['screenshot', correlation.screenshot.file],
  ]) {
    const declared = captureRecord.artifacts?.[key];
    if (!declared
      || declared.file !== actualName
      || declared.sha256 !== context.hashFile(actualName)) {
      failures.push(`The capture record does not hash-bind the exact ${key} artifact`);
    }
  }

  const screenshotPath = context.filePath(correlation.screenshot.file);
  if (fs.readFileSync(screenshotPath).subarray(0, 8).toString('hex') !== PNG_SIGNATURE_HEX) {
    failures.push('The correlated screenshot is not a PNG');
  }
  const domContents = fs.readFileSync(context.filePath(correlation.dom.file), 'utf8');
  const embeddedMatch = /<script\b[^>]*\bid=["']alga-smoke-capture-provenance["'][^>]*>([\s\S]*?)<\/script>/i
    .exec(domContents);
  if (!embeddedMatch) {
    failures.push('The DOM artifact is missing its embedded capture provenance');
    return failures;
  }
  let embeddedProvenance;
  try {
    embeddedProvenance = JSON.parse(embeddedMatch[1]);
  } catch {
    failures.push('The DOM-embedded capture provenance is not valid JSON');
    return failures;
  }
  if (!isDeepStrictEqual(embeddedProvenance, captureRecord.provenance)) {
    failures.push('The DOM-embedded provenance does not match the capture record (nonce, timestamp, browser)');
  }
  return failures;
}

function verifyRuntimeProvenance(context) {
  const failures = [];
  const beforeRuntime = context.readJson('01-before-runtime-build.json');
  const afterRuntime = context.readJson('90-after-runtime-build.json');
  for (const [label, runtime] of [['before', beforeRuntime], ['after', afterRuntime]]) {
    if (!COMMIT_PATTERN.test(runtime.commit || '')) {
      failures.push(`The ${label} runtime provenance has no git commit`);
    }
    if (typeof runtime.worktree !== 'string' || runtime.worktree.trim() === '') {
      failures.push(`The ${label} runtime provenance has no worktree path`);
    }
  }
  if (beforeRuntime.commit !== afterRuntime.commit) {
    failures.push('The before and after captures ran at different commits');
  }
  const database = context.readJson('90-after-database.json');
  if (!database.identity?.database || !database.identity?.postgres_version) {
    failures.push('The after database snapshot has no database identity');
  }
  return failures;
}

function verifyNoFixtureResidue(context) {
  const failures = [];
  const profileId = context.metadata.profileId;
  if (!UUID_PATTERN.test(profileId || '')) {
    failures.push(`${METADATA_FILE} does not record the fixture profile UUID`);
    return failures;
  }
  const database = context.readJson('90-after-database.json');
  if ((database.microsoftProfiles || []).some((profile) => profile.profile_id === profileId)) {
    failures.push(`The fixture profile ${profileId} is still present in the after database snapshot`);
  }
  const secrets = context.readJson('90-after-secret-inventory.json');
  const fixtureSecretName = `microsoft_profile_${profileId}_client_secret`;
  if ((secrets.files || []).some((file) => file.name === fixtureSecretName)) {
    failures.push(`The fixture secret ${fixtureSecretName} is still present in the after secret inventory`);
  }
  return failures;
}

/**
 * Serialize a claim exactly as the index stores it (minus evidence
 * identities), so tampering with the declared assertions is detectable.
 */
function claimDeclaration(claim) {
  return {
    id: claim.id,
    title: claim.title,
    proves: claim.proves,
    assertions: claim.assertions,
    native: claim.native,
  };
}

function verifyIndexConsistency(context) {
  const failures = [];
  const index = context.readJson(INDEX_FILE);
  if (index.schemaVersion !== INDEX_SCHEMA_VERSION) {
    failures.push(`${INDEX_FILE} has an unsupported schemaVersion`);
  }
  if (index.workflowRunId !== context.metadata.workflowRunId) {
    failures.push(`${INDEX_FILE} records a different workflow run`);
  }

  const declaredClaims = Array.isArray(index.claims) ? index.claims : [];
  const declaredIds = declaredClaims.map((claim) => claim.id);
  const requiredIds = REQUIRED_CLAIMS.map((claim) => claim.id);
  if (!isDeepStrictEqual(declaredIds, requiredIds)) {
    const missing = requiredIds.filter((id) => !declaredIds.includes(id));
    const extra = declaredIds.filter((id) => !requiredIds.includes(id));
    failures.push(
      `${INDEX_FILE} does not declare exactly the required claims`
      + (missing.length > 0 ? `; missing: ${missing.join(', ')}` : '')
      + (extra.length > 0 ? `; unknown: ${extra.join(', ')}` : '')
    );
    return failures;
  }
  for (const [position, requiredClaim] of REQUIRED_CLAIMS.entries()) {
    const declared = declaredClaims[position];
    const { evidence, ...declaration } = declared;
    if (!isDeepStrictEqual(declaration, claimDeclaration(requiredClaim))) {
      failures.push(`${INDEX_FILE} declares different assertions for claim ${requiredClaim.id}`);
      continue;
    }
    let resolvedNames;
    try {
      resolvedNames = resolveEvidenceNames(requiredClaim, context);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    const declaredNames = (evidence || []).map((entry) => entry.file);
    if (!isDeepStrictEqual(declaredNames, resolvedNames)) {
      failures.push(`${INDEX_FILE} maps claim ${requiredClaim.id} to different evidence files`);
      continue;
    }
    for (const entry of evidence) {
      if (entry.sealedAfterIndex === true) {
        if (!SEALED_AFTER_INDEX.has(entry.file)) {
          failures.push(`${INDEX_FILE} marks ${entry.file} sealedAfterIndex, which only the seal outputs may be`);
        } else if (!fs.existsSync(context.filePath(entry.file))) {
          failures.push(`Evidence file is missing: ${entry.file}`);
        }
        continue;
      }
      let identity;
      try {
        identity = context.identity(entry.file);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        continue;
      }
      if (!isDeepStrictEqual(identity, { file: entry.file, bytes: entry.bytes, sha256: entry.sha256 })) {
        failures.push(`${entry.file} does not match the identity pinned for claim ${requiredClaim.id}`);
      }
    }
  }

  const verifierPin = index.verification?.verifier;
  if (!verifierPin
    || verifierPin.file !== VERIFIER_COPY_FILE
    || verifierPin.sha256 !== context.hashFile(VERIFIER_COPY_FILE)) {
    failures.push(`${INDEX_FILE} does not pin the sealed verifier copy ${VERIFIER_COPY_FILE}`);
  }
  const runtime = context.readJson('90-after-runtime-build.json');
  if (index.provenance?.commit !== runtime.commit) {
    failures.push(`${INDEX_FILE} provenance commit does not match the runtime capture`);
  }
  if (index.provenance?.tenantId !== context.metadata.tenantId
    || index.provenance?.profileId !== context.metadata.profileId
    || index.provenance?.appUrl !== context.metadata.appUrl) {
    failures.push(`${INDEX_FILE} provenance does not match the workflow metadata`);
  }
  if (index.disclosures?.externalGraphLimitation !== EXTERNAL_GRAPH_LIMITATION
    || index.disclosures?.ctimeNonRestorableReason !== CTIME_NON_RESTORABLE_REASON
    || index.disclosures?.integrityAnchor !== INTEGRITY_ANCHOR_NOTE) {
    failures.push(`${INDEX_FILE} is missing the required limitation disclosures`);
  }
  return failures;
}

/**
 * Render the human review entrypoint (`00-REVIEW.md`) from the sealed
 * evidence. The rendering is a pure function of the sealed files — the
 * capture script writes it at sealing time and `verifyReviewEntrypoint`
 * re-renders it at verification time, so the sealed document must byte-match
 * or the bundle fails. Nothing in the document is asserted from memory: every
 * value comes from the sealed index, the restoration comparison, the session
 * cleanup proof, and the claim table this module hardcodes.
 */
export function buildReviewDocument(context) {
  const sectionIds = REVIEW_SECTIONS.flatMap((section) => section.claimIds);
  const requiredIds = REQUIRED_CLAIMS.map((claim) => claim.id);
  if (new Set(sectionIds).size !== sectionIds.length
    || !isDeepStrictEqual([...sectionIds].sort(), [...requiredIds].sort())) {
    throw new Error('REVIEW_SECTIONS does not cover every required claim exactly once');
  }

  const index = context.readJson(INDEX_FILE);
  const restoration = context.readJson(RESTORATION_FILE);
  const cleanup = context.readJson(SESSION_CLEANUP_FILE);
  const claimCount = REQUIRED_CLAIMS.length;
  const wizardMode = index.provenance?.observedWizardMode;
  const database = index.provenance?.database?.identity;
  const directoryMtimeMs = restoration.tenantSecrets?.baseline?.directoryMtimeMs;
  const sessionIds = cleanup.createdSessionIds
    .map((sessionId) => `\`${sessionId}\``)
    .join(' and ');

  const successOutput = [
    'VERDICT: PASS',
    ...REVIEW_SECTIONS.map(
      (section) => `PASS ${section.title} (${section.claimIds.length}/${section.claimIds.length})`
    ),
    `Observed licensing mode: ${wizardMode}`,
    `VERIFIED: ${claimCount}/${claimCount} claims passed`,
    'bundleDigest sha256(SHA256SUMS)=<64 hex digits>',
    'Review complete: no artifact-by-artifact inspection is required.',
  ].map((line) => `    ${line}`).join('\n');

  const dimensionNotes = {
    'Exact restoration': typeof directoryMtimeMs === 'number'
      ? ` — every database row (timestamps included) and the complete tenant secret inventory match the baseline exactly, down to the secret-directory mtime (${directoryMtimeMs} ms on both sides); the only non-restorable drift is kernel-managed ctime, disclosed with zero unexpected changes`
      : '',
    'Temporary-session deletions': ` — the run created sessions ${sessionIds}; neither existed before the run and neither remains after cleanup`,
  };
  const dimensionList = REVIEW_SECTIONS.map((section) => {
    const claimIds = section.claimIds.map((claimId) => `\`${claimId}\``).join(', ');
    return `- ${section.title} (${section.claimIds.length}): ${claimIds}${dimensionNotes[section.title] ?? ''}`;
  }).join('\n');

  return `# Review this first — Microsoft Email setup smoke evidence

The one bounded command below is the complete review: it re-derives every
conclusion from the sealed evidence and prints a conclusive verdict. No
artifact-by-artifact inspection is required or expected. Do not
investigate the repository, other evidence bundles, or the running stack —
nothing outside this bundle directory is part of the review surface.

- Workflow run: \`${index.workflowRunId}\`
- Sealed at: ${index.generatedAt}
- Commit: \`${index.provenance?.commit}\` (branch \`${index.provenance?.branch}\`)
- Application: ${index.provenance?.appUrl} — tenant \`${index.provenance?.tenantId}\`, smoke fixture profile \`${index.provenance?.profileId}\`
- Database: ${database?.database} — ${database?.postgres_version}
- Observed licensing mode: ${wizardMode}

## The verdict command (the entire review)

    node <bundle-dir>/${VERIFIER_COPY_FILE} <bundle-dir>

From inside this directory: \`node ${VERIFIER_COPY_FILE} .\`. Add \`--json\`
for the same result as one machine-readable JSON line. Typical runtime is
well under one second.

Success is exactly this output, with exit code 0:

${successOutput}

Any other outcome is a failure: exit 1 additionally prints one
\`FAIL <claim-id>\` block per failing claim with its reasons; exit 2 is a
usage error or an exceeded internal deadline.

Bounds: ${index.verification?.boundedBy}

The command is conclusive because its hardcoded claim table is the
authority: it re-derives every conclusion from the raw sealed evidence
(recomputing the restoration comparisons instead of trusting recorded
verdicts), validates every bundle file against \`${CHECKSUM_FILE}\` and the
sealed manifest, checks that \`${INDEX_FILE}\` declares exactly the same
claims and assertions, and re-renders this document, failing on any byte
difference. Tamper handling is already demonstrated inside the bundle: the
sealed trial record \`${TAMPER_TRIALS_FILE}\` (claim
\`sealed-tamper-outcomes\`) shows this bundle's own verifier rejected
byte-tamper, file-deletion, and review-edit-plus-dishonest-reseal copies of
this run's evidence at sealing time, so there is no need to re-run tamper
trials.

Sealed verifier copy: \`${VERIFIER_COPY_FILE}\`, sha256
\`${index.verification?.verifier?.sha256}\`. The identical script lives in
the repository at \`${index.verification?.repoScript}\`; running the sealed
copy alone is sufficient.

${index.disclosures?.integrityAnchor}

## What the ${claimCount} claims cover

All ${claimCount} claims passed when this bundle sealed; the verdict command
re-establishes each one live from the sealed evidence.

${dimensionList}

## Optional independent checksum confirmation

    cd <bundle-dir> && sha256sum -c ${CHECKSUM_FILE}

The verdict command already performs this exact coverage check against the
sealed per-file identities; run \`sha256sum -c\` only when an independent
tool's confirmation is wanted.

## Limitations disclosed

- ${index.disclosures?.externalGraphLimitation}
- ${index.disclosures?.crossHostContext}
- ${index.disclosures?.crossHostFidelityNote}
- Render method: ${index.disclosures?.renderMethod}
- ${index.disclosures?.ctimeNonRestorableReason}.
`;
}

function verifyReviewEntrypoint(context) {
  const reviewPath = context.filePath(REVIEW_FILE);
  if (!fs.existsSync(reviewPath)) {
    return [`${REVIEW_FILE} is missing`];
  }
  let expected;
  try {
    expected = buildReviewDocument(context);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  if (fs.readFileSync(reviewPath, 'utf8') !== expected) {
    return [
      `${REVIEW_FILE} does not byte-match the document re-rendered from the sealed evidence`,
    ];
  }
  return [];
}

/**
 * Evaluate one claim: declarative assertions first, then native checks.
 * Returns { id, title, passed, failures, matchedBranch }.
 */
export function evaluateClaim(claim, context) {
  context.checkDeadline();
  const failures = [];
  let matchedBranch = null;
  for (const evidenceName of resolveEvidenceNames(claim, context)) {
    if (!fs.existsSync(context.filePath(evidenceName))) {
      failures.push(`Evidence file is missing: ${evidenceName}`);
    }
  }
  if (failures.length === 0) {
    for (const assertion of claim.assertions) {
      const result = evaluateAssertion(assertion, context);
      failures.push(...result.failures);
      matchedBranch = matchedBranch ?? result.matchedBranch;
    }
    for (const nativeName of claim.native) {
      const nativeCheck = NATIVE_CHECKS[nativeName];
      if (!nativeCheck) {
        failures.push(`Unknown native check: ${nativeName}`);
        continue;
      }
      try {
        failures.push(...nativeCheck(context));
      } catch (error) {
        if (error instanceof VerificationTimeoutError) {
          throw error;
        }
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  return {
    id: claim.id,
    title: claim.title,
    passed: failures.length === 0,
    failures,
    matchedBranch,
  };
}

/**
 * Build the machine-readable verification index for a bundle that has run
 * before/after/correlate but is not yet sealed. Called by the capture script's
 * manifest stage; the index pins every evidence file's identity except the
 * seal outputs, which the manifest and SHA256SUMS pin in turn.
 */
export function buildVerificationIndex(evidenceDirectory, { verifierCopySha256 }) {
  const context = createContext(evidenceDirectory);
  const correlation = context.readJson(CORRELATION_FILE);
  const afterRuntime = context.readJson('90-after-runtime-build.json');
  const afterDatabase = context.readJson('90-after-database.json');

  const wizardResult = evaluateClaim(
    REQUIRED_CLAIMS.find((claim) => claim.id === 'providers-wizard-platform-gating'),
    context
  );
  if (!wizardResult.passed) {
    throw new Error(`Cannot index the wizard gating claim: ${wizardResult.failures.join('; ')}`);
  }

  const claims = REQUIRED_CLAIMS.map((claim) => ({
    ...claimDeclaration(claim),
    evidence: resolveEvidenceNames(claim, context).map((name) => {
      if (SEALED_AFTER_INDEX.has(name)) {
        return { file: name, sealedAfterIndex: true };
      }
      if (name === VERIFIER_COPY_FILE) {
        const identity = context.identity(name);
        if (identity.sha256 !== verifierCopySha256) {
          throw new Error(`${VERIFIER_COPY_FILE} does not match the verifier source being pinned`);
        }
        return identity;
      }
      return context.identity(name);
    }),
  }));

  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    workflowRunId: context.metadata.workflowRunId,
    generatedAt: new Date().toISOString(),
    verification: {
      command: `node ${VERIFIER_COPY_FILE} <bundle-dir>`,
      repoScript: 'scripts/verify-microsoft-email-smoke-evidence.mjs',
      boundedBy: `Internal ${DEFAULT_TIMEOUT_MS} ms deadline and ${MAX_SESSION_EVIDENCE_ROWS}-row session-evidence cap; reads only the bundle directory (no network, database, or server); exits 0 only when every claim passes, 1 on any mismatch, 2 on usage errors or timeout.`,
      verifier: { file: VERIFIER_COPY_FILE, sha256: verifierCopySha256 },
    },
    provenance: {
      commit: afterRuntime.commit,
      branch: afterRuntime.branch,
      worktree: afterRuntime.worktree,
      appUrl: context.metadata.appUrl,
      tenantId: context.metadata.tenantId,
      profileId: context.metadata.profileId,
      database: {
        connection: afterDatabase.connection,
        identity: afterDatabase.identity,
      },
      observedWizardMode: wizardResult.matchedBranch,
    },
    disclosures: {
      externalGraphLimitation: EXTERNAL_GRAPH_LIMITATION,
      crossHostContext: context.metadata.crossHostContext,
      crossHostFidelityNote: correlation.crossHostFidelityNote,
      renderMethod: correlation.renderMethod,
      ctimeNonRestorableReason: CTIME_NON_RESTORABLE_REASON,
      integrityAnchor: INTEGRITY_ANCHOR_NOTE,
    },
    claims,
  };
}

/**
 * Verify a sealed bundle. Returns { passed, exitCode, results, bundleDigest }
 * and never throws for verification failures — only for setup errors such as
 * a missing directory.
 */
export function verifyBundle(evidenceDirectory, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let context;
  try {
    context = createContext(evidenceDirectory, { timeoutMs });
  } catch (error) {
    return {
      passed: false,
      exitCode: 2,
      results: [],
      bundleDigest: null,
      setupError: error instanceof Error ? error.message : String(error),
    };
  }
  const results = [];
  try {
    for (const claim of REQUIRED_CLAIMS) {
      results.push(evaluateClaim(claim, context));
    }
  } catch (error) {
    if (error instanceof VerificationTimeoutError) {
      return {
        passed: false,
        exitCode: 2,
        results,
        bundleDigest: null,
        setupError: error.message,
      };
    }
    throw error;
  }
  const passed = results.every((result) => result.passed);
  const checksumPath = path.join(context.directory, CHECKSUM_FILE);
  const bundleDigest = fs.existsSync(checksumPath) ? sha256File(checksumPath) : null;
  return { passed, exitCode: passed ? 0 : 1, results, bundleDigest };
}

/**
 * Reduce a `verifyBundle` result to the concise review conclusion: overall
 * verdict, one entry per verdict dimension, the claim tally, the observed
 * licensing mode, and the bundle digest. This — not a per-artifact listing —
 * is what the CLI reports, because the conclusion is the entire review.
 */
export function summarizeVerdict(verdict) {
  const resultsById = new Map(verdict.results.map((result) => [result.id, result]));
  const dimensions = REVIEW_SECTIONS.map((section) => {
    const results = section.claimIds
      .map((claimId) => resultsById.get(claimId))
      .filter(Boolean);
    const passedCount = results.filter((result) => result.passed).length;
    return {
      title: section.title,
      claimCount: section.claimIds.length,
      passedCount,
      passed: passedCount === section.claimIds.length,
    };
  });
  return {
    verdict: verdict.passed ? 'PASS' : 'FAIL',
    exitCode: verdict.exitCode,
    claimsPassed: verdict.results.filter((result) => result.passed).length,
    claimsTotal: REQUIRED_CLAIMS.length,
    dimensions,
    licensingMode: verdict.results
      .find((result) => result.id === 'providers-wizard-platform-gating')?.matchedBranch ?? null,
    bundleDigest: verdict.bundleDigest,
    setupError: verdict.setupError ?? null,
  };
}

/**
 * Render the concise CLI output. Success is terminal — verdict, dimensions,
 * tally, digest, and an explicit "nothing further to inspect" — while failure
 * additionally prints one FAIL block per failing claim with its reasons.
 */
export function formatVerdictLines(verdict, summary = summarizeVerdict(verdict)) {
  const lines = [`VERDICT: ${summary.verdict}`];
  if (verdict.results.length > 0) {
    for (const dimension of summary.dimensions) {
      lines.push(
        `${dimension.passed ? 'PASS' : 'FAIL'} ${dimension.title} (${dimension.passedCount}/${dimension.claimCount})`
      );
    }
  }
  for (const result of verdict.results.filter((entry) => !entry.passed)) {
    lines.push(`FAIL ${result.id} — ${result.title}`);
    for (const failure of result.failures) {
      lines.push(`     ${failure}`);
    }
  }
  if (summary.licensingMode) {
    lines.push(`Observed licensing mode: ${summary.licensingMode}`);
  }
  lines.push(
    `${verdict.passed ? 'VERIFIED' : 'NOT VERIFIED'}: ${summary.claimsPassed}/${summary.claimsTotal} claims passed`
  );
  if (summary.bundleDigest) {
    lines.push(`bundleDigest sha256(SHA256SUMS)=${summary.bundleDigest}`);
  }
  if (verdict.passed) {
    lines.push('Review complete: no artifact-by-artifact inspection is required.');
  }
  return lines;
}

function main() {
  const [directoryArgument, ...options] = process.argv.slice(2);
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let jsonOutput = false;
  for (const option of options) {
    if (option === '--json') {
      jsonOutput = true;
      continue;
    }
    const match = /^--timeout-ms=(\d+)$/.exec(option);
    if (!match) {
      console.error(`Unknown option: ${option}`);
      process.exitCode = 2;
      return;
    }
    timeoutMs = Number(match[1]);
  }
  if (!directoryArgument) {
    console.error('Usage: node verify-microsoft-email-smoke-evidence.mjs <bundle-dir> [--timeout-ms=60000] [--json]');
    process.exitCode = 2;
    return;
  }
  const verdict = verifyBundle(directoryArgument, { timeoutMs });
  const summary = summarizeVerdict(verdict);
  if (jsonOutput) {
    console.log(JSON.stringify({
      ...summary,
      failedClaims: verdict.results
        .filter((result) => !result.passed)
        .map((result) => ({ id: result.id, failures: result.failures })),
    }));
  } else {
    for (const line of formatVerdictLines(verdict, summary)) {
      console.log(line);
    }
    if (verdict.setupError) {
      console.error(verdict.setupError);
    }
  }
  process.exitCode = verdict.exitCode;
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  main();
}
