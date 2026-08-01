# Scratchpad — Re-materialize service periods when billing cadence changes

- Plan slug: `2026-06-22-billing-cadence-change-resync`
- Created: `2026-06-22`

## What This Is

Working memory for the cadence-change resync fix. Short bullets, append as we learn, update earlier notes when decisions change.

## Decisions

- (2026-06-22) Change-time behavior: **preview, then apply on confirm**. The cycle/anchor change shows an impact dialog and only writes after the user confirms.
- (2026-06-22) Trigger scope: **audit and unify all cadence paths** through one shared `applyClientCadenceChange` helper, so no write path can mutate cadence without re-materializing.
- (2026-06-22) Existing drift: **add a tenant-level "Repair all" sweep** so already-broken tenants self-heal. This also covers the IT initiative cleanup.
- (2026-06-22) Billed periods: **preserve billed, regenerate unbilled, warn** when billed periods fall in range. Never supersede or modify invoice-linked rows.
- (2026-06-22) Out of scope for now: collapsing the three cadence representations into one derived model (left as an Open Question); contract-cadence (`cadence_owner='contract'`) behavior, which already re-syncs.

## Discoveries / Constraints

- (2026-06-22) **Root-cause bug**: `updateBillingCycle` (`packages/billing/src/actions/billingCycleActions.ts:40`) updates only the `clients.billing_cycle` scalar. It does NOT call any re-materialization helper, so the RSP ledger goes stale.
- (2026-06-22) Other cadence paths DO re-materialize: contract/line edits via `syncRecurringServicePeriodsForContract*` (`recurringServicePeriodSync.ts:58,96`, wired into `contractActions`, `contractLineAction`, `contractWizardActions`, `billingClientsActions`, `contractLinePresetActions`); schedule/anchor actions via `regenerateClientCadenceServicePeriodsForScheduleChange` (`clientCadenceScheduleRegeneration.ts:413`, wired into `billingScheduleActions.ts:141`, `billingCycleAnchorActions.ts:148`).
- (2026-06-22) **Three sources of truth for cadence** that can drift: `clients.billing_cycle` scalar (drives materialization/repair via `getClientBillingCycleAnchor`, `shared/billingClients/billingSchedule.ts:40-75`); `client_billing_cycles` table (drives gap detection); `recurring_service_periods` ledger (the due-work record).
- (2026-06-22) **Gap detector**: `getAvailableRecurringDueWork` / `buildMaterializationGaps` (`packages/billing/src/actions/billingAndTax.ts:565-660`); a gap = an expected (client-cadence line x billing window) executionIdentityKey with no matching persisted RSP row (filter at `:1386`). Candidate windows come from `client_billing_cycles`.
- (2026-06-22) **Repair already works** and is the model to reuse: `repairMissingRecurringServicePeriods` -> `repairScheduleMaterialization` (`recurringServicePeriodActions.ts:1088, 734`). Client-cadence branch at `:841+` reads the CURRENT scalar via `getClientBillingCycleAnchor`, re-materializes via `materializeClientCadenceServicePeriods`, supersedes stale rows via `backfillRecurringServicePeriods` (`legacyBilledThroughEnd` protects billed history). `regenerationStart = max(obligation start, last billed boundary)`.
- (2026-06-22) Repair is **per-schedule** today (one obligation + charge family + due position). Repair-all must enumerate every stale schedule for the tenant and loop.
- (2026-06-22) Cadence model: `cadence_owner='client'` follows the client cycle and ignores the line's `billing_frequency` (`clientCadenceServicePeriods.ts:52`, `billingEngine.ts:2795-2830`). `cadence_owner='contract'` uses the line's own frequency, anchored to the contract (`billingEngine.ts:2779-2945`, `getContractCadenceDefinition` at `:2971`). Default is `'client'` (`shared/billingClients/recurringTiming.ts:34`).
- (2026-06-22) Billed protection hooks already exist: `recurring_service_periods` carries `invoice_id` / `invoice_charge_detail_id` and `lifecycle_state='billed'`; `backfillRecurringServicePeriods` accepts `legacyBilledThroughEnd`.
- (2026-06-22) No schema change expected — all tables/columns exist.

## Production Evidence (IT initiative)

- (2026-06-22) Tenant `4437fd51-50ef-4d3c-88a7-721da858cf4f` ("IT initiative", james@init.au). Test/self client `e8b23ae2-c93d-4779-a4e5-dcf27aadd542`.
- `clients.billing_cycle` = weekly (updated 2026-03-30), anchor day-of-week = 5 (Friday). `client_billing_cycles`: 4 monthly rows inactive + 14 weekly rows active.
- RSP rows stale monthly, materialized 2026-03-26 04:12 (auto regen, `run_key client-schedule-change`) BEFORE the weekly settings landed (04:20) and the scalar flipped (03-30). The weekly change came via a path that did not re-materialize.
- 0 invoices for the tenant, so all RSP regenerate cleanly. Real client (Maltec, monthly) is clean.

## Commands / Runbooks

- (2026-06-22) Read-only prod probe: `kubectl -n msp exec sebastian-blue-<pod> -c sebastian -- sh -lc 'cd /app && NODE_PATH=/app/node_modules node /tmp/x.cjs'`; `pg` client; password from `/run/secrets/db_password_server` (fallback env `DB_PASSWORD_SERVER`); Citus, queries scoped by `tenant` column.
- Integration tests: see `integration-testing` / `playwright-testing` skills for the DB bootstrap + tenant isolation pattern.

## Links / References

- Customer report + plain-language reply drafted in session (6th-grade level, house voice).
- Auto-memory: `it-initiative-tenant-billing.md`.

## Open Questions

- Make `client_billing_cycles` a pure projection of (scalar + anchor) to remove the third source of truth?
- Skippable impact dialog ("don't ask again") for power users?
- Run Repair-all automatically for drifted tenants (e.g. on billing-page load), or keep it manual?

## Implementation notes (2026-06-22)

- Engine: new `applyClientCadenceChange(trx, tenant, input)` (packages/billing/src/actions/applyClientCadenceChange.ts) delegates to shared `updateClientBillingSchedule` (scalar + anchor + client_billing_cycles windows + history bootstrap) then calls `regenerateClientCadenceServicePeriodsForScheduleChange` (re-materialize ledger; billed preserved). Single entry point for all cadence mutations.
- Routed through it: `updateBillingCycle` + `updateClientBillingSchedule` action (billingCycle/ScheduleActions) + `updateClientBillingCycleAnchor` (billingCycleAnchorActions). Contract/line paths already re-materialize via recurringServicePeriodSync.
- **PRIMARY UI path bug found+fixed:** the client Billing-tab editor (packages/clients ClientBillingSchedule.tsx) saves via billingHelpers `updateClientBillingScheduleAsync` → shared `updateClientBillingSchedule`, which did NOT re-materialize. Fixed by routing billingHelpers through `applyClientCadenceChange`. Required adding `@alga-psa/clients` → `@alga-psa/billing` dep (acyclic: billing never imports clients; the core→clients "edge" was only a code comment). applyClientCadenceChange exported from `@alga-psa/billing/actions` barrel for cross-package import.
- Preview: `previewClientCadenceScheduleChange` (regeneration module, read-only compute shared with regenerate) + `previewClientCadenceChange` action. Returns unbilled count, lines, regen start, billedPeriodsInRange, schedule keys.
- Repair-all: `repairAllClientCadenceServicePeriodsForTenant` (regeneration module) + `repairAllRecurringServicePeriodsForTenant` action (regenerate-permission gated). Idempotent (clean tenant = no changes).
- Recovery UX: AutomaticInvoices gap panel → plain-language copy + "Fix all" button (calls repair-all, refreshes via onGenerateSuccess). Backend gap `detail` string also plain-languaged (billingAndTax.ts).
- Typecheck: packages/billing exit 0, packages/clients exit 0 (NODE_OPTIONS max-old-space-size=8192 + nvm Node 22; default heap OOMs tsc).
- DEFERRED: cadence-change preview dialog in the editor (F022-F028) and Service-Periods-tab repair-all entry (F038). Core fix makes silent drift impossible regardless; dialog is preventive transparency.

## Final state (2026-06-22)

- Cadence-change preview dialog (F022-F028) DONE: editor `ClientBillingSchedule.tsx` Save is now two-step — first click calls `previewClientCadenceChangeAsync` (billingHelpers, read-only) and shows an impact panel (unbilled periods, lines, regen-from date, billed-preserved note); second click ("Confirm & save") applies. Editing the cadence invalidates a stale impact via a reset effect.
- Cross-package safety: `applyClientCadenceChange` and `clientCadenceScheduleRegeneration` are exposed as DEDICATED server-only subpath exports (`@alga-psa/billing/actions/applyClientCadenceChange`, `.../clientCadenceScheduleRegeneration`) and imported only by the `'use server'` billingHelpers — NOT added to the `@alga-psa/billing/actions` barrel, because many `'use client'` components import that barrel and the helpers pull knex/server code (barrel tree-shaking can't be relied on without a real build).
- Verification: `packages/billing` + `packages/clients` tsc --noEmit exit 0 (NODE_OPTIONS=--max-old-space-size=8192, nvm Node 22). Runnable wiring test `packages/billing/tests/cadenceResyncWiring.test.ts` green (8 cases). Existing `AutomaticInvoices.i18n.test.ts` + `recurringDueWorkReader.integration.test.ts` updated for new copy and pass. NOTE: `automaticInvoices.recurringDueWork.ui.test.tsx` fails to collect in isolated `npx vitest run` (pre-existing `createRequire is not a function` env issue in packages/db; fails the same way on pristine main — not caused by these changes).
- Status: 41/42 features (only F038, a secondary "Repair all" entry on the Service Periods tab, deferred — the AutomaticInvoices gap-panel "Fix all" already triggers tenant repair-all). Tests T011/T012/T013 automated (wiring); T001-T010/T014 are DB-behavior → recommend a live smoke on dev (dev DB mutation OK) since the integration harness needs a test Postgres + heavy mocks.
- SMOKE PLAN: on dev, set a test client monthly→weekly via the client Billing tab → confirm dialog shows impact → after save, recurring_service_periods rows are weekly + Automatic Invoices shows no gap. Then seed a drift (or use a stale tenant) → "Fix all" → gaps clear. Re-run "Fix all" → no-op.

## Live smoke validation (2026-06-22) — PASS ~95%

Wired this checkout in place against the running `alga-psa-local-test` infra (pgbouncer 6472 / redis 6419), ran the host dev server on :3255 (nvm Node 22), seeded a Cool Cars monthly Fixed client-cadence obligation, drove the UI with algadev as MSP Admin (glinda). Screenshots in scratchpad/smoke-shots/.

Scenario A (core fix) — ALL PASS:
- Editor Save is two-step: button shows "Review changes" → impact panel ("27 upcoming charge period(s) across 1 contract line(s) will be rebuilt … Rebuilt from 2026-04-01 onward.") → "Confirm & save" → toast. [A4-impact-panel.png]
- DB after apply: clients.billing_cycle=weekly; recurring_service_periods n=27, all 7-day spans, lifecycle generated. Cycle change re-materialized the ledger to weekly. (This is the exact bug class that stranded IT initiative — now fixed.)
- Automatic Invoices shows NO rebuild panel for Cool Cars (cycle+ledger agree).

Scenario B (Fix all recovery) — ALL PASS:
- Induced drift via SQL (scalar/cbc monthly, ledger weekly) → invoicing shows plain-language "These billing schedules need to be rebuilt" panel listing Cool Cars + "Fix all" button. [B9-rebuild-panel.png]
- Clicked Fix all → ledger rebuilt to monthly (n=6, 30-31d spans; 27 weekly rows superseded). [B10-fixall-result.png]
- After healing the panel/button are gone (idempotent no-op by absence).

Test-only issues found (NOT product bugs): (1) dev seed stores some user passwords as plaintext, incompatible with the PBKDF2 verifyPassword path — re-hashed glinda via the app's hashPassword to log in. (2) After an in-app schedule save, the invoicing rebuild panel briefly shows a stale client-side render until reload (data was correct throughout) — cosmetic cache-invalidation, candidate follow-up.

Not smoke-covered (lower priority, covered by code-reuse + wiring tests): billed-period preservation on a real invoice (T005), transactional atomicity rollback (T006), permission denials (T014).

Env left running: host dev server on :3255 wired to alga-psa-local-test; Cool Cars seeded (monthly, 6 periods); glinda has a working password + billing.recurring_service_periods perms.
