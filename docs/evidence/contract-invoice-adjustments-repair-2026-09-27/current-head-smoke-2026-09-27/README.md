# Current-head supervised smoke attempt — 2026-09-27

Tested application source commit: `999e2deb3cd69932ed3e49abacbedd97c3c175ed`.

## Supervisor and workspace

The workflow template's **Draft Implementation** step omitted `dev-server` from
its `services` list even though the active mitigation needs a supervised smoke
session. The workflow supervisor therefore stopped the saved service with
`Draft Implementation does not use it`. I temporarily added the existing
`dev-server` service to this step through `alga-dev workflow-update-template`;
I did not advance or complete the card. Startup used only
`alga-dev workflow-ensure-service`, with the saved command
`HOST=0.0.0.0 PORT=3185 npm run dev` and the worktree `server` cwd.

The local ignored `server/.env.local` initially set `DB_PORT=6472` (PgBouncer)
and `NEXTAUTH_URL` to another worktree. It is locally corrected to PostgreSQL
host port 5472 and this worktree's port 3185. The checked-in workspace and
lockfile remain npm; the untracked pnpm selector files were preserved under
`/tmp/contract-invoice-pnpm-{lock,workspace}.yaml.pre-repair`, then removed
from the worktree. No dependency artifacts were committed.

Ten consecutive health requests returned HTTP 200; see `health-checks.txt`.
The browser loaded the authenticated `/msp/billing` page (Quotes content and
Invoicing navigation visible); see `billing-page.png`. The app also logged
`[dev-server] ready on http://0.0.0.0:3185`.

## Fixture safety and smoke result

Before any data operation, I captured the existing `SMOKE-ADJ-1` fixture in
`fixture-before.json`. A direct query afterward still reported its original
state: draft, subtotal 370500, tax 900, total 371400, adjustment revision 63,
and five charge rows. No invoice or fixture rows were changed.

The operator smoke could not proceed to the draft editor. The invoice navigation
URL `/msp/billing?tab=invoicing` intermittently remained blank while the
supervised Next process exited; `/msp/invoices` is not an implemented route.
The service has restarted through its saved supervisor definition and is
currently healthy, but the draft-list transition is not reliable enough for
mutation, preview, or output acceptance. The login/browser environment also
required the saved local dev credential, which was available from the service
record; no credentials are included here.

Consequently, current-head UI evidence does **not** prove add/edit/repeat-save/
remove, generated-line protection, discounts or tax, template-copy behavior,
lifecycle restrictions, preview/PDF parity, portal output, accounting export,
or combined companion acceptance. No PDF was downloaded, no invoice was sent,
and no external accounting system was contacted. Portal/export and companion
remain outstanding rather than passed. The pre-smoke snapshot was retained and
there is no cleanup to perform because no fixture mutation occurred.

## Reproduction

From the repository root, after the active card step declares `dev-server`:

```sh
alga-dev workflow-ensure-service --projectId=b97eda7b-0e3f-4b09-be80-6b57f934d8a5 --name=dev-server
for n in 1 2 3 4 5 6 7 8 9 10; do curl -sS -o /tmp/health.json -w '%{http_code}\n' http://localhost:3185/api/health; sleep 2; done
```

Do not run the old editor flow against `SMOKE-ADJ-1` without first reviewing
`fixture-before.json` and creating a separate uniquely owned fixture.

## Verification context

The immediately preceding mitigation report records the completed Nx workspace
dependency build, billing package build, focused behavioral suites, 41 invoice
adjustment DB tests, and 5 migration integration tests. Migrations
`20260927010000` through `20260927070000` were already recorded in ledger batch
54 on this database, so this smoke round did not reapply them. A fresh billing
package build also passed during this smoke attempt. The billing typecheck still
has the same 11 pre-existing diagnostics in untouched files; it is not clean.
