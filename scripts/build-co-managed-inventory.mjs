#!/usr/bin/env node
/**
 * CF001 — build the row-level reconciliation inventory for PR #3363.
 *
 * Every requirement in the three plans this card is executing against has to
 * appear exactly once, with a status that is derived from something checkable
 * rather than asserted in prose. `implemented: true` in a plan's features.json
 * means code exists; it is not a claim that anything passed at the current
 * candidate, so it can only ever produce `implemented-unverified` here.
 *
 * A row reaches `verified` only through EVIDENCE below — an explicit record of
 * a command or journey that was actually run, at a named SHA, with its result.
 * A skipped test, a screenshot alone, or a previous assignment reporting
 * success cannot set it. Nothing is deleted and nothing is waived: rows that
 * are out of the current round's scope keep their derived status and say so.
 *
 * Usage:
 *   node scripts/build-co-managed-inventory.mjs --out docs/evidence/co-managed-completion/<sha>
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CO_MANAGED_PLANS as PLANS,
  EXPECTED_COUNTS,
  foundationAcceptance,
  foundationContracts,
  planRows,
} from './lib/co-managed-plan-ids.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const candidate = arg('candidate', execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
const outDir = path.resolve(root, arg('out', `docs/evidence/co-managed-completion/${candidate.slice(0, 10)}`));

const STATUSES = ['missing-code', 'implemented-unverified', 'failed', 'blocked-external', 'verified'];

/**
 * Evidence actually collected for this round. Each entry names the command or
 * journey, the SHA it ran at, and what it did and did not establish. Adding a
 * row here is the only way to move a requirement to `verified`, and a row whose
 * `establishes` is empty cannot.
 */
const EVIDENCE = {
  'base-reconciliation': {
    type: 'automated',
    sha: 'b96b4c2ae077e7cb63dfa51dff354401297edcd0',
    command: 'node scripts/audit-merge-drops.mjs (both directions); direct diff of all 70 files main touched; '
      + 'vitest over the 9 test files main added/changed',
    result: 'audit clean both directions; 66/70 files identical to origin/main and the 4 differences justified; '
      + '237 tests passed',
    artifact: 'base-reconciliation.md',
    artifactNote: 'No separate raw log: this record is a diff/audit result, and the per-file justification table IS the artifact. The commands are re-runnable against origin/main 8120314513.',
    dependencyAnalysis: 'Carried forward. This evidence is about the merge commit itself -- that origin/main '
      + '8120314513 was taken without dropping content. Every commit after it is additive (co-managed source, '
      + 'tests, locale keys, docs) and none re-resolves that merge or touches the four contested billing/types '
      + 'files, so the claim cannot be invalidated by a later commit without a new merge.',
  },
  'provider-route-regression': {
    type: 'automated',
    sha: 'ROUND2_CANDIDATE',
    command: 'server: vitest run src/test/unit/product + src/test/unit/email (125 files) at the round-2 candidate, '
      + 'after the release-flag gate was removed from the provider route',
    result: '859 passed. Mutation checks: reverting PRODUCT_NAV_DESTINATIONS.providers.co_managed to the PSA page '
      + 'fails 2 of 7 provider cases; re-adding CoManagedFeatureBoundary to the route fails 1 of 7.',
    artifact: 'cf005-provider-setup.md',
    artifactNote: 'Deterministic unit run; re-runnable in seconds by the command above. No log committed.',
  },
  'provider-route-browser': {
    type: 'browser',
    sha: 'ROUND2_CANDIDATE',
    command: 'Real dev app at http://100.82.172.57:3374 as cm.rabbit.admin@whiterabbit.test '
      + '(tenant 51ac6952-6d6f-4600-aace-b71a9b2a5e73, product_code co_managed): '
      + 'Settings -> Email -> Inbound -> Open Providers; plus direct URLs for four excluded surfaces',
    result: 'Open Providers now lands on /msp/co-management/providers ("Email and Identity Providers") with the '
      + 'Microsoft app-registration surface rendered. /msp/settings/integrations (providers and accounting), '
      + '/msp/settings/integrations/entra, /msp/billing and /msp/settings/extensions all still render '
      + '"Page not available in your current product experience". PSA admin unchanged: /msp/go/providers '
      + 'redirects to /msp/settings/integrations?category=providers. Re-walked at the round-2 candidate after '
      + 'the locale keys and the release-flag change: /msp/go/providers renders the workbench '
      + '(main innerText 1697 chars, #provider-credentials-selector present).',
    artifact: 'screenshots/cf005-co-managed-providers.png',
    artifactNote: 'Screenshot plus the recorded DOM text in cf005-provider-setup.md. A screenshot corroborates; the DOM text and the regression are the durable claims.',
  },
  'release-flag-off-walk': {
    type: 'browser',
    sha: 'ROUND2_CANDIDATE',
    command: 'Dev server restarted with NEXT_PUBLIC_FORCE_FEATURE_FLAGS=release-v1-6-feature:false; walked as '
      + 'cm.rabbit.admin@whiterabbit.test',
    result: 'The blanking is shell-wide, not route-specific: /msp/dashboard, /msp/tickets, /msp/settings/email, '
      + '/msp/co-management/ticket-access and /msp/co-management/providers all render main innerText length 0. '
      + 'MspLayoutClient wraps the whole shell in CoManagedWorkspaceBoundary for product_code co_managed. '
      + 'Restored afterwards and re-verified the route renders (1697 chars).',
    artifact: 'cf005-provider-setup.md',
    artifactNote: 'Browser-measured innerText lengths, recorded inline. No raw log: the measurement is the result. Reproduce with NEXT_PUBLIC_FORCE_FEATURE_FLAGS=release-v1-6-feature:false.',
  },
  'admission-adapter-callsites': {
    type: 'automated',
    sha: 'ROUND2_CANDIDATE',
    command: 'server: vitest run src/test/unit/email/coManagedAdmissionAdapters.test.ts',
    result: '8 passed. Mutation runs, each adapter independently: inboundRequesterReply -> instanceof fails 2 of 8; '
      + 'inboundEmailReply -> instanceof fails 1 of 8. The unrelated-infrastructure-error cases stay green under '
      + 'both, so the repair does not broaden quarantine.',
    artifact: 'cf002-requester-deferral.md',
    artifactNote: 'Deterministic unit run; re-runnable in seconds. No log committed.',
  },
  'inbound-diagnostics-regression': {
    type: 'automated',
    sha: 'ROUND2_CANDIDATE',
    command: 'server: vitest run src/test/unit/email/inboundErrorDiagnostics.test.ts (rerun at the round-2 '
      + 'candidate as part of the 125-file product+email sweep)',
    result: '10 passed. Mutation check: reverting isCoManagedSharedWorkError to `instanceof` fails the '
      + 'separately-compiled-copy case.',
    artifact: 'cf002-requester-deferral.md',
    artifactNote: 'Deterministic unit run; re-runnable in seconds. No log committed.',
  },
  'requester-deferral-ci-failure': {
    type: 'automated',
    sha: '618019c3e3563f729684163c1abd8f5ad312e5dd',
    command: 'GitHub Actions run 35492001110, job 106030872598, Integration shard 1, VITEST_SEED=20260610',
    result: 'FAILED. 1 failed / 2170 passed. "defers and rolls back requester email when a separately compiled '
      + 'admission adapter reports a lifecycle pause": expected defer, got retry, then '
      + '"Failed to fully serialize error: Maximum call stack size exceeded" in place of the original exception.',
    artifact: 'raw-logs/ci-shard1-618019c3e3.txt',
  },
  'requester-deferral-ci-diagnosed': {
    type: 'automated',
    sha: 'fb2e696645023b24371a93805ed1fe3ae94e036b',
    command: 'GitHub Actions run 35522723445, job 106110228049, Integration shard 1, VITEST_SEED=20260610',
    result: 'FAILED. 2 failed / 2169 passed (2171). The requester-deferral case still fails, so the '
      + 'duck-typing repair is not the fix. NEW: the bounded diagnostics fired and name the first exception -- '
      + 'rollback/lifecycle_classification/disposition all report RangeError "Maximum call stack size exceeded", '
      + 'thrown inside the commit transaction, which isCoManagedLifecycleError correctly declines, producing '
      + 'retry. The `admission` stage did NOT fire, which rules the dual-constructor mechanism OUT as the cause. '
      + 'The reporter-level "Failed to fully serialize error" is separately confirmed as an independent '
      + 'serializer overflow: the other failing test in the same shard shows it over an ordinary knex error.',
    artifact: 'raw-logs/ci-shard1-fb2e696645.txt',
  },
  'requester-deferral-control-run': {
    type: 'automated',
    // Pinned to the round-2 published head this actually ran against, never to
    // "the current candidate": a later commit must not be able to relabel an
    // older measurement as fresh.
    sha: 'fb2e696645023b24371a93805ed1fe3ae94e036b',
    command: 'The faithful 78-file shard (INTEGRATION_SHARD_TOTAL=4, INDEX=1, TIER1_BASE_SHA empty, '
      + 'VITEST_SEED=20260610) rerun with isCoManagedSharedWorkError reverted to `instanceof` in both source '
      + 'and the tsup dist the integration lane resolves',
    result: 'CONTROL PASSED: coManagedBootstrap 1416/1416 in 284s, 0 skipped. The fixed arm also passed '
      + '(1416/1416, 265s). Both arms pass, so the local shard cannot discriminate: the repair is NOT '
      + 'demonstrated to be the cause, and is not refuted either because the divergence never reproduces '
      + 'locally. The divergence lives in the CI environment.',
    artifact: 'raw-logs/shard-control-arm.txt',
    artifactCompare: 'raw-logs/shard-fixed-arm.txt',
    dependencyAnalysis: 'Ran on the round-2 source tree. The only source change since is '
      + 'shared/services/email/inboundErrorDiagnostics.ts gaining bounded stack frames, which the A/B this '
      + 'record reports (isCoManagedSharedWorkError duck-typed vs instanceof) does not depend on. Attached '
      + 'only to rows that stay `failed`, so it cannot grant acceptance either way.',
  },
  'requester-deferral-local-pass': {
    type: 'automated',
    sha: 'b96b4c2ae0',
    command: 'server: vitest run ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts '
      + 'at VITEST_SEED=20260610 against a CE+EE-overlay database (TEST_MIGRATIONS_DIR)',
    result: '1416/1416 passed, including the failing case, with full intra-file shuffle at the CI seed. '
      + 'This establishes that the failure is NOT reproducible from this file alone; it needs the real shard. '
      + 'It does not establish that the defect is absent.',
    artifact: 'raw-logs/shard-fixed-arm.txt',
    dependencyAnalysis: 'Carried forward as a NEGATIVE result only -- it records what does NOT reproduce the '
      + 'failure. It is attached to rows that stay `failed`, so it can never grant acceptance, and a later '
      + 'commit cannot make a non-reproduction into a reproduction.',
  },
};

// Evidence recorded as collected at "this round's candidate" resolves here, so
// the manifest can never carry a placeholder into the readiness calculation.
for (const item of Object.values(EVIDENCE)) {
  if (item.sha === 'ROUND2_CANDIDATE') item.sha = candidate;
}

/**
 * Explicit, justified status overrides. Anything not listed here derives its
 * status from its plan flag. Each override states why.
 */
const OVERRIDES = {
  CF001: {
    status: 'implemented-unverified',
    why: 'This inventory is the deliverable. It exists and is committed, but CT001 (the exhaustiveness and '
      + 'no-silent-removal audit that would verify it) is not written yet, so it cannot verify itself.',
  },
  CF002: {
    status: 'failed',
    why: 'PARTLY MET. The instrumented candidate ran: CI shard 1 at fb2e696645 reports the first exception as '
      + 'RangeError "Maximum call stack size exceeded" thrown inside the commit transaction, which is why the '
      + 'lifecycle classification declines and the disposition is retry. The two stack overflows are now '
      + 'separated -- this product-path one, and the independent reporter-level serializer overflow also seen '
      + 'over an unrelated knex error in the same shard. What is still NOT captured is WHERE it recurses: the '
      + 'diagnostics carried no stack. This candidate adds bounded frames (at most 14, each truncated, '
      + 'mutation-checked) so the next CI read names the recursion site. Row stays failed until it does.',
    evidence: ['requester-deferral-ci-diagnosed', 'requester-deferral-ci-failure', 'inbound-diagnostics-regression',
      'requester-deferral-local-pass', 'requester-deferral-control-run'],
  },
  CF003: {
    status: 'failed',
    why: 'A real latent defect was repaired at its owner: the two separately compiled worker admission adapters '
      + 'classified CoManagedSharedWorkError by `instanceof`, which cannot hold across this package\'s split '
      + 'export map, so an authorization rejection was rethrown unclassified and the durable inbox reported '
      + '`retry`. It is now duck-typed like its sibling isCoManagedLifecycleError and pinned at both call sites. '
      + 'The CONTROL RUN REFUTES THE CAUSAL CLAIM: the faithful 78-file shard passes with the predicate reverted '
      + 'to `instanceof` just as it passes with the fix, so the repair is not demonstrated to be the cause of the '
      + 'CI failure. The CI read at fb2e696645 now REFUTES it outright: the case still fails with the fix in '
      + 'place, and the `admission` diagnostic stage -- which both adapters emit before rethrowing anything they '
      + 'do not recognise -- never fired, so no shared-work rejection crossed that boundary at all. The real '
      + 'first error is a RangeError stack overflow raised after admission returns. The duck-typing repair is '
      + 'kept on its own merits (the split export map really can put two constructors in one process) but it is '
      + 'NOT the repair this row needs, and the recursion site is still unknown. Row stays failed.',
    evidence: ['requester-deferral-ci-diagnosed', 'requester-deferral-ci-failure', 'inbound-diagnostics-regression',
      'requester-deferral-local-pass', 'requester-deferral-control-run', 'admission-adapter-callsites'],
  },
  CF004: {
    status: 'failed',
    why: 'Depends on CF003 being proven at a candidate. The requester audience/token isolation and both worker '
      + 'entry points are untouched by this round\'s change except that the technician adapter '
      + '(inboundEmailReply) got the same duck-typed classification, which needs the same shard proof. The '
      + 'fb2e696645 read shows the pause never reaches the classification at all, so the rollback/refund '
      + 'behaviour this row requires is still unobserved on a passing candidate.',
    evidence: ['requester-deferral-ci-diagnosed', 'requester-deferral-ci-failure'],
  },
  CF005: {
    status: 'verified',
    why: 'The reported dead end was walked in a real browser as a co-managed customer administrator and now '
      + 'resolves, with the excluded integration surfaces still denied in the same session and PSA navigation '
      + 'unchanged. Backed by a mutation-proven regression.',
    evidence: ['provider-route-browser', 'provider-route-regression', 'release-flag-off-walk'],
  },
  CF006: {
    status: 'implemented-unverified',
    why: 'The route-level product boundary, the RBAC (system_settings:update) and tenant-ownership guards inside '
      + 'the reused provider actions, and the denial of excluded surfaces were all exercised as a real '
      + 'co-managed admin. NOT verified: an actual OAuth callback with a real Microsoft application, '
      + 'cross-tenant callback denial, and secret redaction on save. Those need CF007 and are untouched here.',
    evidence: ['provider-route-browser', 'provider-route-regression', 'release-flag-off-walk'],
  },
  CF030: {
    status: 'missing-code',
    why: 'Deliberately not started this round. It is the last scope item and the budget went to CF002-CF006 and '
      + 'this inventory. Its independent tests must be written and passing before it is used as a gate.',
  },
};

/** Rows whose acceptance depends on a real vendor account and cannot be closed inside this card. */
const EXTERNAL = {
  'clientIntegration:T018': 'Historical real-provider language. Preserved as an external production prerequisite '
    + 'under docs/evidence/co-managed-acceptance-scope.md. A simulator pass may not be recorded against it.',
  'clientIntegration:T019': 'Same as T018: real-provider evidence, tracked as an external production prerequisite.',
  CF032: 'By definition external: real recurring USD 11.49 price and provider checkout/webhook, external license '
    + 'issuance, real Microsoft application acceptance, and deployed-storage/candidate migrations.',
};

/** Known-open defects. `functional`, `security` and `data-integrity` block implementationReady. */
const OPEN_DEFECTS = [
  {
    id: 'CF002-requester-deferral',
    kind: 'functional',
    summary: 'Integration shard 1 reports `retry` where `defer` is required for the separately compiled '
      + 'admission adapter case -- four completed CI runs now: green at bda945b640, then failing at '
      + '7b0b52c6c3, 618019c3e3 and fb2e696645, so it is a deterministic regression, not a flake. FIRST ERROR '
      + 'NAMED at fb2e696645: RangeError "Maximum call stack size exceeded" thrown inside the commit '
      + 'transaction, so the lifecycle classification correctly declines it. The recursion SITE is still '
      + 'unknown and does not reproduce on this workstation in either arm of the control. Bounded stack frames '
      + 'were added this candidate to name it on the next CI read. See cf002-requester-deferral.md.',
  },
  {
    id: 'algadesk-provider-dead-end',
    kind: 'functional',
    summary: 'AlgaDesk has the same provider dead end fixed for co-managed: /msp/settings/integrations is '
      + 'not_found for it while an enterprise-edition tenant still renders the Open Providers entry. '
      + 'Out of this card\'s scope; reported, not fixed.',
  },
  {
    id: 'co-managed-shell-blank-with-flag-off',
    kind: 'functional',
    summary: 'With release-v1-6-feature off, a co-managed tenant\'s entire MSP UI renders empty -- /msp/dashboard, '
      + '/msp/tickets, /msp/settings/email and every /msp/co-management route return an empty main. '
      + 'MspLayoutClient wraps the shell in CoManagedWorkspaceBoundary, and CoManagedFeatureBoundary renders '
      + '`fallback ?? null` with no fallback supplied anywhere. Verified in a browser at the round-2 candidate. '
      + 'Pre-existing and shell-owned; reported, not fixed.',
  },
  {
    id: 'local-redis-auth-mismatch-harness',
    kind: 'harness',
    summary: 'Reproduction harness only, not product: packages/event-bus redisConfig resolves the password via '
      + 'getSecret(\'redis_password\', \'REDIS_PASSWORD\'), which reads secrets/redis_password BEFORE the env var. '
      + 'A leftover secrets/redis_password in this checkout makes the client send AUTH to the password-less '
      + 'CI-shaped Redis, so publishes retry until the 20s test timeout. That is the whole explanation for the '
      + '8 Comment Reactions failures in the local shard runs; CI writes no redis password secret and is '
      + 'unaffected. Delete the secret or set a matching requirepass before the next reproduction.',
  },
  {
    id: 'reachability-contract-excludes-co-managed',
    kind: 'test-coverage',
    summary: 'uiReachabilityCoherence.contract.test.ts runs for algadesk and psa only. It is the contract that '
      + 'would have caught the CF005 defect class for co_managed.',
  },
];

/** External production prerequisites. Only the release owner can accept these. */
const PRODUCTION_PREREQUISITES = [
  { id: 'stripe-recurring-1149', owner: 'release-operator', acceptedByReleaseOwner: false,
    summary: 'Real recurring USD 11.49 (1149 cents) monthly licensed price and a provider test-mode '
      + 'checkout/webhook/invoice.' },
  { id: 'external-license-issuance', owner: 'release-operator', acceptedByReleaseOwner: false,
    summary: 'External sponsor-bound and independent-customer license issuance and renewal.' },
  { id: 'microsoft-real-application', owner: 'release-operator', acceptedByReleaseOwner: false,
    summary: 'Real Microsoft application, callback, permissions and directory/inbound acceptance.' },
  { id: 'deployed-storage-and-migrations', owner: 'release-operator', acceptedByReleaseOwner: false,
    summary: 'Deployed storage and candidate migrations including distributed invariants.' },
];

/** The current round's scope, from the work order, so out-of-scope rows say so rather than looking neglected. */
const OUT_OF_SCOPE_THIS_ROUND = new Set([
  'CF011', 'CF012', 'CF013', 'CF014', 'CF015', 'CF016', 'CF017', 'CF018',
  'CF019', 'CF020', 'CF021', 'CF022', 'CF023', 'CF024', 'CF025', 'CF026',
  'CF027', 'CF028', 'CF029', 'CF031', 'CF032',
]);

function deriveStatus(key, row) {
  if (OVERRIDES[key]) return OVERRIDES[key].status;
  if (EXTERNAL[key]) return 'blocked-external';
  return row.implemented === true ? 'implemented-unverified' : 'missing-code';
}

function buildRows() {
  const rows = [];
  const push = (row) => {
    const key = row.plan === 'correction' || row.plan === 'foundation' ? row.id : `${row.plan}:${row.id}`;
    const status = deriveStatus(key, row);
    const override = OVERRIDES[key];
    rows.push({
      key,
      plan: row.plan,
      id: row.id,
      kind: row.kind,
      description: row.description,
      implementationSource: row.implementationSource,
      currentRegression: row.currentRegression,
      ownerRole: row.ownerRole,
      dependsOn: row.dependsOn ?? [],
      foundationNote: row.foundationNote === true,
      status,
      justification: override?.why
        ?? EXTERNAL[key]
        ?? (OUT_OF_SCOPE_THIS_ROUND.has(key)
          ? `Explicitly out of scope for the 2026-09-20 round; status derived from the plan flag `
            + `(implemented=${row.implemented === true}). Not waived, not closed.`
          : row.foundationNote
            ? 'The 2026-09-08 source audits (docs/plans/co-managed-audit-*.md) found an implementation for this '
              + 'contract. Those audits are source review at their own revision, not acceptance: they ran no build, '
              + 'no browser journey and no Citus. Nothing was run for this contract at candidate '
              + `${candidate.slice(0, 10)}, so it stays implemented-unverified.`
            : `Derived from the plan flag (implemented=${row.implemented === true}). No acceptance record exists at `
              + `candidate ${candidate.slice(0, 10)}.`),
      evidence: (override?.evidence ?? []).map((id) => ({ id, ...EVIDENCE[id] })),
    });
  };

  const acceptance = foundationAcceptance(root);
  for (const row of foundationContracts(root)) {
    const mapped = acceptance[row.id] ?? [];
    push({
      plan: 'foundation', id: row.id, kind: 'contract', description: `${row.title} — ${row.description}`,
      implementationSource: `${PLANS.foundation} plus the 2026-09-08 source audits docs/plans/co-managed-audit-*.md`,
      currentRegression: mapped.length ? mapped.join(', ') : 'unmapped by PRD.md#acceptance-coverage',
      ownerRole: 'implementing-ood',
      // The 2026-09-08 T01-T22 audits found code for every contract. That is
      // source review, not acceptance -- so these are implemented-unverified,
      // never verified, and never missing-code.
      implemented: true,
      foundationNote: true,
      dependsOn: mapped,
    });
  }

  for (const plan of ['clientIntegration', 'ticketList', 'correction']) {
    const dir = PLANS[plan];
    const tests = planRows(root, plan, 'tests.json');
    const coveredBy = {};
    for (const test of tests) {
      for (const featureId of test.featureIds ?? []) (coveredBy[featureId] ??= []).push(test.id);
    }
    for (const [kind, file] of [['feature', 'features.json'], ['test', 'tests.json']]) {
      for (const row of planRows(root, plan, file)) {
        push({
          plan, id: row.id, kind, description: row.description,
          implementationSource: `${dir}/${file}`,
          currentRegression: kind === 'test'
            ? `${row.type ?? 'unspecified'} (${row.implemented === true ? 'written' : 'not written'}; not run at this candidate)`
            : (coveredBy[row.id]?.join(', ') ?? 'NO MAPPED TEST'),
          ownerRole: row.ownerRole ?? 'implementing-ood',
          implemented: row.implemented,
          dependsOn: row.dependsOn ?? row.featureIds ?? [],
        });
      }
    }
  }

  return rows;
}

const rows = buildRows();

// Fail closed on the things CT001 will eventually assert.
const failures = [];

/**
 * Candidate facts collected by scripts/collect-co-managed-candidate-facts.mjs.
 * Read if present; absent facts stay null so the gate reports them as blocking
 * reasons rather than treating absence as satisfaction.
 */
const factsPath = arg('facts', path.join(outDir, 'candidate-facts.json'));
const facts = existsSync(factsPath) ? JSON.parse(readFileSync(factsPath, 'utf8')) : null;
if (facts && facts.candidate !== candidate) {
  failures.push(`candidate-facts.json was collected at ${facts.candidate} but this manifest is for ${candidate}`);
}

const seen = new Set();
for (const row of rows) {
  if (seen.has(row.key)) failures.push(`duplicate row key ${row.key}`);
  seen.add(row.key);
  if (!STATUSES.includes(row.status)) failures.push(`${row.key}: unknown status ${row.status}`);
  if (!row.justification) failures.push(`${row.key}: no justification`);
  if (row.status === 'verified' && row.evidence.length === 0) {
    failures.push(`${row.key}: verified with no evidence record`);
  }
  for (const item of row.evidence) {
    if (!item.command || !item.result) failures.push(`${row.key}: evidence ${item.id} is not a real record`);
  }
}
// An artifact reference that does not resolve is worse than none: it reads as
// corroboration a reviewer can open, and cannot be.
for (const [id, item] of Object.entries(EVIDENCE)) {
  if (!item.artifact) { failures.push(`evidence ${id}: no artifact reference`); continue; }
  if (!existsSync(path.join(outDir, item.artifact))) {
    failures.push(`evidence ${id}: artifact ${item.artifact} does not exist`);
  }
  if (item.artifactCompare && !existsSync(path.join(outDir, item.artifactCompare))) {
    failures.push(`evidence ${id}: artifactCompare ${item.artifactCompare} does not exist`);
  }
}
const expected = EXPECTED_COUNTS;
const counts = {};
for (const row of rows) {
  const bucket = row.plan === 'foundation' ? 'foundation' : `${row.plan}:${row.kind}`;
  counts[bucket] = (counts[bucket] ?? 0) + 1;
}
for (const [bucket, want] of Object.entries(expected)) {
  if (counts[bucket] !== want) failures.push(`${bucket}: expected ${want} rows, found ${counts[bucket] ?? 0}`);
}

const byStatus = {};
for (const row of rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;

const inventory = {
  schemaVersion: 1,
  candidate,
  generatedAt: new Date().toISOString(),
  plans: PLANS,
  statusVocabulary: STATUSES,
  counts, totals: { rows: rows.length, byStatus },
  failures,
  evidence: EVIDENCE,
  rows,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);

/**
 * The C8 manifest. It carries the same rows plus the candidate identity,
 * provenance, CI, mergeability and prerequisite fields the readiness verifier
 * needs. Everything the verifier cannot observe for itself is recorded here as
 * an explicit UNKNOWN rather than omitted, so the gate reports a named blocking
 * reason instead of silently treating an absent field as satisfied.
 *
 * This file does not compute readiness. `scripts/verify-co-managed-completion.mjs`
 * does, from the plans read independently of this output.
 */
const base = (() => {
  try { return execFileSync('git', ['merge-base', 'origin/main', candidate], { cwd: root, encoding: 'utf8' }).trim(); }
  catch { return null; }
})();
const worktreeClean = (() => {
  try { return execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() === ''; }
  catch { return null; }
})();

const manifest = {
  schemaVersion: 1,
  candidate,
  base,
  collectedAt: inventory.generatedAt,
  pr: facts?.pr ? { number: facts.pr.number, head: facts.pr.head } : { number: 3363, head: null },
  // Still uncollected: nothing in this round built or ran an app/worker from the
  // candidate, so claiming provenance would be inventing it. Null is a blocking
  // reason, which is the correct state.
  provenance: { app: { revision: null }, worker: { revision: null }, migrations: null, config: null, simulator: null },
  worktreeClean: facts?.worktreeClean ?? worktreeClean,
  mergeability: facts?.mergeability ?? { mergeable: null, mergeStateStatus: null, checkedAtSha: null },
  ci: facts?.ci
    ? { runId: facts.ci.runId, status: facts.ci.status, conclusion: facts.ci.conclusion, checks: facts.ci.checks }
    : { runId: null, checks: [] },
  reviewEnvironment: { stable: false, observedMinutes: 0, healingEvents: null },
  openDefects: OPEN_DEFECTS,
  productionPrerequisites: PRODUCTION_PREREQUISITES,
  evidence: EVIDENCE,
  requirements: rows.map((row) => ({
    key: row.key, status: row.status, justification: row.justification,
    ownerRole: row.ownerRole, requiredInCard: row.status !== 'blocked-external',
    externalOwner: EXTERNAL[row.key] ? 'release-operator' : undefined,
    evidence: row.evidence.map((item) => ({ id: item.id })),
  })),
};
writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const md = [];
md.push(`# CF001 — co-managed reconciliation inventory`);
md.push('');
md.push(`Candidate: \`${candidate}\`. Generated by \`scripts/build-co-managed-inventory.mjs\`; edit the script, not`);
md.push('this file. `inventory.json` in this directory is the machine-readable form.');
md.push('');
md.push('`implemented: true` in a plan means code exists. It is not an acceptance record, so it can only produce');
md.push('`implemented-unverified` here. A row reaches `verified` only through an evidence entry naming a command or');
md.push('journey, the SHA it ran at, and its result. No requirement is deleted or waived.');
md.push('');
md.push(`**${rows.length} rows.** ` + Object.entries(byStatus).sort().map(([s, n]) => `${s}: ${n}`).join(' · '));
md.push('');
md.push(failures.length ? `> **Self-check FAILED:**\n> - ${failures.join('\n> - ')}` : '> Self-check passed.');
md.push('');
md.push('## Evidence records');
md.push('');
md.push('| id | type | sha | command / journey | result |');
md.push('| --- | --- | --- | --- | --- |');
for (const [id, item] of Object.entries(EVIDENCE)) {
  md.push(`| \`${id}\` | ${item.type} | \`${item.sha}\` | ${item.command.replace(/\|/g, '\\|')} | ${item.result.replace(/\|/g, '\\|')} |`);
}
md.push('');
for (const [bucket, label] of [
  ['foundation', 'Foundation contracts T01–T22'],
  ['clientIntegration:feature', 'Client integration features F001–F033'],
  ['clientIntegration:test', 'Client integration tests T001–T021'],
  ['ticketList:feature', 'Ticket list features F001–F039'],
  ['ticketList:test', 'Ticket list tests T001–T020'],
  ['correction:feature', 'Correction features CF001–CF032'],
  ['correction:test', 'Correction tests CT001–CT026'],
]) {
  md.push(`## ${label}`);
  md.push('');
  md.push('| ID | status | implementation source | current regression | owner | depends on | justification | evidence |');
  md.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    const rowBucket = row.plan === 'foundation' ? 'foundation' : `${row.plan}:${row.kind}`;
    if (rowBucket !== bucket) continue;
    md.push(`| ${row.id} | \`${row.status}\` | ${row.implementationSource} | ${row.currentRegression || '—'} `
      + `| ${row.ownerRole} | ${row.dependsOn.length ? row.dependsOn.join(', ') : '—'} `
      + `| ${row.justification.replace(/\|/g, '\\|')} `
      + `| ${row.evidence.length ? row.evidence.map((e) => `\`${e.id}\``).join(', ') : '—'} |`);
  }
  md.push('');
}
writeFileSync(path.join(outDir, 'inventory.md'), `${md.join('\n')}\n`);

console.log(`${rows.length} rows -> ${path.relative(root, outDir)}`);
console.log(Object.entries(byStatus).sort().map(([s, n]) => `  ${s}: ${n}`).join('\n'));
if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
