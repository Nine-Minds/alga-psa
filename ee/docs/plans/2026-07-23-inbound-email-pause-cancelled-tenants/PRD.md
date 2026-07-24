# PRD: Pause Inbound Email Ingestion for Cancelled Tenants (and Manual Per-Inbox Pause)

- Status: Draft (investigation complete, awaiting review)
- Date: 2026-07-23
- Owner: Natallia Bukhtsik
- Plan folder: `ee/docs/plans/2026-07-23-inbound-email-pause-cancelled-tenants/`

## 1. Problem Statement

When a tenant cancels their subscription, inbound email → ticket processing keeps running for the entire ~90-day deletion grace period. Cancellation deactivates the tenant's users (`users.is_inactive = true`) and starts the EE tenant-deletion Temporal workflow, but it never touches `email_providers`, live Microsoft Graph subscriptions, or Gmail watches. Result (observed in production today): a tenant cancelled hours earlier still receives inbound mail, creates tickets (`[Ticket #CF-000761] …`), and sends "Your Ticket Has Been Created" notification emails to external senders — from a product the customer believes they've left.

Three compounding defects found during investigation:

1. **Cancellation never suspends email.** The tenant-deletion workflow (`ee/temporal-workflows/src/workflows/tenant-deletion-workflow.ts`) deactivates users but leaves all `email_providers` rows `is_active=true` and external subscriptions live for up to 90 days.
2. **The Microsoft inbound path ignores `is_active`.** The Google Pub/Sub handler (`packages/integrations/src/webhooks/email/handlers/googleWebhookHandler.ts:136-141`) and the IMAP handler (`packages/integrations/src/webhooks/email/imap.ts:91-97`) filter on `is_active`; the Microsoft handler (`.../microsoftWebhookHandler.ts:138-158`) does not, and neither does the unified queue consumer (`server/src/services/email/unifiedInboundEmailQueueJobProcessor.ts:271,335,532`). So even manually deactivating a Microsoft provider does not stop ticket creation until the Graph subscription self-expires.
3. **External subscriptions are never unregistered.** Neither provider deletion (`server/src/services/email/EmailProviderService.ts:366-410`) nor final tenant deletion calls Microsoft Graph `DELETE /subscriptions/{id}`; Gmail `users.stop` is an unimplemented TODO (`server/src/services/email/GmailWebhookService.ts:106-117`, commented out in `shared/services/email/providers/GmailAdapter.ts:337`).

## 2. Goals

- G1: Within minutes of the tenant-deletion workflow starting (any trigger source: Stripe webhook, Apple IAP, Nine Minds extension), all inbound email ingestion for that tenant stops — no new tickets, no ticket-created notification emails.
- G2: Tenant reactivation (win-back rollback signal) restores email ingestion automatically to its pre-cancellation state.
- G3: A provider marked inactive/paused is actually inert on **all** inbound paths, including Microsoft (webhook layer + queue-consumer defense in depth).
- G4: Pausing/suspending/deleting a provider tears down its external subscription (Graph subscription delete, Gmail `users.stop`) so the platform stops receiving notifications at the source, not just ignoring them.
- G5: A tenant admin can manually pause and resume a single inbox from the email-provider settings UI, independent of cancellation.
- G6: Tenants **already** in `pending_tenant_deletions` when this ships (e.g. the tenant from today's incident) get their email ingestion suspended via a one-off backfill.

## 3. Non-Goals

- No backfill/replay of emails that arrive while a provider is paused. On resume, ingestion restarts from new notifications only; missed messages stay in the customer's mailbox untouched. (Documented in UI copy.)
- No gating of outbound notification emails as a separate mechanism — stopping ingestion stops the ticket-created emails shown in the incident. Existing notification settings remain the tool for outbound control.
- No changes to `services/ai-gateway` (its Stripe webhook and `ai_accounts` status are a separate billing surface).
- No monitoring/metrics/alerting additions.
- No changes to the 90-day grace period, win-back emails, or deletion table ordering.

## 4. Users and Primary Flows

- **Cancelled tenant (automatic):** subscription ends → Stripe `customer.subscription.deleted` → `StripeService.handleSubscriptionDeleted` (`ee/server/src/lib/stripe/StripeService.ts:1558`) → tenant-deletion workflow → *(new)* suspend-email activity → inbound mail no longer creates tickets. If they reactivate via win-back, ingestion resumes automatically.
- **MSP admin (manual):** Settings → Integrations → Email Providers → "Pause" on one inbox → inbound processing for that mailbox stops and its external subscription is torn down. "Resume" re-registers the webhook/watch and processing continues.
- **Nine Minds operator:** runs the backfill script once after deploy to suspend email for all tenants currently pending deletion.

## 5. Design

### 5.1 Data model

New nullable columns on `email_providers` (CE migration; table defined in `server/migrations/20250712214434_add_email_providers_table.cjs`):

- `inbound_paused_at TIMESTAMPTZ NULL`
- `inbound_pause_reason TEXT NULL` — `'manual'` | `'tenant_cancelled'`

Semantics:

- `is_active` keeps its current meaning (provider configured on/off by the user; long-term switch).
- **Paused** = `inbound_paused_at IS NOT NULL`. A provider is *ingestable* only when `is_active = true AND inbound_paused_at IS NULL`. Every inbound path enforces this predicate.
- The reason column lets tenant reactivation resume **only** `'tenant_cancelled'` pauses while preserving deliberate `'manual'` pauses. `is_active` is never mutated by the cancellation flow, so the pre-cancellation configuration survives round-trips exactly.

### 5.2 Ingestion gating (fix + defense in depth)

- Microsoft webhook handler: add `is_active = true` to the provider lookup (parity with Google) **and** `inbound_paused_at IS NULL`; on mismatch, ack the notification (202) without enqueueing, with a debug log. (`microsoftWebhookHandler.ts:138-158`, enqueue at `:219`.)
- Google webhook handler and IMAP handler: extend their existing `is_active` checks with `inbound_paused_at IS NULL`.
- Unified queue consumer: the three provider-config fetches (`unifiedInboundEmailQueueJobProcessor.ts:271` Microsoft, `:335` Google, `:532` IMAP) re-check the ingestable predicate; a gated job **completes successfully as a skip** — no ticket, no DLQ, no `email_processed_messages` failure row. This catches jobs already enqueued at pause time and any webhook race.

### 5.3 External subscription teardown / re-registration

- Implement Gmail watch stop (`users.stop`) in `GmailAdapter` and wire `GmailWebhookService` to it (replaces the TODO).
- Expose Graph subscription deletion in `MicrosoftGraphAdapter` for use outside renewal (delete by stored `webhook_subscription_id`; currently deletion exists only inside renewal pruning, `MicrosoftGraphAdapter.ts:448,464,1356,1379`).
- New `EmailProviderService` operations:
  - `pauseProvider(id, reason)` — set pause columns; best-effort external teardown (Graph delete / Gmail stop / IMAP no-op); clear `webhook_subscription_id`/`webhook_expires_at` (Microsoft) and `watch_expiration` (Google) so renewal jobs have nothing to renew. External-call failure logs a warning but the pause still commits (the DB gate makes ingestion inert regardless).
  - `resumeProvider(id)` — clear pause columns; re-run `initializeProviderWebhook` (`EmailProviderService.ts:415`) for webhook-mode providers. If re-registration fails (e.g. OAuth tokens expired while paused), the provider stays resumed but `status='error'` with a message surfaced in the UI.
- `deleteProvider` gains the same external teardown before deleting rows.
- Renewal jobs exclude paused providers: Microsoft maintenance candidate query (`shared/services/email/EmailWebhookMaintenanceService.ts:220`) and Gmail watch renewal (`packages/jobs/src/lib/handlers/googleGmailWatchRenewalHandler.ts:26`) add `inbound_paused_at IS NULL`. The maintenance service's silent-run/probe logic also skips paused providers so it doesn't "repair" or penalize them.

### 5.4 Tenant cancellation suspension (EE, Temporal)

- New activity `suspendTenantEmailIngestion(tenantId)`: for every provider of the tenant with `is_active = true AND inbound_paused_at IS NULL`, call `pauseProvider(id, 'tenant_cancelled')`. Idempotent; per-provider errors are logged and do not abort the loop; the activity never fails the workflow (email suspension must not block deletion, and the DB gate is the real stop).
- `tenantDeletionWorkflow` invokes it immediately after `deactivateAllTenantUsers` (workflow step order at `tenant-deletion-workflow.ts:85` onward), for **all** trigger sources.
- New activity `resumeTenantEmailIngestion(tenantId)`: resume every provider with `inbound_pause_reason = 'tenant_cancelled'` (manual pauses untouched). Invoked from the rollback/reactivation path (`tenant-deletion-workflow.ts:458-563`). Re-registration failures mark `status='error'` and never fail reactivation.
- Final-deletion phase: before `deleteTenantData` drops the email tables, run external teardown for any remaining subscriptions (idempotent; covers workflows started before this feature and providers whose teardown failed at suspend time).
- **Temporal determinism:** in-flight deletion workflows are parked on 90-day timers and will replay against the new code. All new activity invocations must be guarded with the workflow `patched()` API so existing runs don't hit non-determinism failures.

### 5.5 Manual pause/resume UX

- API: pause/resume endpoints (or server actions) calling `EmailProviderService.pauseProvider/resumeProvider`, with the same auth/permission model as existing provider mutations.
- UI (`packages/integrations/src/components/email/EmailProviderList.tsx` / `EmailProviderCard.tsx`): Pause/Resume action per provider, a visible "Paused" badge, kebab-case `id` attributes on the new interactive elements, i18n keys for all copy (no hardcoded text), and helper copy noting that mail received while paused is not imported retroactively. Providers paused with reason `'tenant_cancelled'` render the same paused state (tenant users are locked out anyway; internal admin tooling can distinguish by reason).

### 5.6 Backfill for already-cancelled tenants

One-off script (or master-tenant-only admin endpoint alongside `ee/server/src/app/api/v1/tenant-management/*`) that iterates `pending_tenant_deletions` rows in status `pending`/`awaiting_confirmation`/`confirmed` and runs `suspendTenantEmailIngestion` for each. Run once after deploy; rerunnable (idempotent).

## 6. Risks & Mitigations

- **Graph/Gmail teardown API failures** (revoked consent, expired tokens): pause commits regardless; the DB gate guarantees inertness; teardown retried opportunistically at final deletion.
- **Resume cannot re-register** (tokens expired during a long pause): provider set to `status='error'`; user resolves via existing reconnect flow. Reactivated tenants see this in provider settings.
- **In-flight Temporal workflows**: mitigated by `patched()` guards (5.4).
- **Race: notification in queue when pause lands**: covered by the consumer-side gate (5.2).
- **Citus**: all new queries/updates carry `tenant` in WHERE/JOIN per multi-tenant rules; new columns are on an existing distributed table, no PK change.

## 7. Acceptance Criteria / Definition of Done

1. Starting a tenant-deletion workflow (any trigger) pauses all of that tenant's active email providers with reason `tenant_cancelled`, and a Graph/Gmail notification arriving afterward creates no ticket and sends no notification email.
2. A Microsoft provider with `is_active=false` (pre-existing bug) no longer produces tickets, even with a live Graph subscription.
3. A job already enqueued when the pause happens is skipped by the consumer (no ticket, no DLQ entry).
4. Pausing a provider deletes its Graph subscription / stops its Gmail watch (verified by the external API call being issued); renewal jobs skip paused providers.
5. Resuming a provider re-registers its webhook/watch and new inbound mail creates tickets again; resume failure surfaces as provider `status='error'` without blocking the resume.
6. Tenant reactivation resumes exactly the providers paused with reason `tenant_cancelled`; a provider manually paused before cancellation stays paused after reactivation.
7. Backfill run suspends email for all tenants currently pending deletion; running it twice is a no-op.
8. In-flight tenant-deletion workflows continue/replay without non-determinism errors.
9. All new UI strings use i18n keys; all new interactive elements have kebab-case `id`s.

## 8. Decisions (resolved with product owner, 2026-07-23)

- **Permissions:** manual pause/resume uses the same permission as configuring an email provider (existing provider-mutation permission).
- **Reactivation:** auto-resume — reactivation automatically resumes providers paused with reason `tenant_cancelled` (manual pauses preserved).
- **Backfill scope confirmed:** the workflow-step suspension only fires for cancellations that happen after deploy; tenants already in `pending_tenant_deletions` are parked past that step on the 90-day timer, so the one-off backfill (5.6) is required to stop their email ingestion. It covers statuses `pending`/`awaiting_confirmation`/`confirmed` and is rerunnable.
- **Incident tenant (2026-07-23):** no immediate manual mitigation — it is handled by the backfill together with all other pending-deletion tenants.

## 9. Open Questions

None.
