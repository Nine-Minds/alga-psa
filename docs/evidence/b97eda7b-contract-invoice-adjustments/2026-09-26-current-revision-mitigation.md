# Contract invoice adjustments — current revision mitigation

Card: `b97eda7b-0e3f-4b09-be80-6b57f934d8a5`  
Run: 2026-09-26, approximately 19:29–19:35 America/New_York  
Worktree: `/home/robert/alga-copies/feature-contract-invoices-automatic-adjustments-and-disc`  
Host: `robert-X670E-Pro-RS` (`100.109.101.64`)  
Target URL: `http://localhost:3185`  
Starting revision: `4ec7f6f040c2feb6e7a44ab1750088c0fcf7ade3`

## Outcome

The board registration was restored, and the current-revision protected-history
database suite passed. Runtime verification is **incomplete**: the board
supervisor immediately suspends the registered PTY during Draft Implementation,
so port 3185 never becomes ready. No browser behavioral assertions, current
revision screenshots, fixture mutations, or PDF comparisons were made. This is
an environment/service-lifecycle mitigation failure; no new application defect
was reproduced.

## Service registration and readiness

- Before: the board listed `review-app` and `review-guide`, with no `dev-server`.
- Registered `dev-server` on this card at
  `/home/robert/alga-copies/feature-contract-invoices-automatic-adjustments-and-disc/server`
  with command `HOST=0.0.0.0 PORT=3185 npm run dev`.
- `workflow-ensure-service --name=dev-server` without `--command` returned the
  saved service definition successfully.
- The board event log then recorded: `Service "dev-server" suspended:
  "Draft Implementation" does not use it.` `workflow-list-services
  --live=true` omitted it and `ss` showed no listener on 3185. Re-ensure started
  the saved service record again, but it was suspended before HTTP readiness.
- `/api/health` on 3185: connection refused (HTTP 000). No source revision
  marker could be read from the process because no process remained listening.
- Existing review app `:23185` is historical context only and is not accepted as
  current-revision evidence.
- `server/.env.local` is ignored local configuration. Its `NEXTAUTH_URL` was
  changed from the stale review URL to `http://localhost:3185` for the target
  dev runtime; DB and Redis hosts/ports already targeted the local test stack.
  No secrets or local configuration were committed.

## Browser attempt

- Attempted card browser pane `d9f5edc2-3855-45de-aecf-f7b0310d1f73` at
  `http://localhost:3185/auth/msp/signin`.
- Actual result: `Session with given id not found`.
- Local Playwright/Chrome fallback was not run because 3185 was not serving an
  app. The historical routing failure remains, and no browser evidence is
  claimed for this revision.

## Database and migration preflight

- Confirmed listeners for the shared test stack ports: PgBouncer 6472,
  Postgres 5472, Redis 6419. The Postgres container is `licval_postgres`.
- The first status invocation without the local environment failed to connect to
  default `127.0.0.1:5432`; it did not modify schema.
- Re-ran `npm run migrate:ee:status` with `server/.env.local` loaded and
  `DB_PORT=5472`. Knex refused status because applied ledger entries lack these
  source files in this checkout:
  `20260917051554_add_external_link_portal_visibility.cjs`,
  `20260921000000_add_default_tax_rate_to_tenant_settings.cjs`,
  `20260922120000_contract_recurring_pricing_revision_policy.cjs`,
  `20260923000000_contract_recurring_pricing_history_attribution.cjs`, and
  `20260923010000_invoice_charge_details_recurring_pricing_provenance.cjs`.
- Direct read-only ledger inspection showed the three recurring-pricing entries
  applied. The current branch's four `20260924` migrations are not recorded as
  applied. No migration was applied and no migration ledger row was changed.
- Because migration history is corrupt for this checkout, no live shared-DB
  invoice/contract fixture was changed.

## Current-revision automated database verification

Command (from `server/`, with `.env.local` loaded and DB port 5472):

```sh
npx vitest run src/test/infrastructure/billing/contracts/contractLineProtectedHistory.test.ts --coverage.enabled=false
```

Result: **1 file passed, 4 tests passed** (2.40 seconds). The real-action DB
tests asserted protected billed service-period history, linked invoice/detail
relationships, rejection without persisted date/text changes, exact protected
boundaries, and safe or rejected bound clearing according to inherited contract
assignment dates. This suite does not cover a locked claim after invoice
cancellation and is not a live browser smoke. Vitest also reported loading the
repository `.env.localtest`; this result is scoped to the test harness database,
not a read/write assertion against the shared `server` database.

## Not rerun in this attempt

No browser flows for live description/date save/reload/restore; billed and
locked cancellation linkage UI flows; draft pagination and adjustment entry;
manual charge add/edit/reload/remove; automatic discount idempotency; customer
preview/PDF parity; recurring terms UI; client portal; or accounting export.
Historical evidence in `README.md` and
`/tmp/alga-smoke-evidence/contract-invoice-adjustments-20260926-2325/report.md`
remains historical and was not counted as current-revision proof.

## Reviewer first check

Resolve why the board supervisor suspends this durable service during the
current step, then run `workflow-ensure-service --name=dev-server` without a
command and verify `/api/health` plus the running checkout revision before
resuming the browser/database fixture smoke. Do not infer application behavior
from the healthy older review app.
