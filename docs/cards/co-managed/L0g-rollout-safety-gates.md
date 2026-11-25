# L0g — Rollout safety gates
Reviewer question: "If this PR ships, can CI stop an unsafe migration, an N-1 incompatible schema, a stale generated artifact or a hot-path query regression, without any flag or product code change?"
Base: main @ 8d7e656679   Reference: none (new work; nothing is ported from feature/co-managed-it)
Ticket: alga-2026-0002848   Design: docs/plans/2026-10-26-cm-l0g-plan.md

## 1. Scope paths (owned)
| Path (glob) | Kind | Notes |
|---|---|---|
| `scripts/ci/migration-lint.mjs` | test | CLI, exit 0 clean / 1 violation / 2 could not decide |
| `scripts/lib/migration-lint.mjs` | test | rule engine (the eight H section 5 rules) |
| `scripts/tests/migration-lint*.test.mjs` | test | table-driven fixtures, meta-test, 30-migration audit |
| `scripts/tests/fixtures/migration-lint/**` | fixture | one red and one green fixture per rule |
| `scripts/ci/artifact-drift.mjs` | test | git-status drift plus OpenAPI additivity |
| `scripts/ci/artifact-drift-allow.json` | test | deliberate OpenAPI breaks, each with a reason |
| `scripts/tests/artifact-drift.test.mjs` | test | |
| `scripts/ci/upgrade-order.mjs` | test | verified-main upgrade, current-main structural check, fresh candidate bootstrap |
| `scripts/ci/resolve-upgrade-base.mjs` | test | latest first-parent ancestor with a successful main push safety workflow |
| `scripts/ci/upgrade-order-smoke.json` | test | pinned release-tree suites |
| `scripts/lib/n1-schema.mjs` | test | structural N-1 assertions |
| `scripts/tests/n1-schema.test.mjs` | test | |
| `scripts/ci/attribute-card.mjs` | test | maps a failing path to the owning charter |
| `scripts/ci/resolve-base.mjs` | test | gate baseline: the PR merge ref's first parent, not the stale `pull_request.base.sha` |
| `scripts/tests/resolve-base.test.mjs` | test | |
| `server/src/test/contract/hotPathScenario.ts` | test | 16 canonical psa-tenant steps |
| `server/src/test/contract/hotPathQueryBudget.db.test.ts` | test | runner, UNSTABLE vs BUDGET EXCEEDED |
| `server/src/test/contract/hotPathQueryBudget.json` | fixture | snapshot; raising a number is a reviewed diff |
| `.github/workflows/ci-safety-gates.yml` | test | four jobs |
| `docs/cards/co-managed/L0g-rollout-safety-gates.md` | guide | this charter |
Shared files (hunk-level ownership): `package.json` (script entries only); generated artifacts under `sdk/docs/openapi/`, `server/src/lib/mcp/registry.generated.ts`, `ee/server/src/chat/registry/apiRegistry.generated.ts` (regenerated because main had drifted).
Existing migrations: comments only (`// migration-lint: allow ...`); no migration logic changed.

## 2. Reference pull
Not applicable: new work.

## 3. Out of scope
| Behaviour | Owner |
|---|---|
| Gate-coverage contract and write-admission coverage | L0a |
| Schema-absent neutrality | deferred |
| Census, verifier, renderer, ledger, evidence media | dropped (PLAN section 4) |

## 4. Flag gating points
None. No flag, no runtime or product code change.

## 5. Migrations
None added.

## 6. Acceptance bar
Automated (must be green at HEAD): `npm run test:migration-lint`; `node scripts/ci/migration-lint.mjs --last 30`; `node --test scripts/tests/artifact-drift.test.mjs scripts/tests/n1-schema.test.mjs`; `npm run generate:artifacts && npm run artifacts:check`; `node scripts/ci/upgrade-order.mjs`; `npm run budget:hot-path`.
Global gates: this card creates the migration-lint, artifact-drift, upgrade-order and hot-path-budget gates; later cards append to the budget `denylist` (exported as `NEW_TABLE_DENYLIST`).

The upgrade baseline is pinned before testing, using a successful `push` run of this
repository's safety workflow on `main`, restricted to first-parent ancestors of the
current PR base. The resolver examines the latest 100 successful runs and fails if
none qualifies or the API is unavailable. It never retries older baselines to make
a candidate pass. Migration lint and artifact drift still compare against the exact
current PR base. When that base differs from the verified baseline, its exact schema
and migration ledger are independently upgraded to the candidate and checked for
N-1 compatibility. The verified baseline retains its own migrations, helpers, seeds,
and application smoke tests. Fresh candidate migrations and seeds must also pass;
this catches broken candidate catalogs even when the old baseline seeds are valid.
This permits repair of an unbootstrappable main tip without changing historical code
or waiving a failing candidate check. CI evidence identifies a tested main baseline,
not proof of which commit is deployed in production.

## 9. Dependencies
Hard: none.   Soft: L0a.

## 10. LEVERAGE markers added/resolved
See `grep -rn "LEVERAGE:" scripts server/src/test/contract`.
