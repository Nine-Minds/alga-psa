# Scratchpad — Inbound Email Pause for Cancelled Tenants

## Incident context (2026-07-23)
Tenant cancelled subscription today; inbound mail to their Microsoft mailbox kept creating tickets (`[Ticket #CF-000761]`) and sending "Your Ticket Has Been Created" notifications to external senders 46–47 min before the report. Root cause: cancellation never touches email providers; see PRD §1.

## Key investigation findings (2026-07-23)

### Inbound pipeline
- Webhook routes are thin re-exports: `server/src/app/api/email/webhooks/{microsoft,google,imap}/route.ts` → `packages/integrations/src/webhooks/email/...`
- **Microsoft handler has NO is_active check** (`handlers/microsoftWebhookHandler.ts:138-158`, enqueue `:219`); Google (`googleWebhookHandler.ts:136-141,153-158`) and IMAP (`imap.ts:91-97`) do check.
- Queue: Redis list `email:inbound:unified:pointer:ready`, pointer-only payloads. Enqueue `shared/services/email/unifiedInboundEmailQueue.ts:339`; consumer `shared/services/email/unifiedInboundEmailQueueConsumer.ts` (bin: `server/src/bin/unifiedInboundEmailQueueConsumer.ts`), DLQ after 5 attempts.
- Job processor `server/src/services/email/unifiedInboundEmailQueueJobProcessor.ts:872`; provider-config fetches at `:271` (MS), `:335` (Google), `:532` (IMAP) — **none filter is_active**.
- Ticket path: `shared/services/email/processInboundEmailInApp.ts:873` → `createTicketFromEmail` `shared/workflow/actions/emailWorkflowActions.ts:1130` → TICKET_CREATED event → `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts:956` sends client/tech/watcher emails. The legacy INBOUND_EMAIL workflow is dead; live path is in-app.
- Only tenant-level gate on inbound: `assertTenantEmailProductAccess` (product_code psa/algadesk) — not a status check.

### Provider config
- `email_providers` (migration `server/migrations/20250712214434_...`): `is_active` bool default true; `status` enum connected/disconnected/error/configuring — **status is never consulted on inbound path**.
- Vendor tables: `microsoft_email_provider_config` (webhook_subscription_id, webhook_expires_at, delivery_mode, ...), `google_email_provider_config` (pubsub_*, history_id, watch_expiration), `imap_email_provider_config`. Idempotency ledger `email_processed_messages` (PK message_id+provider_id+tenant).
- `EmailProviderService` (`server/src/services/email/EmailProviderService.ts`): `updateProvider` `:254`, `updateProviderStatus` `:326`, `deleteProvider` `:366` (rows only — no external teardown), `initializeProviderWebhook` `:415`, `deactivateProviderWebhook` `:498` (Gmail-only, sets status=disconnected which nothing reads).
- Graph subscription delete exists only inside renewal pruning: `shared/services/email/providers/MicrosoftGraphAdapter.ts:448,464,1356,1379`. Gmail `users.stop` is a TODO: `server/src/services/email/GmailWebhookService.ts:106-117`, commented out `GmailAdapter.ts:337`.
- Renewal jobs: MS `email-webhook-maintenance` → `EmailWebhookMaintenanceService.renewMicrosoftWebhooks` (`shared/services/email/EmailWebhookMaintenanceService.ts:47`, candidates filter is_active `:220`); silent-run auto-switch to polling `:671-725`. Gmail `renew-google-gmail-watch` → `packages/jobs/src/lib/handlers/googleGmailWatchRenewalHandler.ts:12` (is_active filter `:26`). CE cron via pg-boss `server/src/lib/jobs/index.ts:797`; EE via Temporal schedule `ee/temporal-workflows/src/workflows/email-webhook-maintenance-workflow.ts`.

### Cancellation / deletion
- **No status column on `tenants`** (`server/migrations/202409071803_initial_schema.cjs:11-23`). Lifecycle lives in `pending_tenant_deletions.status` (pending → awaiting_confirmation → confirmed → deleting → deleted; rolled_back/failed) — `ee/server/migrations/20260113120000_...`.
- Cancel phase A: `ee/server/src/lib/actions/license-actions.ts:758` → Stripe cancel_at_period_end (direct Stripe, not nm-store).
- Phase B: Stripe webhook → `ee/server/src/lib/stripe/StripeService.ts` `handleSubscriptionDeleted` `:1558` → `startTenantDeletionWorkflow` `:1616` (skipped if another live license sub `:1596-1606`). Other triggers: nineminds_extension (`ee/server/src/app/api/v1/tenant-management/start-deletion/route.ts:153`), apple_iap.
- Workflow `ee/temporal-workflows/src/workflows/tenant-deletion-workflow.ts:85`; activities `.../activities/tenant-deletion-activities.ts`. Order: validate → export data → **deactivateAllTenantUsers** (`:778`, sets users.is_inactive — this is the real access gate) → stripe cancel (extension only) → tag client → stats → record pending deletion (+90d, `:1177`) → await confirm/90d timer `:291` → delete schedules `:2288` → deleteTenantData `:1540` (~250-table ordered list; email tables at `:496-498,:133`) → delete tenants row.
- **Deletion removes email DB rows but never unregisters Graph subscriptions / Gmail watches.**
- Reactivation: rollback signal any time (`tenant-deletion-workflow.ts:458-563`) — reactivates users, removes Canceled tag, re-links Stripe. Win-back: `ee/server/src/lib/auth/loginWinback.ts`, nm-store HMAC routes `ee/server/src/app/api/billing/*` → `rollbackTenantDeletion` (`ee/server/src/lib/tenant-management/workflowClient.ts:358`).
- Login gate: `packages/auth/src/actions/auth.tsx:101-112` rejects is_inactive users. No middleware reads pending_tenant_deletions.
- ai-gateway has its own Stripe webhook (`services/ai-gateway/src/http/app.ts:84`) — out of scope.

### UI
- Provider settings UI: `packages/integrations/src/components/email/EmailProviderList.tsx` (isActive at `:81`), `EmailProviderCard.tsx`, forms per provider. Runtime import path rules: `@alga-psa/integrations/components` subpath.

## Decisions
- 2026-07-23: Separate pause columns (`inbound_paused_at`, `inbound_pause_reason`) instead of reusing `is_active`, so tenant-cancellation suspension can round-trip without clobbering user configuration, and manual pauses survive reactivation.
- 2026-07-23 (user): permissions for pause/resume = same as configuring email provider; reactivation auto-resumes; backfill confirmed for tenants already pending deletion (in-flight workflows are past the new step, so patched() alone won't cover them).
- Pause commits even if external teardown fails — DB gate is the source of truth; teardown is best-effort + retried at final deletion.
- Consumer skip is a success (no DLQ, no failed processed-message row) to avoid noise for a deliberate state.

## Gotchas
- **Temporal determinism:** in-flight tenant-deletion workflows sit on 90-day timers; any new activity calls in the workflow must be wrapped in `patched()` or replays will fail non-deterministically.
- Graph subscription delete must treat 404 as success (subs expire naturally in ~3d; Gmail watches ~7d).
- Resume after long pause can hit expired OAuth tokens → provider `status='error'`, existing reconnect flow handles it; must not fail tenant reactivation.
- Citus: every new query carries `tenant` in WHERE/JOIN; pause columns go on existing distributed table `email_providers` (no PK change).
- `EmailProviderService` lives in `server/src/` but webhook handlers live in `packages/integrations/` and the maintenance service in `shared/` — the ingestable predicate (`is_active AND inbound_paused_at IS NULL`) will be duplicated across those query sites; keep the predicate trivial so drift is unlikely.

## Ops follow-up
- 2026-07-23 (user): no immediate manual mitigation for today's incident tenant — it gets suspended by the post-deploy backfill together with all other pending-deletion tenants. Until deploy, its Microsoft mailbox keeps creating tickets (Graph subscription renews daily while `is_active=true`).

## Implementation log

### Schema and inbound gates (2026-07-23)
- F001/T001/T002: added CE migration `server/migrations/20260723180000_add_inbound_pause_to_email_providers.cjs`; both columns are nullable for existing rows, the reason/timestamp relationship is constrained, and down removes the constraint and columns.
- F002: exposed camel-case pause fields through the shared/server inbound DTOs, integration UI type, both provider-service mappers, and `PROVIDER_COLUMNS`.
- F003/T003/T005/T006: Microsoft subscription lookup now requires `ep.is_active = true`; gated callbacks are acknowledged without enqueueing while active callbacks and client-state validation remain covered.
- F004/T004: Microsoft lookup also requires a null pause timestamp; an all-gated callback returns 202 and emits a structured debug event.
- F005/T007: both Google subscription and mailbox lookup paths require a null pause timestamp; paused notifications are acknowledged as no-provider while active notifications still enqueue.
- F006/T008: IMAP loads the pause timestamp and returns an explicit successful skip before enqueueing.
- F007/T009-T012/T014: the unified processor checks the tenant-scoped provider gate before source fetch and repeats the ingestable predicate in Microsoft, Google, and IMAP config fetches.
- F008/T009-T013: deliberate gate skips return a successful `skipped` result before ticket processing or `email_processed_messages` insertion, so the queue consumer completes them without retry/DLQ noise.
- Verification: `npx vitest run --config vitest.config.ts src/test/unit/migrations/inboundEmailPauseMigration.test.ts src/test/unit/unifiedInboundEmailQueueJobProcessor.fetch.test.ts src/test/integration/microsoftWebhookUnifiedQueue.integration.test.ts src/test/integration/googleWebhookUnifiedQueue.integration.test.ts src/test/integration/imapWebhookHandoff.integration.test.ts --coverage.enabled=false` from `server/` (35 passed).

### External subscription lifecycle (2026-07-23)
- F009/T015/T016: added `GmailAdapter.stopWatch()` (shared plus both runtime copies), wired both `GmailWebhookService` implementations to it, and reused it during renewal. API failures are wrapped for callers; lifecycle cleanup contains them.
- F010/T017/T018: exposed `MicrosoftGraphAdapter.deleteSubscription`, accepting an explicit/stored id, URL-encoding it, and treating Graph 404 as idempotent success; the older delete method delegates to it.
- F011/T019-T021/T023: introduced tenant-scoped shared `EmailProviderLifecycleService`; pause atomically sets the reason/timestamp once, tears down Graph/Gmail (IMAP no-op), and clears local renewal cursors.
- F012/T022: pause is committed before teardown and teardown errors are warned/contained; local subscription cursors are cleared in `finally`.
- F013/T024-T026/T028: resume clears only the pause fields and recreates Gmail watches or Microsoft webhook-mode subscriptions. IMAP and inactive/polling Microsoft providers need no external registration. The round-trip restores the ingestable predicate.
- F014/T027: failed resume registration leaves pause fields clear and writes `status='error'` plus the reconnect error.
- F015/T029/T030: provider deletion now delegates through lifecycle teardown before vendor/base row deletion; the existing server action calls the service, and teardown failure does not prevent deletion.
- F016/T031 and F018/T033: Microsoft maintenance candidates require a null pause timestamp, so renewal, polling probes, reconciliation, and silent-run transitions never receive paused providers.
- F017/T032: Gmail watch renewal candidates require a null pause timestamp.
- Verification: shared and integrations workspace typechecks passed; focused adapter/lifecycle/maintenance suite passed (35 tests).

### Manual pause/resume UX (2026-07-23)
- F019/T034/T035: added `pauseEmailProvider`/`resumeEmailProvider` server actions wrapped by `withAuth`, guarded by the existing `ticket_settings:update` provider-configuration permission, and preflighted through the authenticated tenant-scoped provider table. Pause always uses reason `manual`; cross-tenant ids resolve as not found.
- F020/T036: provider cards render the pause fields returned by `getEmailProviders`, show a Paused badge, and expose Pause/Resume in the provider kebab menu. `EmailProviderList` runs the action, shows feedback, and refreshes provider state; resume failures that cleared the pause still refresh so `status='error'` is visible.
- F021/T037: added English i18n keys for badge/actions/feedback/helper copy. The helper explicitly states that messages received during the pause are not imported retroactively. New pause/resume menu ids use kebab-case.
- Verification: inbound action tests passed (2), card/i18n contract tests passed (5), and the integrations workspace typecheck passed.

### Tenant cancellation workflow integration (2026-07-23)
- F022/T038-T041: added tenant-scoped suspension activity selecting only active, unpaused providers, applying `tenant_cancelled`, isolating each provider failure, and returning success even when its query fails. Repeated runs select nothing because the pause is already present; existing manual pauses are excluded.
- F023/T042/T043: every deletion trigger now calls suspension directly after user deactivation and before trigger-specific Stripe/email behavior.
- F024/T044: cancellation resume activity selects only non-null pauses whose reason is `tenant_cancelled`; manual pauses never enter the loop.
- F025/T045: rollback invokes resume just after user reactivation and contains both activity-level failures and per-provider registration errors. The lifecycle service leaves failed registrations unpaused with `status='error'`.
- F026/T046: a final best-effort teardown activity visits every remaining tenant provider before `deleteTenantData`; provider failures are isolated and the lifecycle teardown is idempotent for expired/missing subscriptions.
- F027/T047: all three additions use stable `patched()` marker ids. A workflow contract test enforces that every new activity call occurs exactly once inside its matching patch guard, preserving pre-change replay behavior.
- T051/T052: cross-layer regression contracts connect workflow suspension to the Microsoft webhook and queue-consumer gates, and rollback selection to pause clearing plus Microsoft/Gmail registration. Behavioral tests in the earlier groups cover the gated skips and restored inbound processing at those boundaries.
- Verification: focused Temporal activity/workflow suite passed (12 tests) with `TEMPORAL_TEST_SKIP_ENV_BOOTSTRAP=1`; Temporal workspace typecheck passed. The bypass reused the already-running Temporal service and avoided the test compose file's port 7233 collision.

### Pending-deletion backfill and tenant-scope audit (2026-07-23)
- F028/T048: added `npm run backfill:pending-deletion-email-pause` in the Temporal workspace. The script selects only `pending`, `awaiting_confirmation`, and `confirmed` deletion rows that still have active, unpaused providers, then invokes the same suspension activity per tenant. An unexpected tenant failure is logged and does not stop later tenants; the CLI exits nonzero when any errors remain so operations can rerun it.
- T049: eligibility includes `ep.inbound_paused_at IS NULL`, so after a successful first run the second query returns no tenant and issues no suspension calls.
- F029/T050: audited every added production query. Tenant-local reads/writes use `tenantDb(knex, tenant)` (which injects the tenant predicate); provider/config joins use `tenantJoin` with the tenant distribution column; Microsoft discovery already joins provider/config on tenant; the intentionally cross-tenant backfill joins `ep.tenant = pd.tenant` and passes the selected tenant into the activity. No provider/config mutation uses an unscoped raw query.
- Verification: backfill suite passed (3 tests), including exact status/pause predicates, tenant join, rerun behavior, and per-tenant isolation; Temporal workspace typecheck and `git diff --check` passed.
- Operations runbook: after deploying the migration and application code, run `npm run backfill:pending-deletion-email-pause` from `ee/temporal-workflows`. A zero exit code means all eligible providers were paused/processed; a nonzero exit should be investigated and the command safely rerun.
