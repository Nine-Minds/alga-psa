# Emulator suite (algasim)

Emulators for the external services Alga integrates with. Use them to run
integration and E2E tests without vendor accounts, and to smoke-test
integration flows by hand. Design decisions and history live in
[docs/plans/2026-07-26-emulator-suite-design.md](../../docs/plans/2026-07-26-emulator-suite-design.md).

## Run everything

```bash
cd packages/emulators/suite && npm run build && npm start
```

This starts every emulator on its default port and the console at
<http://localhost:9500>:

| Emulator | Package | Port | Emulates |
| --- | --- | --- | --- |
| `msgraph` | `@alga-psa/emulator-msgraph` | 4010 | Microsoft login (OAuth2) + Graph v1.0 mail, subscriptions, change notifications, Teams; Bot Framework connector + its OpenID/JWKS |
| `qbo` | `@alga-psa/emulator-qbo` | 4020 | Intuit OAuth + QBO v3 company API (query, CDC, void/delete, SyncTokens, credits) |
| `webhook-sink` | `@alga-psa/emulator-webhook-sink` | 4030 | Any webhook receiver; records requests, echoes Graph validation tokens |
| `smtp-sink` | `@alga-psa/emulator-smtp-sink` | 4040 | SMTP capture (MailHog stand-in) |
| `stripe` | `@alga-psa/emulator-stripe` | 4050 | Stripe /v1 API (customers, Checkout sessions) + simulated hosted Checkout with signed webhooks |
| `xero` | `@alga-psa/emulator-xero` | 4060 | Xero identity OAuth + connections list + api.xro/2.0 accounting API (invoices, contacts, settings) |

The control API and console share port 9500. Override ports with
`ALGASIM_CONTROL_PORT` and `ALGASIM_PORT_<ID>` (e.g. `ALGASIM_PORT_SMTP_SINK`).

To run a subset, or your own set of emulator modules:

```bash
node packages/emulators/host/dist/cli.js serve \
  -m @alga-psa/emulator-qbo -m @alga-psa/emulator-msgraph \
  --scenarios packages/emulators/suite/scenarios
```

### As a container

```bash
packages/emulators/build-image.sh          # builds algasim:dev
docker compose -f packages/emulators/compose.yml up
```

The image contains only the built packages and their public npm
dependencies; it never needs the monorepo at runtime.

## Point Alga at the emulators

Emulators speak the vendors' real wire protocols. Redirect Alga with env
overrides:

| Vendor | Env vars |
| --- | --- |
| Microsoft | `MICROSOFT_LOGIN_BASE_URL=http://localhost:4010`, `MICROSOFT_GRAPH_BASE_URL=http://localhost:4010/v1.0` |
| Teams / Bot Framework | `TEAMS_EMULATOR_MODE=true`, the two Microsoft vars above, plus `TEAMS_BOT_OPENID_CONFIG_URL=http://localhost:4010/v1/.well-known/openidconfiguration` and `TEAMS_BOT_SERVICE_URL_ALLOWLIST=http://localhost:4010` |
| QBO | `QBO_OAUTH_AUTHORIZE_URL=http://localhost:4020/connect/oauth2`, `QBO_OAUTH_TOKEN_URL=http://localhost:4020/oauth2/v1/tokens/bearer`, `QBO_API_BASE_URL=http://localhost:4020/v3/company` |
| Stripe | `STRIPE_API_BASE_URL=http://localhost:4050`, `STRIPE_SECRET_KEY=sk_test_algasim`, `STRIPE_PAYMENT_WEBHOOK_SECRET=whsec_algasim`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_algasim` |
| Xero | `XERO_OAUTH_AUTHORIZE_URL=http://localhost:4060/identity/connect/authorize`, `XERO_OAUTH_TOKEN_URL=http://localhost:4060/connect/token`, `XERO_CONNECTIONS_URL=http://localhost:4060/connections`, `XERO_API_BASE_URL=http://localhost:4060/api.xro/2.0` |
| Webhooks | Point the integration's webhook/notification URL at `http://localhost:4030/<any path>` |
| SMTP | Configure the SMTP provider with host `localhost`, port `4040`, no TLS |

`TEAMS_EMULATOR_MODE` is the single gate for every Teams override, and it is
deny-by-default: unless it is explicitly `true` (or `1`), the Teams surface
behaves exactly as it does in production. Any other value — unset, empty,
`staging`, a typo — fails closed, so a worker or staging host that never sets
`NODE_ENV` cannot redirect anything by accident, and `NODE_ENV=production` is a
second lock the flag cannot unlock. The vars it gates are
`TEAMS_BOT_OPENID_CONFIG_URL` and `TEAMS_BOT_SERVICE_URL_ALLOWLIST`, plus — for
the Teams integration specifically — `MICROSOFT_LOGIN_BASE_URL` and
`MICROSOFT_GRAPH_BASE_URL`, which is where the bot secret, the setup-probe
credentials, the Graph client secret, and activity-notification tokens are
sent. (The email module honors those two Microsoft vars unconditionally; that
is pre-existing behavior, unchanged here.)

`TEAMS_BOT_OPENID_CONFIG_URL` moves *discovery only*: the emulator generates
an RSA keypair, publishes a JWKS, and RS256-signs the activities it injects,
so the app's signature, issuer, and audience checks all still run.
`TEAMS_BOT_SERVICE_URL_ALLOWLIST` takes exact origins (comma-separated, no
wildcards) and is what lets the bot send back to the emulator. Entries must
include the scheme: `localhost:4010` is not an origin, and is rejected with a
warning rather than quietly widening the trust list.

Restarting the emulator mints a fresh keypair. While the override is set the
app re-discovers the JWKS every 30s (instead of the 12h production cache), so
a restart heals on its own — no need to restart the app.

### Teams round trip

The whole walkthrough below was run end to end against a real EE dev server;
every step is reproducible from a clean worktree.

**1. A server to point at.** Teams is EE, so the app has to run enterprise.
Give the worktree its own database rather than sharing the dev one:

```bash
PW=$(cat secrets/postgres_password)
docker exec -e PGPASSWORD=$PW alga_psa_postgres psql -U postgres \
  -c 'CREATE DATABASE server_mine'
# Clone an existing dev database (pg_dump, because CREATE DATABASE ... TEMPLATE
# refuses to run while the source has open connections), or migrate from empty.
docker exec -e PGPASSWORD=$PW alga_psa_postgres bash -lc \
  'pg_dump -U postgres -d server --no-owner --no-acl -Fc -f /tmp/s.dump &&
   pg_restore -U postgres -d server_mine --no-owner --no-acl -j4 /tmp/s.dump'

# CE and EE migrations share one knex_migrations table, so `knex migrate:latest`
# on ./migrations alone reports the EE rows as a "corrupt migration directory".
# Always use the merged runner:
cd server && DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER_ADMIN=postgres \
  DB_NAME_SERVER=server_mine node scripts/run-ee-migrations.js latest

cd .. && npx nx build-deps server
cd server && npx next dev -p 3210
```

`server/.env.local` needs `NEXT_PUBLIC_EDITION=enterprise`, `NEXTAUTH_URL`
matching the port, `DB_NAME`/`DB_NAME_SERVER` pointing at the new database, and
the emulator vars:

```
TEAMS_EMULATOR_MODE=true
MICROSOFT_LOGIN_BASE_URL=http://127.0.0.1:4010
MICROSOFT_GRAPH_BASE_URL=http://127.0.0.1:4010/v1.0
TEAMS_BOT_OPENID_CONFIG_URL=http://127.0.0.1:4010/v1/.well-known/openidconfiguration
TEAMS_BOT_SERVICE_URL_ALLOWLIST=http://127.0.0.1:4010
TEAMS_BOT_APP_ID=11111111-2222-4333-8444-999999999999
TEAMS_BOT_APP_PASSWORD=algasim-bot-secret
TEAMS_BOT_APP_TENANT_ID=11111111-2222-4333-8444-555555555555
```

Use one host spelling everywhere: the allowlist matches origins exactly, so a
`serviceUrl` of `http://localhost:4010` is *not* covered by an allowlist entry
of `http://127.0.0.1:4010`.

**2. Seed the Microsoft side.** The Graph client is the one you will enter as a
Microsoft profile; `appRoles` are the admin-consented application permissions
its app-only tokens carry, which is what the setup wizard's permission probe
reads:

```bash
algasim seed msgraph client -p '{
  "clientId": "alga-teams-graph-client",
  "clientSecret": "alga-teams-graph-secret",
  "appRoles": ["Calendars.ReadWrite","OnlineMeetings.ReadWrite.All",
               "OnlineMeetingRecording.Read.All","OnlineMeetingTranscript.Read.All",
               "TeamsActivity.Send","User.Read.All"]
}'
# The bot's own credentials, so its client_credentials token grant succeeds.
algasim seed msgraph client -p '{"clientId":"11111111-2222-4333-8444-999999999999","clientSecret":"algasim-bot-secret"}'
```

**3. Set the tenant up through the product.** Open **Settings → Integrations**:

- *Providers → Microsoft → Add profile*: client id, tenant id
  (`11111111-2222-4333-8444-555555555555`) and secret from step 2.
- *Communication → Teams*: pick that profile, save the draft, then run the
  wizard's three checks — validate the Microsoft profile, probe Graph
  permissions, validate the Bot Framework connector — and Activate. All three
  hit the emulator.

**4. Drive a conversation.**

```bash
# Point the emulator at your app, and match TEAMS_BOT_APP_ID.
algasim action msgraph configure -p '{
  "botTargetUrl": "http://localhost:3210/api/teams/bot/messages",
  "botServiceUrl": "http://127.0.0.1:4010",
  "botAppId": "11111111-2222-4333-8444-999999999999"
}'

# An external/guest client identity, then an inbound message from them.
algasim seed msgraph teams-user -p '{"id":"guest-1","displayName":"Wanda","userType":"Guest"}'
algasim seed msgraph bot-activity -p '{
  "text": "My printer is on fire",
  "fromAadObjectId": "guest-1",
  "conversationId": "a:conversation-1",
  "conversationType": "personal"
}'

# Read back what the bot sent, adaptive cards and all.
algasim state msgraph bot-activities
algasim state msgraph activity-notifications
```

`seed bot-activity` returns the app's HTTP status and body, so a rejected
activity shows up immediately (`401` with `{"error":"unauthorized"}` when the
audience or signature does not check out).

The inbound JWT is stamped with wall time, not the virtual clock, so
`clock advance` and activity injection compose: advancing the clock to expire
Graph tokens never invalidates the activities injected afterwards. To test the
app rejecting an expired inbound token, backdate that token on its own with
`tokenAgeSeconds` (past the 1h TTL):

```bash
algasim seed msgraph bot-activity -p '{"text":"stale","tokenAgeSeconds":7200}'
```

The bot answers an unlinked Teams identity with the "Teams sign-in required"
card. Linking a Teams user to a PSA user happens through Microsoft SSO sign-in,
which the emulator does not serve yet (no OIDC discovery document on the login
surface), so richer command replies still need a tenant whose users are already
linked. For local testing, plant the link directly — one row in
`user_auth_accounts` (`provider='microsoft'`, `provider_account_id=<the
teams-user id>`, `user_id=<PSA user>`); the bot then runs commands as that user.

### Unsupported Graph operations

Calendar wire-contract validation lives in `msgraph/tests/contracts/calendar.ts`
and runs against the actual HTTP responses in `calendar.test.ts`. Its independent
references are Microsoft's [create-event response](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0)
and [Graph error format](https://learn.microsoft.com/en-us/graph/errors), reviewed
2026-09-08. It checks the create status and consumed event fields, plus the error
envelope. Deliberately changing the start field to a string, changing the create
status, or removing the error envelope fails validation. This exposed missing
error messages in the emulator, now supplied for Graph error objects. OAuth
errors retain their separate format. This is partial contract coverage: callback,
OAuth, bot and other provider contracts still require independent parity checks.
No live Microsoft sandbox drift verification has been performed.

The following Microsoft contract boundaries are independently checked. These
checks run in the normal msgraph Vitest suite against local HTTP listeners.

| Surface | Contract evidence | Remaining limitation |
| --- | --- | --- |
| Calendar create/error responses | `tests/contracts/calendar.ts` and real HTTP checks in `calendar.test.ts`; malformed event/error bodies and wrong create status fail | Consumed fields only; no full event schema or live sandbox comparison |
| OAuth token responses | `tests/contracts/oauth.ts` applied to code, refresh and client-credential responses in `smoke.test.ts`; wrong expiry type and bearer type fail | Opaque token envelope only; does not establish Entra signatures, consent, PKCE, SSO, or complete scope-dependent token issuance parity |
| Subscription validation | `calendar.test.ts` verifies request method/content type, accepts only 200/plain-text matching token responses, and verifies rejected callbacks leave no subscription | HTTP loopback transport; real HTTPS trust and tenant registration require application/sandbox coverage |
| Basic change notifications | `tests/contracts/notifications.ts` validates real mail, calendar, meeting-artifact and call-record callbacks; deleting required fields or corrupting GUIDs, expiry and change type fails. Mail checks compare tenant to the OAuth claim and ID/expiry to the created subscription | Single emulated Entra tenant; resource-specific encrypted payloads, lifecycle notifications and live sandbox drift remain unverified |

OAuth response reference: [Microsoft authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).
Subscription reference: [Graph webhook validation](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks#notificationurl-validation).
Both were reviewed 2026-09-08. Validation requests have a ten-second deadline,
including reading the response body, and do not follow redirects. Basic callback
metadata follows the [changeNotification resource contract](https://learn.microsoft.com/en-us/graph/api/resources/changenotification?view=graph-rest-1.0),
reviewed 2026-09-08: GUID subscription/tenant IDs, subscription expiration,
change type and resource. Subscription GUIDs are derived from the seeded ID
stream, preserving deterministic replay. Resource-specific rich notification
payloads, lifecycle events and remaining provider auth/error surfaces still need
independent checks; a green emulator suite does not establish those contracts.

Explicit delegated OAuth scope requests now receive a refresh token only when
they include `offline_access` as a complete scope. App-only grants never create
or return a refresh token. HTTP contract cases cover a valid offline scope,
its omission, and a similarly named scope that must not match. This prevents a
test application from getting persistent access merely because the emulator
was more permissive than Entra. Legacy requests that omit the scope entirely
still use the emulator's default mail/offline scope set; PKCE, consent and full
scope validation remain outside this check.

Unimplemented `/v1.0` Graph routes return HTTP 501 with
`error.code: EmulatorUnsupportedOperation`. This is an emulator capability
error, not a claim that Microsoft Graph returns the same response. Implemented
routes still return 404 when the requested item does not exist. Keeping these
cases distinct prevents clients from treating a misspelled or unimplemented
DELETE route as successful idempotent deletion. Named-calendar operations and
other unsupported paths must not be counted as covered by a passing request.

### Primary calendar synchronization

Shared and enterprise calendar adapters use `MICROSOFT_GRAPH_BASE_URL` and
`MICROSOFT_LOGIN_BASE_URL`, including token refresh and the enterprise OAuth
callback. The emulator serves primary-calendar metadata and event CRUD at
`/me/calendar/events`, plus `/me/calendarView/delta` for incremental sync.
Delta rounds preserve the initial date window, return opaque next/delta links,
freeze paginated results, and report event updates, deletions and window exits.
`Prefer: odata.maxpagesize=N` controls page size (default 100). Resetting or
restoring the emulator invalidates prior sync tokens with `410 SyncStateNotFound`.

For mailbox replay, `deliver-message` takes an existing `messageId`, sends its
created notification again, and returns `{ message, deliveries }`. Each delivery
includes the subscription ID, HTTP status and success flag; connection failures
also include an error. It preserves the message identity and does not add another
mailbox message. Only unexpired mail subscriptions requesting `created` receive
it. Delivery has a ten-second timeout and does not follow redirects. The existing
`message` seeder still creates a message and sends its initial notification.

Use the `calendar-change` control action to create/update/delete vendor events;
it returns the event and each matching webhook delivery's HTTP status. Supply
`changeType`, an `event` object for creation/update, and `eventId` for update/delete.
The default organizer is `emulated-user`, the single delegated mailbox.
Primary-calendar HTTP mutations also deliver notifications. Subscription resource,
change type and expiry determine delivery; mail and calendar notifications are
separate. Failed callbacks remain visible in control results and redirects are
not followed. The emulator does not automatically retry failed deliveries.

This delta model handles single-instance UTC and IANA-zone events. Explicit
ISO offsets identify instants; offset-free event dates use the supplied zone,
including its winter/summer offset. Delta responses normalize dates to UTC
without mutating vendor state. Windows timezone names, ambiguous/nonexistent
local times, recurrence expansion and unsupported query options remain explicit
model limitations; refusal does not claim Graph rejects those cases. The separate
legacy event-list filter still models UTC values only.
It reports deletions for previously tracked events; it does not reproduce Graph's
optional tombstones for unrelated changes outside the window. Tokens are bound
to the OAuth client, but the single-mailbox model does not establish Entra user
or permission parity. Named calendars are not implemented. Alga's calendar
subscription code still requires HTTPS: provide a trusted test callback endpoint
instead of disabling that check. Browser configuration, callback persistence and
worker synchronization require their own full application journey.

Protocol references: [Graph dateTimeTimeZone](https://learn.microsoft.com/en-us/graph/api/resources/datetimetimezone?view=graph-rest-1.0) and [Microsoft calendar-view delta](https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0).

### Teams meetings and recordings

The msgraph emulator also serves the meetings surface the Teams integration uses:
calendar events (`POST/PATCH/DELETE /users/{upn}/events`, an `isOnlineMeeting`
event auto-creates an online meeting with a join URL), `onlineMeetings`
(creation probe, join-URL `$filter` resolution), recordings/transcripts lists
and `/content` endpoints, and `getAllRecordings`/`getAllTranscripts`
subscriptions with Graph-style change notifications.

The app reaches it through the same `TEAMS_EMULATOR_MODE` gate (the meetings
module resolves Graph URLs via `getMicrosoftGraphBaseUrl()`), plus one extra
var so the artifact webhook is reachable from inside the container — plain
http is accepted only while the emulator gate is on:

```
TEAMS_RECORDINGS_WEBHOOK_URL=http://host.docker.internal:3000/api/teams/webhooks/recordings
```

The subscription + artifact loop, end to end:

```bash
# The app's own renewal job creates both artifact subscriptions against the
# emulator (validation handshake included). Locally on pg-boss, enqueue it:
#   INSERT INTO pgboss.job (name, data) VALUES
#     ('renew-teams-meeting-artifact-subscriptions', '{"tenantId":"<tenant>"}');
# (`teams_integrations` must be active with default_meeting_organizer_upn set.)

# A meeting the app knows about, then a recording landing on it:
algasim seed msgraph meeting -p '{"organizerUserId":"organizer@example.test","subject":"Standup"}'
algasim seed msgraph meeting-recording -p '{"meetingId":"<id from above>"}'
algasim seed msgraph meeting-transcript -p '{"meetingId":"<id>"}'

algasim state msgraph online-meetings       # meetings + artifact inventory
algasim state msgraph subscriptions         # who is listening
```

`meeting-recording`/`meeting-transcript` return the webhook delivery status
inline. For the app to fetch-and-persist, its `online_meetings` row must match
the emulator meeting id (`provider_meeting_id`) and have a `created_by` —
meetings created through the app get both automatically; a hand-planted row
needs them set. On success the meeting advances to `recording_ready`, with
recordings stored as files and transcripts as documents.

### Teams Phone call records

The same msgraph emulator serves the telephony surface: a
`communications/callRecords` subscription, a `call-record` seeder that pushes a
Graph-style change notification, and
`GET /v1.0/communications/callRecords/{id}?$expand=sessions` returning the CDR
the adapter maps. The PSTN leg lives on the session endpoints
(`identity.phone.id`), which is what decides direction; `answered: false` seeds
a missed call (zero-length session with `failureInfo`).

Point the webhook at the app the same way the recordings one is pointed —
plain http is accepted only while the emulator gate is on:

```
TELEPHONY_CALLS_WEBHOOK_URL=http://host.docker.internal:3000/api/telephony/webhooks/teams-calls
```

The whole loop, end to end:

```bash
# The renewal job creates the callRecords subscription against the emulator.
# Locally on pg-boss, enqueue it:
#   INSERT INTO pgboss.job (name, data) VALUES
#     ('renew-telephony-call-subscriptions', '{"tenantId":"<tenant>"}');
# (`telephony_providers` must have an active teams-phone row.)

algasim seed msgraph call-record -p '{"direction":"inbound","callerNumber":"+15551234567","durationSeconds":180}'
algasim seed msgraph call-record -p '{"direction":"inbound","callerNumber":"+15557654321","answered":false}'

algasim state msgraph call-records    # seeded CDRs + notification delivery
```

A seeded call whose number matches a contact lands as a `Call` interaction on
that contact's timeline within one processing cycle. An unmatched or ambiguous
number stays in the ledger and shows up under Settings → Integrations →
Communication → Telephony, waiting to be resolved.

### Teams Phone call recordings and transcripts

Call artifacts do not live on an online meeting: Graph serves them from the ad
hoc call — enumerated ONLY via `getAllRecordings`/`getAllTranscripts` function
calls (`/v1.0/users/{id}/adhocCalls/getAllRecordings(userId=...,startDateTime=...,endDateTime=...)`,
items carry `callId`) and fetched by artifact id
(`.../adhocCalls/{callId}/{recordings,transcripts}/{artifactId}/content`).
There is no per-call artifact list in real Graph, and the emulator deliberately
refuses one — serving fictitious routes is how the Entra-sync class of bug got
validated locally. There is no change notification for call artifacts at all. The app therefore polls, and
the emulator has no deliveries to report — seed an artifact and it simply sits
there until the poll finds it:

```bash
algasim seed msgraph call-transcript -p '{"callId":"<callRecordId>"}'
algasim seed msgraph call-recording  -p '{"callId":"<callRecordId>"}'

algasim state msgraph call-records    # CDRs now carry their artifacts
```

The transcript is filed as a document on the matched client/contact and, when
the call is linked to a ticket and the AI Assistant add-on is active, summarized
onto that ticket. Recording bytes are only stored when the tenant turned on
recording downloads in the Teams settings.

### Living with the emulator

Six ergonomics fixes that came out of using it in anger:

- **State survives restarts.** `--state-file <path>` (or `ALGASIM_STATE_FILE`)
  snapshots seeded state after every mutating control call and on shutdown, and
  restores it on boot. Compose sets it by default onto a named volume, so
  `docker compose restart algasim` no longer costs you the seed. The Bot
  Framework signing key is deliberately *not* part of the snapshot — the app
  caches the discovered JWKS, so restoring must not rotate it.
- **A default actor.** `algasim action msgraph configure -p '{"defaultActor":
  {"fromAadObjectId":"...","conversationId":"..."}}'` fills in the identity
  every `bot-activity` seed used to repeat. Explicit values still win.
- **Seed presets.** Every seeder in the console carries a preset row: fill the
  form, name it, hit **save form**, and **load** puts it straight back into the
  fields later (**load & seed** does both in one click). They are stored by
  `save-seed-preset` / `delete-seed-preset` and visible in the `seed-presets`
  state view, so the CLI and scenarios can reach the same payloads — no more
  copying a fiddly seed out of a state view by hand.
- **Adaptive Card preview.** The console renders card attachments found in any
  state view with a small vendored renderer — no CDN, so it works under the
  console's CSP.
- **Prefix faults.** `operation-fault` accepts a trailing `*`, e.g.
  `"POST /v3/conversations/x/activities/*"`, so reply paths with a
  server-generated activity id are targetable at all.
- **Scenario recording.** Start with `--record-scenario` (or
  `ALGASIM_RECORD_SCENARIO=true`) and `algasim recording` prints everything you
  did as a scenario document you can save and replay.

## Drive them

Every emulator exposes two surfaces: the **vendor surface** above, and a
uniform **control surface**. The CLI, the console, and test helpers are all
clients of the control surface, so anything one can do, all can.

```bash
alias algasim='node packages/emulators/host/dist/cli.js'

algasim catalog                                        # everything available
algasim seed qbo customer -p '{"name":"Acme Rockets"}'
algasim action msgraph expire-access-tokens
algasim arm qbo transport:error -p '{"status":503,"rate":0.5}'
algasim disarm qbo transport:error
algasim state webhook-sink requests
algasim clock advance 32d                              # virtual time: token expiry, billing periods
algasim reset msgraph                                  # state + all faults
algasim scenario run my-setup.yaml
```

The same operations over HTTP:

```
GET  /control/catalog
POST /control/:emulator/actions/:name        body = params
POST /control/:emulator/faults/:name/arm     body = params
POST /control/:emulator/faults/:name/disarm
GET  /control/:emulator/state/:view
GET  /control/:emulator/requests
POST /control/:emulator/seed/:name           body = params
POST /control/:emulator/reset
POST /control/clock/advance                  {"duration":"32d"}
POST /control/scenario                       body = scenario JSON
POST /control/scenarios/:name/run
```

### Request evidence

`GET /control/:emulator/requests` returns `{ ok: true, result: ... }` with
completed HTTP vendor requests, including injected transport failures. Records
contain a sequence number assigned on arrival, method, path, start time,
elapsed milliseconds, HTTP status, and whether the connection aborted. Query
strings, headers, and bodies are excluded. Use provider state views to verify
business effects such as created invoices or captured email.

For SMTP, `GET /control/smtp-sink/state/emails` returns received messages in
`result`, including `messageId`, `inReplyTo`, `references` and `attachments`.
Each attachment includes `filename`, `contentType`, `contentDisposition`,
`contentId`, byte `size` and `contentBase64`. Decode the base64 to compare exact
received bytes; match attachments by identity rather than MIME part order.
These values come from parsing the received SMTP message. Reset clears the
captured messages. The sink does not provide inbox/IMAP behavior.

History is in memory, in completion order, and retains the latest 1,000
completed requests by default (`EmulatorHost.requestHistoryLimit`, 1–10,000).
`dropped` reports evicted records; `inFlight` reports unfinished requests in
the current generation. `complete` is false while requests are in flight,
after truncation, or for non-HTTP protocols such as SMTP (`supported: false`).
A complete snapshot describes only traffic observed so far: tests must also
await the expected application outcome and assert the expected requests.

Reset clears history and increments `generation`, alongside resetting provider
state and faults. Responses from requests started before reset are excluded
from the new history. Reset does not cancel application jobs or outstanding
vendor operations; stop or drain those before reusing a provider for another
scenario. Request history is not restored from persisted provider snapshots.

To exercise duplicate Stripe callback handling, use
`algasim action stripe redeliver-event -p '{"eventId":"evt_..."}'` with an ID
from the `events` state view. It sends the stored event again without creating
another payment intent or event. Each delivery receives a fresh signature
timestamp, independent of the event's creation time and virtual clock, and its
per-event/per-target attempt number appears in `webhook-deliveries`.

### Faults

Three tiers, so most failure modes cost nothing to support:

- **Transport** (`transport:latency`, `transport:error`, `transport:connection-reset`)
  come free with every HTTP emulator via host middleware.
- **Protocol** — token expiry and revocation actions on `msgraph` and `qbo`.
- **Domain** — emulator-specific, e.g. `msgraph` `operation-fault` (fail
  `"GET /me"` or `"POST /v3/conversations/{id}/activities"` N times, for
  Graph throttling and bot-connector failures; a trailing `*` matches by
  prefix), QBO stale SyncTokens produced by out-of-band
  `receive-payment`/`apply-credit` actions. QBO `rename-invoice` models a
  bookkeeper changing `DocNumber`; pass `realmId`, `invoiceId`, and `docNumber`
  to create invoice drift without changing the invoice identity or amount.
  Wire QBO timestamps follow the shared host clock so current-time CDC polls
  discover these edits. Pure in-process simulator tests retain their default
  deterministic logical clock.

### Scenarios

Xero's `select-organisation` action takes `xeroTenantId` for an already seeded
organisation and places it first in `/connections`, matching Alga's supported
default-connection selection. It retains the other organisations and their
records; selecting an unknown organisation fails without changing the order.
This control models the connection response, not a provider consent screen.

Declarative YAML that seeds, acts, arms, and advances the clock by registry
name — identical behavior from CI setup code, the CLI, and the console's run
button. See [suite/scenarios/](suite/scenarios/) for examples:

```yaml
name: delinquent-customer
steps:
  - seed: qbo/customer
    params: { name: Slowpay Inc }
  - seed: qbo/invoice
    params: { customerId: customer-1, amountCents: 90000 }
  - advance: 45d
  - arm: qbo/transport:latency
    params: { ms: 2000 }
```

### Virtual clock

All emulator time flows through one host clock. `algasim clock advance 2h`
expires OAuth tokens; `32d` crosses billing periods and subscription
expirations. Runs are reproducible: the host PRNG is seeded (`--seed`).

One deliberate exception: the JWT `seed msgraph bot-activity` signs is stamped
with wall time, because the app verifies it with jose against the real clock
(as real Microsoft does). Emulator state stays on the virtual clock, so the two
compose; `tokenAgeSeconds` is the knob for an intentionally expired one.

## Write an emulator

A package under `packages/emulators/<vendor>` exports an `EmulatorPackage`:

```ts
const myEmulator: EmulatorPackage<MyCore> = {
  id: 'vendor',
  displayName: 'Vendor',
  defaultPort: 40xx,
  createCore: (env) => new MyCore(env),   // pure state machine; time via env.clock
  wire(router, core) { /* the vendor's real HTTP routes */ },
  register(reg, core) { /* actions, faults, state views, seeders */ },
};
```

Rules that keep the suite coherent:

- **Core is pure.** No I/O, no wall time (`env.clock`), no `Math.random()`
  (`env.rng`). Unit tests inject the core directly at the service seam —
  billing's QBO tests are the model.
- **Controls are declarations.** One `reg.action(...)` with a zod schema and
  the CLI command, console form, and HTTP endpoint all exist. Never build
  client-side support for an emulator.
- **Wire is faithful.** Real routes, real auth handshakes, real error
  envelopes. If Alga needs an env override to reach the emulator, add it at
  the client (see `microsoftGraphEndpoints.ts` and `qboClientService.ts`).
- **Non-HTTP protocols** implement `serve()` instead of `wire()` (see
  `smtp-sink`).

Add the package to `SUITE_EMULATORS` in [suite/src/index.ts](suite/src/index.ts)
and to the `PACKAGES` list in [build-image.sh](build-image.sh).

### Xero OAuth application fixtures

After each emulator reset, seed `application` before starting OAuth. Confidential
applications require `type: "confidential"`, `clientId`, `clientSecret`, and an
array of exact `redirectUris`. Public applications use `type: "pkce"`, `clientId`
and `redirectUris`; authorization requires an S256 challenge and token exchange
requires its matching verifier. Token requests support form credentials or HTTP
Basic authentication. Invalid secrets, client/code identity and callback mismatches
are rejected without consuming a valid grant. Reset removes registrations and tokens.

The application seeder returns only client ID and type. It does not register a real
Xero application. After seeding organisations, call `set-connections` with
`{ clientId, xeroTenantIds }` to set the exact consent list for that application.
Seeded organisations are invisible to the vendor API until granted; the control
`organisations` view still lists all seeded organisations. An empty consent list
revokes access immediately, including for existing tokens. Invalid changes leave
existing consent intact. Reset clears consent. Live-provider drift checks remain
outside this emulator's current coverage.

### Stripe callback signature parity

The Stripe smoke suite verifies actual HTTP callback payloads and headers with
`stripe.webhooks.constructEvent`, using the same declared SDK range as the
application (`^19.1.0`, currently locked to 19.3.1). The SDK is an explicit
emulator test dependency. It replaces the test's local HMAC verifier and
checks delivery-time tolerance as well as signature bytes. The suite also
rejects payload whitespace changes, a wrong endpoint secret, and a correctly
signed but hour-old delivery. Historical event creation time remains distinct
from the fresh signature time when an event is redelivered.

Reference: [Stripe webhook signature verification](https://docs.stripe.com/webhooks/signature),
reviewed 2026-09-08. This is callback authentication parity, not live sandbox
verification or validation of every Stripe event payload/API field.

### QBO token error contracts

The token endpoint `/oauth2/v1/tokens/bearer` returns OAuth `error` and
`error_description` fields for invalid client credentials, invalid grants,
and unsupported grant types. Accounting endpoints retain the distinct
`Fault.Error` envelope. Native HTTP cases verify both contracts so a local
export test cannot accidentally exercise accounting-error parsing for token
refresh failures.

Independent reference: [Intuit OAuth Ruby client documentation](https://developers.intuit.com/app/developer/qbo/docs/develop/sdks-and-samples-collections/ruby/oauth-ruby-client),
which demonstrates HTTP 400 with an `invalid_grant` OAuth error, and the
[Intuit OAuth JavaScript client](https://github.com/intuit/oauth-jsclient/blob/master/README.md),
reviewed 2026-09-08. Authorization-page behavior and live Intuit sandbox drift
remain outside these token-error checks.

### Xero accounting validation errors

Invoice and contact validation failures use the accounting error structure
from [Xero's published OpenAPI specification](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero_accounting.yaml):
`ErrorNumber`, `Type`, `Message`, and per-element `ValidationErrors`. The wire
response does not substitute problem-detail fields for that accounting
contract. Tests exercise invalid item codes, archived accounts and a missing
contact name through HTTP. OAuth error objects keep their separate shape.
This checks representative rejection payloads; it does not claim live sandbox
verification, full batch-error semantics or complete Xero API coverage.

### Xero refresh-token recovery and expiry

The token endpoint retains a rotated refresh token for a fixed 30-minute retry
window, allowing recovery when the first refresh response is lost. Repeated
use does not extend that deadline. Unused refresh tokens expire after 60 days;
newly issued tokens retain their own lifetime and client/scope binding.
`xero/tests/tokenLifecycle.test.ts` verifies recovery and expiry over HTTP with
an isolated emulator clock. These rules follow the
[Xero OAuth FAQ](https://developer.xero.com/faq/oauth2), reviewed 2026-09-08.
This covers token lifetime behavior, not live sandbox drift, JWT signatures,
or complete scope-dependent token issuance parity.
