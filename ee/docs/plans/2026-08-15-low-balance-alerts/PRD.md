# PRD — Low-Balance Alerts for Prepaid Credit and Bucket Hours

- Slug: `2026-08-15-low-balance-alerts`
- Card: `29.8.20`
- Date: 2026-08-15
- Status: Ready for implementation

## Summary

Warn the client account manager, and optionally the client, before prepaid value is exhausted. Each client may configure a currency-specific prepaid-credit floor and/or one bucket-consumption percentage. A daily 09:00 UTC scan evaluates canonical credit and bucket ledgers, creates one durable alert per threshold episode, and routes notifications through the existing notification framework.

The feature is wholly gated by `release-v1.5-feature`. While the flag is loading or disabled, the new client setting card is absent, settings actions reject access, and the scheduled scan performs no alert-state or delivery writes. Nullable/false migration defaults also make deployment inert before enablement.

## Problem

Prepaid credit and hour buckets can run out between routine reviews. The current expiring-credit notification warns billing contacts about an approaching expiration date, but it does not warn an MSP that usable credit is low, does not cover bucket consumption, and does not notify the responsible account manager. The client portal can display current prepaid values, but that is passive and depends on someone looking at the page.

Without a threshold warning, the first obvious signal may be an overage charge or a service interruption. MSPs need a per-client policy, useful routing, and suppression of repeated daily messages while a balance remains in the same alert state.

## Goals

- Allow an authorized MSP user to configure a positive prepaid-credit threshold in one explicit ISO currency for a client.
- Allow an authorized MSP user to configure a bucket-consumption threshold from 1 through 100 percent for a client.
- Always target an active assigned account manager and optionally target the client's canonical invoice billing recipient.
- Use canonical credit and bucket ledgers without summing unrelated currencies or bucket periods.
- Send at most one alert per credit below-threshold episode and one alert per bucket period/configured threshold.
- Make alert creation concurrency-safe and retry notification delivery without creating a second logical alert.
- Preserve existing UI and runtime behavior while `release-v1.5-feature` is off.
- Reuse notification subtype, template, localization, preference, and internal-priority infrastructure.
- Leave a queryable audit of alert decisions and delivery outcomes.

## Non-goals

- Changing the existing credit-expiration job, its 09:00 UTC behavior, recipients, templates, or settings.
- Performing an immediate or event-driven evaluation after every credit, invoice, time-entry, or bucket mutation; this release scans daily.
- Introducing tenant-local scheduling or changing the existing UTC maintenance schedule convention.
- Adding tenant-wide defaults, bulk client policy editing, or policy inheritance.
- Supporting multiple simultaneous credit thresholds per client, foreign-exchange conversion, or aggregation across currencies.
- Supporting a different threshold for each bucket, contract line, or service; the configured percentage applies to every active client bucket.
- Creating client-portal in-app notifications. The optional client route is email to the canonical invoice billing recipient.
- Guaranteeing exactly-once email delivery across a crash after the provider accepts a message.
- Automatically replenishing credit, changing billing, stopping work, or suppressing overage charges.
- Adding a dedicated alert-history screen, dashboard, or metrics backend.

## Users and Primary Flows

### Billing administrator configures a client

1. The administrator opens the client's Billing tab and General section.
2. When `release-v1.5-feature` is enabled, a Prepaid balance alerts card appears after Credit Expiration Settings and before External Credit Settings.
3. The administrator enables a credit alert and supplies a positive minor-unit threshold plus ISO currency, enables a bucket alert and supplies an integer percentage from 1 to 100, or configures both.
4. The administrator may opt in to also email the client billing recipient. The account manager route is automatic.
5. One Save action validates and persists only the new alert fields. Saving does not send immediately; the next scheduled scan evaluates the policy.

### Daily scan identifies low prepaid credit

1. At 09:00 UTC, the CE or EE scheduler submits a tenant-scoped low-balance scan request.
2. A server subscriber fails closed unless `release-v1.5-feature` is enabled for the tenant.
3. For each configured client/currency with credit history, the subscriber sums non-expired `credit_tracking.remaining_amount` in that currency.
4. A value strictly below the configured floor opens a credit alert episode. Equality is recovery, not an alert.
5. Repeated scans below the same policy deduplicate. Recovery to the threshold or above resolves the episode and rearms a later drop.

### Daily scan identifies a consumed bucket

1. The subscriber resolves current bucket periods through `client_contracts -> contracts -> contract_lines` and only `configuration_type='Bucket'` services.
2. For each current `bucket_usage` row, capacity is `total_minutes + rolled_over_minutes` and consumption is `minutes_used`.
3. Exact integer/rational comparison determines whether `used / capacity` is at or above the configured percentage; rounded display values never decide the alert.
4. One alert is opened for the bucket usage period and configured threshold. A later scan of that same period deduplicates; a new period is a new subject.

### Notifications are routed and retried

1. The active account manager receives an internal warning and, when a valid email exists, an email. Existing tenant, subtype, category, channel, and user preferences remain authoritative.
2. If the client opt-in is enabled, one email is sent to the result of `resolveInvoiceBillingRecipient` using its existing precedence.
3. Matching manager and client email addresses collapse to one email for that alert.
4. Missing recipients or transient delivery failures do not abort the tenant scan. Pending and retryable deliveries are drained on the current run and later daily runs.

## UX / UI Notes

- Add `ClientPrepaidBalanceAlertSettings.tsx` to `packages/clients/src/components/clients/`, rendered by `BillingConfiguration.tsx` in the existing General billing section.
- The component must call `useFeatureFlag('release-v1.5-feature', { defaultValue: false })` and return `null` both while loading and when disabled. Do not leave a skeleton, spacer, heading, or altered tab markup in flag-off state.
- Credit controls: enable switch, threshold money input, and ISO currency selector initialized from `clients.default_currency_code` when no policy exists. Persist money in minor units; never persist a localized decimal string.
- Bucket controls: enable switch and whole-number percentage input constrained to 1–100 inclusive.
- Client routing control: “Also email the client billing recipient,” default off and disabled when neither alert type is enabled.
- Use one explicit Save button, field-level errors, and existing billing settings loading/toast patterns. Copy must state that checks run daily at 09:00 UTC and that saving does not send immediately.
- Displayed bucket values should retain the existing client-portal semantics: base allowance plus rollover, used, remaining, and percent. Time capacity is presented as hours; other configured usage units use their service unit rather than being mislabeled as hours.
- Add strings to the existing `msp/clients.json` namespace for every shipped locale, including pseudo-locales.

## Requirements

### Feature gating

- The client component, read action, update action, and scan subscriber must independently gate on `release-v1.5-feature` with a false default.
- A disabled or unavailable flag checker must cause no alert evaluation, no alert/delivery rows, and no notification side effects.
- Schema defaults are `NULL` thresholds and `false` client opt-in; the migration itself must not enable a client.
- Existing expiring-credit scheduling, settings, templates, and subscribers must not be modified as a shortcut for this feature.

### Settings and validation

- Extend `client_billing_settings` with:
  - `prepaid_credit_alert_threshold bigint NULL`, constrained to positive values;
  - `prepaid_credit_alert_currency_code char(3) NULL`, paired with the threshold and constrained to uppercase ASCII letters;
  - `bucket_usage_alert_percent smallint NULL`, constrained to 1–100;
  - `notify_client_on_prepaid_alert boolean NOT NULL DEFAULT false`.
- Threshold/currency must both be null or both be present. Null credit or bucket values mean disabled.
- Read and update paths require the existing `billing_settings.read` and `billing_settings.update` permissions respectively.
- The update action must use a dedicated input schema and a partial/upsert implementation that touches only the new columns. It must not route through the broad null-delete behavior of `updateClientBillingSettings`.
- Server validation is authoritative and repeats feature-flag and client/tenant scoping checks regardless of client validation.
- Disabling both alert types forces client opt-in false.

### Credit evaluation

- Use `packages/billing/src/lib/creditBalance.ts` semantics: sum `credit_tracking.remaining_amount` only for non-expired rows and only in the configured currency.
- Never sum currencies or convert currencies.
- Require at least one historical `credit_tracking` row for the client/currency before evaluating zero as a low balance. This prevents a policy configured before any prepayment from generating a spurious zero alert.
- A zero balance after relevant credit history is eligible.
- Open an alert only when available credit is strictly less than the threshold. `available >= threshold` resolves any open episode and rearms the policy.
- A credit threshold or currency change resolves the prior open episode with `resolution_reason='policy_changed'` and evaluates the new policy as a new episode.

### Bucket evaluation

- Resolve client ownership through `client_contracts -> contracts -> contract_lines`; do not query the removed `client_contract_lines` relationship.
- Pin service configuration to `contract_line_service_configuration.configuration_type='Bucket'`.
- Evaluate current periods using the inclusive period boundaries already used by bucket reconciliation and charge computation.
- For each current `bucket_usage` row, use `capacity = total_minutes + rolled_over_minutes`, `consumed = minutes_used`, and `remaining = capacity - consumed`. Overage may produce a percentage above 100 and must not be clamped.
- Compare `consumed * 100 >= configured_percent * capacity` using exact integer/numeric arithmetic. The threshold is inclusive.
- Skip rows with non-positive capacity and emit a structured warning rather than dividing by zero or opening an alert.
- A bucket alert is unique to the `bucket_usage` period and configured threshold. A new threshold closes/re-evaluates prior open policy alerts; a new period is independently eligible.

### Alert lifecycle and deduplication

- Add a tenant-distributed `prepaid_balance_alerts` table containing the client, alert type, subject/dedupe key, policy values, observed values, optional currency/bucket/service/contract-line/period snapshot, payload JSON, trigger/resolution timestamps, resolution reason, and audit timestamps.
- Use a tenant-unique stable `dedupe_key`. Credit keys identify a monotonically increasing below-threshold episode for client/currency/policy. Bucket keys identify bucket usage ID plus configured percentage.
- Serialize evaluation for one client by locking its `client_billing_settings` row in a short transaction. A unique constraint remains the final protection against concurrent or replayed scans.
- Repeated scans may refresh diagnostic observations but must not create another logical alert or another successful delivery for the same alert/recipient/channel.
- Enabling client opt-in while an alert is open may add the previously absent client delivery. A newly assigned manager may add manager deliveries only if no manager delivery has already succeeded for that alert. Recipient changes do not resend an already successful episode.

### Recipient semantics

- Account manager:
  - resolve `clients.account_manager_id` at delivery planning time;
  - require an active user for delivery;
  - create an internal notification even if the user has no email;
  - plan an email only when a syntactically valid manager email exists;
  - honor existing internal/email subtype, category, tenant, and user preferences.
- Optional client:
  - call `packages/billing/src/services/invoiceBillingRecipientService.ts` and retain its precedence: valid billing contact, client billing email, active billing-location email, active default-location email, else none;
  - send email only and pass `recipientClientId` so the existing client locale resolution applies;
  - treat the per-client opt-in as authorization, while existing tenant/category/subtype email gates still apply.
- Normalize email addresses by trim plus lowercase for deduplication. If two roles resolve to the same normalized email, store/send one email delivery and retain both roles in delivery metadata.
- Manager links target `/msp/clients/{clientId}?tab=billing`; client links target `/client-portal/billing`.
- Missing or invalid recipients are logged as unroutable, not treated as scan failures. They may be resolved again on a later scan while the alert remains open and the role has no successful terminal delivery.

### Notification definitions

- Add email and internal notification subtypes for `prepaid-credit-low-balance` and `prepaid-bucket-threshold-reached` through the existing source-of-truth template registries and migration upsert helpers.
- Add localized email templates for every locale already supported by the billing email registry.
- Add localized internal templates with `warning` type and a default priority of `high`, relying on the existing user-over-tenant-over-default priority resolution.
- Templates include client name, threshold, observed amount/usage, period where relevant, and a safe navigation link. Do not include unrelated ledger detail.
- Existing preference management UIs discover the new subtypes through the normal category/subtype data; no new preference screen is required.

### Scheduling, idempotency, and concurrency

- Add a separate job name, `prepaid-balance-alert-scan`, rather than overloading `expiring-credits-notification`.
- CE schedules it at `0 9 * * *` through `server/src/lib/jobs/initializeScheduledJobs.ts` and `server/src/lib/jobs/index.ts`.
- EE adds it to `ee/temporal-workflows/src/schedules/setupSchedules.ts` as a global maintenance fanout with overlap policy `SKIP` and the existing short catch-up convention.
- Register a server-free handler in `packages/jobs/src/lib/handlers/` through `server/src/lib/jobs/registerAllHandlers.ts`, and add it to the existing EE fanout map in `packages/jobs/src/lib/maintenanceJobFanout.ts`. The handler validates tenant context and publishes `PREPAID_BALANCE_ALERT_SCAN_REQUESTED`; it must not import server billing, PostHog, or notification code.
- Register a server subscriber in `server/src/lib/eventBus/subscribers/index.ts`. The subscriber owns flag evaluation, ledger queries, alert transactions, recipient planning, and delivery draining.
- CE singleton scheduling and EE overlap suppression are operational safeguards, not correctness mechanisms. Duplicate events and concurrent processes must be harmless because of client locks, unique keys, and delivery claims.
- Add `prepaid_balance_alert_deliveries`, tenant-distributed and keyed to alerts, with channel, recipient role(s), normalized recipient key, optional user/email, status, attempt count, processing lease, last error, and terminal timestamps.
- Claim delivery work with `FOR UPDATE SKIP LOCKED`, a worker ID, and an expiring processing lease. Reclaim stale leases. Retry transient failures on later drains with a finite maximum (five attempts); retain exhausted failures for audit.
- Create an internal notification and mark that delivery sent in the same database transaction using `createNotificationFromTemplateInternal(trx, ...)`.
- Send email outside the database transaction, then mark it sent. This is deliberately at-least-once: a process crash after provider acceptance but before the sent update can duplicate an email. The stable delivery row and bounded retry minimize but cannot eliminate that window.
- Preference-disabled deliveries are recorded `skipped` and terminal for that alert episode.

## Data / API / Integrations

### Migration shape

- Create one timestamped migration under `server/migrations/` with `exports.config = { transaction: false }` for Citus-safe DDL.
- Alter `client_billing_settings` with the four policy columns and checks described above.
- Create `prepaid_balance_alerts` with composite primary key `(tenant, alert_id)`, composite tenant/client foreign key, tenant-unique `(tenant, dedupe_key)`, and scan indexes on `(tenant, client_id, resolved_at)` and alert type/state.
- Create `prepaid_balance_alert_deliveries` with composite primary key `(tenant, delivery_id)`, composite foreign key `(tenant, alert_id)`, unique `(tenant, alert_id, channel, recipient_key)`, and a claim index on `(tenant, status, lease_expires_at)`.
- Distribute both new tables by `tenant` using `server/migrations/utils/citusDistribution.cjs`; create distribution-compatible composite foreign keys in the ordering used by current migrations.
- Register both tables in `packages/db/src/lib/tenantTableMetadata.ts` and `server/migrations/utils/tenantDb.cjs`.
- The down migration drops deliveries before alerts and removes the four setting columns/checks. No existing data is rewritten.

### Code boundaries

- Pure credit/bucket policy math and dedupe-key construction belong in `packages/billing`, with unit tests and no server imports.
- Tenant-scoped settings actions belong in `packages/billing/src/actions/` and are exported through `packages/billing/src/actions/index.ts` / package exports.
- The maintenance job handler belongs in `packages/jobs`; it publishes an event only.
- Server-only orchestration, PostHog gating, recipient resolution, notifications, and delivery leasing belong under `server/src/lib/eventBus/subscribers/` with small supporting modules under `server/src/lib/notifications/` or the subscriber directory.

## Security / Permissions

- The settings UI and actions retain normal MSP authentication. Read requires `billing_settings.read`; update requires `billing_settings.update`.
- Client IDs are tenant-scoped on every action and query; no caller-provided tenant is accepted.
- Scheduled handlers require a valid tenant context and all new tables retain `tenant` in primary, unique, foreign, and distribution keys.
- Client emails are sent only after explicit per-client opt-in and existing email preference gates.
- Logs and dedupe keys must not contain raw email addresses. Store normalized email only where required for delivery/audit and avoid rendering it in structured logs.
- Template variables are escaped by the existing email/internal renderers; no user-supplied HTML is introduced.

## Observability

- Emit one structured run summary per tenant with configured clients, credit and bucket subjects evaluated, alerts opened/resolved/deduplicated, deliveries sent/skipped/retried/exhausted, and invalid subjects.
- Emit structured warnings for non-positive bucket capacity, absent credit history, missing/inactive manager, unresolved client billing recipient, stale lease reclamation, and exhausted delivery attempts.
- Include tenant, client, alert ID/type, delivery ID/channel, bucket usage ID, and currency where applicable; do not log raw email or template bodies.
- The alert and delivery tables are the durable operational audit and allow support queries without reconstructing daily scheduler logs.
- Keep job and event errors compatible with existing job/event-bus logging so failed tenant scans surface through current operational tooling.

## Rollout / Migration

1. Ship schema, definitions, scheduler wiring, server subscriber, actions, UI, and tests together while `release-v1.5-feature` remains off.
2. Verify migration distribution metadata and that a disabled tenant produces no alert/delivery writes at the 09:00 UTC run.
3. Enable the existing flag for internal/test tenants, configure explicit client policies, and observe at least two daily runs to verify first-send and deduplication behavior.
4. Expand the flag gradually. There is no backfill: the first enabled daily scan establishes current alert episodes from canonical ledgers.
5. Rollback application code safely leaves nullable settings and audit rows. If the flag is disabled, the feature becomes inert without deleting history.

## Risks and Mitigations

- **Mixed-currency false alerts:** require an explicit currency and filter every credit row by it; never aggregate currencies.
- **Bucket formula drift:** centralize pure snapshot math using the same base-plus-rollover semantics as `computeBucketPeriodState` and portal reporting, then protect boundaries with unit tests.
- **Repeated daily spam:** durable episode/delivery keys, unique constraints, and recovery semantics suppress repeats independently of scheduler overlap controls.
- **Concurrent scanners:** row locks, tenant-unique dedupe keys, `SKIP LOCKED` claims, and leases make duplicate events harmless.
- **Email duplicates after crash:** document at-least-once semantics, retain a stable delivery record, and cap retries. Exactly-once provider delivery is outside this scope.
- **Incorrect recipient or privacy leak:** reuse the canonical invoice recipient service, require client opt-in, normalize/dedupe email, and omit raw addresses from logs.
- **Stale account-manager assignment:** re-resolve only while no successful manager delivery exists; do not resend completed episodes on assignment changes.
- **Feature-flag partial activation:** gate component, actions, and subscriber independently and use disabled schema defaults.
- **Large daily tenant scan:** query only configured clients/current bucket rows, index open alerts/delivery claims, use existing EE fanout concurrency, and keep per-client transactions short.
- **Migration incompatibility under Citus:** use transaction-free migration, composite tenant keys, distribution utilities, and a migrated DB integration test.
- **Localization gaps:** seed both subtypes/templates for the full locale registry and add a completeness test.

## Dependencies and Constraints

- Depends on the existing `release-v1.5-feature` bridge in `packages/core/src/lib/features.ts` and UI hook in `packages/ui/src/hooks/useFeatureFlag.tsx`.
- Depends on canonical credit math in `packages/billing/src/lib/creditBalance.ts`.
- Depends on canonical bucket ownership and period state in `shared/billingClients/bucketUsageService.ts` and `packages/billing/src/lib/billing/compute/computeBucketCharges.ts`.
- Depends on canonical invoice billing recipient resolution in `packages/billing/src/services/invoiceBillingRecipientService.ts`.
- Depends on the CE scheduler, EE maintenance fanout, and server-free `packages/jobs` boundary established by the expiring-credit job and subsequent Temporal migration.
- Depends on internal-notification priority support from card 29.8.46; the new subtypes default to `high` and do not recreate priority infrastructure.
- Constrained by sibling card 29.8.21 semantics: bucket capacity includes rollover and buckets remain distinct.
- Constrained by sibling card 29.8.22 semantics: credit balances remain currency-specific and bucket state uses canonical period calculations.

## Decisions

- (2026-08-15) Use a new daily job/event/subscriber rather than modifying the expiring-credit notification flow.
- (2026-08-15) Store one explicit credit currency and one bucket percentage per client; no FX conversion or per-bucket overrides.
- (2026-08-15) Treat credit equality as recovered and bucket equality as reached.
- (2026-08-15) Notify the active account manager by internal notification and email; optionally email exactly one canonical client billing recipient.
- (2026-08-15) Persist alerts and deliveries so deduplication, retries, and operational history survive process restarts.
- (2026-08-15) Keep notification evaluation fail-closed behind `release-v1.5-feature` in addition to UI/action gating.

## Open Questions

None. Engineering choices are resolved for draft implementation.

## Acceptance Criteria (Definition of Done)

1. With `release-v1.5-feature` disabled or unavailable, the client UI is byte-for-byte structurally unchanged at the insertion point, settings actions cannot expose/mutate the policy, and a scheduled scan creates no alerts, deliveries, or notifications.
2. An authorized user can independently enable/disable a positive currency-specific credit floor, a 1–100 bucket percentage, and optional client email for one tenant-scoped client.
3. The migrated schema enforces paired credit amount/currency, valid ranges, composite tenant keys, unique dedupe/delivery keys, and Citus distribution metadata.
4. A client with relevant credit history opens one alert when non-expired remaining credit in the configured currency is below the floor, does not open at equality, and rearms only after recovery to equality or above.
5. A client with no history in the configured currency does not receive a zero-balance alert; a client whose prior credit was consumed to zero does.
6. Each current bucket uses `minutes_used / (total_minutes + rolled_over_minutes)`, opens at exact threshold equality, supports over-100-percent observations, skips non-positive capacity, and alerts only once per period/configured threshold.
7. Replayed or concurrent scan events create one logical alert and at most one terminal delivery per channel/normalized recipient key.
8. The active account manager receives a preference-aware high-priority internal warning and an email when valid; inactive/missing managers do not fail the scan.
9. Client email is sent only when opted in and only to the canonical invoice billing recipient; duplicate manager/client email collapses to one message.
10. Internal delivery is transactionally idempotent; email retry is leased, bounded, auditable, and explicitly at-least-once.
11. CE and EE schedule only `prepaid-balance-alert-scan` at 09:00 UTC in their mutually exclusive paths, and the `packages/jobs` handler has no server imports.
12. Email/internal subtypes and localized templates exist for credit and bucket alerts, with internal default priority `high` and links appropriate to the recipient role.
13. Structured run summaries and warnings contain useful tenant/client/alert identifiers without raw recipient addresses.
14. All feature and behavioral tests in `tests.json` pass against a migrated tenant database where specified.
