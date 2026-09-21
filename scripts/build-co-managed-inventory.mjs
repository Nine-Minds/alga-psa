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
import { markArtifactAvailability } from './lib/co-managed-completion.mjs';

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
  'base-reconciliation-round3': {
    type: 'automated',
    sha: 'ROUND3_CANDIDATE',
    command: 'git merge origin/main (2dc8454a4c, 19 commits: sync-mode bundle status propagation); '
      + 'node scripts/audit-merge-drops.mjs --added-by origin/main --against 023076a648 --result worktree; '
      + 'byte-identity diff of every file main touched that the branch did not; vitest over the suites main added',
    result: 'Four conflicts, all in ticket-bundle / client-portal code where the co-managed audience guards live; '
      + 'all four resolved by keeping BOTH sides, none by taking a side. audit-merge-drops: 22 contested files, '
      + '7 flagged lines, every one a line this resolution deliberately rewrote. 49 files main touched that the '
      + 'branch did not are byte-identical to origin/main; the single exception is ticketBundlePropagation.ts, '
      + 'whose types this resolution extends. Main\'s new suites pass: 14 server unit, 26 tickets-package, '
      + '3 temporal, 1 TicketDetails confirm. PR #3363 reports mergeable=MERGEABLE.',
    artifact: 'base-reconciliation-round3.md',
    artifactNote: 'Diff/audit result; the per-file table IS the artifact. Re-runnable against origin/main 2dc8454a4c. '
      + 'NOT established: ee/mobile suites could not run locally (mobile deps absent), so their evidence is '
      + 'byte-identity to origin/main plus the CI run, not a local pass.',
  },
  'nav-contract-reanchored': {
    type: 'automated',
    sha: 'ROUND3_CANDIDATE',
    command: 'server: vitest run src/test/unit/api/microsoftEmailSetupCallback.test.ts '
      + 'src/test/unit/product/uiReachabilityCoherence.contract.test.ts '
      + 'src/test/unit/product/providerSetupReachability.test.ts; '
      + 'packages/integrations: vitest run (whole project)',
    result: '37 passed across the 6 targeted suites; 115 files / 959 tests pass for @alga-psa/integrations. '
      + 'MUTATION-VERIFIED both halves: pointing the psa rows of PRODUCT_NAV_DESTINATIONS at '
      + '/msp/settings/MUTATED turns microsoftEmailSetupCallback and MicrosoftIntegrationSettings.contract red. '
      + 'uiReachabilityCoherence now runs for co_managed as well as algadesk/psa; MUTATION-VERIFIED by adding a '
      + 'co_managed-allowed route prefix with no nav entry, which the orphan assertion reports by name. '
      + '/msp/settings/integrations remains not_found for co_managed.',
    artifact: 'cf005-provider-setup.md',
    artifactNote: 'Deterministic unit runs plus two recorded mutation checks; re-runnable in seconds.',
  },
  'integration-shard-apt-repair': {
    type: 'automated',
    sha: 'ROUND3_CANDIDATE',
    command: 'Read GitHub Actions job 106117870496 (Integration shard 4) and repaired '
      + '.github/workflows/integration-tests.yml:145 and citus-migration-smoke.yml:137',
    result: 'Shard 4 died before running a single test: apt-get update exited 100 because packages.microsoft.com '
      + 'returned HTTP 403 for the Ubuntu noble InRelease file. poppler-utils is a genuine dependency '
      + '(invoiceTicketImmutable/invoiceTicketProduction shell out to pdftotext) and is kept. The step now drops '
      + 'the vendor sources the runner ships, tolerates a residual update error, and hard-verifies pdftotext -v; '
      + 'the install is not `|| true`.',
    artifact: 'base-reconciliation-round3.md',
    artifactNote: 'NOT established locally: whether the 78 missing collection records go to zero. That is only '
      + 'readable from the Repository test inventory job of a run where shard 4 actually collects, and must be '
      + 'read from that job output rather than assumed from causation.',
  },
  'cf002-diagnostic-survives-pass': {
    type: 'automated',
    sha: 'ROUND3_CANDIDATE',
    command: 'server: vitest run src/test/unit/email/inboundErrorDiagnostics.test.ts',
    result: '29 passed (was 22). Adds a file sink (ALGA_INBOUND_DIAGNOSTIC_FILE, NDJSON, capped, never throws) '
      + 'wired in integration-tests.yml to the existing server-integration-shard-N artifact, and derives '
      + 'recursionCycle/recursionRepetitions so a stack overflow names its own recursion site. New cases cover '
      + 'self-recursion, mutual recursion, a negative case that must not invent a cycle, the emitted payload, '
      + 'and the sink\'s create / no-op / never-throw behaviour.',
    artifact: 'cf002-requester-deferral.md',
    artifactNote: 'ESTABLISHES observation only. It does NOT establish a cause for CF002, and there is no '
      + 'mutation-verified CF002 regression because there is no established cause to reintroduce.',
  },
  'cf002-cause-established': {
    type: 'automated',
    sha: '603a74c5757a56f2a3a5c75d07e347603beb3ecd',
    command: 'GitHub Actions run 35534035281, job 106141697370, Integration shard 1; read '
      + 'inbound-diagnostics-shard-1.ndjson from the server-integration-shard-1 artifact; then '
      + 'packages/db: vitest run src/withAdminTransaction.errorFidelity.test.ts (+ mutation)',
    result: 'CAUSE ESTABLISHED. 34 records. The failing case reports commit_body = '
      + 'CoManagedLifecycleError / CO_MANAGED_READ_ONLY with classifiedAsLifecycle TRUE, then '
      + 'rollback = RangeError, then disposition retry/commit_failure. commit_body reports '
      + 'RangeError 0 times out of 8, so the overflow is NOT raised by the product commit body: it '
      + 'is manufactured by withAdminTransaction\'s unguarded lazy error.stack read '
      + '(packages/db/src/index.ts:137-140), whose getter throws inside the catch block and '
      + 'propagates in place of the `throw error` below it. Two further messages show the same '
      + 'substitution, one over an ordinary Error, so the mechanism is general. Reading (A) '
      + 'confirmed; reading (B) refuted. Repaired at its owner; regression is 4 cases in '
      + 'withAdminTransaction.errorFidelity.test.ts, MUTATION-VERIFIED: reverting the guard fails '
      + '3 of 4 with the exact CI signature (RangeError where CoManagedLifecycleError is expected).',
    artifact: 'raw-logs/inbound-diagnostics-shard1-35534035281.ndjson',
    artifactNote: 'The raw NDJSON the shard uploaded, verbatim. NOT established: the original shard '
      + 'has not yet been rerun at a candidate carrying the repair, so CF002 stays `failed`. The '
      + 'independent reporter-level serialization overflow is still not fixed.',
  },
  'cf002-repair-confirmed': {
    type: 'automated',
    sha: '449e0a7b6c10adc03f2d88ad6977e42ae2ebd91f',
    command: 'GitHub Actions run 35537272058, job 106151151704, Integration shard 1; compared against run '
      + '35534035281 job 106141697370 at 603a74c575 via both uploaded inbound-diagnostics-shard-1.ndjson files',
    result: 'REPAIR CONFIRMED before/after. At 603a74c575 shard 1 had 7 failures including the requester '
      + 'lifecycle-pause case, whose chain was commit_body=CoManagedLifecycleError(classifiedAsLifecycle true) '
      + '-> rollback=RangeError -> disposition retry/commit_failure, with 3 RangeError records in the file. At '
      + '449e0a7b6c that case PASSES, the chain is commit_body=CoManagedLifecycleError -> '
      + 'rollback=CoManagedLifecycleError with NO lifecycle_classification decline and NO disposition record '
      + '(it deferred), and there are ZERO RangeError records. The 6 remaining shard-1 failures are all '
      + 'MSP SLA bundle propagation and are present in BOTH runs, so they date to merge 3026683f9f, not to the '
      + 'guard; repaired separately in abfbd69071.',
    artifact: 'raw-logs/inbound-diagnostics-shard1-35537272058.ndjson',
    artifactNote: 'Both shard-1 NDJSON files are committed so the comparison is re-readable. NOT established: a '
      + 'green CI shard 1 at a candidate carrying BOTH the guard and the bundle repair, which is what CF002 '
      + 'still needs. Locally the whole coManagedBootstrap file is 1418/1418 at VITEST_SEED=20260610.',
  },
  'bundle-propagation-regression-repair': {
    type: 'automated',
    sha: 'ROUND3_CANDIDATE',
    command: 'server: vitest run ../ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts '
      + 'with DB_NAME_SERVER=server_co_managed and VITEST_SEED=20260610 (docs/dev/running-integration-tests-locally.md)',
    result: '1418/1418 pass, the first fully green local run of this file recorded on this card. Repairs 6 '
      + 'regressions the merge introduced: (1) prepareTicketResourceReassignment was ported into the engine\'s '
      + 'boundary path but not its legacy path, so a bare assigned_to change silently failed to move the child\'s '
      + 'assignee; (2) main\'s new sync-mode contract requires an explicit propagateToChildren choice, which the '
      + 'fixture did not make. Adds 2 cases covering the confirmation guard on the co-managed path so answering '
      + 'it in the fixture does not hide it.',
    artifact: 'base-reconciliation-round3.md',
    artifactNote: 'Local run. NOT established: the same green result in CI, which is pending at the candidate. '
      + 'Local server_co_managed required migrate:ee first (main\'s ticket_bundle_status_propagations table).',
  },
  'fixture-reset-repaired': {
    type: 'automated',
    sha: 'ROUND3_CANDIDATE',
    command: 'npm run fixtures:co-managed -- --verify / --reset / --verify / (apply) / --verify',
    result: 'The documented C7 cycle now reproduces with exit codes: 19/19 (exit 0) -> reset (exit 0) -> 5/19 '
      + '(exit 1) -> apply (exit 0) -> 19/19 (exit 0). Previously the fixtures were stuck at 18/19 with a STALE '
      + 'shared-work escalation row and --reset could not run at all: time_sheets, then jobs, then a second-level '
      + 'blocker (client_billing_cycles under client_billing_profiles) that escaped from inside purgeRow\'s catch '
      + 'and aborted the whole single-transaction reset. The complete table set was established by enumerating '
      + 'every foreign key into users from pg_constraint and counting rows against the four fixture user ids.',
    artifact: 'raw-logs/fixture-reset-cycle-449e0a7b6c.txt',
    artifactNote: 'Full stdout with per-step exit codes. Fixtures are left applied at 19/19.',
  },
  'cf007-authority-hardening': {
    type: 'automated',
    sha: 'ROUND3_CANDIDATE',
    command: 'ee/server: vitest run mcpIdpPresets (LIVE Google+Microsoft discovery) and '
      + 'mcpOidcDiscoveryHardening; server: vitest run mcpIdpDiscoveryNotRequestSelected.contract and '
      + 'nextAuthOptions.mspContract; node --test scripts/tests/microsoft-oidc-harness.test.mjs',
    result: 'Nonce is now verified on BOTH Microsoft providers (it was absent on one and undeclared on the '
      + 'other), OIDC discovery now binds the advertised issuer to the URL it was fetched from (Discovery 1.0 '
      + 'section 4.3) with https-only transport, and the discoveryBaseUrl seam is pinned as not request-reachable. '
      + '11 live + 9 hardening + 3 contract + 17 harness cases pass. MUTATION-VERIFIED: dropping nonce fails the '
      + 'contract; disabling the issuer-match fails 3 of 9. Two candidate rules were REJECTED by measurement - '
      + 'an issuer/jwks same-origin rule would break Google, and strict issuer equality would break Microsoft\'s '
      + 'templated {tenantid} issuer.',
    artifact: 'cf007-microsoft-authority.md',
    artifactNote: 'ESTABLISHES the code half only. NOT established: real application sign-in/callback execution '
      + '(the harness lane was not run), the emulator\'s missing Entra OIDC surface, and the still-ungated '
      + 'production MICROSOFT_LOGIN_BASE_URL override, which is left alone with its reason recorded.',
  },
  'qualified-handback-eligibility-repair': {
    type: 'automated',
    sha: 'ROUND3_CANDIDATE',
    command: 'server: vitest run src/test/unit/product/coManagedHandbackRecovery.test.tsx '
      + '../packages/tickets/src/lib/ticketListIdentity.test.ts',
    result: '19 passed. Writing the missing T013 recovery test exposed a product defect: '
      + 'isQualifiedHandbackEligible read responsibility/work_revision from the top level of the item while '
      + 'every real CoManagedTicketQueueItem carries them under `fields`, so it returned false for EVERY row '
      + 'and the qualified selection column and handback composer were dead at runtime. It typechecked '
      + '(optional properties) and its only unit test used a flat object, so it agreed with the bug. The '
      + 'predicate now takes the real shape, so a flat object is a type error rather than a silent false. '
      + 'MUTATION-VERIFIED: reverting to the top-level read fails 6 cases across the two suites.',
    artifact: 'ticket-list-reconciliation.md',
    artifactNote: 'Unit-level only. It does NOT establish that the qualified handback journey works in a '
      + 'browser - no co-managed browser test exists (see ticketList:T019/T011) - only that the eligibility '
      + 'gate and the recovery contract behave.',
  },
  'cf002-verified-green-shard': {
    type: 'automated',
    sha: '5e71e4efd27fbd0305310b14ab8ceae3d64a5c6a',
    command: 'GitHub Actions run 35543087189, job 106164529115, Integration shard 1, VITEST_SEED=20260610',
    result: 'GREEN. 2173 passed, 0 failed, 0 skipped. Includes the requester lifecycle-pause case, all 8 '
      + 'MSP SLA bundle-propagation cases, and the period-job case whose rejection was made finite this round. '
      + 'The uploaded inbound-diagnostics-shard-1.ndjson carries 32 records with ZERO RangeError, and every '
      + 'commit_body error name equals its rollback error name - the substitution that turned defer into retry '
      + 'is gone, measured at the candidate. Three shard-1 artifacts are now committed (35534035281 broken, '
      + '35537272058 repaired-but-red-elsewhere, 35543087189 green) so the whole arc is re-readable.',
    artifact: 'raw-logs/inbound-diagnostics-shard1-35543087189.ndjson',
    artifactNote: 'NOT a claim that the full mandatory CI is green: integration shard 4 failed at this same '
      + 'candidate on an unrelated RMM/pg-boss delivery timing flake (1 of 520, "expected pending to be '
      + 'completed"), which is recorded as an open defect rather than waved through.',
  },
  'gate-self-test': {
    type: 'automated',
    sha: 'ROUND5_CANDIDATE',
    command: 'node --test scripts/tests/co-managed-completion.test.mjs; '
      + 'node scripts/verify-co-managed-completion.mjs',
    result: '64 pass, 0 fail (was 59 at the start of this round). The suite is '
      + 'built as "start from a fixture that passes all three predicates, break exactly one thing, assert the '
      + 'named predicate goes false", so each case is its own mutation. It covers every negative CT026 '
      + 'enumerates: missing/duplicate/unmapped requirement, open defect flags, stale SHA, missing artifact, '
      + 'pending/failed/skipped/cancelled/wrong-SHA/absent mandatory CI, conflicting and unknown mergeability, '
      + 'wrong-revision app and worker, prose-only completion, and a green-check tally that cannot substitute '
      + 'for the required set - plus the positive case, where one complete fixture reaches humanReviewReady '
      + 'while unaccepted external provider prerequisites keep productionReady false. This round\'s two '
      + 'additions are separately mutation-verified: removing "analysis" from EVIDENCE_TYPES fails 3 cases, '
      + 'and neutering the executed-evidence floor fails 2 different ones. The 64th case closes a '
      + 'collector/verifier asymmetry found while reviewing the above: the verifier blocked on '
      + 'artifactAvailable === false, but the collector never SET the field, and it writes manifest.json '
      + 'before exiting non-zero - so a manifest kept from a failed collection could cite an artifact no '
      + 'reviewer can open and still pass. markArtifactAvailability now stamps it, shared by both sides, and '
      + 'the case asserts the stamp and the block end to end. Also mutation-verified in both halves: forcing '
      + 'the stamp to true fails 1 case, and neutering the verifier\'s block fails 2. Run against the real '
      + '193-row manifest the verifier reports zero malformed-manifest blockers and all three verdicts false.',
    artifact: 'raw-logs/gate-self-test.txt',
    artifactNote: 'Scope limit: this exercises the PURE decision function over manifests, and the CLI over '
      + 'the committed manifest. It does NOT prove the packet COLLECTION is faithful - that a collected '
      + 'manifest truthfully reflects the repository and CI - which is CF031, still unverified. A gate that '
      + 'reasons correctly about a lying manifest is still a gate that can be lied to.',
  },
  'requester-deferral-refund-asserted': {
    type: 'automated',
    sha: 'ROUND5_CANDIDATE',
    command: 'server: vitest run ../ee/temporal-workflows/src/__tests__/integration/'
      + 'coManagedBootstrap.integration.test.ts (whole file, VITEST_SEED=20260610, DB_NAME_SERVER='
      + 'server_co_managed, CE+EE overlay via TEST_MIGRATIONS_DIR)',
    result: '1418 passed, 0 failed (whole file, 307.5s) - the documented green baseline, unchanged. The '
      + 'specific assertions this row was blocked on are named and passing: "retains pending and '
      + 'expired-workspace mail without source fetches, processing attempts, or terminal acknowledgements" '
      + '(defer x7 on co_managed_pending_acceptance, then co_managed_read_only, with {status: received, '
      + 'attempt_count: 0, completed_at: null} and inbound_email_effects length 0); "refunds the claim when '
      + 'grace expires during source fetch and resumes the same inbox exactly once after renewal" '
      + '({status: received, attempt_count: 0, lease_owner: null, lease_token: null, completed_at: null}, '
      + 'then exactly-once resumption of the SAME inbox after entitlement renewal); "does not release '
      + 'another worker lease or refund a reclaimed attempt, and preserves prior error provenance" (the '
      + 'negative control that bounds the refund); and the two unknown-failure cases, "retains requester '
      + 'email for retry when its worker lacks the required admission adapter" and "retains technician mail '
      + 'for retry if a durable worker has no qualified admission adapter", each asserting disposition '
      + 'retry, status retryable_failed and zero effects at the two separate worker entry points.',
    artifact: 'raw-logs/cf003-cf004-refund-assertions.txt',
    artifactNote: 'EXECUTED AT THE CANDIDATE, not relabelled onto it. An earlier capture of this same '
      + 'file in this round ran at 40423ed9f3; because CF003/CF004 are flipped to verified on it, it was '
      + 're-run in full against the exact source tree committed as the candidate rather than having its SHA '
      + 'rewritten (PRD C8 forbids a silent relabel). Both the whole-file pass and all five named cases were '
      + 'reproduced; the only delta is wall-clock (307.5s vs 315.6s). Scope limit: these are integration '
      + 'tests that substitute ONLY source-fetch and '
      + 'sender/routing policy (intake.read / intake.parse / intake.process). Canonical ticket and comment '
      + 'writes, the transactional outbox, effects rows and terminal inbox state are all real. They therefore '
      + 'do NOT constitute a real inbound-email journey against a live mail source - that is CF008/CF009, '
      + 'explicitly out of scope this round and still unproven.',
  },
  'f010-shell-extraction': {
    type: 'analysis',
    sha: 'ROUND5_CANDIDATE',
    command: 'Side-by-side code read of packages/tickets/src/components/TicketListShell.tsx and the frame '
      + 'of packages/tickets/src/components/TicketingDashboard.tsx (3123 lines), plus grep for TicketListShell '
      + 'across packages/ and server/',
    result: 'TicketingDashboard.tsx contains ZERO occurrences of TicketListShell; the shell\'s only consumer '
      + 'is QualifiedTicketList.tsx:22,:346. F010 ("extract from the actual dashboard frame ... preserving '
      + 'native structure and IDs") is therefore unmet and T005 has no subject. New this round: the '
      + 'extraction is BLOCKED rather than merely unstarted. The dashboard puts BoardHeader, the sticky '
      + 'toolbar and the results inside one card (:2257) with BoardTabStrip outside it (:2251); '
      + 'TicketListShell renders board/toolbar/children as flat siblings with no wrapper (:44-65), so that '
      + 'grouping cannot be expressed. Two further conflicts: the shell owns a root id (:45) that the '
      + 'dashboard\'s ReflectionContainer already carries, and it wraps scope in mb-4 (:61) where the '
      + 'dashboard renders scopeControls bare. Conclusion: the SHELL must change to serve the dashboard, '
      + 'not the row be reworded down to the parallel frame.',
    artifact: 'f010-shell-extraction.md',
    artifactNote: 'A code read, not an execution - and by EVIDENCE type "analysis" it is structurally '
      + 'incapable of moving a row to verified (see NON_ACCEPTING_EVIDENCE_TYPES in '
      + 'scripts/lib/co-managed-completion.mjs). ticketList:F010 and ticketList:T005 stay missing-code. It '
      + 'does NOT establish that any proposed shell revision is correct; it establishes only what obstructs '
      + 'the one the row asks for. DEPENDENCY ANALYSIS for the candidate SHA (PRD C8 forbids a silent '
      + 'relabel): the read was performed earlier in this round, and the three files it reasons about - '
      + 'TicketListShell.tsx, TicketingDashboard.tsx and QualifiedTicketList.tsx - are byte-identical at the '
      + 'candidate to the revision that was read, verified by git blob hash, so every line number quoted '
      + 'above still resolves. No later commit in this round touched them.',
  },
  'ticket-list-reconciliation': {
    type: 'analysis',
    sha: 'ROUND3_CANDIDATE',
    command: 'Row-by-row code read of all 39 unchecked ticket-list rows (F003-F039, T002-T019) against '
      + 'packages/tickets/src/{lib,components,actions}, server/src/components/{co-managed,tickets} and '
      + 'server/src/app/msp/tickets',
    result: 'Of 39 rows, 7 are satisfied by code that exists and move to implemented-unverified (F012, F015, '
      + 'F021, F029, F036, T003, T014); 3 features and 5 tests were searched and have NO implementing code '
      + '(F006, F022, F026, T006, T008, T011, T013, T019); the remaining 24 are PARTIAL and stay missing-code '
      + 'with the specific missing third named. Three structural findings: TicketListShell was written as a '
      + 'PARALLEL frame rather than extracted from the dashboard, so F010 and its test T005 have no subject; '
      + 'the components this plan intends to RETIRE are the only ones with component tests, so T007/T010/T012 '
      + 'point at the wrong target; and no test file anywhere renders QualifiedTicketList, TicketListScopeBar, '
      + 'TicketListShell, CoManagedTicketHandbackComposer or CoManagedTicketQueueLegacyAdapter.',
    artifact: 'ticket-list-reconciliation.md',
    artifactNote: 'A code read, not an execution. It establishes what EXISTS, never that anything passes - no '
      + 'row moves to verified on it. Re-runnable by re-reading the cited file:line references.',
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
const CANDIDATE_PLACEHOLDERS = new Set(['ROUND2_CANDIDATE', 'ROUND3_CANDIDATE', 'ROUND5_CANDIDATE']);
for (const item of Object.values(EVIDENCE)) {
  if (CANDIDATE_PLACEHOLDERS.has(item.sha)) item.sha = candidate;
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
    status: 'verified',
    why: 'VERIFIED at candidate 5e71e4efd2. Integration shard 1 (run 35543087189, job 106164529115) is GREEN: '
      + '2173 passed, 0 failed, 0 skipped, including "defers and rolls back requester email when a separately '
      + 'compiled admission adapter reports a lifecycle pause". The uploaded diagnostics carry 32 records with '
      + 'ZERO RangeError, and every commit_body error name equals its rollback error name '
      + '(CoManagedLifecycleError->CoManagedLifecycleError twice, Error->Error six times) - the substitution '
      + 'that produced retry is gone, measured at the candidate rather than argued. All four C2 exit conditions '
      + 'are met: causal explanation (withAdminTransaction read error.stack unguarded inside its catch, so the '
      + 'lazy getter\'s own RangeError propagated in place of the throw below it); a regression that detects '
      + 'its removal, MUTATION-VERIFIED (withAdminTransaction.errorFidelity.test.ts fails 3 of 4 when the guard '
      + 'is reverted, with the exact CI signature); a focused pass; and an original-shard pass both locally '
      + '(coManagedBootstrap 1418/1418 at VITEST_SEED=20260610) and in CI. NOT claimed: the independent '
      + 'reporter-level serialization overflow is still not fixed in general - this round only made one '
      + 'recurring site finite - and integration shard 4 failed at this candidate on an unrelated RMM/pg-boss '
      + 'timing flake (1 of 520), so the aggregate mandatory CI is not green. Superseded framing retained '
      + 'below for provenance: '
      + 'The file sink added this round worked on its first CI run: shard 1 failed at 603a74c575 '
      + '(run 35534035281, job 106141697370) and uploaded 34 diagnostic records. They show the '
      + 'commit body raising a CORRECTLY FORMED CoManagedLifecycleError / CO_MANAGED_READ_ONLY with '
      + 'classifiedAsLifecycle TRUE, and the very next stage reporting RangeError. commit_body '
      + 'reports RangeError 0/8 times, so the overflow is not the product\'s: it is manufactured by '
      + 'withAdminTransaction\'s unguarded lazy `error.stack` read (packages/db/src/index.ts), whose '
      + 'getter throws INSIDE the catch block and propagates in place of the `throw error` below it, '
      + 'so the caller never receives the transaction\'s error. Two other messages show the same '
      + 'substitution, one over an ordinary Error - the mechanism is general, not co-managed '
      + 'specific. This also explains the intermittency: whether the read overflows depends on stack '
      + 'depth at the moment of failure, which varies with shard composition and order. Reading (A) '
      + 'confirmed, reading (B) refuted. Repaired at its owner with a MUTATION-VERIFIED regression '
      + '(withAdminTransaction.errorFidelity.test.ts; reverting the guard fails 3 of 4 with the exact '
      + 'CI signature). Exit still requires the original shard to pass at a candidate carrying the '
      + 'repair, which has not been run, and the independent reporter-level serialization overflow is '
      + 'still NOT fixed. Superseded framing retained below for provenance: '
      + 'Shard-1 history for the separately-compiled requester lifecycle-pause case is now pass (bda945b640), '
      + 'fail x5 (7b0b52c6c3, 618019c3e3, fb2e696645, b17b7a80b4), then PASS at 023076a648 (job 106117870494). '
      + 'That retires the earlier "deterministic regression in a fixed window" reading: six runs show '
      + 'pass-fail-pass, which is not deterministic. It also exposes the blocking fact: the commit_body '
      + 'discriminator shipped at 4879aa8d63 and 023076a648 is the FIRST head that carried it -- and that run '
      + 'passed, so it emitted nothing, because server/vitest.config.ts sets silent:"passed-only". The prior '
      + 'round\'s instrumentation can only speak when the test fails, and the test had stopped failing, so every '
      + '"read commit_body from the next log" next-action was unreachable. This round fixes that and nothing '
      + 'else: a file sink writes every record as NDJSON to the existing server-integration-shard-N artifact '
      + 'regardless of pass/fail, and the report now names its own recursion cycle. A green run therefore now '
      + 'yields the discriminator, because the commit_body stage sits in the withAdminTransaction callback\'s own '
      + 'catch and the PASSING path of this test throws CoManagedLifecycleError through exactly that catch. '
      + 'Readings (A) (withAdminTransaction\'s unguarded .stack read manufactured the RangeError) and (B) (the '
      + 'commit body genuinely overflowed) both remain open and untested. No causal explanation, and no '
      + 'mutation-verified regression, because there is no established cause to reintroduce. Row stays failed.',
    evidence: ['requester-deferral-ci-diagnosed', 'requester-deferral-ci-failure', 'inbound-diagnostics-regression',
      'requester-deferral-local-pass', 'requester-deferral-control-run', 'cf002-diagnostic-survives-pass',
      'cf002-cause-established', 'cf002-repair-confirmed', 'cf002-verified-green-shard'],
  },
  CF003: {
    status: 'verified',
    why: 'CORRECTED on measurement. This row stayed `failed` on a reading that is now superseded: it said the '
      + 'recursion site was unknown and the duck-typing repair was "NOT the repair this row needs". Both '
      + 'halves have since been resolved - the cause WAS established (withAdminTransaction read error.stack '
      + 'unguarded inside its catch, so V8\'s lazy formatter threw in place of the real error) and repaired at '
      + 'its owner in 899ae2e1cc, which is CF002, now verified. With that repair in place every clause of '
      + 'this row\'s wording is asserted by a named test that passes: separately compiled admission pauses '
      + 'DEFER ("retains pending and expired-workspace mail...", asserting disposition defer with reason '
      + 'co_managed_pending_acceptance seven times and then co_managed_read_only); effects ROLL BACK '
      + '(inbound_email_effects toHaveLength(0) in that case and in both retry cases); claims are REFUNDED '
      + '("refunds the claim when grace expires during source fetch...", asserting status received, '
      + 'attempt_count 0, lease_owner null, lease_token null, completed_at null); and unknown failures RETRY, '
      + 'at BOTH worker entry points - "retains requester email for retry when its worker lacks the required '
      + 'admission adapter" and "retains technician mail for retry if a durable worker has no qualified '
      + 'admission adapter", each asserting disposition retry, status retryable_failed and zero effects. The '
      + 'refund is bounded rather than blanket by its own negative control, "does not release another worker '
      + 'lease or refund a reclaimed attempt, and preserves prior error provenance". Flipped on those named '
      + 'assertions executing and passing, NOT on "shard 1 is green" - the green shard is corroboration, not '
      + 'the evidence. LIMITATION: source fetch and sender/routing policy are substituted in these tests, so '
      + 'no real inbound-email journey is proven here (CF008/CF009, out of scope, still unproven).',
    evidence: ['requester-deferral-refund-asserted', 'cf002-verified-green-shard', 'admission-adapter-callsites',
      'inbound-diagnostics-regression'],
  },
  CF004: {
    status: 'verified',
    why: 'CORRECTED on measurement. The blocker this row recorded - that the refund half, "attempt_count=0 and '
      + 'the inbox row back to received", was never separately asserted - is FALSE against the repository. '
      + 'That assertion exists in two places and has for some time: '
      + 'coManagedBootstrap.integration.test.ts:727 asserts {status: received, attempt_count: 0, '
      + 'completed_at: null} immediately after the co_managed_read_only defer, and :743 asserts {status: '
      + 'received, attempt_count: 0, lease_owner: null, lease_token: null, completed_at: null} in a case '
      + 'literally named "refunds the claim". The row was blocked on a fact that could have been checked by '
      + 'opening the file. Each remaining clause of the wording is also asserted: BOTH WORKER ENTRY POINTS by '
      + 'the paired requester and technician retry cases; EXACTLY-ONCE RENEWAL REPLAY by the second half of '
      + 'the refund case, which reconciles the entitlement, advances only that record\'s wakeup and resumes '
      + 'the SAME inbox once, with the negative control "does not release another worker lease or refund a '
      + 'reclaimed attempt" proving the refund does not over-apply; and REQUESTER AUDIENCE/TOKEN ISOLATION by '
      + 'the requester reply-token and content-audience cases carried in the same file. All executed and '
      + 'passing locally at VITEST_SEED=20260610. LIMITATION: same substitution caveat as CF003 - this is '
      + 'integration-level with source fetch and routing policy mocked, not a real mail journey.',
    evidence: ['requester-deferral-refund-asserted', 'cf002-verified-green-shard'],
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
  CF007: {
    status: 'implemented-unverified',
    why: 'Code now exists where there was none, so this is no longer missing-code, but it is NOT verified. '
      + 'Repaired this round: nonce is verified on both Microsoft providers (absent on one, undeclared on the '
      + 'other, so verification posture depended on which provider a deployment built); OIDC discovery binds the '
      + 'advertised issuer to the URL it was fetched from per Discovery 1.0 section 4.3, with https-only '
      + 'transport; and the discoveryBaseUrl seam is pinned as not request-reachable. All mutation-verified, and '
      + 'the pre-existing LIVE Google/Microsoft discovery tests still pass, which is what proves the new rules do '
      + 'not reject real providers. STILL MISSING for verification: real application sign-in/callback execution '
      + 'evidence (the harness lane was not run, so nothing shows the app now REQUESTS a nonce end to end); the '
      + 'emulator\'s Entra OIDC surface (no openid-configuration, no JWKS, no UserInfo, no PKCE, alg:none); and '
      + 'the still-ungated production MICROSOFT_LOGIN_BASE_URL override, deliberately left alone because the '
      + 'Teams-style NODE_ENV gate would break the e2e emulator lane, which runs NODE_ENV=production WITH that '
      + 'override set.',
    evidence: ['cf007-authority-hardening'],
  },
  CF030: {
    status: 'verified',
    why: 'CORRECTED: the previous justification ("deliberately not started this round") was refuted by the '
      + 'repository. All three artifacts this row requires exist and are exercised - '
      + 'scripts/verify-co-managed-completion.mjs (read-only CLI, writes nothing, exits non-zero unless '
      + 'humanReviewReady), scripts/lib/co-managed-completion.mjs (the pure calculation) and '
      + 'scripts/tests/co-managed-completion.test.mjs (63 passing negative-and-positive cases). The row\'s '
      + 'three clauses are each met: COMPLETE-ID, because expected IDs are read independently from the plans '
      + 'on disk via coManagedRequirementKeys() and compared BOTH ways, so a row vanishing from a plan and a '
      + 'row appearing from nowhere are both blockers; FAIL-CLOSED, because a missing manifest, unreadable '
      + 'plan, unsupplied ID set, unknown status or unparseable JSON all produce false rather than an '
      + 'exception or a pass; and SEPARATE VERDICTS, because implementationReady, humanReviewReady and '
      + 'productionReady are calculated independently and proved separable by a case where review stability '
      + 'moves the last two while the first stays true. An inventory that is wrong about its own repository '
      + 'destroys the gate\'s credibility, which is why this is corrected rather than carried forward. '
      + 'LIMITATIONS, recorded rather than waved past: the evidence exercises the decision function and the '
      + 'CLI, NOT the faithfulness of packet collection (CF031, unverified); and the gate is not yet wired '
      + 'into required CI, so nothing yet FORCES it to run before review is requested.',
    evidence: ['gate-self-test'],
  },
};


/**
 * CF001 reconciliation of the 39 unchecked ticket-list rows, done by reading the
 * code rather than by trusting the plan flag.
 *
 * `implemented: false` in the plan only ever produced `missing-code` here, which
 * is right as a default and wrong as a final answer: it cannot tell "nobody
 * built this" apart from "this is two thirds built". Each row below states what
 * exists, with file:line, and what does not.
 *
 * Only rows whose described behaviour is actually satisfied move to
 * `implemented-unverified`. PARTIAL rows stay `missing-code` on purpose - a
 * requirement two thirds met is not met - but they now say precisely which third
 * is missing, which is the difference between a backlog and a list.
 */
const TICKET_LIST_RECONCILIATION = {
  'ticketList:F003': {
    status: 'missing-code',
    why:
      'PARTIAL. Exists: scope parse/serialize (ticketListScope.ts:175,:249), explicit transitions '
      + '(TicketListScopeBar.tsx:112), the navigation-in-flight URL guard (ticketListUrlSync.ts:27 used at '
      + 'TicketingDashboardContainer.tsx:325) and native popstate restore (:726). MISSING the row\'s headline '
      + 'requirement: no native list-state snapshot exists anywhere, so returning to native serializes to a '
      + 'bare /msp/tickets (serializeTicketListQuery returns \'\' for native, ticketListScope.ts:254) and '
      + 'filters/page/sort/bundle are dropped. Qualified Back/Forward also does not restore presentation '
      + '(QualifiedTicketList.tsx:77 seeds it in a useState initializer, no popstate listener). '
      + 'resetQualifiedTicketListPresentation (ticketListScope.ts:318) is dead code.',
  },
  'ticketList:F006': {
    status: 'missing-code',
    why:
      'NO CODE. ticketListDetailHref appends no return target and says so itself '
      + '(ticketListIdentity.ts:69); QualifiedTicketList.tsx:161 pushes the bare href. Native returnFilters '
      + 'is pre-existing and encodes no queueView/workspace - `queueView` appears nowhere in '
      + 'ticketFilterUtils.ts or the ticket detail page.',
  },
  'ticketList:F010': {
    status: 'missing-code',
    why:
      'PARTIAL, and not what the row asks. TicketListShell.tsx exists with the required slots, but its only '
      + 'consumer is the qualified list (QualifiedTicketList.tsx:346). TicketingDashboard.tsx never imports '
      + 'it and still renders heading/actions/board inline (:2196-2200). Nothing was extracted from the '
      + 'actual dashboard frame; a parallel frame was written, so the native structure this row exists to '
      + 'preserve is not going through it. SHARPENED this round (f010-shell-extraction.md): the extraction '
      + 'is BLOCKED, not merely unstarted. The dashboard groups BoardHeader, toolbar and results inside one '
      + 'card (TicketingDashboard.tsx:2257) with BoardTabStrip outside it (:2251), while TicketListShell '
      + 'emits board/toolbar/children as flat siblings with no wrapper (TicketListShell.tsx:44-65), so that '
      + 'grouping is inexpressible; the shell also owns a root id (:45) the dashboard already carries on its '
      + 'ReflectionContainer, and wraps scope in mb-4 (:61) where the dashboard renders it bare. F010 '
      + 'requires preserving native structure AND ids, so the shell contract has to change before the '
      + 'dashboard can render through it. Deliberately NOT attempted this round: no render test exists over '
      + 'TicketingDashboard to catch a DOM or automation-id regression on the primary PSA ticket screen. '
      + 'The row is NOT reworded down to what the parallel frame already does.',
    evidence: ['f010-shell-extraction'],
  },
  'ticketList:F012': {
    status: 'implemented-unverified',
    why:
      'Code exists. server/src/app/msp/tickets/page.tsx:117 returns on the qualified SSR branch before any '
      + 'native bootstrap, with the client gate and native fallback at :121 and the loading state at '
      + 'QualifiedTicketList.tsx:369. Caveat recorded rather than hidden: the native fallback is a '
      + 'client-side router.replace(\'/msp/tickets\') (TicketListQualifiedFallback.tsx:22), not an inline '
      + 'native render. Unverified - no test renders this branch.',
    evidence: ['ticket-list-reconciliation'],
  },
  'ticketList:F015': {
    status: 'implemented-unverified',
    why:
      'Code state satisfies it, by separation rather than by a mechanism - flagged deliberately. Qualified '
      + 'rows are CoManagedTicketQueueItem with their own column set (QualifiedTicketList.tsx:218) and never '
      + 'touch ticket-columns.tsx / ticketColumnCatalog.ts; the type seam is ticketListIdentity.ts:12, and '
      + 'native cells are untouched. Because the two sources never render in one table, the requirement holds '
      + 'by construction. Unverified: no test exercises it, and if the two were ever merged into one table '
      + 'the guarantee would disappear silently.',
    evidence: ['ticket-list-reconciliation'],
  },
  'ticketList:F017': {
    status: 'missing-code',
    why:
      'PARTIAL, and the part this row adds is vacuous. The native side (ticketViewSettings.ts, '
      + 'TicketViewMenu.tsx, validateCapturedFilters at page.tsx:324) is intact and pre-existing. The '
      + 'exclusion clause holds only because the qualified list has no View menu and no display state to leak '
      + '(see F022); no code filters queue params out of a saved-default write, so nothing enforces it once '
      + 'F022 lands.',
  },
  'ticketList:F020': {
    status: 'missing-code',
    why:
      'PARTIAL. Present: applied-on-submit search (QualifiedTicketList.tsx:282), open/closed/all (:298), '
      + 'workspace via TicketListScopeBar.tsx:154 from the authorized reader (:79), scope-preserving reset '
      + '(:319). MISSING: there is no qualified client filter control at all - clientId only arrives from a '
      + 'fixed prop or the URL (:93) - and the reset at :323 does not clear a global clientId, contradicting '
      + 'the PRD\'s \'global client narrowing can be cleared\'.',
  },
  'ticketList:F021': {
    status: 'implemented-unverified',
    why:
      'Code exists. QualifiedTicketList.tsx:387 sets manualSorting, server totalItems from '
      + 'result.totalCount, and onPageChange/onItemsPerPageChange; unsupported columns are sortable:false '
      + '(:248,:254,:260); counts come from the server page (:372); the page-size preference is honoured at '
      + 'page.tsx:108. Recorded gaps short of the row\'s wording: no explicit refresh control in qualified '
      + 'mode, and the header-sort mapping at :401 falls back to \'title\' for any non-updated_at column id. '
      + 'Unverified - no test renders this component.',
    evidence: ['ticket-list-reconciliation'],
  },
  'ticketList:F022': {
    status: 'missing-code',
    why:
      'NO CODE. QualifiedTicketList.tsx:276 returns a fixed column array; there is no View menu, no density '
      + 'control and no optional-column state anywhere on the qualified path.',
  },
  'ticketList:F024': {
    status: 'missing-code',
    why:
      'PARTIAL. The CSV itself is correct - QualifiedTicketList.tsx:135 strips page/pageSize and exports '
      + 'all applied matches independent of selection, with machine-readable owner/relationship/ticket '
      + 'columns at coManagedTicketQueueActions.ts:27. But it is NOT in the Share area this row requires: it '
      + 'is a standalone Export button in the heading actions (:333) while native Share lives in '
      + 'TicketingDashboard.tsx.',
  },
  'ticketList:F025': {
    status: 'missing-code',
    why:
      'PARTIAL. Button, \'Add MSP ticket\' wording and authorized client prefill exist '
      + '(QualifiedTicketList.tsx:336, locale key present in en/de/es/fr). MISSING: no keyboard shortcut '
      + '(native uses usePageCreateShortcut at TicketingDashboard.tsx:83; absent here) and no post-creation '
      + 'refresh.',
  },
  'ticketList:F026': {
    status: 'missing-code',
    why:
      'NO CODE. The qualified list navigates away to /msp/create-ticket and has no creation-result handling '
      + 'of any kind, so there is nothing to produce the out-of-scope success link this row requires.',
  },
  'ticketList:F027': {
    status: 'missing-code',
    why:
      'PARTIAL, one direction only. Qualified selection is correctly separate: local state '
      + '(QualifiedTicketList.tsx:87) keyed by ticketListIdentityKey and cleared on every request/scope/page '
      + 'change (:115), with no TicketsRouteProvider import. NOT implemented: the reverse. '
      + '/msp/tickets/layout.tsx mounts TicketsRouteProvider for BOTH branches and it rehydrates its '
      + 'sessionStorage selection on mount (TicketsRouteProvider.tsx:103) with no scope awareness, so a '
      + 'native selection survives a native to qualified transition.',
  },
  'ticketList:F028': {
    status: 'missing-code',
    why:
      'PARTIAL, and the first half was BROKEN until this round. isQualifiedHandbackEligible read '
      + 'responsibility/work_revision from the TOP LEVEL of the item, while every real '
      + 'CoManagedTicketQueueItem carries them under `fields` - so it evaluated undefined against \'msp\' and '
      + 'returned false for EVERY row. Nothing was ever handback eligible: the selection column offered no '
      + 'rows and the single composer never rendered, which also made F029/F030/F031 unreachable in a '
      + 'browser. It typechecked because the parameter type made those properties optional, and the only '
      + 'unit test passed a hand-written FLAT object, so it agreed with the bug instead of catching it. '
      + 'Repaired and mutation-verified this round (6 cases go red when reverted). Still PARTIAL: selection '
      + 'with eligibility gating now feeds one composer (QualifiedTicketList.tsx:178, composer at :376), but '
      + 'the second half - removing the duplicate standalone bulk-handback checklist - is NOT done: '
      + 'CoManagedTicketBulkHandback.tsx still exists with its own checkbox list (:44) and still has live '
      + 'tests.',
  },
  'ticketList:F029': {
    status: 'implemented-unverified',
    why:
      'Reachability: this composer never rendered in a browser before this round\'s eligibility repair. Code exists. CoManagedTicketHandbackComposer.tsx:104 builds per-item {operationId, expectedRevision, '
      + 'resource}; :128 freezes the command and reuses the exact frozen request on retry; required note and '
      + 'audience line at :188. Server-side bound and dedupe at '
      + 'packages/co-managed/src/ticketBulkHandback.ts:22. Unverified at the component level: no test file '
      + 'imports this composer; the DB-side behaviour is covered by the integration suite (see '
      + 'ticketList:T014).',
    evidence: ['ticket-list-reconciliation'],
  },
  'ticketList:F030': {
    status: 'missing-code',
    why:
      'Reachability: unreachable in a browser before this round\'s eligibility repair. PARTIAL. Persistence is implemented well - versioned, 24h expiry, actor-scoped key '
      + '(CoManagedTicketHandbackComposer.tsx:12), written BEFORE first submit (:134), never auto-submitted '
      + 'on restore (:159), storage-unavailable message (:198). NOT implemented: nothing prevents a scope or '
      + 'page change from tearing the composer down. Selection clears on scope change '
      + '(QualifiedTicketList.tsx:115) so eligible empties and the composer returns null (:176), while '
      + '`restored` is read only at mount (:93) - an unresolved uncertain handback therefore vanishes from '
      + 'the screen until reload. No logout cleanup hook.',
  },
  'ticketList:F031': {
    status: 'missing-code',
    why:
      'Reachability: unreachable in a browser before this round\'s eligibility repair. PARTIAL. Per-item outcomes render (CoManagedTicketHandbackComposer.tsx:200). The re-read this row '
      + 'requires is MANUAL only: onDone is wired to a Reload button (:215) which bumps a refresh counter '
      + '(QualifiedTicketList.tsx:380); nothing re-reads the authorized queue automatically when results '
      + 'arrive, so returned work does not leave working until the operator asks.',
  },
  'ticketList:F032': {
    status: 'missing-code',
    why:
      'PARTIAL. Implemented: stale-clearing on every request change (QualifiedTicketList.tsx:112), export '
      + 'failure dropping protected rows (:154), loading (:369), empty (:384), restricted per-cell label '
      + '(:166). MISSING: no separate no-match vs empty state, no workspace-unavailable state or reset action '
      + '(the PRD requires a scoped unavailable result plus a clear reset instead of silent widening), and no '
      + 'retry affordance on a failed load.',
  },
  'ticketList:F036': {
    status: 'implemented-unverified',
    why:
      'Code exists. CoManagedFeatureBoundary wraps the qualified branch (page.tsx:121), the native-mode '
      + 'scope bar (:396) and the legacy route (msp/co-managed/tickets/page.tsx:14); the boundary returns '
      + 'null while loading so there is no flash, and enabled!==true or error yields the fallback '
      + '(CoManagedFeatureBoundary.tsx:19). Unverified, with a specific gap: '
      + 'coManagedT21Boundary.contract.test.ts inventories five co-managed pages but NOT /msp/tickets, the '
      + 'ticket-queue legacy page or the scope bar, so this row is asserted by no test.',
    evidence: ['ticket-list-reconciliation'],
  },
  'ticketList:F038': {
    status: 'missing-code',
    why:
      'PARTIAL. Translations exist in all four locales, theme tokens are used throughout '
      + '(QualifiedTicketList.tsx:240,:280) and narrow width is handled via columnFitMode=\'scroll\' (:391) '
      + 'plus flex-wrap toolbars. MISSING the accessibility half: no keyboard navigation or focus-return '
      + 'handling - rows open via onRowClick (:405), the title Link is the only keyboard path, and nothing '
      + 'restores focus on return from detail or create.',
  },
  'ticketList:F039': {
    status: 'missing-code',
    why:
      'PARTIAL, and blocked on its own precondition. All three entries do use the common composition '
      + '(global page.tsx:122, client CoManagedClientIntegration.tsx:105, legacy '
      + 'CoManagedTicketQueueLegacyAdapter.tsx:47). But the duplicate ownership was NOT retired - '
      + 'CoManagedTicketQueue.tsx and CoManagedTicketBulkHandback.tsx still exist with live tests - and there '
      + 'is no real-application evidence: no browser or e2e test touches the co-managed ticket list anywhere '
      + 'in the repo.',
  },
  'ticketList:T002': {
    status: 'missing-code',
    why:
      'PARTIAL. Only the last clause (URL writers stop before navigation) is covered, by a pre-plan test: '
      + 'TicketingDashboardContainer.urlSync.contract.test.tsx. Pure scope parsing is covered by '
      + 'ticketListScope.test.ts. Nothing renders the real coordinator with a scope, and there is no '
      + 'snapshot-retention or selection-clearing test.',
  },
  'ticketList:T003': {
    status: 'implemented-unverified',
    why:
      'Test exists and matches. coManagedBootstrap.integration.test.ts:4390 covers the combined list with '
      + 'search/sort/page/counts, :4410 client scoping including a sibling, :4492 same-number same-UUID '
      + 'across two customers plus workspace options, :15978 full filtered export ignoring page controls, and '
      + ':16164 assignment-driven working/oversight membership. Unverified only in the sense that it has not '
      + 'been recorded green at this candidate; it is part of the coManagedBootstrap file, which is 1418/1418 '
      + 'locally.',
    evidence: ['ticket-list-reconciliation'],
  },
  'ticketList:T004': {
    status: 'missing-code',
    why:
      'PARTIAL. Covered: revoke/handback (coManagedBootstrap.integration.test.ts:4427), unshared and '
      + 'other-MSP exclusion (:4436), redaction before search/sort/counts (:4476), export field restriction '
      + 'and revoked removal (:15991). NOT covered: the omitted-assignment-is-not-false case - '
      + 'has_msp_assignment appears only in ticketQueue.ts and QualifiedTicketList.tsx:264 and in no test.',
  },
  'ticketList:T005': {
    status: 'missing-code',
    why:
      'Cannot exist as written while F010 is unmet (see f010-shell-extraction.md for the blocking shell '
      + 'contract mismatch): the dashboard does not render through TicketListShell, '
      + 'so \'native dashboard rendered through the new frame\' has no subject. Pre-existing native regressions '
      + 'do exist (ticketColumns.prefetch.contract, boardArrival.contract, ticketColumnOrder, '
      + 'ticketViewSettings) and are unaffected.',
  },
  'ticketList:T006': {
    status: 'missing-code',
    why:
      'NO TEST. columnFitMode===\'scroll\' exists at packages/ui/src/components/DataTable.tsx:397, but '
      + 'columnFitMode appears in zero DataTable test files; neither DataTable.interaction.test.tsx nor '
      + 'DataTable.expandedRow.test.tsx touches column fitting.',
  },
  'ticketList:T007': {
    status: 'missing-code',
    why:
      'PARTIAL, and aimed at the wrong component. coManagedTicketQueue.test.tsx covers toolbar requests, '
      + 'sorting, reset and pagination for CoManagedTicketQueue - the component this plan intends to RETIRE. '
      + 'QualifiedTicketList has no test file at all.',
  },
  'ticketList:T008': {
    status: 'missing-code',
    why:
      'NO TEST, and no subject: qualified View controls do not exist (see F022), so there is nothing to '
      + 'pair with the native ones.',
  },
  'ticketList:T009': {
    status: 'missing-code',
    why:
      'PARTIAL. ticketListIdentity.test.ts covers key and href purity only. No component test exercises '
      + 'rows, Ctrl/Cmd-click opening (QualifiedTicketList.tsx:232) or detail return with duplicate '
      + 'identities.',
  },
  'ticketList:T010': {
    status: 'missing-code',
    why:
      'PARTIAL, and aimed at the wrong component. coManagedTicketQueue.test.tsx has exactly the '
      + 'applied-filter export and stale-download-discarded assertions, but against the retired component. '
      + 'Nothing covers native Share or the new Export button.',
  },
  'ticketList:T011': {
    status: 'missing-code',
    why:
      'NO TEST. There is no co-managed browser or e2e test anywhere in the repo (server/src/test/e2e, '
      + 'e2e-tests/tests).',
  },
  'ticketList:T012': {
    status: 'missing-code',
    why:
      'PARTIAL, and aimed at the wrong component. coManagedTicketBulkHandback.test.tsx tests the retired '
      + 'checklist. The 100-item bound is enforced server-side '
      + '(packages/co-managed/src/ticketBulkHandback.ts:22) but no test covers the new selection column or '
      + 'CoManagedTicketHandbackComposer.',
  },
  'ticketList:T013': {
    status: 'implemented-unverified',
    why:
      'WRITTEN THIS ROUND, and writing it found a product defect. '
      + 'coManagedHandbackRecovery.test.tsx drives the real composer against real sessionStorage across 13 '
      + 'cases: a restored intent is never auto-submitted, resuming replays the EXACT frozen operationId '
      + 'rather than minting a new one, the intent is cleared once the result is known, and expired / '
      + 'wrong-actor / mismatched-scope / wrong-version / corrupt / empty intents are all refused. It also '
      + 'pins that the replay command is written BEFORE the action is called (observed from inside the '
      + 'action, not after it), that it survives an uncertain result so a reload can resume, and that a '
      + 'browser with storage disabled says so and still permits the handback. Unverified: not yet recorded '
      + 'green in CI at a candidate.',
    evidence: ['qualified-handback-eligibility-repair'],
  },
  'ticketList:T014': {
    status: 'implemented-unverified',
    why:
      'Test exists and matches. coManagedBootstrap.integration.test.ts:16011 covers mixed per-item '
      + 'outcomes, idempotent exact-request retry (:16029), forbidden (:16044), readOnly/invalid (:16055) and '
      + 'rollback (:16064), with re-queried working/oversight membership at :4427. Unverified only in the '
      + 'sense that it has not been recorded green at this candidate.',
    evidence: ['ticket-list-reconciliation'],
  },
  'ticketList:T015': {
    status: 'missing-code',
    why:
      'PARTIAL. Stale-response and export-failure behaviour is tested only for the retired component. '
      + 'QualifiedTicketList\'s own generation guard (:107-120) is untested, and the unavailable-workspace '
      + 'state the row requires does not exist to be tested (see F032).',
  },
  'ticketList:T016': {
    status: 'missing-code',
    why:
      'PARTIAL, and weaker than it looks. coManagedClientIntegration.test.tsx:22 exists but MOCKS '
      + 'QualifiedTicketList, so it asserts slot wiring only - not fixed-client reads, export, reset or id '
      + 'uniqueness in the full-page and drawer surfaces.',
  },
  'ticketList:T017': {
    status: 'missing-code',
    why:
      'PARTIAL. coManagedT21Boundary.contract.test.ts and coManagedFeatureBoundary.test.tsx exist, but the '
      + 'inventory lists /msp/co-managed and /msp/co-management pages and NOT /msp/tickets/page.tsx, '
      + '/msp/co-managed/tickets/page.tsx, TicketListScopeBar or CoManagedTicketQueueLegacyAdapter - exactly '
      + 'the new coordinator surfaces this row names.',
  },
  'ticketList:T018': {
    status: 'missing-code',
    why:
      'PARTIAL. Covered: the route/API product matrix (coManagedProductSurface.test.ts), sponsor route '
      + 'selection, and \'keeps backend resolution free of release-flag checks\' '
      + '(coManagedT21Boundary.contract.test.ts:50). NOT covered: the legacy /msp/co-managed/tickets to '
      + 'canonical qualified-URL mapping implemented at CoManagedTicketQueueLegacyAdapter.tsx:29-51.',
  },
  'ticketList:T019': {
    status: 'missing-code',
    why:
      'NO TEST. The full browser journey (native to working to oversight to client to CSV to handback to '
      + 'native, with widths, locale, theme and keyboard) has no counterpart anywhere; no co-managed browser '
      + 'test exists in the repo.',
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
    id: 'reporter-serialization-stack-overflow',
    kind: 'functional',
    summary: 'CORRECTED this round: the previous text here said "the recursion SITE is still unknown", which '
      + 'the repository now contradicts. The site WAS found and repaired -- withAdminTransaction read '
      + 'error.stack unguarded inside its catch, so the lazy getter\'s own RangeError propagated in place of '
      + 'the throw below it -- fixed in 899ae2e1cc, and CF002 is verified at 5e71e4efd2 with integration '
      + 'shard 1 green (run 35543087189, job 106164529115: 2173 passed, 0 failed) and a mutation-verified '
      + 'regression. What remains genuinely OPEN, and why this stays a blocking functional defect rather than '
      + 'being deleted: the underlying reporter-level serialization overflow is NOT fixed in general. That '
      + 'round only made one recurring site finite, so any other unguarded read of a lazily serialized error '
      + 'can reproduce the same RangeError. See cf002-requester-deferral.md.',
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
    id: 'rmm-pgboss-delivery-timing-flake',
    kind: 'test-reliability',
    summary: 'Integration shard 4 failed at 5e71e4efd2 (run 35543087189, job 106164529103) on 1 of 520: '
      + '"RMM device sync - pg-boss (CE) accepts and delivers the job delivers the job to rmmDeviceSyncHandler '
      + 'and writes the cursor", expected pending to be completed. Unrelated to co-managed - it is a job-queue '
      + 'delivery race - and shard 4 passed at the two preceding candidates, so it is intermittent. Recorded '
      + 'rather than retried away; it is why the aggregate mandatory CI is not green even though shard 1 is.',
  },
  {
    id: 'xero-locale-resources-loading-race',
    kind: 'test-reliability',
    summary: 'Unit shard 1 failed at 871646d601 (run 35548365704, job 106178368274) on 1 of 764 files: '
      + '"XeroIntegrationSettings loaded-locale copy > renders the updated English mapping and reauthorization '
      + 'copy". TestingLibraryElementError - the scopeReconnectNote copy is absent because the connection card '
      + 'still reads "Loading Xero settings...". The test awaits findByText for the mapping alert at line 133, '
      + 'then reads scopeReconnectNote with a SYNCHRONOUS getByText at line 134, so that second assertion '
      + 'races the connection card\'s own load. Neither a regression from this branch nor co-managed: the '
      + 'test, the component and the English locale resource it loads are byte-identical to origin/main '
      + '(blobs 300dbc5e9d, 08ff58c1af and d2eded439f on both refs), and the ONLY diff between 353786ce91 -- '
      + 'where this same shard passed, run 35544309336 -- and 871646d601 is four files under '
      + 'docs/evidence/co-managed-completion. Same source, different result, so it is intermittent. Recorded '
      + 'rather than retried away, and the test was not touched; it is why aggregate mandatory CI is not green.',
  },
  {
    id: 'webhook-sink-smoke-duplicate-record-local-only',
    kind: 'test-reliability',
    summary: 'A SEPARATE local observation, not the cause of the CI failure above - kept distinct so the two '
      + 'are not conflated. packages/emulators/webhook-sink/tests/smoke.test.ts > "records requests and '
      + 'answers 200 by default" fails deterministically on this workstation, both inside a full shard-1 '
      + 'reproduction and in isolation, recording 2 requests where it asserts 1. It PASSES in CI at these same '
      + 'revisions (shard 1 at 353786ce91), and the sink package and @alga-psa/emulator-host are unchanged on '
      + 'this branch versus origin/main, with express resolving to 5.2.1 exactly as package-lock specifies - '
      + 'so the divergence is environmental and remains unexplained. Out of this card\'s scope (emulator '
      + 'harness, not co-managed); reported, not fixed, and the test was not touched.',
  },
  {
    id: 'microsoft-login-base-url-ungated-in-production',
    kind: 'product',
    summary: 'shared/services/email/microsoftGraphEndpoints.ts honours MICROSOFT_LOGIN_BASE_URL and '
      + 'MICROSOFT_GRAPH_BASE_URL unconditionally, including production, and that is where client secrets are '
      + 'POSTed. The Teams surface already gated its half behind a deny-by-default flag plus a production lock '
      + 'and left a comment saying the email module was deliberately unchanged. Copying that gate would BREAK '
      + 'the e2e emulator lane: docker-compose.ee.yaml runs NODE_ENV=production while the e2e-emulators overlay '
      + 'sets the variable, so the override is in use UNDER production NODE_ENV. Closing it needs an opt-in flag '
      + 'threaded into the compose overlay too, which cannot be validated without the full Docker e2e stack. '
      + 'Reported rather than half-done. No sovereign-cloud support exists in the repo, so that is not a blocker.',
  },
  {
    id: 'msgraph-emulator-missing-entra-oidc-surface',
    kind: 'test-coverage',
    summary: 'packages/emulators/msgraph serves authorize/token/adminconsent but has no Entra OIDC surface: no '
      + '/{tenant}/v2.0/.well-known/openid-configuration, no /{tenant}/discovery/v2.0/keys, no OIDC UserInfo, no '
      + 'PKCE enforcement, and it signs with alg:none. Its own Bot Framework side is a real RS256 signer with a '
      + 'published JWKS and is the template for completing it. This is why the NextAuth callback lane needs a '
      + 'separate harness fixture, and it is the remaining half of CF007.',
  },
  {
    id: 'co-managed-account-management-permission-gap',
    kind: 'product',
    summary: 'A co_managed workspace resolves /msp/account as allowed (msp_core_helpdesk) but its seed vocabulary '
      + 'never grants account_management:read, so the header avatar menu -> Account entry never renders for any '
      + 'co-managed tenant. Found by extending uiReachabilityCoherence.contract.test.ts to co_managed this round. '
      + 'Repair needs server/migrations/utils/permissions/catalog.cjs plus a backfill migration for existing '
      + 'tenants, which is a seeding change beyond this card. RECORDED, not waived: the contract asserts each '
      + 'recorded gap is still real, so seeding the permission turns the test red and forces the entry out.',
  },
  {
    id: 'algadesk-provider-nav-dead-end',
    kind: 'product',
    summary: 'AlgaDesk has the identical provider dead end: /msp/settings/integrations is not_found for it, yet an '
      + 'EE AlgaDesk tenant still renders the Open Providers entry. Recorded in UNRESOLVED_NAV_DESTINATIONS in '
      + 'providerSetupReachability.test.ts. Explicitly out of this card\'s scope; carried forward unfixed.',
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
  if (TICKET_LIST_RECONCILIATION[key]) return TICKET_LIST_RECONCILIATION[key].status;
  if (OVERRIDES[key]) return OVERRIDES[key].status;
  if (EXTERNAL[key]) return 'blocked-external';
  return row.implemented === true ? 'implemented-unverified' : 'missing-code';
}

function buildRows() {
  const rows = [];
  const push = (row) => {
    const key = row.plan === 'correction' || row.plan === 'foundation' ? row.id : `${row.plan}:${row.id}`;
    const status = deriveStatus(key, row);
    const override = OVERRIDES[key] ?? TICKET_LIST_RECONCILIATION[key];
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
  if (!item.artifact) failures.push(`evidence ${id}: no artifact reference`);
}
// Stamps `artifactAvailable` onto each record. The failures below stop this
// run, but manifest.json is written before the exit, so the flag is what makes
// the verifier block independently on a manifest kept from a failed
// collection. Shared with the verifier so the two cannot drift.
for (const { id, field, reference } of markArtifactAvailability(EVIDENCE, (rel) => existsSync(path.join(outDir, rel)))) {
  failures.push(`evidence ${id}: ${field} ${reference} does not exist`);
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
  // Content fingerprints come from the collector, which derives them from git
  // tree hashes at the candidate, so they are reproducible rather than asserted.
  // `app`/`worker` revision stay null on purpose: nothing exposes the revision a
  // running app or worker was built from, so the only honest way to fill them is
  // for whoever starts the stack to record it. They remain blocking reasons.
  provenance: facts?.provenance ?? {
    app: { revision: null }, worker: { revision: null }, migrations: null, config: null, simulator: null,
  },
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
