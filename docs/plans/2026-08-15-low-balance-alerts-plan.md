# Low-balance alerts for prepaid credit and bucket hours

**Branch:** `feature/low-balance-alerts-for-prepaid-credit-and-bucket`

**Date:** 2026-08-15

**Status:** Design complete; implementation not started

**Source task:** 29.8.20

**ALGA plan:** `ee/docs/plans/2026-08-15-low-balance-alerts/`

## Outcome

Add a fully `release-v1-5-feature`-gated, per-client policy that warns the assigned account manager and optionally the client billing recipient before prepaid credit or a current bucket is exhausted. The existing daily 09:00 UTC maintenance paths initiate the scan: CE schedules a tenant job and EE reuses the global maintenance schedule plus its per-tenant fanout. The server evaluates canonical ledgers, persists one logical alert per dedupe subject, and routes preference-aware internal/email deliveries through durable leased rows and the existing event-email retry/idempotency path.

The implementation must preserve two intentionally different boundaries:

- Credit is low only when `available < threshold`; equality resolves and rearms the episode.
- A bucket has reached its limit when `minutes_used * 100 >= configured_percent * (total_minutes + rolled_over_minutes)`; equality alerts.

No product code is part of this design commit. `features.json` and `tests.json` start with every `implemented` value set to `false`.

## Settled behavior

### Policy and UI

- Policy scope is one client: one positive minor-unit credit floor paired with one ISO currency and/or one integer bucket percentage from 1 through 100.
- The card is in Billing > General, after Credit Expiration Settings and before External Credit Settings.
- Account-manager routing is required whenever an active assigned manager can be resolved. Client email is a separate, default-off opt-in to the canonical invoice billing recipient.
- Saving only persists policy; it never evaluates or sends immediately. The card says the next check is the daily 09:00 UTC scan.
- The component, read action, update action, and subscriber independently gate on `release-v1-5-feature` with a false default. Loading, missing, disabled, or throwing flag infrastructure is inert.

### Credit subjects

- Sum only non-expired `credit_tracking.remaining_amount` for the configured client/currency, following `packages/billing/src/lib/creditBalance.ts`.
- Do not mix or convert currencies.
- Require at least one historical row for that client/currency before zero can alert. A once-funded, now-consumed zero balance is eligible.
- One below-threshold episode remains deduplicated until the balance reaches the floor or rises above it. A later drop is a new episode.
- A threshold or currency change resolves the old episode as `policy_changed` before evaluating the new policy.

### Bucket subjects

- Resolve ownership only through `client_contracts -> contracts -> contract_lines`; select service configurations whose `configuration_type='Bucket'`.
- Evaluate the current `bucket_usage` period using the same inclusive period convention as reconciliation/charge calculation.
- Capacity is base plus rollover; usage is not clamped at 100 percent. Non-positive capacity is invalid and logged, not alerted.
- Dedupe by `bucket_usage` ID and configured percentage. The same period/percentage sends once; a new period or changed percentage is independently eligible.

### Recipients and delivery

- Resolve `clients.account_manager_id` when planning delivery and require an active user. Plan internal notification even without manager email; plan manager email only for a valid address.
- Client delivery is email-only and calls `resolveInvoiceBillingRecipient`, retaining its existing precedence and passing `recipientClientId` for locale selection.
- Normalize addresses by trim/lowercase. If manager and client resolve to the same address, one email delivery retains both roles.
- Client opt-in enabled while an alert is open may add a previously absent client delivery. A newly assigned manager may be used only while no manager delivery has succeeded. Recipient changes never resend an already successful role.
- Preference-disabled delivery is terminal `skipped`. Missing/invalid recipients are auditable and may be resolved again while that role has no successful terminal delivery.
- Internal creation and delivery success commit in one transaction through `createNotificationFromTemplateInternal(trx, ...)`.
- Email sends outside the database transaction and is marked sent afterward. A provider-acceptance/process-crash window can duplicate email, so delivery is explicitly at-least-once, leased, and capped at five attempts.

## Migration shape

Create `server/migrations/20260815090000_add_prepaid_balance_alerts.cjs` with `exports.config = { transaction: false }`.

1. Alter `client_billing_settings`:
   - `prepaid_credit_alert_threshold bigint NULL`, positive when set.
   - `prepaid_credit_alert_currency_code char(3) NULL`, uppercase ASCII letters when set.
   - `bucket_usage_alert_percent smallint NULL`, range 1–100 when set.
   - `notify_client_on_prepaid_alert boolean NOT NULL DEFAULT false`.
   - Check amount/currency are either both null or both present.
2. Create `prepaid_balance_alerts`:
   - Composite primary key `(tenant, alert_id)` and composite tenant/client foreign key.
   - Alert type; stable `dedupe_key`; client and policy snapshots; observed credit/bucket values; optional currency, bucket usage, service, contract-line, and period fields; JSON payload; triggered/resolved timestamps; resolution reason; audit timestamps.
   - Tenant-unique `(tenant, dedupe_key)` plus open-client and type/state scan indexes.
3. Create `prepaid_balance_alert_deliveries`:
   - Composite primary key `(tenant, delivery_id)` and composite foreign key `(tenant, alert_id)`.
   - Channel, recipient-role metadata, normalized recipient key, optional user/email, status, attempt count, worker/lease fields, last error, sent/skipped/exhausted timestamps, and audit timestamps.
   - Unique `(tenant, alert_id, channel, recipient_key)` plus claim index `(tenant, status, lease_expires_at)`.
4. Distribute both tables by `tenant` with `server/migrations/utils/citusDistribution.cjs`. Add both to `packages/db/src/lib/tenantTableMetadata.ts` and the migration-only mirror `server/migrations/utils/tenantDb.cjs`.
5. The migration enables no client and rewrites no existing policy. Down drops deliveries, then alerts, then new checks/columns.

## Ordered implementation handoff

Implement in this order so each layer has stable contracts before its callers are added.

### 1. Schema and tenant metadata

1. `server/migrations/20260815090000_add_prepaid_balance_alerts.cjs` — add the four policy columns/checks, create the alert and delivery ledgers, create Citus-compatible tenant keys/indexes, distribute both tables, seed/upsert the two email and two internal notification subtypes/templates, and implement reverse-order down behavior.
2. `packages/db/src/lib/tenantTableMetadata.ts` — register `prepaid_balance_alerts` and `prepaid_balance_alert_deliveries` as tenant-scoped.
3. `server/migrations/utils/tenantDb.cjs` — mirror those two tenant metadata entries for migration execution.

Do not proceed to orchestration until a migrated database proves the check constraints, composite keys, uniqueness, distribution, indexes, and inert defaults.

### 2. Pure policy math and settings actions

4. `packages/billing/src/lib/prepaidBalanceAlerts.ts` — add pure types/functions for credit threshold decisions, exact bucket cross-multiplication, stable credit episode/bucket dedupe keys, normalized recipient keys, and policy-change detection. Keep this module server-free.
5. `packages/billing/src/lib/prepaidBalanceAlerts.test.ts` — lock down all strict/inclusive boundaries, no-history semantics, rollover, overage, non-positive capacity, and deterministic keys.
6. `packages/billing/src/actions/prepaidBalanceAlertSettingsActions.ts` — add dedicated flagged, permission-checked, tenant-scoped read/update actions and input schema; partial-upsert only the four new columns and force opt-in false when both thresholds are null.
7. `packages/billing/src/actions/prepaidBalanceAlertSettingsActions.integration.test.ts` — exercise the actions against migrated schema, including authorization, fail-closed flag behavior, tenant isolation, range/pair checks, and preservation of unrelated billing settings.
8. `packages/billing/src/actions/index.ts` — export the two actions and their public policy types.
9. `packages/billing/package.json` — expose the new action/domain entry points only if the existing export map does not already cover them.

### 3. Server-free job, CE registration, and shared EE fanout

10. `packages/jobs/src/lib/handlers/prepaidBalanceAlertScanHandler.ts` — define `PREPAID_BALANCE_ALERT_SCAN_REQUESTED`, validate tenant context, and publish the tenant request; do not import server billing, PostHog, or notification code.
11. `packages/jobs/src/lib/handlers/prepaidBalanceAlertScanHandlerTenantScoped.contract.test.ts` — prove missing-tenant rejection, correct event publication, and the server-free import boundary.
12. `packages/jobs/src/lib/maintenanceJobFanout.ts` — map `prepaid-balance-alert-scan` as a tenant-scoped maintenance job using the same handler; this is the existing per-tenant fanout reused by EE.
13. `server/src/lib/jobs/registerAllHandlers.ts` — register `prepaid-balance-alert-scan` for the central CE/worker registry and its validation list. This is the real registry path; the previously cited `packages/jobs/src/lib/jobs/registerAllHandlers.ts` does not exist.
14. `server/src/lib/jobs/index.ts` — expose the CE scheduling function/constant for the new job name.
15. `server/src/lib/jobs/initializeScheduledJobs.ts` — in the CE-only path, schedule one tenant singleton at `0 9 * * *`; do not modify `expiring-credits-notification`.
16. `ee/temporal-workflows/src/schedules/setupSchedules.ts` — add one global 09:00 UTC `maintenanceJobWorkflow` schedule for `prepaid-balance-alert-scan`, `ScheduleOverlapPolicy.SKIP`, and the existing short catch-up convention. Do not create per-tenant Temporal schedules.

### 4. Alert evaluation and durable delivery orchestration

17. `server/src/lib/eventBus/subscribers/prepaidBalanceAlertEvaluator.ts` — query configured clients and canonical credit/bucket subjects; lock each `client_billing_settings` row in a short transaction; resolve/rearm policy episodes; insert/upsert stable alert rows; refresh diagnostic observations without duplicating logical alerts.
18. `server/src/lib/eventBus/subscribers/prepaidBalanceAlertDelivery.ts` — resolve manager/client recipients, normalize/dedupe roles, plan unique delivery rows, claim with `FOR UPDATE SKIP LOCKED`, reclaim stale leases, enforce five attempts, transact internal delivery, and send email outside the transaction through the existing event-email path.
19. `server/src/lib/eventBus/subscribers/prepaidBalanceAlertSubscriber.ts` — fail closed on `release-v1-5-feature`, invoke evaluator then delivery drain, isolate per-client/recipient failures, and emit one tenant summary plus structured warnings.
20. `server/src/lib/eventBus/subscribers/index.ts` — register the `PREPAID_BALANCE_ALERT_SCAN_REQUESTED` subscriber.
21. `server/src/lib/notifications/prepaidBalanceAlertTemplates.ts` — provide localized credit/bucket email and internal template definitions/variables with manager `/msp/clients/{clientId}?tab=billing` and client `/client-portal/billing` links; internal variants are `warning` and default `high`.
22. `server/src/lib/notifications/prepaidBalanceAlertTemplates.test.ts` — verify every billing-email locale and both event variants/recipient link shapes are registered.

The subscriber is the only layer allowed to evaluate PostHog, query ledgers, resolve recipients, or invoke notifications. Scheduling overlap controls are operational only; database locks and unique rows are the correctness boundary.

### 5. Client settings UI and localization

23. `packages/clients/src/components/clients/ClientPrepaidBalanceAlertSettings.tsx` — implement the independently flagged card, loading/read/save states, minor-unit money conversion, ISO currency selection, percent validation, client opt-in, field errors, toast behavior, and 09:00 UTC/no-immediate-send copy.
24. `packages/clients/src/components/clients/ClientPrepaidBalanceAlertSettings.test.tsx` — verify flag-off structural absence, field behavior, action errors, default currency, save payload, and opt-in reset.
25. `packages/clients/src/components/clients/BillingConfiguration.tsx` — render the card exactly after `ClientCreditExpirationSettings` and before `ClientExternalCreditSettings`.
26. Add every key used by the card to these exact locale files:
   - `server/public/locales/de/msp/clients.json`
   - `server/public/locales/en/msp/clients.json`
   - `server/public/locales/es/msp/clients.json`
   - `server/public/locales/fr/msp/clients.json`
   - `server/public/locales/it/msp/clients.json`
   - `server/public/locales/nl/msp/clients.json`
   - `server/public/locales/pl/msp/clients.json`
   - `server/public/locales/pt/msp/clients.json`
   - `server/public/locales/xx/msp/clients.json`
   - `server/public/locales/yy/msp/clients.json`

The component itself must call `useFeatureFlag('release-v1-5-feature', { defaultValue: false })` and return `null` for both loading and disabled states. Do not gate only at the parent or expose settings via an ungated server action.

### 6. DB-backed behavior, retry, and schedule tests

27. `server/src/lib/eventBus/subscribers/prepaidBalanceAlertSubscriber.integration.test.ts` — run T009–T017, T021–T025, and T027 against a migrated tenant database: credit history/episode reset, bucket ownership/period/threshold reset, concurrency, recipient changes, flag-off no writes, leases/retries, delivery transactionality, observability, and tenant isolation.
28. `server/src/lib/jobs/prepaidBalanceAlertScheduling.test.ts` — verify CE/EE mutual exclusion, the CE cron/job name, the single EE global fanout schedule, overlap `SKIP`, and catch-up behavior without modifying expiring-credit scheduling.
29. `server/migrations/__tests__/prepaidBalanceAlertsMigration.integration.test.ts` — run T005–T007 against the migrated schema, including Citus distribution and down order.
30. `packages/clients/src/components/clients/ClientPrepaidBalanceAlertSettings.e2e.test.tsx` — cover the authorized save/no-immediate-send UI journey; keep the scheduled-scan delivery assertion in the server integration suite rather than mocking the ledger.

Use repository-native integration/bootstrap utilities when implementing these files. Source-string/wiring tests may supplement but cannot replace the real-query cases identified in `tests.json`.

## Feature-flag and rollout contract

1. Deploy schema, registries, scheduler wiring, subscriber, actions, UI, and tests together while `release-v1-5-feature` remains off.
2. Confirm a configured-low migrated fixture produces zero alert/delivery/notification writes with the flag disabled or checker unavailable.
3. Enable internal/test tenants and configure explicit policies. Observe two daily runs: the first opens/sends; the second deduplicates.
4. Exercise recovery/re-drop for credit and a period rollover for buckets before gradual flag expansion.
5. Disabling the flag later makes the feature inert but preserves policy and audit rows. No backfill is required; the first enabled scan establishes current episodes.

## Observability

Emit one structured run summary per tenant with counts for configured clients, credit/bucket subjects, opened/resolved/deduplicated alerts, sent/skipped/retried/exhausted deliveries, and invalid subjects. Emit warnings for absent credit history, non-positive capacity, missing/inactive manager, unresolved client recipient, reclaimed lease, and exhausted attempts.

Allowed structured identifiers are tenant, client, alert ID/type, delivery ID/channel, bucket usage ID, and currency. Never log raw email addresses, normalized recipient keys, or rendered template bodies. The two durable tables are the support/audit source for episode and delivery status; no new dashboard or metrics backend is in scope.

## Risks and mitigations

- **Mixed currency:** require paired explicit currency and filter canonical credit rows by it.
- **Bucket drift:** centralize exact capacity/consumption math and test rollover, equality, overage, and current-period boundaries.
- **Daily spam or races:** combine per-client row locks, stable dedupe keys, tenant-unique constraints, recipient delivery uniqueness, and leased claims.
- **Provider crash window:** state at-least-once behavior, keep one durable delivery identity, reclaim leases, and stop after five attempts.
- **Privacy/recipient mistakes:** reuse canonical invoice-recipient precedence, require opt-in, normalize only for dedupe/storage, and exclude addresses from logs.
- **Feature partial activation:** independently gate UI, actions, and subscriber; keep schema defaults inert.
- **Citus incompatibility:** use transaction-free DDL, composite tenant keys, distribution utilities, metadata registration, and a migrated Citus test.
- **Localization gaps:** test all billing email locales and all ten `msp/clients.json` files, including `xx` and `yy`.

## Non-goals

- No changes to expiring-credit settings, job, templates, schedule, or recipients.
- No immediate/event-driven scans after ledger mutation and no tenant-local scheduling.
- No tenant defaults, bulk edit, inheritance, multiple credit currencies, FX, per-bucket overrides, or aggregation across bucket periods.
- No client-portal in-app notification, history screen, dashboard, or new metrics backend.
- No automatic replenishment, billing/work suppression, or overage behavior change.
- No exactly-once provider guarantee; the bounded email path remains explicitly at-least-once.

## Completion checklist

- `features.json` remains synchronized with the PRD and flips items only when behavior ships.
- `tests.json` remains synchronized and DB-labeled cases execute real queries against migrated schema.
- Every implementation step appends durable discoveries, commands, and changed decisions to `SCRATCHPAD.md`.
- Definition of done is all 14 PRD acceptance criteria plus every test in `tests.json` passing.
