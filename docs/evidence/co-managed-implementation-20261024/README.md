# Co-managed isolation and completion-gate verification

This round preserves the approved implementation at `2632aaacb0` and adds a
PostgreSQL isolation regression and a correction to the completion tooling.
It does not establish whole-card implementation, human-review or production
readiness. The committed completion manifest is stale, the review runtime has
not been exercised, and PR #3363 still needs integration and current CI evidence.

## Source and scope

The execution host was `robert-Desktop-AMD-Ryzen-AI-Max-300-Series`, in
`/home/robert/alga-copies/feature-co-managed-it`, branch `feature/co-managed-it`.
The starting local, remote feature and PR heads were `2632aaacb0c1a54376e0071e1daca31a82b56cd9`.
The seven formerly unpublished commits remain ancestors. The host's configured
git identity was used without overrides.

The card description, annotations and approved Draft Implementation run
`54a7452c-e350-49ab-960e-1fa166ec23e8` were read through `alga-dev`. That run
delivered the implementation and multipart acceptance-gate repair, rather than
a new design requiring the feature to be built again. The foundation,
completion, client-integration, ticket-list and native-ticket-screen plans were
used to assess the existing implementation and the new tests.

## Changes

- **Isolation:**
  `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`
  adds “isolates sibling customers and MSP data when all three tickets have the
  same local identity.” It uses the existing migrated disposable PostgreSQL
  database, provisioning, customer acceptance, RBAC, staff assignments and real
  authorization/query services.
- **Completion tooling:** `scripts/lib/co-managed-plan-ids.mjs` includes the
  approved ticket-list amendments and native-ticket-screen plan. Its independent
  baseline now names all 260 required IDs. Missing, duplicate, substituted and
  unknown IDs fail validation, including a substitution that preserves row count.
  `scripts/build-co-managed-inventory.mjs` uses the same plan registry and records
  identity-validation failures.
- **Tooling regressions:** `scripts/tests/co-managed-plan-ids.test.mjs` adds six
  cases for the complete baseline, removed native-screen and foundation contracts,
  count-preserving replacement, duplicate IDs and unapproved additions. The
  repository's existing mandatory node-tooling lane discovers the new file.

## Isolation proof

The new test provisions two accepted customer workspaces under one MSP. It
creates a ticket in each customer and the MSP with the same ticket UUID and
number but different confidential titles.

Positive reads prove that each customer's own active administrator session
returns its own ticket. The MSP can read the first customer, cannot read the
second before assignment, then can read the second after a separate assignment.
Even that MSP cannot combine one customer's tenant with the other's relationship.

Each customer is denied the sibling's and MSP's ticket, and a forged relationship,
through the summary reader and both customer-local and sponsor-shared command
boundaries. Both read and update admission are checked. The forbidden callback
would write and return the foreign title if admitted; it never executes. Database
assertions confirm that all three titles remain unchanged.

This is a focused T06/CT025 isolation regression. It does not replace the entire
list/API/search/download/realtime/audience isolation matrix. The existing harness
stubs mail, events, storage and other external adapters; the new test uses real
PostgreSQL and real policy/query code, with no browser or live vendor claim.

## Validation

Commands run from the repository root unless a directory is stated. Raw outputs
and a [machine-readable command/result record](verification.json) accompany this
report. The [complete database run](raw-logs/bootstrap-full.txt),
[product run](raw-logs/product.txt) and [gate tests](raw-logs/gate-tests.txt)
retain their actual results. Terminal whitespace is normalized; the command
record preserves the original log hashes. No configured secret value was found
in the captured outputs.

| Command | Result |
| --- | --- |
| `cd packages/auth && npx vitest run src/lib/withAuth.coManagedAcceptance.test.ts` | PASS, 7 tests. |
| Load `scripts/dev/load-env-local.sh server/.env.local`, set `DB_NAME_SERVER=server_co_managed VITEST_SEED=20260610`, then `cd server && npx vitest run ../ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts -t 'isolates sibling customers and MSP data'` | PASS, new isolation test; 1,458 others intentionally unselected. |
| Same environment and runner, without `-t` | PASS, all 1,459 tests, no skips; 376.28 seconds. |
| `cd server && VITEST_SEED=20260610 npx vitest run src/test/unit/product ../packages/auth/src/lib/withAuth.coManagedAcceptance.test.ts` | PASS, 106 files, 803 tests. |
| `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit` in `server`, `ee/temporal-workflows`, `packages/auth`, and `packages/co-managed` | PASS in all four directories. |
| `node --test scripts/tests/co-managed-plan-ids.test.mjs scripts/tests/co-managed-completion.test.mjs` | PASS, 70 tests. |
| Temporarily restore count-only validation in a separate module and run the replacement-ID regression against it | Expected FAIL, exit 1. Temporary files removed; restored implementation passes. |
| `node --check scripts/lib/co-managed-plan-ids.mjs` and `node --check scripts/build-co-managed-inventory.mjs` | PASS. |
| `node scripts/build-co-managed-inventory.mjs --out /tmp/co-managed-implement-inventory` | Exit 1: 260 rows generated with no plan/identity failures; 26 referenced historical artifacts are unavailable in that temporary output. No readiness claimed. |
| `node scripts/verify-co-managed-completion.mjs` | Expected rejection, exit 1. All readiness predicates remain false. |
| `git diff --check` | PASS. |

The suite and typecheck commands ran on the starting revision plus this round's
source changes. The command record contains source hashes so these results can
be matched to the delivered files without relabeling historical evidence.

## Decisions and remaining work

- The approved draft's publication repair was already present. No replacement
  migrations, permissions, UI or server implementation were introduced. The
  new work verifies its isolation boundary and fixes completion tooling.
- The older completion baseline expected 39 ticket-list features and 20 tests;
  the approved amendment contains 49 and 26. The native-screen plan adds 37
  features and 14 tests. Their IDs are now mandatory. The design did not name
  their manifest namespace; `nativeTicketScreen:<ID>` follows the existing
  `clientIntegration:<ID>` and `ticketList:<ID>` convention.
- A matching row count was insufficient to enforce C8's removed-ID rule. The
  approved contiguous ID ranges are now checked independently of the plan files.
  No required IDs or evidence obligations were removed, and no statuses were
  promoted to verified.
- The committed historical manifest was not overwritten with generated evidence
  or present-day success claims. Its acceptance ledger must be reconciled for
  all 260 requirements before the card can meet its completion contract.
- App and worker startup, authenticated Open Review, the current-revision
  walkthroughs for all 14 guides, browser acceptance, PostgreSQL/Citus migration
  acceptance, both edition builds and complete CI remain separate outstanding
  acceptance work. This round follows the approved repair's instruction to leave
  services stopped. No production purchase, signed-license issuer or live Graph
  acceptance was performed.
- No merge with current main, workflow transition, approval or merge was
  attempted. The correction plan requires a separately authorized integration
  conflict-resolution order. PR readiness and board progression remain with the
  XO and captain. Existing untracked `docs/guides/` and `server/.next-review/`
  were preserved.

The next implementation/review owner should begin with the missing/stale
requirements reported by the completion verifier, then align the review app,
workers, fixtures, recordings and CI with the published candidate. A successful
bounded test run must not override those blockers.
