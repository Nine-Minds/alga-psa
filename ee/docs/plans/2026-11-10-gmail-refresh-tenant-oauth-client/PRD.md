# PRD — Gmail token refresh must use the tenant's OAuth client

PSA ticket alga-2026-0002844 (Pereceptive IT, Dan Cudjoe): "GSuite email
connection disconnecting every 7 days". The bug is on Alga's side and affects
every hosted Gmail mailbox.

## 1. Problem

Hosted Gmail mailboxes stop receiving mail shortly after connecting. About 7
days later they show as disconnected. Reconnecting only resets the clock.

### Root cause

Google mailbox OAuth is always tenant-owned (CE and EE). Initiate
(`packages/integrations/src/actions/email-actions/oauthActions.ts:70`,
`server/src/app/api/email/oauth/initiate/route.ts:50`) and the callback
(`server/src/app/api/auth/google/callback/route.ts:142`) read only the tenant
secrets `google_client_id` / `google_client_secret`. The refresh token is
issued to that client.

`GmailAdapter.refreshAccessToken` (`packages/integrations/src/services/email/providers/GmailAdapter.ts:89`,
duplicated in `server/src/services/email/providers/GmailAdapter.ts` and
`shared/services/email/providers/GmailAdapter.ts`) resolves credentials as:

```ts
let clientId = vendorConfig.client_id || process.env.GOOGLE_CLIENT_ID;
let clientSecret = vendorConfig.client_secret || process.env.GOOGLE_CLIENT_SECRET;
// tenant secrets only if still missing
```

Hosted prod sets `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` to Alga's own Gmail
app. The source is nm-kube-config `alga-psa/hosted.values.yaml`, block
`gmail_integration`, project `alga-psa-466214`, rendered by
`helm/templates/deployment.yaml` "GMAIL INTEGRATION". The callback never
writes `google_email_provider_config.client_id`, so the column is null. Every
refresh therefore sends Alga's client with a tenant-issued refresh token, and
Google answers `unauthorized_client` (401). The ordering has existed since the
adapter was written (2025-07).

`server/src/services/email/EmailProviderAutoWiring.ts:323` has the same
env-first ordering.

### Why it surfaces at 7 days

1. Connecting stores an access token valid about 1 hour and registers a Gmail
   watch valid 7 days.
2. After that hour, every refresh fails. `GmailAdapter` is the only Gmail token
   refresher, so inbound processing (history fetch) fails from then on. Pushes
   still arrive (`last_push_received_at` keeps moving) but mail isn't
   ingested.
3. `renew-google-gmail-watch` runs every 30 min and picks up providers within
   6h of watch expiry (`packages/jobs/src/lib/handlers/googleGmailWatchRenewalHandler.ts`).
   It calls `configureGmailProvider`, whose watch registration refreshes, fails
   and writes `status='error'` with "Gmail watch registration failed ...
   unauthorized_client (code: 401)". That is the "disconnect" the customer
   sees.

### Prod evidence (2026-11-10)

- Pereceptive: tenant `bc9aa7be-6c93-4bb9-8077-692b56670624`, provider
  `53ed5bc5-6e56-4e6c-a4c7-1fc30de7e85c` (zsupport@perceptiveit.net), their own
  project `alga-cloud-connector-project`, `client_id` null.
  - Connected 2026-10-19 17:12 UTC; `token_expires_at` 2026-10-19 18:12 and
    never advanced.
  - `watch_expiration` 2026-10-26 17:12; `status='error'` with
    `unauthorized_client`.
- Fleet: 6 of 11 hosted Gmail providers are `status='error'` with the same
  `unauthorized_client` refresh error. Each has `token_expires_at` fixed at its
  connect day and `watch_expiration` 7 days later. 10 of 11 rows have a null
  `client_id`.

Ruled out: Google "External / Testing" refresh-token expiry. That produces
`invalid_grant`, not `unauthorized_client`.

## 2. Goal

A Gmail mailbox stays connected for as long as the tenant's Google grant is
valid. Refresh always uses the same OAuth client that issued the token. A
mailbox that was broken by this bug recovers on its own after deploy, without
reconnecting, and the mail it missed is ingested.

## 3. Design

### 3.1 One Google mailbox OAuth client resolver (F001)

Add a single resolver, for example `resolveGoogleMailboxOAuthClient({ tenant,
vendorConfig })`. Initiate, callback and refresh all use it, so the three paths
can't diverge again. Place it where `packages/integrations`, `server/` and
`shared/` can all import it, or collapse the three `GmailAdapter` copies
onto one implementation (the `packages/integrations` copy) if that is clean.
Rules:

- The client ID and secret always come from one source as a pair. A row's
  `client_id` is never combined with an env or secret-store `client_secret`.
- Order:
  1. the row's `client_id` + `client_secret`, when both are present (legacy
     rows);
  2. the tenant secrets `google_client_id` + `google_client_secret`.
- Never `process.env.GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Initiate and
  callback already refuse app-level secrets for Google, so refresh must match.
  Hosted env still feeds Google SSO through `sebastian.googleOAuthEnv`, so
  nothing in Helm changes.
- If the row records an issuing `client_id` (§3.2) and the tenant's current
  `google_client_id` differs (the tenant rotated or replaced their Google app),
  don't attempt the refresh. Fail with a specific error saying the Google OAuth
  client changed since the mailbox was connected and it must be reconnected.

### 3.2 Record the issuing client on connect (F002)

The Google callback writes the `client_id` it exchanged the code with into
`google_email_provider_config.client_id`, alongside the tokens. Don't add new
plaintext secrets to the row: the client secret stays in tenant secrets. Rows
connected before this change keep a null `client_id` and resolve through tenant
secrets (§3.1, rule 2). No migration is needed.

### 3.3 Remove the env-first fallback elsewhere (F003)

`server/src/services/email/EmailProviderAutoWiring.ts` uses the same env-first
ordering. Point it at the resolver. Nothing outside the file appears to import
it; if that's confirmed, delete it instead. Grep for any other
`process.env.GOOGLE_CLIENT_ID` read on a Gmail mailbox path and route it
through the resolver.

### 3.4 Say what Google said (F004)

Turn Google refresh errors into messages the admin can act on, shown in the
provider card's `error_message`:

- `unauthorized_client`: the refresh was sent with a client that doesn't match
  the one that issued the authorization. With §3.1 this can only mean the
  tenant changed their Google OAuth client. Tell them to reconnect the mailbox.
  It doesn't count toward auth-failure auto-pause, because it's a
  configuration mismatch, not a revoked grant.
- `invalid_grant`: Google expired or revoked the authorization. Tell them to
  reconnect. Add that if their OAuth consent screen is User Type External with
  publishing status Testing, Google expires authorizations after 7 days, and
  they should switch to Internal or publish the app. This keeps the existing
  auto-pause behaviour.

Today both arrive as the generic "Verify the mailbox's Google authorization
and the Pub/Sub topic permissions", which sent this ticket down the wrong path.

### 3.5 Recover the outage's mail on automatic recovery (F005)

Once F001 deploys, `renew-google-gmail-watch` re-runs `configureGmailProvider`
for the broken providers within 30 minutes. Their watches have expired, so
they're due. The refresh then succeeds and the status flips to `connected`.
But only auth-paused providers get the outage reconciled
(`EmailProviderLifecycleService.recoverAuthPausedProvider` →
`reconcileGooglePausedInterval`). A provider recovering from `status='error'`
re-registers the watch at a fresh cursor and silently skips weeks of support
mail.

Generalise that mechanism from "auth-paused" to "delivery outage". When
`configureGmailProvider` succeeds for a provider that was `status='error'`
before the call, reconcile from the cursor saved before the watch was
registered (`savedHistoryId`, which it already captures). Use the same
history-rejected fallback to a time-bounded query. The fallback lower bound is
the last time delivery was known good: `email_providers.last_sync_at`, the last
successful watch registration. Re-use the existing idempotent ingress pointer,
so a re-run doesn't duplicate tickets. Don't add a parallel code path. Rename
or widen `reconcileGooglePausedInterval` so both callers share it.

Already-processed messages inside the window must not create duplicate tickets
(see T006).

## 4. Out of scope

- Changing the Helm `gmail_integration` block or the hosted env. Google SSO
  still uses it.
- Microsoft mailbox credential handling.
- Google Calendar. `GoogleCalendarAdapter` has the same env-first shape with
  `GOOGLE_CALENDAR_CLIENT_ID`. Check whether hosted sets that variable while
  calendar tokens are tenant-issued. If it does, file a separate card; don't
  widen this one.

## 5. Rollout and verification

1. Deploy. Within about 30 minutes, run this read-only check on prod:
   ```sql
   select ep.status, left(ep.error_message, 80), gc.token_expires_at, gc.watch_expiration
   from email_providers ep
   join google_email_provider_config gc
     on gc.tenant = ep.tenant and gc.email_provider_id = ep.id
   where ep.provider_type = 'google';
   ```
   The 6 `unauthorized_client` rows should show `connected`, a
   `token_expires_at` in the future and a `watch_expiration` about 7 days out.
2. Any row that now shows `invalid_grant` has a genuinely expired grant (for
   example, the tenant's own app is in Testing) and needs a reconnect.
   List those tenants for support follow-up.
3. Confirm Pereceptive's missed mail since 2026-10-19 was ingested, and tell
   Dan Cudjoe through ticket alga-2026-0002844.
