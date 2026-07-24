# PRD: Tenant-Wide Suspension of Background Activity for Cancelled Tenants

- Status: Approved direction (scope questions answered by owner 2026-07-24)
- Date: 2026-07-24
- Owner: Natallia Bukhtsik
- Plan folder: `ee/docs/plans/2026-07-24-tenant-suspension-cancelled-tenants/`
- Predecessor: `ee/docs/plans/2026-07-23-inbound-email-pause-cancelled-tenants/` (inbound email pause)

## 1. Problem Statement

When a tenant cancels, the deletion workflow deactivates users and (since the predecessor plan) pauses inbound email. **Everything else keeps running for the ~90-day grace window.** A full audit (see SCRATCHPAD for the inventory) found that the inbound-email pause is the *only* cancellation-aware guard in the entire background-processing surface. For a cancelled tenant, today:

- RMM pollers (NinjaOne/Tactical/Huntress, every 5–60 min) and inbound RMM webhooks keep ingesting alerts and **creating tickets**, which send contact-facing notification emails — the same incident class that motivated the email pause.
- The renewal-queue job keeps **creating renewal tickets** daily.
- The auto-close job (15 min) sends auto-close warnings and fires close side-effects (emails/surveys) to the tenant's customers.
- SLA timers publish threshold events → escalation notifications.
- Marketing sequences keep **sending the MSP's outbound marketing emails**.
- Customer-authored scheduled workflows keep executing arbitrary actions.
- Accounting sync (QBO/Xero, 15 min), calendar webhook renewals, Entra sync, Hudu sync, and Teams subscription renewals keep churning external APIs.
- Time periods, billing cycles, and credit jobs keep accruing rows nightly.
- Public endpoints (anonymous booking, marketing capture) keep accepting submissions and emailing confirmations to real humans on behalf of a product the MSP has left.
- API keys remain valid to any consumer that does not load the owning user (`/api/auth/validate-api-key` reports them valid).

No recurring process reads `pending_tenant_deletions` or any tenant status. The only ripple from cancellation is `users.is_inactive`, which suppresses staff-facing notifications but nothing customer-facing or machine-driven.

## 2. Goals

- G1: Within minutes of the deletion workflow starting, all recurring background work, event-triggered workflow execution, RMM ingestion, and customer-facing outbound email for that tenant stops.
- G2: Win-back rollback restores everything automatically by clearing a single flag — no per-subsystem re-registration, no data loss (gates are pure: nothing is torn down or deleted).
- G3: One source of truth (`tenants.suspended_at`) enforced at a small number of chokepoints rather than ~20 per-job guards.
- G4: API keys stop authenticating for suspended tenants (and for deactivated owning users), reversibly.
- G5: Anonymous public endpoints stop accepting work for suspended tenants with a neutral "temporarily unavailable" response.
- G6: Tenants already in `pending_tenant_deletions` when this ships get suspended via a one-off, rerunnable backfill.
- G7: Nine Minds' win-back and reactivation machinery is never impaired: login win-back hook, reactivation emails (SystemEmailService), Stripe/billing reactivation paths, and the deletion workflow itself are exempt by construction.

## 3. Non-Goals

- No tenant-level gate in the login/auth layer. Users are already deactivated by the workflow; the login win-back hook depends on login attempts reaching it. (The client-user-invited-during-window edge stays open; revisit if it ever occurs.)
- No external subscription teardown for calendar/Teams/Entra/RMM. Gating stops renewals; remote subscriptions expire naturally; final deletion cleans up. (Mirrors the email plan's "DB gate is authoritative" philosophy.)
- No API-key revocation or any destructive state change — suspension is purely a reversible gate.
- No changes to SystemEmailService (cancellation confirmation, win-back, reactivation password reset must keep sending).
- No changes to `services/ai-gateway`.
- No pausing of already-running EE per-ticket SLA Temporal workflows. New tickets stop (RMM/email/renewals gated), and contact-facing emails die at the outbound-email gate, which covers the visible effects.
- No monitoring/metrics additions; no admin UI for manual tenant suspension (the reason column leaves room for a future `'manual'`).
- No changes to the 90-day grace period or deletion table ordering.

## 4. Users and Primary Flows

- **Cancelled tenant (automatic):** deletion workflow → *(existing)* deactivate users → *(existing)* suspend inbound email → *(new)* stamp `tenants.suspended_at = now(), suspended_reason = 'tenant_cancelled'` → all chokepoint gates go inert for that tenant.
- **Win-back (automatic):** rollback signal → *(existing)* reactivate users, resume email → *(new)* clear `suspended_at`/`suspended_reason` where reason is `'tenant_cancelled'` → all gates reopen; self-rescheduling job chains resume on their next tick because they skip-and-reschedule rather than terminate.
- **Nine Minds operator:** runs the backfill once after deploy to suspend tenants already pending deletion (including `failed` deletions, which otherwise run background work indefinitely).

## 5. Design

### 5.1 Data model

CE migration (hasColumn-guarded, like other `tenants` alters):

- `tenants.suspended_at TIMESTAMPTZ NULL`
- `tenants.suspended_reason TEXT NULL` — `'tenant_cancelled'` (only value for now)
- CHECK: both null, or `suspended_at` set with `suspended_reason IN ('tenant_cancelled')`.

Semantics: a tenant is **suspended** iff `suspended_at IS NOT NULL`. Naming is deliberately neutral (generic suspension, not deletion-specific) so no tenant-lifecycle detail leaks into the OSS tree.

Shared helper (`@alga-psa/shared`): `isTenantSuspended(knex, tenantId)` (single PK lookup, **fail-open** — a flag-read error is treated as not-suspended so an infra hiccup can never halt active tenants), `suspendTenant(knex, tenantId, reason)` (idempotent: only stamps when currently null), `resumeTenant(knex, tenantId, reason)` (clears only a matching reason, preserving any future manual suspension).

### 5.2 Chokepoint gates

All gates are read-only checks against `tenants.suspended_at`; none mutate integration/config rows.

1. **Job dispatch (single highest-leverage seam):** `JobHandlerRegistry.execute` skips any job whose `data.tenantId` belongs to a suspended tenant — the job completes successfully as a logged skip (no retry, no DLQ). Covers every per-tenant pg-boss/generic-job handler on both CE and EE planes, including jobs registered before suspension happened (long-lived scheduler processes).
2. **Fan-out enumerations (avoid scheduling work at all):** `maintenanceJobFanout` tenants query, `listMarketingTenantIds`, CE `initializeScheduledJobs` tenant enumeration, and the Entra schedule-config loader all exclude suspended tenants.
3. **Self-rescheduling chains skip-not-kill:** the nightly time-period chain, billing-cycle creation, and accounting-sync cycle skip their work for suspended tenants but keep rescheduling, so win-back resumes them with no operator action. (A chain that terminates on suspension would never restart.)
4. **RMM:** the polling reconciler excludes suspended tenants when enumerating `rmm_integrations` (kills the per-integration recurring polls at the source, in addition to gate 1); the Tactical, NinjaOne, and LevelIO webhooks ack 2xx and drop notifications for suspended tenants with a debug log (2xx so the remote does not retry/alert; mirrors the email webhook pattern).
5. **Workflow engine:** `WorkflowRuntimeV2EventStreamWorker.processEvent` acks and skips events for suspended tenants before any workflow run is created (debug log; fail-open on flag-read error).
6. **API keys:** `ApiKeyService.validateApiKey` (and the server-side `validateApiKeyForTenant`/`validateApiKeyAnyTenant`) reject keys whose owning user is inactive **or** whose tenant is suspended, so `/api/auth/validate-api-key` and every consumer converge with the "users deactivated ⇒ no API access" model. Reversible: reactivation restores keys untouched.
7. **Public endpoints:** anonymous appointment booking and marketing-capture routes return a neutral generic "temporarily unavailable" error for suspended tenants before persisting anything or emailing anyone (no tenant-status detail leaked). Calendar webhooks (Google/Microsoft) ack-and-drop.
8. **Outbound email belt-and-braces:** the tenant-scoped email send seam drops sends for suspended tenants with a log line. Guarantees no customer-facing email leaves a suspended tenant even if some generator was missed. SystemEmailService is untouched (win-back/reactivation mail keeps flowing).

### 5.3 Tenant cancellation integration (EE, Temporal)

- New activity `suspendTenantBackgroundActivity(tenantId)`: stamps the flag via the shared helper. Idempotent; contained errors (suspension must never strand deletion — the chokepoint gates are progressively applied but user deactivation already happened).
- Invoked in `tenantDeletionWorkflow` immediately after `suspendTenantEmailIngestion`, guarded by `patched('tenant-deletion-suspend-tenant-v1')` with a new `suspending_tenant_activity` step marker (in-flight workflows parked on 90-day timers replay safely; the backfill covers them).
- New activity `resumeTenantBackgroundActivity(tenantId)`: clears the flag where reason is `'tenant_cancelled'`. Query failures **propagate** so Temporal retries (lesson from the email plan review: a swallowed transient failure here would strand a won-back tenant suspended). Invoked in `handleRollback` after `resumeTenantEmailIngestion`, guarded by `patched('tenant-deletion-resume-tenant-v1')`, wrapped in a workflow-level try/catch so rollback itself never fails.

### 5.4 Backfill

One-off operator procedure (deliberately not shipped in this repository): stamps `suspended_at` for tenants in `pending_tenant_deletions` statuses `pending | awaiting_confirmation | confirmed | failed` that are not yet suspended. Rerunnable and idempotent; run by a Nine Minds operator right after deploy, alongside the equivalent inbound-email pause backfill.

## 6. Risks

- **The fan-out and dispatch gates sit on paths shared by every active tenant.** A logic error there is a platform-wide background outage. Mitigation: fail-open on flag-read errors, and every gate has an explicit "non-suspended tenant passes through" regression test.
- **CE scheduler staleness:** jobs registered before suspension keep firing until process restart — this is exactly why gate 1 (dispatch-time check) exists; enumeration filters are an optimization, not the enforcement.
- **Suspension flag drift:** if a rollback ever bypasses the Temporal path, the flag could stay set. The reason-scoped `resumeTenant` and the rerunnable backfill make repair trivial; reactivation-path integration is asserted by contract tests.

## 7. Acceptance Criteria

- Suspending a tenant (workflow step or backfill) stops: per-tenant job handler execution, new job scheduling, RMM polling and webhook ingestion, event-triggered workflow runs, API-key authentication, public form submissions, and tenant-scoped outbound email — each verified by tests.
- A suspended tenant produces zero new tickets, zero customer-facing emails, and zero external RMM/accounting/calendar API calls from recurring jobs.
- Rollback clears the flag and every gate reopens without manual intervention; self-rescheduling chains resume on their next tick.
- Non-suspended tenants are completely unaffected by every gate (regression tests).
- Win-back emails, reactivation flows, and the deletion workflow itself function identically before/during/after suspension.
- Backfill is idempotent and covers `failed` deletions.
