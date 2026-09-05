# Scratchpad — Low-Balance Alerts for Prepaid Credit and Bucket Hours

- Plan slug: `2026-08-15-low-balance-alerts`
- Card: `29.8.20`
- Created: `2026-08-15`
- Status: Implemented; awaiting review

## Decisions

- (2026-08-15) Reuse the existing 09:00 UTC maintenance architecture: CE schedules the tenant job, while EE uses one global schedule and the existing per-tenant maintenance fanout with overlap `SKIP`.
- (2026-08-15) Configure policies per client: one amount/currency credit floor and one bucket-consumption percentage applying to every active bucket owned by that client.
- (2026-08-15) Account-manager routing is mandatory when an active manager can be resolved; client billing-recipient email is separately opt-in and defaults off.
- (2026-08-15) A credit alert is one below-threshold episode, rearmed only after recovery to equality or above. A bucket alert is one `bucket_usage` period/configured-percent pair.
- (2026-08-15) Persist logical alerts separately from delivery attempts. Internal delivery is transactionally idempotent; email uses a stable leased delivery row and bounded retries with documented at-least-once semantics.
- (2026-08-15) `release-v1-5-feature` gates the whole feature independently at UI, settings action, and scan-subscriber boundaries; unavailable flag infrastructure fails closed.

## Discoveries / Constraints

- (2026-08-15) `BillingConfiguration.tsx` already renders `ClientCreditExpirationSettings` before `ClientExternalCreditSettings`; the new card belongs exactly between them in the General tab.
- (2026-08-15) Server flag checks already fail closed when no checker is registered through `isFeatureFlagEnabled`; the client hook exposes both `loading` and `enabled` and accepts `defaultValue: false`.
- (2026-08-15) The existing EE maintenance fanout is `packages/jobs/src/lib/maintenanceJobFanout.ts`; it maps tenant-scoped job names to the same handlers used by CE and isolates failures per tenant.
- (2026-08-15) The grounded PRD initially named a nonexistent `packages/jobs/src/lib/jobs/registerAllHandlers.ts`. The real central registry is `server/src/lib/jobs/registerAllHandlers.ts`; the PRD and handoff were corrected.
- (2026-08-15) Client settings translations live in ten files: `server/public/locales/{de,en,es,fr,it,nl,pl,pt,xx,yy}/msp/clients.json`; both pseudo-locales are part of completeness.
- (2026-08-15) Canonical invoice-recipient precedence is billing contact, client billing email, active billing-location email, active default-location email, then none. Reuse it rather than duplicating contact queries.
- (2026-08-15) Credit equality is recovery (`available >= threshold`); bucket equality is alerting (`consumed * 100 >= threshold * capacity`). Keep these asymmetric boundaries explicit in code and tests.
- (2026-08-15) No new client-portal in-app notification, immediate/event-driven evaluation, FX conversion, tenant defaults, per-bucket overrides, or exactly-once email guarantee belongs in this card.
- (2026-08-15) Migration filename was renamed `20260815090000_add_prepaid_balance_alerts.cjs` → `20260815000000_add_prepaid_balance_alerts.cjs`: the `custom-rules/migration-filename` lint rule rejects timestamps later than the authoring machine clock (09:00 UTC was ~3.5h in the future at implementation time). The new name keeps the same date and still sorts after the last existing migration.
- (2026-08-15) `packages/clients` cannot import `@alga-psa/billing` (custom lint rule `no-feature-to-feature-imports`). The policy read/update DB logic therefore lives in a horizontal module `shared/billingClients/prepaidBalanceAlertSettings.ts`; `packages/billing/src/actions/prepaidBalanceAlertSettingsActions.ts` and clients-local `getPrepaidBalanceAlertSettingsAsync`/`updatePrepaidBalanceAlertSettingsAsync` in `packages/clients/src/lib/billingHelpers.ts` both delegate to it and independently gate on the flag + `billing_settings` read/update permissions.
- (2026-08-15) Decision: a bucket alert whose period is no longer current (rollover / removed bucket) is resolved as `recovered` so only current subjects carry an open alert. This is an implementation decision beyond the PRD's literal text; the delivery/audit tables preserve the historical episode.
- (2026-08-15) Decision: disabling a policy type (credit threshold or bucket percent set to null) resolves that type's open episodes as `policy_changed`, so a later re-enable starts a fresh episode.
- (2026-08-15) Credit dedupe keys embed a monotonically increasing `episode` column (`credit:{client}:{currency}:ep{n}`) so a rearm + re-drop never collides with the prior resolved row under the `(tenant, dedupe_key)` unique constraint. Bucket keys deliberately do not: their stable identity is exactly `bucket:{usage}:{percent}pct`, so one usage period/percentage can own only one logical alert row.
- (2026-08-15) Email delivery format: bucket capacity/used are presented in hours (minutes/60); `contract_line_service_bucket_config.total_minutes` is always minutes. `usedPercent` is rounded for display only; the exact integer cross-multiplication decides the alert.
- (2026-08-15) The dev-stack Postgres (localhost:5472, plain PG, not Citus) was used to verify migration up/down and all DB-backed tests. Citus distribution (`ensureTenantDistribution`) is exercised only by the migrated-DB integration test's existence checks on plain PG; real Citus shard/colocation behavior was NOT directly verified here and should be confirmed in the Citus CI smoke before rollout.
- (2026-08-15) The repo's DB-backed test bootstrap (`server/test-utils/dbConfig.createTestDbConnection`) drops/recreates `test_database` and runs every migration; a pre-existing migration (`20251214120000_time_entry_work_date.cjs`) with a 3s Citus-propagation wait can lose its connection under rapid back-to-back bootstraps on the shared dev server, making the bootstrap occasionally flaky (retry once; `server/vitest.config.ts` runs files sequentially in a single fork).
- (2026-08-15) Client email is sent through `server/src/lib/notifications/sendEventEmail` with `recipientClientId` for locale resolution and `notificationSubtypeId` for preference linkage. The provider-acceptance/process-crash window before the `sent` mark is documented as at-least-once (bounded by `MAX_DELIVERY_ATTEMPTS = 5`).

## Review-fix round (lead review, 9 must-fix + 3 should-fix)

- (2026-08-15) `claimDeliveries` now runs the SELECT ... FOR UPDATE SKIP LOCKED and the per-row `processing` claim inside ONE `knex.transaction`; the row locks are held until the claim commits, so concurrent drains cannot double-claim (the earlier version's auto-commit SELECT released locks at statement end). `claimDeliveries` also now reports reclaimed stale leases and attempt-overflow exhaustion through the summary/warnings.
- (2026-08-15) `resolveCurrentBucketSubjects` pins `bu.client_id = cc.client_id` so a shared (system-managed default) contract line can never make client A alert on client B's bucket usage — matching billingEngine/getRemainingBucketUnits.
- (2026-08-15) Credit and bucket evaluation for one client run in SEPARATE transactions so a bucket failure can never roll back the client's committed credit writes; individual bucket subjects are also failure-isolated.
- (2026-08-15) The internal-channel delivery-status updates now go through the tenant-scoped facade (`tenantDb(trx, tenant).table(...)`) with the `(tenant, delivery_id)` predicate, so they stay shard-pruned on Citus.
- (2026-08-15) Internal notifications now receive a FLAT context (`clientName`, `available`, `currency`, `threshold`, `percent`, `usedPercent`, `capacity`, `used`, `link`) because the internal renderer substitutes only top-level `\w+` keys — the previous nested email context rendered literal `{{...}}`. The internal channel formats with the recipient user's locale (not hardcoded 'en').
- (2026-08-15) The clients UI loads the threshold with `result.prepaidCreditAlertCurrencyCode` first for minor-unit conversion (JPY 0 digits vs a 2-digit default no longer corrupts the value), and keeps the card busy (`loadingSettings=true`) while the feature flag is still resolving and while the async read is in flight, so a user cannot Save empty defaults before the policy loads.
- (2026-08-15) The shared input schema now `.refine`s the credit amount/currency both-or-neither pairing, making validation authoritative instead of relying on the DB check constraint.
- (2026-08-15) The migration `down` now removes the seeded email/internal templates, subtypes, and the (now-empty) categories — mirroring `20260715120000_add_project_billing_notification_templates.cjs` and using the `_shared` delete helpers.
- (2026-08-15) `planAndDrainDeliveriesForTenant` wraps each alert's planning in try/catch so one alert's recipient-resolution failure cannot abort the tenant drain. The delivery upsert unions `recipient_roles` on conflict (a late client opt-in for an already-sent manager address retains both roles without resending). The subscriber no longer logs `clientName` (outside the plan's allowed-identifier list).
- (2026-08-15) New regression tests: delivery/evaluator source contracts (atomic claim, tenant predicate, flat internal context, per-alert isolation, bucket client pin, separate credit/bucket transactions), DB-backed concurrent-claim atomicity, shared-contract-line isolation, schema both-or-neither validation, JPY-vs-USD load conversion, and async-flag busy state.

## Mitigation pass (draft-review blockers)

- (2026-08-15) Evaluation candidates are the union of configured clients and clients with open alerts. Each credit/bucket transaction locks and re-reads `client_billing_settings`; a disabled type resolves as `policy_changed` from the locked state and cannot create from a stale pre-scan policy snapshot.
- (2026-08-15) Bucket identity is exactly usage period plus configured percentage. Same-period oscillation stays suppressed, percentage changes resolve/re-evaluate distinct identities, returning to a prior percentage reuses its row, and rollover resolves the old usage ID before the new period opens.
- (2026-08-15) Resolved-alert deliveries transition to terminal `superseded`; claims join only open alerts, active workers revalidate the parent immediately before side effects, and terminal writes compare `(status, worker_id)` so a worker cannot overwrite concurrent supersession.
- (2026-08-15) Delivery authorization re-resolves the current active internal account manager and the current opt-in/canonical client billing recipient at planning and pre-send time. Billing contacts must belong to the client and be active. Recipient locale is resolved once and passed explicitly with the matching localized context/template send.
- (2026-08-15) The pre-existing uncommitted `package-lock.json` churn had no corresponding manifest change and was removed in full; no lockfile change is required by task 29.8.20.
- (2026-08-15) Next.js `"use server"` modules may export only async functions. The billing alert settings action no longer re-exports its shared schema/constants/types; consumers import those directly from the horizontal shared policy module, and the aggregate community build succeeds.
- (2026-08-15) Shared manager/client email rows evaluate preferences per role. Manager user opt-out removes only that route; an authorized opted-in client role still sends once with client locale/link/recipientClientId. The delivery drain loops through distinct 50-row claims while excluding IDs attempted earlier in the invocation.
- (2026-08-15) The shared settings reader returns `null` when its tenant-scoped client lookup fails, distinguishing a missing/cross-tenant client from an existing client with no policy. Bucket email and internal contexts now carry locale-formatted period start/end snapshots.

## Task 29.8.20 review mitigation

- (2026-08-15) `ClientPrepaidBalanceAlertSettings` now distinguishes not-loaded/loading/loaded/failed reads, validates the returned policy shape before hydrating controls, and renders only a disabled Save plus a visible error until the current client's policy has loaded successfully.
- (2026-08-15) Migration `20260812090200` owns one deterministic `default_folder_id` per tenant. Its rollback deletes only that tenant-scoped identifier, so a matching Sales Orders folder that predated `up` survives `down`.
- (2026-08-15) Regression proof ran against the defective implementation first: the component suite failed because no alert existed and Save unlocked, and the DB-backed migration test failed because the pre-existing folder was deleted. Both pass after the mitigation.

## Commands / Runbooks

- Validate the ALGA plan: `python3 /home/robert/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-08-15-low-balance-alerts`
- Independently parse both checklists: `python3 -m json.tool ee/docs/plans/2026-08-15-low-balance-alerts/features.json >/dev/null` and the same command for `tests.json`.
- During implementation, run the migration/integration harness against a migrated tenant database; source-string checks do not satisfy T004–T007, T009–T017, or T021–T023.
- Before committing design, stage only `ee/docs/plans/2026-08-15-low-balance-alerts/` and `docs/plans/2026-08-15-low-balance-alerts-plan.md`; leave the pre-existing `package-lock.json` modification unstaged.

## Links / References

- Product scope: `ee/docs/plans/2026-08-15-low-balance-alerts/PRD.md`
- Implementation checklist: `ee/docs/plans/2026-08-15-low-balance-alerts/features.json`
- Test checklist: `ee/docs/plans/2026-08-15-low-balance-alerts/tests.json`
- Ordered implementation handoff: `docs/plans/2026-08-15-low-balance-alerts-plan.md`
- Card: `29.8.20`

## Open Questions

- None. Repository-path correction is resolved and all product decisions needed for implementation are settled.
