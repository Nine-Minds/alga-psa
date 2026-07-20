# Premise Microsoft email: token renewal & sync reliability

**Branch:** `fix/premise-microsoft-email-token-renewal`
**Date:** 2026-07-18
**Status:** Approved design; ready for implementation

## Problem

On premise appliances, Microsoft 365 inbound email dies ~1–2 hours after "Connect
Microsoft 365" and never recovers without a human re-authenticating. Emails that
arrive during an outage are permanently lost — they never become tickets even after
re-auth. Meanwhile the UI keeps reporting the provider as Connected, and "Test
Connection" refreshes "Last Sync" without doing anything.

Field report (premise appliance, pro enabled): overnight support mail not converted
to tickets; Graph diagnostics fail wholesale ~2–3h after connect; re-auth turns
everything green but the backlog never imports; appliance logs spam
`❌ Provider not found for subscription: <uuid>` for five different subscription ids.

## Root causes (all confirmed in code)

1. **Refresh uses different OAuth client credentials than authorization.**
   - Authorize/code-exchange resolves the Email-bound Microsoft profile via
     `resolveMicrosoftConsumerProfileConfig(tenant, 'email')`
     (`packages/integrations/src/lib/microsoftConsumerProfileResolution.ts:422`),
     used by `initiateEmailOAuth`
     (`packages/integrations/src/actions/email-actions/oauthActions.ts`) and the
     callback (`server/src/app/api/auth/microsoft/callback/route.ts`).
   - Runtime refresh (`shared/services/email/providers/MicrosoftGraphAdapter.ts:233`
     `refreshAccessToken`) instead reads `microsoft_email_provider_config.client_id/
     client_secret` → env `MICROSOFT_CLIENT_ID/SECRET` → legacy tenant secrets.
   - The vendor row is populated by `persistMicrosoftConfig`
     (`packages/integrations/src/actions/email-actions/emailProviderActions.ts:322`)
     which consults `getHostedMicrosoftConfig()` first (unconditionally supplies the
     hosted `algapsa.com` redirect and hosted-cred shape) and never resolves the
     bound profile.
   - Hosted works by accident (env creds exist and match). An appliance has no env
     creds (`helm/values.yaml` defaults `microsoft_integration.enabled: false`), so
     refresh posts wrong/stale creds → `invalid_grant` → provider dead once the
     ~1h access token expires.
   - A profile-aware `refreshAccessToken` already exists in a **duplicate, unused**
     adapter at `server/src/services/email/providers/MicrosoftGraphAdapter.ts:226`;
     all live imports point at the shared adapter.

2. **Re-auth leaks Graph subscriptions.** `registerWebhookSubscription`
   (`shared/.../MicrosoftGraphAdapter.ts:352`) creates a new subscription and
   overwrites `webhook_subscription_id` without deleting the old one. Leaked
   subscriptions stay live up to ~60h. The webhook handler
   (`packages/integrations/src/webhooks/email/handlers/microsoftWebhookHandler.ts:124-160`)
   matches `notification.subscriptionId` against the single stored id and
   error-logs "Provider not found" for the rest.

3. **No backfill.** Graph notifications are one-shot. While the token is dead, each
   notification's message fetch fails auth
   (`shared/services/email/unifiedInboundEmailQueueJobProcessor.ts:861` rethrows to
   queue retry) and the email is lost after retries. Nothing lists "messages since
   last successful import" after recovery. No polling fallback exists for Microsoft.

4. **Dishonest status.** `testEmailProviderConnection`
   (`emailProviderActions.ts:1105`) only implements IMAP; for Microsoft/Google it
   sets `status='connected'` and `last_sync_at=now()` with zero network I/O
   (lines 1233-1239). Renewal failures land only in `email_provider_health`
   (`shared/services/email/EmailWebhookMaintenanceService.ts:263-300`), never on
   `email_providers.status`, and the card derives subscription state solely from
   `webhook_expires_at`.

Token refresh is otherwise lazy-only (axios interceptor → `ensureValidToken`,
`shared/services/email/providers/base/BaseEmailAdapter.ts:52`); the only scheduled
Graph traffic is the webhook-maintenance sweep — Temporal
`email-webhook-maintenance-schedule` every 15 min on EE/appliance
(`ee/temporal-workflows/src/schedules/setupSchedules.ts:262`), PgBoss daily on CE
(`server/src/lib/jobs/index.ts:721`, `initializeScheduledJobs.ts:282`) — both via
`EmailWebhookMaintenanceService`, so changes there serve both editions.

## Design (approved)

### 1. Unify credential resolution (root-cause fix)

Deployment model this must serve: **premise appliances use a tenant-owned Entra
app** (stored as the tenant's Microsoft profile, bound to the `email` consumer),
while **hosted uses the Nine Minds-owned Azure app** (platform app secrets / env
`MICROSOFT_CLIENT_ID/SECRET`), which the resolver already returns as its fallback
when no Email binding exists. Both models flow through
`resolveMicrosoftConsumerProfileConfig` — the fix is making refresh use it too.

- Introduce a single shared Microsoft email **provider-config builder** that
  resolves OAuth client credentials in this order:
  **Email-bound profile (resolver) → vendor row → env → legacy secrets** (the
  fallback chain preserves hosted behavior exactly).
- **Issuing-app pinning:** a Microsoft refresh token is only redeemable by the
  `client_id` that issued it. Connect-time persistence records the issuing
  `client_id` (and profile id, when profile-sourced) in the vendor row. At refresh,
  resolved credentials are used when their `client_id` matches the issuing one
  (this transparently picks up rotated client secrets, which remain valid for the
  same app); on mismatch — e.g. a hosted tenant who authorized under the Nine
  Minds app and later bound their own profile, or a premise tenant who swapped
  profiles — fall back to the stored issuing credentials, and if refresh still
  fails, set the honest error state (§2) prompting re-authentication instead of
  failing silently.
- `shared/` cannot depend on `packages/integrations`, so resolution happens where
  `provider_config` is assembled, not inside the adapter: either inject a
  credential-resolver hook into the adapter config, or hoist the resolver into a
  shared-safe module. All adapter construction sites use the builder: the OAuth
  callback route, `unifiedInboundEmailQueueJobProcessor`
  (`fetchMicrosoftMessageForPointer`), `EmailWebhookMaintenanceService`,
  `EmailProcessor`, and diagnostics/provider actions.
- Fix `persistMicrosoftConfig` to persist the **bound profile's** client id/secret
  ref/tenant id/redirect into `microsoft_email_provider_config` instead of
  `getHostedMicrosoftConfig()` defaults, so the vendor-row fallback is also correct
  and existing rows heal on next save/connect.
- Retire the duplicate `server/src/services/email/providers/MicrosoftGraphAdapter.ts`
  (and sibling duplicates if import-graph confirms they're dead) in favor of the
  shared adapter. One implementation, profile-aware.

### 2. Proactive token health in the maintenance sweep

- Each sweep, for every **active** Microsoft provider (not just webhook-renewal
  candidates): if `token_expires_at` is within ~30 min (or past), perform a refresh
  through the adapter.
- On refresh failure: set `email_providers.status='error'` + `error_message`, and
  record the health row (`updateHealthStatus`). On success after failure: restore
  `status='connected'` and clear `error_message`. The card goes red honestly and
  recovers honestly.

### 3. Subscription hygiene

- `registerWebhookSubscription`: best-effort `DELETE /subscriptions/{old}` for the
  previously stored `webhook_subscription_id` before creating the new one.
- Sweep-side orphan cleanup: `GET /subscriptions` (app-scoped by Microsoft), delete
  any subscription whose `notificationUrl` targets this instance's webhook URL but
  whose id doesn't match the DB. Kills existing orphans within one cycle and
  self-heals future leak paths. Never touches other apps' subscriptions.
- Webhook handler: unknown-subscription notifications drop from repeated
  `console.error` spam to one structured `warn` with context.

### 4. Reconcile sweep (missed-message backfill)

- Each sweep, per active Microsoft provider: list monitored-folder messages with
  `receivedDateTime >=` (last successful import − safety margin), bounded by a
  hard window cap (7 days) and a per-sweep max count; skip message ids already in
  `email_processed_messages`; enqueue the remainder through the **same unified
  inbound queue** as webhook-delivered mail (identical downstream processing and
  dedupe).
- Webhooks become a latency optimization; any outage self-heals within one sweep
  of the token working again — including mail that arrived while the provider was
  dead.
- `email_providers.last_sync_at` is updated only by real ingestion work (successful
  sweep or webhook-driven fetch).

### 5. Honest Test Connection

- For Microsoft, `testEmailProviderConnection` calls the shared adapter's real
  `testConnection()` (mailbox read via `ensureValidToken` — also exercises
  refresh); provider `status` reflects the actual result; the action no longer
  touches `last_sync_at`.

### 6. Minimal Microsoft Graph emulator + automated smoke suite

A small, growable emulator component so this branch's behavior — and future Graph
work — is smoke-testable without a real M365 tenant.

- **Endpoint overridability (enabler):** centralize `MICROSOFT_GRAPH_BASE_URL` and
  `MICROSOFT_LOGIN_BASE_URL` (defaults: real Microsoft endpoints) in one shared
  module, consumed by the shared adapter's axios `baseURL`
  (`shared/.../MicrosoftGraphAdapter.ts:21`), both token-exchange sites (adapter
  refresh, callback route:262), and `generateMicrosoftAuthUrl`
  (`oauthHelpers.ts:28`). Only the inbound-email path converts on this branch.
- **Emulator service** (new component in the repo, e.g. `test-harness/graph-emulator/`;
  plain Node HTTP service, runs as a compose service in smoke setups):
  - OAuth: `/authorize` (immediately redirects back with a code — headless
    connect), `/token` with authorization_code + refresh_token grants,
    configurable access-token TTL, refresh-token rotation, per-client validation
    (exercises issuing-app pinning).
  - Graph mail subset: `/me`, `/users/{id}`, mailFolders incl. well-known
    `inbox`, message list honoring `$filter receivedDateTime ge` (backfill),
    message fetch incl. MIME.
  - Subscriptions: full CRUD, the `validationToken` handshake POST against the
    `notificationUrl` at create, expiry, and change-notification delivery to the
    webhook endpoint when a message is seeded.
  - **Control API** for tests: seed message, expire access token now, revoke
    refresh token, inject `invalid_grant`/HTTP faults, list live subscriptions.
- **Automated smoke suite** driving the acceptance criteria end to end against the
  emulator: connect → seed mail → notification → ticket; token self-refresh past
  TTL; refresh failure → honest red status → recovery; mail seeded during a broken
  window imported by the reconcile sweep; double re-auth → exactly one live
  subscription and orphans deleted; Test Connection real behavior.
- Deliberately minimal; grows into a broader Graph test harness (calendar, Teams)
  as needs dictate.

### Out of scope

Gmail/IMAP equivalents of the reconcile sweep, hosted OAuth-relay changes, provider
card redesign beyond honest status, encryption of vendor-row token columns.

## Implementation order

1. **Config builder + refresh resolution + endpoint overridability** (design §1,
   §6 enabler) — foundation; everything else exercises it.
2. **Graph emulator service + smoke scaffolding** (§6) — built early so every
   later lane lands with emulator-backed verification.
3. **`persistMicrosoftConfig` fix + duplicate-adapter retirement** (§1).
4. **Maintenance sweep: token health** (§2).
5. **Subscription hygiene: delete-before-create, orphan cleanup, log downgrade** (§3).
6. **Reconcile sweep** (§4).
7. **Honest Test Connection** (§5).
8. **Full smoke suite over acceptance criteria** (§6).

Each step lands with its tests; steps 4–6 all live in
`EmailWebhookMaintenanceService` and ship on both Temporal (EE/appliance) and
PgBoss (CE) schedules for free.

## Testing

- **Unit:** credential-resolution ordering (profile → vendor row → env → legacy);
  issuing-app pinning (resolved `client_id` match/mismatch, secret rotation,
  hosted-app → tenant-profile transition falls back then errors honestly);
  reconcile windowing/cap and `email_processed_messages` dedupe;
  delete-before-create issues the delete and survives its failure; unknown-
  subscription handling.
- **Integration (mocked Graph):** sweep against a provider with expired token +
  orphaned subscriptions + unimported messages → token refreshed, orphans deleted,
  messages enqueued, statuses honest. Refresh failure → provider `status='error'`.
- **Emulator smoke suite (§6):** automated end-to-end runs of the acceptance
  criteria against the Graph emulator — connect, notification→ticket, token
  self-refresh, honest red/recovery, outage backfill, single-subscription
  invariant, real Test Connection.
- **Manual (real M365 mailbox, final validation):** one pass of the same scenarios
  against a live tenant on this worktree's stack to confirm emulator fidelity.

## Acceptance criteria

1. On an appliance-shaped install (no `MICROSOFT_CLIENT_ID/SECRET` env), a
   connected Microsoft provider stays working indefinitely: access tokens refresh
   using the Email-bound profile's credentials.
2. Emails arriving during a token/subscription outage are imported automatically
   within one sweep cycle after recovery — no human action, no lost mail (within
   the 7-day window).
3. Re-authentication never leaves more than one live Graph subscription; existing
   orphans are removed by the sweep; no "Provider not found" error spam.
4. The provider card cannot show Connected while refresh is failing; "Test
   Connection" performs a real mailbox check and never fabricates Last Sync.
