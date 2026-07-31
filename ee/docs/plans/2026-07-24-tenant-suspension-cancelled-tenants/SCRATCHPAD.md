# Scratchpad: tenant-wide suspension for cancelled tenants

## Decisions (2026-07-24, owner-confirmed)

- **Source of truth:** `tenants.suspended_at` + `suspended_reason` (CE schema, EE-stamped). Neutral naming on purpose — no tenant-lifecycle detail in OSS tree. Chosen over deriving from `pending_tenant_deletions` (EE table; CE code paths can't cleanly depend on it; status-set query vs null check on hot paths).
- **API keys:** gate at validation, not revoke. Owner's model: "all users deactivated ⇒ no API access". Today that's only partially true (validateApiKey checks the key row alone; `/api/auth/validate-api-key` reports gated keys valid). So validation gains owner-inactive + tenant-suspended checks. Fully reversible on win-back.
- **Public forms:** neutral generic "temporarily unavailable" (no tenant-status leak); webhooks ack-and-drop (2xx so remotes don't retry/alert — mirrors email pattern).
- **Outbound email:** yes to belt-and-braces gate at the tenant email send seam. SystemEmailService untouched (win-back / cancellation-confirmation / reactivation emails must keep flowing).
- **Fail-open everywhere:** a suspension-flag read error must never halt active tenants. The gates protect a handful of cancelled tenants; the failure mode must not be a platform outage.
- **Skip-not-kill for self-rescheduling chains** (time periods `server/src/lib/initializeApp.ts:504-644`, billing cycles `:466`, accounting cycle): a chain that terminates on suspension never restarts after win-back; it must skip work and keep rescheduling.
- **No login/auth tenant gate:** users are already deactivated, and the login win-back hook (`ee/server/src/lib/auth/loginWinback.ts`) fires on login attempts by inactive users — a tenant-level auth wall would break win-back.
- **Backfill includes `failed` deletions** (same reasoning as the email backfill fix: a failed deletion leaves background work running indefinitely; prod has ≥1 failed row).

## Key discovery: the dispatch seam

`JobHandlerRegistry.execute(name, jobId, data)` (`packages/jobs/src/lib/jobs/jobHandlerRegistry.ts:244`) is the single point through which per-tenant job handlers run, and `data.tenantId` is part of `BaseJobData`. One gate there covers all pg-boss handlers on both planes and — critically — jobs registered *before* suspension (CE scheduler registers per-tenant recurring jobs at process start; enumeration filters alone would leak until restart). Verify during implementation whether the EE Temporal generic-job worker also dispatches through `executeJobHandler` — if so the gate covers that plane too.

## Audit inventory (2026-07-24, two Explore agents; file:line verified then)

Ungated per-tenant background work (nothing below checks any tenant status):
- RMM: reconciler `packages/jobs/src/lib/handlers/rmmAlertPollingHandlers.ts:215` (every 5 min via `server/src/lib/initializeApp.ts:658`), per-integration polls 5–60 min; webhooks `server/src/app/api/webhooks/tacticalrmm/route.ts:35`, `ee/server/src/lib/integrations/ninjaone/webhooks/webhookHandler.ts:89` (re-exported CE), LevelIO `ee/server/src/app/api/webhooks/levelio/route.ts`. Creates tickets → contact emails.
- Renewal queue → renewal tickets: fan-out `packages/jobs/src/lib/maintenanceJobFanout.ts:96` (daily 05:00 EE `setupSchedules.ts:483`); handler contract-level filters only (`processRenewalQueueHandler.ts:322`).
- Auto-close (15 min): warnings + close side-effects to contacts (`autoCloseTicketsHandler.ts:406`).
- SLA: CE timer per-tenant 5 min (`initializeScheduledJobs.ts:338`, `slaTimerHandler.ts:35`); EE per-ticket Temporal workflows (non-goal v1).
- Marketing sends: `listMarketingTenantIds` (`marketing-activities.ts:32`), every 5 min.
- Customer scheduled workflows: `workflowScheduledRunHandlers.ts:80` — only checks schedule.enabled.
- Time periods nightly self-rescheduling chain: `initializeApp.ts:504-644` (only stops when tenant ROW deleted); billing cycles `initializeApp.ts:466`; credits x4; search reconcile; teams renewals/sweeps; premium-trial scan.
- Accounting sync (QBO/Xero) 15 min: `accountingSyncCycleHandler.ts` (EE-only guard, realm-connected guard, no tenant guard).
- Calendar: MS renewal `CalendarWebhookMaintenanceService.ts:102` (only cp.is_active); Google pubsub verify hourly; inbound calendar webhooks unguarded. NOTE: EE Temporal calendar-webhook-maintenance activity is a no-op stub (`calendar-webhook-maintenance-activities.ts:4-10`) — CE pg-boss is the live path.
- Entra sync: per-tenant Temporal schedules `setupSchedules.ts:441-470`, gate only on sync_enabled/add-on.
- Hudu auto-sync daily: connection+autoSync guards only.
- Event plane: `WorkflowRuntimeV2EventStreamWorker.processEvent` (`services/workflow-worker/src/v2/...:123-172`) — no tenant gate; publishes runs for any tenant.
- API keys: `packages/auth/src/services/apiKeyService.ts:120` checks key row only; `server/src/lib/services/apiKeyServiceForApi.ts:55,111`; `/api/auth/validate-api-key` route `server/src/app/api/auth/validate-api-key/route.ts:15` trusts it; user-context loads (`findUserByIdForApi.ts:29`) are what 401 user-scoped REST today.
- Public: booking `server/src/app/api/public/appointment-request/route.ts` (tenant-exists check only, `:176`; persists `:224`; emails requester `:276`); marketing capture `server/src/app/api/marketing/capture/[tenant]/[slug]/route.ts` → `publicEndpoints.ts:28`.
- `deactivateAllTenantUsers` (`tenant-deletion-activities.ts:784-806`) deactivates ALL user types incl. client portal — no user_type filter. Internal notification subscribers self-suppress via is_inactive; contact-facing emails (ticketEmailSubscriber, invoiceEmailHandler:89, booking confirmation) do NOT.

Already gated (predecessor plan): inbound email only — MS/Gmail renewal+reconcile queries filter `inbound_paused_at`.

## Gotchas / constraints

- **Temporal determinism:** in-flight deletion workflows are parked on 90-day timers; every new activity invocation needs `patched()` (markers: `tenant-deletion-suspend-tenant-v1`, `tenant-deletion-resume-tenant-v1`). Parked workflows replay PAST the suspend point → they rely on the backfill, same as email.
- **Resume must propagate query failures** (Temporal retry). Lesson from email-plan review: an outer catch on the resume activity silently strands a won-back tenant. Suspend/backfill contain errors; resume does not.
- **`tenants` is a Citus reference-ish/local table** — plain ALTER with hasColumn guard, follow `20260505140000_add_tenant_product_code.cjs` pattern.
- **`pending_tenant_deletions` is coordinator-local, not distributed** (created `ee/server/migrations/20260113120000` without distribution) — cross-tenant joins recursively planned; fine for backfill scripts, don't claim co-location in comments.
- Running ee/temporal-workflows vitest locally: local Temporal occupies :7233 → `TEMPORAL_TEST_SKIP_ENV_BOOTSTRAP=1 npx vitest run …`.
- Base URLs in worker context: `APPLICATION_URL` first (see `shared/services/email/webhookBaseUrl.ts` extracted during the email-plan review fixes). Not needed for suspension (no re-registration), noted for consistency.
- i18n: any new user-visible copy needs all 9 locales + pseudo regen (`node scripts/generate-pseudo-locales.cjs`), else `validate-translations` CI fails. Public-endpoint "unavailable" copy is API-level JSON (English message) — confirm whether those routes have localized clients before adding keys.
- Win-back exemptions verified: login win-back = `handleInactiveLoginWinback` reads `pending_tenant_deletions` directly and sends via SystemEmailService; reactivation invite emails likewise. None flow through gated seams.

## Implementation notes (2026-07-24, all groups landed)

**Enforcement map — where suspension is actually checked:**
- Helper: `packages/db/src/lib/tenantSuspension.ts` (`isTenantSuspended` fail-open, `suspendTenant`, `resumeTenant`) — lives in `@alga-psa/db`, not shared, because `packages/auth` depends only on db. Exported from the package index; **db dist rebuilt** (`npx nx build db`).
- Migration: `server/migrations/20260724120000_add_suspension_to_tenants.cjs` (hasColumn-guarded).
- Workflow: `tenant-suspension-activities.ts`, wired under `patched('tenant-deletion-suspend-tenant-v1')` / `('tenant-deletion-resume-tenant-v1')`, re-exported through tenant-deletion-activities so worker registration picks them up via `export *`.
- Dispatch gates (THREE dispatch paths, all gated): `packages/jobs/.../jobHandlerRegistry.ts` AND `server/src/lib/jobs/jobHandlerRegistry.ts` (**byte-identical duplicate** — LEVERAGE marker added; keep in sync) AND the Temporal worker's own map in `ee/temporal-workflows/src/activities/job-activities.ts#executeJobHandler`.
- EE maintenance fan-out calls handlers DIRECTLY (not via any registry) → the `whereNull('suspended_at')` on its tenants enumeration is the enforcement there, and it re-evaluates every scheduled run (no staleness).
- EE RMM polls & accounting cycle flow: Temporal generic job → worker forwards `MAINTENANCE_JOB_REQUESTED` event → server `maintenanceJobSubscriber` → **server registry copy** → gated. Their Temporal schedules stay armed (skip-not-kill for free).
- Time-period chain: gate INSIDE the handler after the tenant-row fetch, `tenantExists` stays true → finally-block re-arms. Startup enumeration deliberately NOT filtered (chain must stay armed so win-back resumes without a restart) — contract test T022 pins this.
- RMM reconciler: suspension folded into `eligible` → control loop CANCELS polls for suspended tenants and recreates after win-back.
- Webhooks: tactical/levelio (2xx ack + drop after secret check), ninjaone (after org resolution), calendar processor (single `isProviderTenantSuspended` helper used by all 3 entry points).
- Event plane: `WorkflowRuntimeV2EventStreamWorker.processEvent` before idempotency check.
- API keys: `getKeyGateReason` (owner-inactive OR tenant-suspended) in `packages/auth` ApiKeyService AND `server/.../apiKeyServiceForApi` (both validate variants). Outer catches fail CLOSED for auth (opposite of job gates — deliberate).
- Public: booking route 503 neutral copy (English JSON, API-level — no i18n keys added); marketing capture returns null → module's own generic-404-no-leak convention.
- Outbound email: gate at `TenantEmailService.sendEmail` top (before rate limiting); `SystemEmailService` untouched (contract test asserts it stays that way).
- Backfill: one-off operator procedure covering statuses incl. `failed`; kept out of the repo per the no-tenant-lifecycle-in-OSS rule (runbook lives with the operator notes).

**Key discovery:** `scheduleRecurringJob` on pg-boss is a **delayed one-shot send with singletonKey**, not persistent cron — "recurring" jobs recur via re-arming (boot-time re-registration or handler finally-blocks). This is why gates must be per-run (dispatch/handler level), with enumeration filters as optimization only.

**Test residue (deliberate):** T029/T031/T039/T043 (runtime pass-through regressions for active tenants on webhook/event/booking/email paths) are not behavior-tested — the gates are conditional early-returns and existing suites exercise the active-tenant paths; revisit if a harness becomes cheap.

## Commit groups (implementation order)

suspension-schema → workflow-suspend-step → job-dispatch-gate → fanout-gates → rmm-gates → event-worker-gate → api-key-gate → public-endpoint-gates → outbound-email-gate → backfill → regression

## Links

- Predecessor plan: `ee/docs/plans/2026-07-23-inbound-email-pause-cancelled-tenants/`
- Deletion workflow: `ee/temporal-workflows/src/workflows/tenant-deletion-workflow.ts`
- Email lifecycle service (pattern reference): `shared/services/email/EmailProviderLifecycleService.ts`
- Email backfill (pattern reference): operator runbook, kept out of the repo
