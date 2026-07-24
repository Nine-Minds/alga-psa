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
