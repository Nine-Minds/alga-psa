import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVIDENCE_TYPES,
  REQUIREMENT_STATUSES,
  evaluateCoManagedCompletion,
  headOnlyRewritesItsOwnEvidence,
} from '../lib/co-managed-completion.mjs';

/**
 * CF030 / CT026. These validate the gate's own behaviour, and they exist
 * because the PRD forbids a self-referential checklist: the verifier has to be
 * proved to reject before it is trusted to accept.
 *
 * Every case starts from a manifest that PASSES all three predicates and then
 * breaks exactly one thing, so a failure names the rule that stopped working
 * rather than "the fixture drifted".
 */

const CANDIDATE = 'a'.repeat(40);
const BASE = 'b'.repeat(40);

const EXPECTED_IDS = ['CF005', 'CF006', 'clientIntegration:T018'];

function passingManifest() {
  return {
    schemaVersion: 1,
    candidate: CANDIDATE,
    base: BASE,
    collectedAt: '2026-09-20T12:00:00.000Z',
    pr: { number: 3363, head: CANDIDATE },
    provenance: {
      app: { revision: CANDIDATE },
      worker: { revision: CANDIDATE },
      migrations: 'sha256:migrations',
      config: 'sha256:config',
      simulator: 'algasim@1.2.3',
    },
    worktreeClean: true,
    mergeability: { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', checkedAtSha: CANDIDATE },
    ci: {
      runId: '35519946625',
      checks: [
        { name: 'Integration shard 1', status: 'completed', conclusion: 'success', headSha: CANDIDATE },
        { name: 'Production regression readiness', status: 'completed', conclusion: 'success', headSha: CANDIDATE },
      ],
    },
    reviewEnvironment: { stable: true, observedMinutes: 35, healingEvents: 0 },
    openDefects: [],
    productionPrerequisites: [
      { id: 'stripe-price-1149', owner: 'release-operator', acceptedByReleaseOwner: true },
    ],
    evidence: {
      'browser-walk': {
        type: 'browser', sha: CANDIDATE, command: 'walked the journey', result: 'passed',
        artifact: 'cf005-provider-setup.md',
      },
      'regression': {
        type: 'automated', sha: CANDIDATE, command: 'vitest run …', result: '41 passed',
        artifact: 'cf005-provider-setup.md',
      },
    },
    requirements: [
      {
        key: 'CF005', status: 'verified', justification: 'walked and pinned',
        evidence: [{ id: 'browser-walk' }, { id: 'regression' }],
      },
      {
        key: 'CF006', status: 'verified', justification: 'guards exercised',
        evidence: [{ id: 'regression' }],
      },
      {
        key: 'clientIntegration:T018', status: 'blocked-external', justification: 'real provider',
        externalOwner: 'release-operator', evidence: [],
      },
    ],
  };
}

const evaluate = (manifest, expectedRequirementIds = EXPECTED_IDS) =>
  evaluateCoManagedCompletion({ manifest, expectedRequirementIds });

/** Break one thing and assert the named predicate goes false with a reason. */
function rejects(name, mutate, predicate, matcher) {
  test(`rejects: ${name}`, () => {
    const manifest = passingManifest();
    mutate(manifest);
    const verdict = evaluate(manifest);
    assert.equal(verdict[predicate], false, `${predicate} should be false`);
    const reasons = verdict.blocking[predicate === 'implementationReady' ? 'implementation'
      : predicate === 'humanReviewReady' ? 'humanReview' : 'production'];
    assert.ok(
      reasons.some((reason) => matcher.test(reason)),
      `expected a blocking reason matching ${matcher}, got:\n  ${reasons.join('\n  ')}`,
    );
  });
}

test('the fixture passes all three predicates', () => {
  const verdict = evaluate(passingManifest());
  assert.deepEqual(verdict.blocking, { implementation: [], humanReview: [], production: [] });
  assert.equal(verdict.implementationReady, true);
  assert.equal(verdict.humanReviewReady, true);
  assert.equal(verdict.productionReady, true);
  assert.equal(verdict.candidate, CANDIDATE);
});

test('the three predicates are calculated separately', () => {
  const manifest = passingManifest();
  manifest.reviewEnvironment.healingEvents = 2;
  const verdict = evaluate(manifest);
  assert.equal(verdict.implementationReady, true, 'implementation is unaffected by review stability');
  assert.equal(verdict.humanReviewReady, false);
  assert.equal(verdict.productionReady, false, 'production depends on human review');
});

test('fails closed on a missing manifest', () => {
  const verdict = evaluateCoManagedCompletion({});
  assert.equal(verdict.implementationReady, false);
  assert.equal(verdict.humanReviewReady, false);
  assert.equal(verdict.productionReady, false);
});

test('fails closed when the expected ID set is not supplied', () => {
  const verdict = evaluateCoManagedCompletion({ manifest: passingManifest() });
  assert.equal(verdict.implementationReady, false);
  assert.ok(verdict.blocking.implementation.some((r) => /expected requirement IDs/.test(r)));
});

// --- the reject list the PRD names ---------------------------------------

rejects('a removed required ID', (m) => { m.requirements = m.requirements.filter((r) => r.key !== 'CF006'); },
  'implementationReady', /required requirement CF006 is absent/);

rejects('a duplicate ID', (m) => { m.requirements.push({ ...m.requirements[0] }); },
  'implementationReady', /duplicate requirement CF005/);

rejects('an unknown ID appearing from nowhere',
  (m) => { m.requirements.push({ key: 'CF999', status: 'verified', justification: 'x', evidence: [{ id: 'regression' }] }); },
  'implementationReady', /unknown requirement CF999/);

rejects('an unknown status', (m) => { m.requirements[0].status = 'round-complete'; },
  'implementationReady', /unknown status/);

rejects('a requirement with no justification', (m) => { m.requirements[0].justification = ''; },
  'implementationReady', /no justification/);

rejects('verified with no evidence record', (m) => { m.requirements[0].evidence = []; },
  'implementationReady', /verified with no evidence record/);

rejects('an unresolved required row', (m) => { m.requirements[0].status = 'implemented-unverified'; },
  'implementationReady', /CF005: implemented-unverified/);

rejects('a failed required row', (m) => { m.requirements[1].status = 'failed'; },
  'implementationReady', /CF006: failed/);

rejects('missing code on a required row', (m) => { m.requirements[1].status = 'missing-code'; },
  'implementationReady', /CF006: missing-code/);

rejects('evidence that names no command', (m) => { m.evidence.regression.command = ''; },
  'implementationReady', /no command or journey/);

rejects('evidence that names no actual result', (m) => { m.evidence['browser-walk'].result = ''; },
  'implementationReady', /no actual result/);

rejects('evidence of an unknown type', (m) => { m.evidence.regression.type = 'vibes'; },
  'implementationReady', /unknown type/);

rejects('an unavailable artifact', (m) => { m.evidence.regression.artifactAvailable = false; },
  'implementationReady', /artifact .* is unavailable/);

rejects('evidence referenced but not recorded', (m) => { m.requirements[0].evidence = [{ id: 'imaginary' }]; },
  'implementationReady', /evidence imaginary is not in manifest.evidence/);

rejects('a stale SHA relabelled onto the candidate',
  (m) => { m.evidence.regression.sha = 'c'.repeat(40); },
  'implementationReady', /ran at c+, not the candidate, with no recorded dependency analysis/);

test('historical evidence is usable only with a recorded dependency analysis', () => {
  const manifest = passingManifest();
  manifest.evidence.regression.sha = 'c'.repeat(40);
  manifest.evidence.regression.dependencyAnalysis = 'the candidate changes only docs/, which this suite does not read';
  const verdict = evaluate(manifest);
  assert.equal(verdict.implementationReady, true);
});

rejects('an open functional defect',
  (m) => { m.openDefects.push({ id: 'D1', kind: 'functional', summary: 'requester deferral collapses to retry' }); },
  'implementationReady', /open functional defect D1/);

rejects('an open security defect', (m) => { m.openDefects.push({ id: 'D2', kind: 'security', summary: 'x' }); },
  'implementationReady', /open security defect D2/);

rejects('an open data-integrity defect', (m) => { m.openDefects.push({ id: 'D3', kind: 'data-integrity', summary: 'x' }); },
  'implementationReady', /open data-integrity defect D3/);

rejects('a candidate that is not the PR head', (m) => { m.pr.head = 'd'.repeat(40); },
  'humanReviewReady', /PR head .* is not the candidate/);

rejects('a running app on a different revision', (m) => { m.provenance.app.revision = 'e'.repeat(40); },
  'humanReviewReady', /running app revision .* is not the candidate/);

rejects('a running worker on a different revision', (m) => { m.provenance.worker.revision = 'e'.repeat(40); },
  'humanReviewReady', /running worker revision .* is not the candidate/);

rejects('a dirty delivered worktree', (m) => { m.worktreeClean = false; },
  'humanReviewReady', /worktree is not clean/);

rejects('conflicting mergeability', (m) => { m.mergeability.mergeable = 'CONFLICTING'; },
  'humanReviewReady', /mergeable is CONFLICTING/);

rejects('unknown mergeability', (m) => { m.mergeability.mergeable = 'UNKNOWN'; },
  'humanReviewReady', /mergeable is UNKNOWN/);

rejects('a dirty merge state', (m) => { m.mergeability.mergeStateStatus = 'DIRTY'; },
  'humanReviewReady', /mergeStateStatus is DIRTY/);

rejects('mergeability checked at an older SHA', (m) => { m.mergeability.checkedAtSha = BASE; },
  'humanReviewReady', /not re-checked at the candidate/);

rejects('a pending mandatory check', (m) => { m.ci.checks[0].status = 'in_progress'; m.ci.checks[0].conclusion = null; },
  'humanReviewReady', /Integration shard 1: in_progress/);

rejects('a failed mandatory check', (m) => { m.ci.checks[1].conclusion = 'failure'; },
  'humanReviewReady', /Production regression readiness: concluded failure/);

rejects('a skipped mandatory check', (m) => { m.ci.checks[1].conclusion = 'skipped'; },
  'humanReviewReady', /concluded skipped/);

rejects('a cancelled mandatory check', (m) => { m.ci.checks[1].conclusion = 'cancelled'; },
  'humanReviewReady', /concluded cancelled/);

rejects('a mandatory check that ran at another SHA', (m) => { m.ci.checks[0].headSha = BASE; },
  'humanReviewReady', /ran at b+, not the candidate/);

rejects('no mandatory checks at all', (m) => { m.ci.checks = m.ci.checks.map((c) => ({ ...c, mandatory: false })); },
  'humanReviewReady', /no mandatory CI check is recorded/);

test('a count of green checks cannot substitute for the required set', () => {
  const manifest = passingManifest();
  // Twenty passing non-mandatory checks and one failing mandatory one.
  manifest.ci.checks = [
    ...Array.from({ length: 20 }, (_, i) => ({
      name: `green-${i}`, status: 'completed', conclusion: 'success', headSha: CANDIDATE, mandatory: false,
    })),
    { name: 'Integration shard 1', status: 'completed', conclusion: 'failure', headSha: CANDIDATE },
  ];
  const verdict = evaluate(manifest);
  assert.equal(verdict.humanReviewReady, false);
});

rejects('an unstable review environment', (m) => { m.reviewEnvironment.stable = false; },
  'humanReviewReady', /not recorded stable/);

rejects('an observation shorter than 30 minutes', (m) => { m.reviewEnvironment.observedMinutes = 12; },
  'humanReviewReady', /shorter than the required 30 minutes/);

rejects('any automatic healing during the observation', (m) => { m.reviewEnvironment.healingEvents = 1; },
  'humanReviewReady', /healed 1 times/);

rejects('an external prerequisite with no owner', (m) => { delete m.requirements[2].externalOwner; },
  'productionReady', /external prerequisite with no recorded owner/);

rejects('a production prerequisite the release owner has not accepted',
  (m) => { m.productionPrerequisites[0].acceptedByReleaseOwner = false; },
  'productionReady', /not accepted by the release owner/);

rejects('no production prerequisites recorded at all', (m) => { m.productionPrerequisites = []; },
  'productionReady', /missing or empty/);

// --- shape guards ---------------------------------------------------------

rejects('an unsupported schema version', (m) => { m.schemaVersion = 2; },
  'implementationReady', /unsupported manifest schemaVersion/);

rejects('a short candidate SHA', (m) => { m.candidate = 'abc1234'; },
  'implementationReady', /candidate is not a full 40-character SHA/);

rejects('a missing base SHA', (m) => { delete m.base; },
  'implementationReady', /base is not a full 40-character SHA/);

rejects('a missing collection timestamp', (m) => { delete m.collectedAt; },
  'implementationReady', /collectedAt is missing/);

rejects('missing requirements entirely', (m) => { delete m.requirements; },
  'implementationReady', /requirements is missing or not an array/);

rejects('missing open-defect tracking', (m) => { delete m.openDefects; },
  'implementationReady', /openDefects is missing/);

rejects('a missing migrations fingerprint', (m) => { delete m.provenance.migrations; },
  'humanReviewReady', /provenance.migrations fingerprint is missing/);

rejects('a missing simulator fingerprint', (m) => { delete m.provenance.simulator; },
  'humanReviewReady', /provenance.simulator fingerprint is missing/);

// --- things that must never be accepted as substitutes -------------------

test('prose cannot satisfy a predicate', () => {
  const manifest = passingManifest();
  manifest.requirements[0].status = 'implemented-unverified';
  manifest.summary = 'round complete; no release-blocking defect';
  manifest.implementationReady = true;
  manifest.humanReviewReady = true;
  const verdict = evaluate(manifest);
  assert.equal(verdict.implementationReady, false, 'a manifest cannot assert its own verdict');
  assert.equal(verdict.humanReviewReady, false);
});

test('counts are reported for every status present', () => {
  const verdict = evaluate(passingManifest());
  assert.deepEqual(verdict.counts, { verified: 2, 'blocked-external': 1 });
});

test('the status vocabulary is the one the inventory uses', () => {
  assert.deepEqual(REQUIREMENT_STATUSES,
    ['missing-code', 'implemented-unverified', 'failed', 'blocked-external', 'verified']);
  assert.deepEqual(EVIDENCE_TYPES,
    ['automated', 'browser', 'database', 'simulator', 'external', 'analysis']);
});


/**
 * `analysis` — a recorded code read. It is a real, citable artifact (the
 * ticket-list reconciliation is one), so recording it must not be a
 * malformed-manifest error. But it observes source, not behaviour, so it can
 * never accept a requirement on its own. Both halves are load-bearing: drop the
 * first and the gate reports a false blocker, drop the second and "the code
 * looks right" becomes a path to `verified`.
 */

/** Replace every evidence ref on CF006 with a single analysis-only record. */
function analysisOnlyCF006(manifest) {
  manifest.evidence['code-read'] = {
    type: 'analysis', sha: CANDIDATE, command: 'row-by-row read of the ticket-list rows',
    result: '39 rows classified', artifact: 'ticket-list-reconciliation.md',
  };
  const row = manifest.requirements.find((r) => r.key === 'CF006');
  row.evidence = [{ id: 'code-read' }];
}

test('analysis is a recordable evidence type, not a malformed manifest', () => {
  const manifest = passingManifest();
  analysisOnlyCF006(manifest);
  const verdict = evaluate(manifest);
  assert.ok(
    !verdict.blocking.implementation.some((r) => /unknown type/.test(r)),
    `no "unknown type" blocker expected, got:\n  ${verdict.blocking.implementation.join('\n  ')}`,
  );
});

rejects('a row verified by a code read alone', analysisOnlyCF006,
  'implementationReady', /^CF006: verified only by analysis evidence — nothing was executed$/);

test('analysis alongside an executed run is fine — it is a supplement, not a substitute', () => {
  const manifest = passingManifest();
  analysisOnlyCF006(manifest);
  // Put the automated run back beside the code read.
  manifest.requirements.find((r) => r.key === 'CF006').evidence.push({ id: 'regression' });
  const verdict = evaluate(manifest);
  assert.deepEqual(verdict.blocking, { implementation: [], humanReview: [], production: [] });
  assert.equal(verdict.implementationReady, true);
});

test('the analysis floor is per-row, not per-manifest', () => {
  // CF005 keeps its browser walk and regression run; only CF006 is starved.
  const manifest = passingManifest();
  analysisOnlyCF006(manifest);
  const reasons = evaluate(manifest).blocking.implementation;
  assert.equal(reasons.filter((r) => /nothing was executed/.test(r)).length, 1,
    `exactly CF006 should be blocked, got:\n  ${reasons.join('\n  ')}`);
  assert.ok(reasons.every((r) => !r.startsWith('CF005:')), 'CF005 must be unaffected');
});


/**
 * The candidate-vs-HEAD exception. A manifest cannot name the commit that adds
 * it, so generated-last it is one docs-only commit behind. The exception has to
 * be narrow enough that real drift still blocks.
 */
const DIR = 'docs/evidence/co-managed-completion/81fe5d58c8';

test('HEAD may rewrite only the packet under the candidate it describes', () => {
  assert.equal(headOnlyRewritesItsOwnEvidence([
    `${DIR}/manifest.json`, `${DIR}/inventory.json`, `${DIR}/inventory.md`,
  ], DIR), true);
});

test('a single file touched outside that directory is real drift', () => {
  for (const stray of [
    'server/src/lib/productSurfaceRegistry.ts',
    'docs/plans/2026-09-20-co-managed-it-completion/features.json',
    'docs/evidence/co-managed-completion/README.md',
    'docs/evidence/co-managed-completion/deadbeef00/manifest.json',
    'packages/co-managed/src/sharedWorkIdentity.ts',
  ]) {
    assert.equal(
      headOnlyRewritesItsOwnEvidence([`${DIR}/manifest.json`, stray], DIR), false,
      `${stray} must count as drift`,
    );
  }
});

test('a prefix that merely looks similar does not count as inside', () => {
  // `.../81fe5d58c8-old/x` must not satisfy a `.../81fe5d58c8` prefix.
  assert.equal(headOnlyRewritesItsOwnEvidence([`${DIR}-old/manifest.json`], DIR), false);
});

test('an empty or unusable diff never grants the exception', () => {
  assert.equal(headOnlyRewritesItsOwnEvidence([], DIR), false);
  assert.equal(headOnlyRewritesItsOwnEvidence(null, DIR), false);
  assert.equal(headOnlyRewritesItsOwnEvidence([`${DIR}/manifest.json`], ''), false);
  assert.equal(headOnlyRewritesItsOwnEvidence([`${DIR}/manifest.json`], null), false);
});
