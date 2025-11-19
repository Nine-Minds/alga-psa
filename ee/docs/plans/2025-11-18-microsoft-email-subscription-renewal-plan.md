# Microsoft 365 Inbound Email Subscription Renewal – Implementation Plan

**Date:** November 18, 2025  
**Authors:** Codex (draft)  
**Status:** Draft  
**Edition:** Applies to Community & Enterprise (EE layers add telemetry, but renewal logic lives in shared server code)

---

## Implementation Todo List

### Phase 1: Core Service & Logic
- [x] Create `EmailWebhookMaintenanceService` class structure
- [x] Implement `findRenewalCandidates` DB query (join `email_providers` & `microsoft_email_provider_config`)
- [x] Implement `renewMicrosoftWebhooks` main orchestration method
- [x] Add `renewWebhookSubscription` logic using `MicrosoftGraphAdapter`
- [x] Implement fallback to `registerWebhookSubscription` on 404/ResourceNotFound
- [x] Persist new subscription ID and expiration to `microsoft_email_provider_config`
- [x] Update `email_provider_health` with renewal result (status, failure reason)

### Phase 2: Scheduling (EE & CE)
- [x] Create `email-webhook-maintenance-workflow.ts` Temporal workflow (EE)
- [x] Create workflow activities wrapping `EmailWebhookMaintenanceService`
- [x] Register workflow in `ee/temporal-workflows/src/workflows/index.ts`
- [x] Add client helper in `shared/workflow/init/registerWorkflowActions.ts` (Handled in `ee/temporal-workflows/src/client.ts` and `server/src/lib/jobs/index.ts`)
- [x] Create pg-boss job handler for CE daily renewal

### Phase 3: UI & Manual Controls
- [x] Create server action `retryMicrosoftSubscriptionRenewal`
- [x] Update `EmailSettings` UI to show "Subscription expires in..." column
- [x] Add "Retry Renewal" button to `EmailSettings` provider table

## 1. Problem Statement
Inbound Microsoft 365 mailboxes rely on Microsoft Graph change notifications to trigger the `INBOUND_EMAIL_RECEIVED` event stream that ultimately feeds the Temporal `system-email-processing-workflow` (`shared/workflow/workflows/system-email-processing-workflow.ts`). Each webhook subscription expires after ~72 hours and must be renewed before expiration. Today:
- `MicrosoftGraphAdapter.renewWebhookSubscription` exists (`server/src/services/email/providers/MicrosoftGraphAdapter.ts:417`) but nothing schedules or invokes it for email providers.
- After a subscription expires, `server/src/app/api/email/webhooks/microsoft/route.ts` never receives notifications; `EmailWebhookService` (`server/src/services/email/EmailWebhookService.ts`) therefore stops enqueueing jobs, Redis never emits `INBOUND_EMAIL_RECEIVED`, and tickets/comments are no longer created by `system-email-processing-workflow`.
- Operators must manually delete/recreate providers to regain coverage, which is error-prone and risky for hosted tenants.

We need an automatic renewal + recovery loop so Microsoft 365 inbound email continues to flow without manual work and we can detect/report failures quickly.

## 2. Goals
1. Automatically renew every active Microsoft inbound email subscription at least 24 hours before it expires, per tenant.
2. Automatically recreate subscriptions that are missing or rejected during renewal (404 → new `POST /subscriptions`), and persist the new IDs/expiration metadata in `microsoft_email_provider_config`.
3. Surface renewal health in `email_provider_health` and the Email Settings UI so operators can see when the last renewal ran, its result, and the next expiration.
4. Emit actionable alerts/events (PostHog + structured logs) when renewals fail repeatedly so support teams intervene before inbound mail stops flowing.
5. Keep CE and EE parity: CE handles renewal and queue continuity; EE additionally forwards failures into workflow/analytics stacks without forking code paths.

## 3. Non-Goals
- Gmail Pub/Sub watch automation (already handled separately via topic refresh).  
- Changing ticket creation logic in `system-email-processing-workflow` beyond consuming steady events.  
- Overhauling OAuth onboarding or adding delegated mailbox discovery (tracked elsewhere).  
- Outbound mail renewals (Resend / Managed Domains) — only inbound Microsoft Graph change notifications are in scope here.

## 4. Current State Summary
- **Webhook ingestion**: Microsoft Graph webhooks hit `server/src/app/api/email/webhooks/microsoft/route.ts`, which loads provider metadata from `microsoft_email_provider_config`, validates `clientState`, and enqueues jobs through `EmailWebhookService` → `EmailQueueService` (Redis) → `EmailProcessor` (`server/src/services/email/EmailProcessor.ts`).  
- **Event flow**: `EmailProcessor` emits `INBOUND_EMAIL_RECEIVED` via the Redis event bus, which the Temporal worker consumes to run `system-email-processing-workflow.ts` (see `docs/inbound-email/architecture/workflow.md`).  
- **Provider storage**: `email_providers` holds common metadata; `microsoft_email_provider_config` stores tokens + webhook fields (migration `server/migrations/20250714081528_create_vendor_email_config_tables.cjs`). `EmailProviderService` maps these rows to `EmailProviderConfig` (`server/src/interfaces/email.interfaces.ts`).  
- **Existing renewal logic**: `MicrosoftGraphAdapter` can patch `/subscriptions/{id}` to extend expiration and updates `webhook_expires_at`, but nothing schedules this call. Calendar webhooks already have a `renew-microsoft-calendar-webhooks` pg-boss job (`server/src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts`), which demonstrates the renewal query pattern even though EE email providers will rely on Temporal for orchestration.  
- **Health visibility**: `email_provider_health` exists (`server/migrations/20250601000000_create_email_system_tables.cjs`) but is unused for inbound webhooks, so we cannot alert on renewal failures. UI under `/server/src/components/admin/EmailSettings.tsx` shows limited status, without subscription metadata.  
- **Docs**: `docs/inbound-email/architecture/overall.md` is still a placeholder and does not mention webhook lifecycle, making on-call handoffs harder.

## 5. Solution Overview
We will introduce an **Email Webhook Maintenance Service** that discovers Microsoft providers needing attention, renews or recreates their subscriptions via the existing adapter, and records health metrics. On Enterprise Edition we will schedule that service via a dedicated Temporal Cron workflow (15-minute cadence by default) so we gain end-to-end visibility in the Temporal UI, native retries, and workflow history. Community Edition — which does not run Temporal — will rely on a lightweight pg-boss job that runs once per day (sufficient for CE’s smaller footprint) plus an optional manual CLI trigger. Renewal results flow into `email_provider_health`, logs, and (for EE) PostHog/Temporal observability hooks. The Email Settings UI gains a “Subscription” column and manual “Retry renewal” action that calls the same service.

### 5.1 Renewal Candidate Discovery
1. Query `email_providers` ⨝ `microsoft_email_provider_config` for active (`is_active = true`) Microsoft rows with any of:
   - `webhook_subscription_id` null/empty (never initialized).  
   - `webhook_expires_at` null or within `lookAheadMinutes` (default 1440 = 24h).  
   - `last_subscription_renewal` older than `renewalIntervalMinutes` (safety net).  
2. Guard with `FOR UPDATE SKIP LOCKED` (or update-returning) scoped to the tenant to prevent duplicate renewals if two workers overlap.  
3. Convert each row into an `EmailProviderConfig` instance (reuse `EmailProviderService.getProvider` to hydrate OAuth secrets).  

### 5.2 Renewal / Recovery Flow
For each candidate provider:
1. Instantiate `MicrosoftGraphAdapter` with provider config. The adapter already loads tokens from the vendor config or secrets provider.  
2. If `webhook_subscription_id` exists, call `renewWebhookSubscription()`.  
   - If Graph returns 404/ResourceNotFound, fall back to `registerWebhookSubscription()` to fully recreate the subscription (using stored folder filters + derived webhook URL).  
3. Persist new `webhook_subscription_id`, `webhook_expires_at`, and `last_subscription_renewal` in `microsoft_email_provider_config`.  
4. Update `email_provider_health` row for the provider with fields like:
   - `subscription_status` (enum: healthy, renewing, error)  
   - `subscription_expires_at`, `last_renewal_attempt_at`, `last_renewal_result`, `failure_reason`  
   - `last_notification_received_at` (optional future enhancement by backfilling from webhook route).  
5. Emit structured log + PostHog event (EE) for success/failure. On >3 consecutive failures mark the provider `connection_status = 'error'` in `email_providers` and surface to UI.  

### 5.3 Observability & Operations
- **Temporal scheduling (EE)**: Add an EE-only workflow (e.g., `ee/temporal-workflows/src/workflows/email-webhook-maintenance-workflow.ts`) that invokes the maintenance service as an activity on a 15-minute Cron schedule per tenant. Wire it through `ee/temporal-workflows/src/workflows/index.ts` and expose a workflow client helper so server actions and the UI can trigger ad-hoc runs or retry signals.  
- **pg-boss scheduling (CE)**: Register a CE-only pg-boss recurring job (24-hour cadence) that calls the same maintenance service. The daily interval keeps load minimal while ensuring expired subscriptions are caught within a day.  
- **Manual controls**:  
  - Server action `retryMicrosoftSubscriptionRenewal(providerId)` under `server/src/lib/actions/email-actions`.  
  - CLI / script (optional) for on-call to run `node scripts/email/renew-microsoft-webhook.cjs --tenant ... --provider ...`.  
- **UI**: Extend Email Settings table to show “Subscription expires in Xh” and add a “Retry renewal” button that calls the action. Gate the button per-provider to avoid duplicates (disable while job is running).  
- **Docs/runbook**: Update `docs/inbound-email/architecture/overall.md` with the webhook lifecycle + renewal loop. Add an operations runbook under `docs/inbound-email/operations/microsoft-renewal.md` capturing alerts, manual commands, and expectations.  

## 6. Phased Work Breakdown

### Phase 0 – Data & Observability Foundations (0.5 sprint)
1. Add missing columns to `email_provider_health` (`subscription_status`, `subscription_expires_at`, `last_renewal_attempt_at`, `last_renewal_result`, `failure_reason`) via a migration.  
2. Backfill `microsoft_email_provider_config.webhook_expires_at` and `webhook_subscription_id` for any providers missing values (call Graph `GET /subscriptions/{id}` where possible, else schedule re-registration).  
3. Instrument `server/src/app/api/email/webhooks/microsoft/route.ts` to write `last_notification_received_at` to `email_provider_health` so we can detect silent failures independent of renewals.  
4. Add structured logging helpers (shared logger wrapper) for all webhook lifecycle operations (register, renew, delete) with tenant/provider context.

### Phase 1 – Renewal Service & Scheduler (1 sprint)
1. Create `EmailWebhookMaintenanceService` (`server/src/services/email/EmailWebhookMaintenanceService.ts`) that exposes `renewMicrosoftWebhooks({ tenantId, lookAheadMinutes })`.  
2. Implement SQL queries using the admin connection (`@alga-psa/shared/db/admin`) to fetch candidate providers with locking semantics.  
3. Within the service, instantiate `MicrosoftGraphAdapter` and call `renewWebhookSubscription` or `registerWebhookSubscription` per provider, handling 404/410 gracefully.  
4. Centralize persistence updates (webhook fields + `email_provider_health`) so both the job and manual UI reuse the same code.  
5. Implement `ee/temporal-workflows/src/workflows/email-webhook-maintenance-workflow.ts` plus activities that call `EmailWebhookMaintenanceService`, emit telemetry, and accept signals to force immediate renewal.  
6. Register the workflow in the EE worker (`ee/temporal-workflows/src/workflows/index.ts`), add a helper client in `shared/workflow/init/registerWorkflowActions.ts`, and schedule a Cron run per tenant via Temporal APIs (storing schedule metadata per tenant/edition). For CE, wire up a pg-boss recurring job (`*/1440` minutes) that invokes the same service without Temporal.  
7. Provide configuration knobs via env vars: `MICROSOFT_EMAIL_RENEWAL_LOOKAHEAD_MINUTES`, `MICROSOFT_EMAIL_RENEWAL_FAILURE_THRESHOLD`, `MICROSOFT_EMAIL_RENEWAL_BATCH_SIZE`.  

### Phase 2 – Failure Handling, UI, and Alerts (1 sprint)
1. Extend `EmailProviderService.updateProviderStatus` to mark providers `error` after `n` consecutive renewal failures and optionally disable inbound processing to avoid silent drops.  
2. Implement manual “Retry renewal” action + button in the Email Settings UI (likely in `server/src/components/admin/EmailSettings.tsx` or the newer settings tabs). Ensure dialog IDs satisfy `docs/AI_coding_standards.md`.  
3. Fire PostHog events (`email_provider.subscription_renewal_success` / `_failure`) inside EE builds (use `ee/server/src/lib/analytics/posthog.ts`).  
4. Add optional Slack/Email notifications via `SharedNotificationService` when a provider remains in error for >1 hour.  
5. Update docs: finish `docs/inbound-email/architecture/overall.md` with diagrams connecting webhooks → Redis → Temporal and highlight the renewal scheduler.  

### Phase 3 – Testing, Migration & Rollout (0.5 sprint)
1. Expand WireMock fixtures under `test-config/wiremock-oauth/microsoft-oauth.json` to cover renewal success, 404, and throttling responses.  
2. Add unit tests for `EmailWebhookMaintenanceService` (using mocked adapters) and integration tests that simulate expiring subscriptions to ensure the job renews them and records health rows.  
3. Add regression tests ensuring `EmailProcessor` still emits `INBOUND_EMAIL_RECEIVED` when jobs fire concurrently (queue + workflow).  
4. Create a rollout checklist: enable the Temporal schedule in staging, monitor `email_provider_health` metrics + workflow histories, then promote to production tenants gradually (toggle lookAhead from 720 → 1440 once stable).  
5. Provide a backfill job to enqueue an immediate renewal for all tenants after deployment to ensure consistent state.

## 7. Data & Schema Considerations
- **`microsoft_email_provider_config`** already stores `webhook_subscription_id`, `webhook_expires_at`, `webhook_verification_token`, and OAuth secrets. No schema changes needed beyond ensuring indexes exist (`server/migrations/20250818014500_index_ms_webhook_columns.cjs`).  
- **`email_provider_health`** needs new columns enumerated in Phase 0; distribute the table in Citus migrations (`ee/server/migrations/citus/...`).  
- Consider materializing a view (or updating `email_provider_configs`) that exposes `subscription_expires_at` so APIs/UI don’t need to read vendor tables directly.  
- Store consecutive failure count either inside `email_provider_health` (simple integer) or as JSON metadata.

## 8. Testing Strategy
1. **Unit tests**:  
   - Mock Microsoft Graph responses (renew success, 404, throttling) to ensure the service retries/re-registers correctly.  
   - Verify DB persistence logic updates both `microsoft_email_provider_config` and `email_provider_health`.  
2. **Integration tests** (`server/src/test/integration/...`):  
   - Spin up WireMock (existing `test-config/wiremock-oauth/microsoft-oauth.json`) to simulate expiring subscriptions, then run the maintenance handler and assert webhook expiration extends.  
   - Feed a fake webhook notification after renewal to ensure `EmailWebhookService` processes it end-to-end (Redis queue + Temporal stub).  
3. **End-to-end smoke**:  
   - In staging, configure a Microsoft test tenant, wait for expiration threshold, verify job renews automatically (monitor logs + DB).  
   - Validate UI shows updates and manual “Retry renewal” triggers the same service.  
4. **Chaos testing**:  
   - Revoke Graph subscriptions manually and confirm the job recreates them.  
   - Force invalid tokens to ensure renewal surfaces an actionable error and does not loop infinitely.

## 9. Risks & Mitigations
- **Token expiration / revoked consent**: Renewal will fail until OAuth tokens are refreshed. Mitigation: detect `invalid_grant` responses, mark provider as `error`, and notify admins to reauthorize.  
- **Schedule overlap causing double renewals**: Use DB-level locking and per-provider idempotency (compare `webhook_expires_at` before updating) to avoid patch storms, and keep Temporal schedule concurrency at 1.  
- **Graph throttling**: Batch renewals with exponential backoff + jitter; respect 429 retry-after headers and rely on Temporal activity retries (EE) or pg-boss retry policies (CE fallback) to spread load.  
- **Partial migrations (old vs. new tables)**: Ensure the service reads from canonical vendor tables but writes back to any aggregated view (`email_provider_configs`) used by other services to avoid stale data.  
- **Alert fatigue**: Only alert after repeated failures and include remediation instructions (re-auth, contact Microsoft, etc.).  

## 10. Open Questions / Follow-Ups
1. Should we migrate `email_provider_configs` (new unified table) to be the single source of truth before building the service, or can we rely on the vendor tables short-term?  
2. Do we need to renew subscriptions per mailbox folder (multiple `folder_filters`), or is the first entry sufficient? If multiple, we may need to store multiple subscription IDs per provider.  
3. How should we handle tenants with thousands of shared mailboxes? Do we throttle per tenant or globally?  
4. Should we raise a Temporal workflow signal/event when a provider enters `error` so downstream automations pause/resume gracefully?  
5. Do we also want to auto-delete orphaned subscriptions (Graph still has them, but provider removed)? Possibly add cleanup later.

---

**Next Steps:** get architecture/product sign-off on this plan, then create engineering tickets by phase (Phase 0 foundations first). Ensure the on-call runbook reflects the new job before rollout.
