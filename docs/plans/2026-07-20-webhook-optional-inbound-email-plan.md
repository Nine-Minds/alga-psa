# Implementation Plan: Webhook-Optional Inbound Email (Firewalled Appliance Support)

**Status:** Approved design, ready for implementation
**Branch:** `improve/premise-microsoft-polling`
**Origin:** Design discussion 2026-07-20 (Robert + Claude), refined in design session on this branch
**Depends on:** PR #2981 (`fix/premise-microsoft-email-token-renewal`) — merged to main, must be deployed before/with this work

## Problem

Some appliance customers run behind firewalls with no inbound HTTPS. Microsoft
Graph change notifications (webhooks) cannot reach them, so the current
inbound-email design — which treats the Graph subscription as the primary
transport — either fails at setup (subscription validation cannot complete) or,
worse, silently degrades later: the subscription exists and renews (Graph
renewal is an outbound PATCH that is **not** re-validated), but deliveries are
suspended by Microsoft and nothing notices. The 2026-07-20 lab session
demonstrated the silent-degradation class directly: a healthy-looking, renewing
subscription with zero mail flowing and no system signal.

Key architectural fact: post-PR #2981, missed-message reconciliation already
constitutes a complete, webhook-free ingestion path (outbound-only HTTPS to
`graph.microsoft.com`). Webhooks are a latency optimization, not the transport.
This plan makes that stance explicit and operational.

Note: setup on a firewalled box already "succeeds" today — the OAuth callback
swallows subscription-registration failures with a `console.warn`
(`server/src/app/api/auth/microsoft/callback/route.ts:382` region). What is
missing is recording that outcome and acting on it; the maintenance loop then
re-attempts `recreateSubscription` every 15 minutes forever (the
`!webhook_subscription_id` branch, `EmailWebhookMaintenanceService.ts:188-201`).

## Scope

- **EE / Temporal only.** The tight polling loop is a Temporal schedule. The
  appliance runs the EE image with `temporal` + `temporal-worker` deployed via
  Flux (`ee/appliance/flux/base/releases/temporal-worker.yaml`), so premise is
  covered. The CE pg-boss path (`email-webhook-maintenance` daily at 4 AM,
  `server/src/lib/jobs/index.ts:744`, `initializeScheduledJobs.ts`) is
  **unchanged**. New columns exist for all editions (migrations are shared) but
  CE behavior does not change. *(Decided 2026-07-20: option (a), leave CE
  unchanged.)*
- Microsoft provider only. Google/Gmail (Pub/Sub watch) gets the same concept
  in a follow-up plan if needed.
- No global shortening of the 15-minute maintenance cadence.
- No primary UI knob for delivery mode or polling frequency. A single advanced
  "Webhooks: Auto / Off" override is deferred until a compliance customer asks.
- No new ingestion pipeline — reuse reconciliation (`last_sync_at` delta
  import) as the polling mechanism.

## Design

### Delivery modes (per provider, system-managed)

- `webhook` — subscription active, deliveries observed; reconciliation runs at
  the existing 15m safety-net cadence.
- `polling` — no subscription (or subscription culled); reconciliation runs on
  a tight per-provider cadence (default **3 minutes**, config-backed constant,
  not UI-exposed). All Graph traffic is outbound.

### Mode transitions (auto-detection)

1. **At provider setup / Test Connection / config change:** attempt
   subscription creation. Graph validates the notification URL synchronously —
   unreachable endpoints fail immediately and unambiguously. Validation
   failure → `polling` mode, setup completes without user-facing error.
   Success → `webhook` mode.
2. **Webhook-silence detector:** if reconciliation imports messages the
   webhook never delivered for **N consecutive runs** (default N=3), webhooks
   are de facto dead → delete the Graph subscription, enter `polling` mode,
   record reason in provider health. A quiet mailbox never increments the
   counter (detector requires imported messages).
3. **Recovery probe:** in `polling` mode, re-attempt subscription creation
   **daily** (`next_subscription_probe_at`) and on explicit Test Connection.
   Success → back to `webhook` mode, counters reset. Failure → stay in
   `polling`, single info-level log line, provider status stays healthy-green
   (polling is a fully supported configuration, not an error).

**Guard rail:** only endpoint-validation failures and the silence detector may
enter polling mode. Auth/permission errors (401/403, `ErrorAccessDenied`) keep
the existing error surfacing — masking revoked credentials behind "polling
mode is fine" would hide real breakage.

### Cadence rules

- Global Temporal schedule stays at **15m**
  (`email-webhook-maintenance-schedule`, `ee/temporal-workflows/src/schedules/setupSchedules.ts:262`).
- Each 15m tick keeps doing renewal, token refresh, and safety-net
  reconciliation for `webhook`-mode providers exactly as today. For
  `polling`-mode providers it does token refresh and probe-due evaluation
  only — no subscription renewal/recreate attempts, and no reconciliation
  (the 3m loop owns it; avoids double-running).
- New Temporal schedule `email-polling-reconcile-schedule` (every 3m, SKIP
  overlap) reconciles `polling`-mode providers only; no-ops when none exist.
- Cost basis: one delta query per polling provider per tick
  (`receivedDateTime > last_sync_at - safety_margin`), far below Graph
  per-mailbox throttling limits.

### Health / status surfacing (read-only)

- Provider card shows `Real-time delivery: active` (webhook mode) or
  `Polling every 3 minutes` (polling mode), plus `Last ingested: <timestamp>`.
- `polling` mode renders as normal/healthy, never warning styling.
- Silence-detector culling and every mode transition (both directions, with
  reason) recorded as a provider health/timeline note and an info-level log
  with provider id + tenant.

## Data Model

New columns on `microsoft_email_provider_config` (recommended placement — all
mechanics are Microsoft-specific and `webhook_subscription_id` already lives
there; revisit promotion to `email_providers` if/when the Google plan lands):

- `delivery_mode` text NOT NULL: `webhook` | `polling`. Migration backfills
  existing rows: `webhook` when `webhook_subscription_id` is set, else
  `polling`.
- `last_webhook_delivery_at` timestamptz — stamped by the webhook handler on
  every accepted (clientState-valid) notification.
- `webhook_silent_runs` int NOT NULL DEFAULT 0 — consecutive reconciliation
  runs that imported mail with no interceding webhook delivery; reset on any
  webhook delivery.
- `next_subscription_probe_at` timestamptz — recovery-probe scheduling.
- `last_reconciliation_at` timestamptz — Graph reconciliation window and
  overlap-claim cursor. This is deliberately separate from
  `email_providers.last_sync_at`, which unified queue consumers advance after
  successful ingestion.

Migration follows existing tenant-scoped (Citus) migration patterns in
`server/migrations/`.

Note: `Last ingested` uses the existing `email_providers.last_sync_at`.
Reconciliation must never use that ingestion timestamp to decide that a Graph
polling window was claimed; webhook/queue ingestion can advance it while a
polling runner is in flight.

## Implementation Steps

1. **Migration** — add the four columns with backfill defaults as above.
2. **Typed subscription outcome** — `MicrosoftGraphAdapter`
   (`shared/services/email/providers/MicrosoftGraphAdapter.ts`,
   `registerWebhookSubscription` ~line 430): surface a typed outcome
   distinguishing (a) endpoint-validation failure (`ValidationError` /
   validation timeout on `POST /subscriptions`), (b) auth/permission errors
   (401/403 token errors, 403 `ErrorAccessDenied` on resource), (c) other.
   Only (a) may flip mode.
3. **Setup flow** — OAuth callback
   (`server/src/app/api/auth/microsoft/callback/route.ts:382` region): on
   validation-failure outcome set `delivery_mode='polling'` and complete
   setup successfully; on success set `delivery_mode='webhook'`; on auth
   error keep existing error surfacing. Also invoke the same logic on
   provider mailbox/config changes, and cull any now-orphaned subscription
   when config changes (lab example: orphan `9f181f67` left by a reconfigure).
4. **Webhook handler stamping** —
   `packages/integrations/src/webhooks/email/handlers/microsoftWebhookHandler.ts`
   (clientState validation ~line 170): stamp `last_webhook_delivery_at` and
   reset `webhook_silent_runs` on every accepted notification. (Graph never
   echoes clientState on `GET /subscriptions` — the lab's `clientState: null`
   observation is expected read behavior; notification payloads do carry it.)
5. **Maintenance service mode logic** —
   `shared/services/email/EmailWebhookMaintenanceService.ts`:
   - Gate BOTH the renewal path and the `!webhook_subscription_id`
     recreate branch (lines 188–201) on `delivery_mode='webhook'`.
   - Reconciliation run recording: each run stamps messages-imported count
     and whether a webhook delivery occurred in the window, feeding
     `webhook_silent_runs` idempotently.
   - Silence detector: `webhook_silent_runs >= 3` → delete Graph
     subscription, clear `webhook_subscription_id`, set
     `delivery_mode='polling'`, write health note.
   - Recovery probe: when `now >= next_subscription_probe_at`, re-attempt
     subscription creation; success → `webhook` mode + reset counters;
     failure → advance probe ~24h, single info log, health stays green.
   - New entry point for the polling loop: reconcile `polling`-mode
     providers only (reuses `reconcileMissedMessages`).
   - Lock, compare, and advance `last_reconciliation_at` to serialize Graph
     windows. Commit it only after queue writes succeed; leave `last_sync_at`
     to the unified queue consumer.
6. **Temporal schedule** —
   `ee/temporal-workflows/src/schedules/setupSchedules.ts`: add
   `email-polling-reconcile-schedule` (interval from env,
   default 3m; SKIP overlap; sensible execution timeout) + workflow/activity
   plumbing mirroring `emailWebhookMaintenanceWorkflow`.
7. **Test Connection** — trigger an immediate recovery probe for
   polling-mode providers in addition to the existing Graph health check;
   must not change `last_sync_at`.
8. **UI (read-only)** — `ee/server/src/components/MicrosoftProviderForm.tsx`
   / provider status card: show delivery status line + last-ingested
   timestamp; polling mode styled as normal/healthy.
9. **Docs** — appliance setup docs note the egress-only requirement:
   outbound HTTPS to `graph.microsoft.com` and `login.microsoftonline.com`
   suffices for polling mode (no tunnel, no public DNS, no cert).

### Reconciliation constants (context, on main)

`RECONCILE_WINDOW_CAP_MS=7d`, `RECONCILE_SAFETY_MARGIN_MS=15m`,
`DEFAULT_RECONCILE_MAX_MESSAGES=50`, `TOKEN_REFRESH_LOOK_AHEAD_MINUTES=30`
(`EmailWebhookMaintenanceService.ts:26-29`). 50 msgs/run at 3m ticks ≈
1000/hr ceiling — likely fine; sanity-check against busiest customer
mailboxes during implementation.

## Feature Checklist

- F001 `delivery_mode` column + backfill migration
- F002 `last_webhook_delivery_at` stamped by webhook handler on accepted notifications
- F003 `webhook_silent_runs` counter (increment on missed-import runs, reset on webhook delivery)
- F004 `next_subscription_probe_at` column
- F005 typed `createSubscription` outcome (validation vs auth vs other)
- F006 setup: validation failure → polling mode, setup succeeds
- F007 setup: success → webhook mode
- F008 auth/permission errors surface as provider error, never flip mode
- F009 `email-polling-reconcile-schedule` Temporal schedule (3m, config-backed)
- F010 polling reconcile = delta import via `last_sync_at` (PR #2981 path)
- F011 15m tick: no tight reconcile for webhook-mode; no double-run of polling-mode providers
- F012 silence detector culls subscription at 3 silent runs, flips to polling
- F013 culling writes provider health/timeline note
- F014 daily recovery probe flips back to webhook on success
- F015 probe failure silent-by-design (info log, +24h, health green)
- F016 Test Connection triggers immediate probe for polling-mode providers
- F017 renewal AND recreate paths skip polling-mode providers
- F018 UI: read-only delivery status + last-ingested
- F019 polling mode renders as normal/healthy
- F020 appliance docs: egress-only requirement
- F021 mode transitions logged (info, provider id + tenant, reason)
- F022 reconciliation run recording feeds silence counter idempotently
- F023 dedicated reconciliation cursor cannot be advanced by queue ingestion

## Test Plan

- T001 DB integration: migration adds all four columns with correct backfill
  (webhook when subscription id present, else polling).
- T002 unit (Graph emulator): `createSubscription` returns
  validation-failure outcome on validation POST timeout/refusal; auth-error
  outcome on 401/403.
- T003 integration: setup with unreachable notification URL completes with
  `delivery_mode='polling'`, no error status.
- T004 integration: setup with reachable URL sets `delivery_mode='webhook'`
  (existing behavior preserved).
- T005 integration (guard): 401/403 during subscription creation sets
  provider error status and does NOT enter polling mode.
- T006 integration: polling-mode provider with 2 new messages since
  `last_sync_at` imports both via 3m tick, enqueues inbound processing,
  advances `last_sync_at`.
- T007 unit: 15m tick runs no tight reconcile for webhook-mode providers;
  polling-mode provider not double-processed on schedule overlap.
- T008 integration: silence detector — 3 consecutive missed-import runs flip
  mode to polling, delete subscription, clear `webhook_subscription_id`,
  write health note.
- T009 unit (guard): quiet mailbox never increments `webhook_silent_runs`; a
  single webhook delivery resets it to 0.
- T010 integration: recovery probe — reachable endpoint flips to webhook +
  resets counters; unreachable stays polling, advances probe ~24h, health
  stays green.
- T011 integration: Test Connection on polling-mode provider triggers
  immediate probe without changing `last_sync_at`.
- T012 unit: renewal loop issues no Graph renewal/recreate calls for
  polling-mode providers.
- T013 UI: provider card renders polling status + last-ingested with normal
  styling; webhook mode shows real-time active.
- T014 E2E smoke (appliance profile, Graph emulator): firewalled setup →
  polling mode → message becomes ticket within 2 polling cycles → endpoint
  becomes reachable → probe restores webhook mode → webhook-delivered
  message creates ticket.
- T015 unit/concurrency: a queue consumer advances `last_sync_at` while
  reconciliation is deciding whether to enqueue/commit; the Graph window is
  still enqueued and the dedicated cursor advances.

## Acceptance Criteria

- Appliance with **zero inbound connectivity**: provider setup completes
  without error, provider shows polling mode, an email to the watched
  mailbox becomes a ticket in ≤ 2× polling cadence (≤ 6 min at default).
- Appliance with working webhooks: behavior unchanged; email → ticket ≤ 30s;
  reconciliation stays at 15m.
- Kill inbound path on a webhook-mode provider, send 3+ emails across 3
  reconciliation windows: subscription deleted, mode flips to polling,
  health note recorded, no mail lost.
- Restore inbound path: within 24h (or on Test Connection) provider returns
  to webhook mode.
- Auth revocation on a polling-mode provider still surfaces as an error.
- Hosted tenants: no measurable increase in Graph API call volume for
  webhook-mode providers.
- CE (pg-boss) behavior byte-for-byte unchanged apart from inert new columns.

## Risks & Mitigations

- **False-positive silence detection:** detector requires reconciliation to
  have *found* messages the webhook missed; quiet mailboxes never increment.
  N=3 consecutive guards flappiness.
- **Mode flapping:** probe is daily; culling needs 3 consecutive positive
  misses; hysteresis is inherent.
- **Error-classification mistakes:** only validation failures and the
  silence detector may enter polling mode (F005/F008 typed taxonomy).
- **Partial webhook delivery** (flaky, not dead): recent
  `last_webhook_delivery_at` resets the counter, so a flaky-but-alive
  webhook stays in webhook mode — acceptable; the 15m safety-net
  reconciliation still catches stragglers.
- **Load on hosted:** polling schedule no-ops for webhook-mode providers;
  net new cost ≈ zero.

## Implementation Gotchas (from 2026-07-20 lab session)

- **kubectl logs blind spot on the appliance:** Next.js route-handler
  `console.log` lines (the entire webhook handler) do NOT appear in
  `kubectl logs`; diagnose webhook traffic with tcpdump on :3000 or
  `cloudflared --loglevel debug`, never by log absence.
- `GET /subscriptions` with the provider's stored delegated token works from
  the appliance — good supportability trick (token never leaves the box).
- Re-OAuth may issue a narrower-scope token (observed: Mail read-only).
  Polling only needs read, so fine — but don't assume write scopes.
- The appliance serves plain HTTP on :3000 hostNetwork; only external
  TLS-terminating proxies make https notification URLs possible. Polling
  mode removes that requirement entirely.

## Open Questions (deferred, not blocking)

1. Advanced "Webhooks: Auto / Off" override — deferred until a compliance
   customer explicitly requires never-advertise-endpoint behavior.
2. Exact polling cadence (3m default; 2m for SLA-sensitive desks?) —
   config-backed constant either way.
3. Should the first silence-detector cull fire a notification to the MSP
   admin?
4. Same treatment for the Google provider (Pub/Sub watch) — separate plan.

## Rollout

- Ships with the next appliance release, riding on PR #2981 (merged
  2026-07-19, not yet deployed anywhere as of 2026-07-20; hosted prod green
  = `alga-psa-ee:47148b8d`, appliance stable 1.3.6 = same SHA).
- No feature flag: behavior is additive and self-detecting; migration
  defaults preserve current behavior for existing providers.
