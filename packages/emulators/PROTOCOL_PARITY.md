# Provider protocol coverage

Reviewed 2026-09-08. This inventory supplements the [suite guide](README.md).
It records bounded evidence, not complete vendor compatibility. Native test
results below are recorded runs, not a claim that the
current revision passed the full CI or browser matrix.

| Surface | Implemented and exercised | Evidence boundary / remaining gap |
| --- | --- | --- |
| Teams organizer lookup | Both workspace and EE `saveTeamsIntegrationSettings` obtain a token and resolve an organizer by UPN through native Graph HTTP; journal proves the token POST and user GET. Graph also accepts directory object ID and preserves unknown-user 404. Both save actions preserve existing settings after an unresolved organizer and recover when the directory user becomes available. | [Consumer tests](msgraph/tests/teamsOrganizerRouting.test.ts), [wire tests](msgraph/tests/smoke.test.ts). Auth/storage seams are isolated. This does not exercise a browser profile form, tenant consent, SSO, or live directory behavior. Production and absent-gate override rejection are separate action tests. |
| QBO consumer refresh/retry | Actual `QboClientService` recovers from API 401 through HTTP refresh, persists replacement credentials, and retries once. Revoked refresh does not overwrite credentials or replay; another API 401 stops after one refresh. | [Consumer tests](qbo/tests/clientRecoveryConsumer.test.ts). Native Axios/vendor HTTP with private memory secret storage and mocked disconnect coordination. This does not prove cross-process refresh locking, a database transaction, or Intuit retry-window parity. |
| QBO company authorization | Selected company is bound to the authorization code and retained by access/refresh credentials. Wrong-company reads and writes are rejected before entity mutation. | [HTTP tests](qbo/tests/smoke.test.ts) authorize companies independently and check the boundary before/after refresh. `403 / SIM_REALM_MISMATCH` is an explicit emulator guard; the exact Intuit rejection envelope is not independently verified. |
| QBO revocation | Basic authentication + JSON token; either access or refresh token can revoke the modeled grant family. Independent grants survive; invalid/foreign clients cannot revoke it. | [HTTP tests](qbo/tests/tokenRevocation.test.ts). Unknown/repeated success and grant-family invalidation are RFC-based model choices, not live Intuit observations. Existing immediate refresh-token consumption still lacks Intuit retry-window parity. |
| Xero revocation | Basic authentication + form refresh token, empty 200; removes connected organisations and rotated credentials. | [Lifecycle HTTP tests](xero/tests/tokenLifecycle.test.ts), [model limits](xero/README.md). One resource owner per client; immediate access-token invalidation is deterministic emulation, not measured JWT propagation. Unknown/repeated/foreign-token success follows RFC 7009. Direct access-token revocation is not modeled. |
| Actual accounting cleanup consumers | Real `revokeAccountingOAuthGrant` for each provider reaches the journaled vendor route. Success rejects credentials; Xero also verifies connection removal after fresh authorization. Failed cleanup logs without throwing and preserves usable credentials. | [QBO consumer](qbo/tests/accountingCleanupConsumer.test.ts), [Xero consumer](xero/tests/accountingCleanup.test.ts). Native HTTP with guards against external destinations; auth/state/logger seams are isolated. This is the cleanup helper, not the entire denied OAuth callback, database rollback, disconnect UI, or a running worker. |
| Stripe callback redirects | HTTP 302/307 count as delivery failures; redirect destination receives no request and independent callbacks still receive valid signed payloads. | [Redirect tests](stripe/tests/webhookRedirect.test.ts). SDK verification covers signatures and delivery time; no live sandbox capture, exhaustive event schema, or automatic retry/backoff parity is implied. |
| Level REST consumer | Alga's real `LevelIoApiClient` over HTTP: `testConnection`, group hierarchy across pages, devices with `include_*` sections and `ancestor_group_id`, alerts by device/status, resolve, updates, 401 envelope, 429 retry on `Retry-After`, persistent 429/5xx errors. | [Consumer tests](levelio/tests/restConsumer.test.ts). Shapes follow the OpenAPI definition only; no live Level capture. The incremental-sync check applies the sync engine's `last_seen_at` filter by hand, not `runLevelIoFullSync`. |
| Level outbound (route) | Alga's fixed route exercised through the real EE route and a migrated database: signed native webhooks (`X-Level-Signature` over the raw body) are accepted, create tickets, reset on `alert_resolved` and no-op on a re-run of the same `event_id`; Alga's fallback automation template (documented system variables only) produces distinct alerts and tickets; the old literal `{{alert_id}}` template is rejected. Fixed 2026-10-15; no emulator behavior was changed for the fix. | [Route integration test](../../ee/server/src/__tests__/integration/levelioEmulatorRoute.integration.test.ts), [webhook tests](levelio/tests/webhooks.test.ts), [automation tests](levelio/tests/automation.test.ts). Secrets and event publishing are stubbed. Level-side delivery behavior beyond the documented points below is modeled, not observed. |
| Huntress REST consumer and poll cycle | Alga's real `HuntressClient` over HTTP: the documented `{ account }` envelope, `listOrganizations` across pages with `limit=500` + `page_token`, `getOrganization`/`getAgent` 404 → null, the exact `listIncidentReportsPage` query string with `updated_at desc` ordering, 429 retried twice on `Retry-After` and the third propagated, 5xx propagated. `pollHuntressIncidents` then runs end to end on a migrated database: backfill window, mapped-board routing with the severity→priority map, fallback routing plus on-demand organization discovery, hostname asset match, status-change note, auto-close, cursor advancing only past successes, list failure leaving the cursor and `last_incremental_sync_at` untouched, and a retried 429. | [Client consumer test](../../ee/server/src/__tests__/integration/huntressEmulatorApiClient.integration.test.ts), [poller test](../../ee/server/src/__tests__/integration/huntressEmulatorPoller.integration.test.ts), [wire tests](huntress/tests/rest.test.ts), [escalation wire tests](huntress/tests/escalations.test.ts). Shapes follow the published OpenAPI document only; no live Huntress account was used. Secrets, the tenant Knex handle and event publishing are stubbed. Escalation ingestion is not on this branch (PR #3814), so the escalation surface has vendor-contract coverage only, no consumer coverage. Org sync (`runHuntressOrgSync`) and the settings UI are not exercised here. |
| Temporal Stripe routing | Actual subscription-metadata POST and tenant-deletion DELETE use the configured SDK endpoint; missing override retains production default and malformed overrides fail. | [Native consumer tests](../../ee/temporal-workflows/src/config/__tests__/stripe-client-routing.test.ts). Two of five migrated constructors have individual HTTP journeys. DB/secrets/activity context are mocked; no running Temporal worker or workflow-engine routing proof. |

## Independent references and deliberate model choices

- Microsoft documents [user lookup by ID or UPN](https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0).
  The local case-insensitive UPN lookup is not a live-provider drift check.
- QBO request/auth/success shape comes from Intuit's
  [OAuth client implementation](https://github.com/intuit/oauth-jsclient/blob/master/src/OAuthClient.js)
  and [its tests](https://github.com/intuit/oauth-jsclient/blob/master/test/OAuthClientTest.js).
- Xero documents refresh-token revocation in its
  [token guide](https://developer.xero.com/documentation/guides/oauth2/token-types).
  The [OAuth FAQ](https://developer.xero.com/faq/oauth2) separately grounds
  the 30-minute rotated-token retry and 60-day unused-token expiry tests.
- [RFC 7009](https://www.rfc-editor.org/rfc/rfc7009.html#section-2.2)
  supplies invalid/repeated-token success semantics. Do not present these as
  captured Intuit or Xero responses. Foreign-client handling also differs in
  the local models: QBO rejects with 400; Xero returns a non-mutating 200.
- Stripe documents [webhook HTTP status handling](https://docs.stripe.com/webhooks#fix-http-status-codes)
  and [signature verification](https://docs.stripe.com/webhooks/signature).

## Recorded execution and topology limits

The [revocation/routing evidence](../../ee/docs/plans/2026-09-05-production-regression-prevention/evidence/provider-revocation-worker-routing.json)
records pre-fix failures and native passes for the new vendor routes and
Temporal consumers. The later [accounting consumer evidence](../../ee/docs/plans/2026-09-05-production-regression-prevention/evidence/accounting-consumers-and-artifact-verification.json)
records both cleanup consumers and 48 combined accounting tests. These are
separate from [earlier host browser journeys](../../ee/docs/plans/2026-09-05-production-regression-prevention/evidence/host-accounting-provider-journeys.json),
which tested accounting product flows on the revisions/configurations recorded
there; those browser runs do not establish the newly added cleanup paths.

Both Xero revocation variables and QBO's revocation variable must reach each
requesting process. Rendered Compose values prove configuration only. A generic
invalid-credential probe proves endpoint reachability, not that a real consumer
uses that endpoint. Completed [CI run 34287571495](https://github.com/Nine-Minds/alga-psa/actions/runs/34287571495)
tested merge revision `3c046458a0fca6cc43c63f9ac791154410a8a1e3` and passed
worker startup, candidate image identity and shared-secret checks in both editions.
It also executed the authored workflow through Temporal to successful persisted
state-node results, without provider actions. Its seven routing records identify
service classes; they do not establish coverage of every running replica.
The stricter per-container topology check in [run 34299806767](https://github.com/Nine-Minds/alga-psa/actions/runs/34299806767)
fails despite successful worker startup. Local repairs address Compose-generated
image names and enterprise profile selection; actual replica-level CI verification
is still pending. No whole-run green claim follows from the earlier bounded passes.
Running-process
provider journeys, the remaining
Temporal constructors, denied callback/disconnect journeys, and optional
sanitized live-provider drift checks remain explicit follow-up work.

Existing Graph calendar/OAuth/notification contract checks are listed in the
[suite guide](README.md#unsupported-graph-operations). Named calendars, Microsoft
SSO/complete consent and scope enforcement, rich/lifecycle notifications, and
complete vendor payload schemas remain outside that coverage. Graph's explicit
501 `EmulatorUnsupportedOperation` is an emulator diagnostic, not a vendor
response contract. A successful route must never stand in for an unsupported one.


## Microsoft user callback evidence

The separate [NextAuth callback lane](../../ee/docs/plans/2026-09-05-production-regression-prevention/microsoft-coverage-boundaries.md#real-nextauth-callback-lane)
uses a test-only canonical-authority transport fixture, not the msgraph emulator's
OAuth endpoints. One native development run exercised actual application sign-in,
Microsoft account linking and invalid-state rejection with persisted identity
checks. CI registration is present; execution remains pending. It observed zero
JWKS requests and no nonce, so it does not establish application signature
verification, nonce rejection, or live Microsoft consent. This adds application
callback evidence without expanding the msgraph emulator's protocol-parity claims.

A second, narrower lane does use the emulator's OAuth endpoints:
[the SSO mapping-failure test](../../server/src/test/integration/nextAuthOptions.microsoftSimulator.integration.test.ts)
builds the app's `azure-ad` provider behind `MICROSOFT_SSO_EMULATOR_MODE`, then
replays the authorization redirect, the code exchange and the Graph `/me`
userinfo request before handing the response to the provider's own `profile()`
and `signIn` callbacks. It establishes that an Entra-shaped profile whose mail
matches no AlgaPSA user ends on a readable redirect instead of Auth.js
`error=Configuration`. It is not browser evidence and not OIDC evidence: the
emulator mints no signed id_token for this flow, so no signature, nonce or
consent check runs, and the AlgaPSA database and session store are fixtures.

The token endpoint reads client credentials from the form body
(`client_secret_post`) and from an HTTP Basic header
([`client_secret_basic`](https://www.rfc-editor.org/rfc/rfc6749#section-2.3.1),
form-urlencoded halves), because Auth.js sends the header by default and omits
the body fields. Both are grounded in RFC 6749 and in Microsoft's support for
either method; the emulator publishes no
`token_endpoint_auth_methods_supported` metadata, so this is not evidence about
which methods a given Entra application accepts.

## SMTP transaction evidence

The SMTP sink records bounded DATA transactions through the host request-history endpoint: acceptance, rejection, processing failure and interrupted transfers, with in-flight, dropped and reset-generation accounting. Records contain protocol, command, sequence, timestamps and outcome only; they contain no envelope, credentials or message content. Native transport tests cover these outcomes and isolation across reset. Greeting, envelope and authentication failures before DATA are not represented. The browser readiness consumer requires complete, nonempty SMTP evidence for the inbound-email journey; this is emulator observation, not live mail-provider parity.

## Level

Reviewed 2026-10-15 against the Level v2 OpenAPI definition at
[developers.level.io](https://developers.level.io) (endpoint and webhook
pages updated 2026-05-22), [About Webhooks](https://developers.level.io/reference/about-webhooks),
the [system variables](https://docs.level.io/en/articles/11321970-system-variables)
article and the [HTTP Request action](https://docs.level.io/en/articles/13909223-http-request-action)
article. No live Level account was used.

Documented and modeled:

- `Authorization: <api key>` with no scheme; 401 `{"error":"Access denied"}`,
  404 `{"error":"Record not found"}`.
- List parameters for groups, devices, alerts and updates, including
  `limit` (1–100, default 20), `starting_after`, `ending_before` and
  `{ data, has_more }`. Device detail sections only appear with their
  `include_*` flag. Online devices report `last_seen_at` as the current time.
- Group, device, alert and update field names. Ids follow Level's examples,
  unpadded base64 of `gid://level/<Type>/<n>`.
- Webhook envelope `{ event_type, event_id, occurred_at, data }` for all eight
  event types. Alert, device and group `data` use the same schemas as the REST
  resources. `event_id` stays constant across retries.
- `X-Level-Signature: sha256=<hex>` over the raw body, only when a secret is
  set, verified with Level's own Node.js snippet. No custom headers.
- Up to 3 retries with exponential backoff and jitter, 2+ minutes apart; only
  2xx succeeds; manual "Re-run request".
- System variable names and rendering rules (unreported values empty,
  booleans as text). HTTP Request action fields: URL, method, the three content
  types, header rows, body; 4xx/5xx marks the action failed.

Emulator choices, not confirmed against Level:

- Out-of-range `limit`, an unknown cursor, or both cursors at once answer
  400. Level documents no error for these.
- Rate limiting answers 429 with `Retry-After` and `{"error":"Too many requests"}`.
  Level documents neither the limit nor the envelope.
- `Bearer <key>` is rejected. Level documents only the bare key.
- `ancestor_group_id` includes devices directly in that group.
  `status=installed` on updates means `is_available: false` with an
  `installed_on` date.
- Deleting a group moves its children to its parent and ungroups its devices.
- Device webhook `data` carries every detail section.
- Retry delays are 2, 4 and 8 minutes plus up to 30 s of jitter. A redirect,
  a network error or a 10-second timeout counts as a failed delivery. A
  re-run does not start a new retry chain.
- System variable formatting where the article is silent: comma-separated
  lists with no spaces, `level_device_memory_formatted` as `16 GB`,
  `level_device_os_version` from the OS minor version. Substituted values are
  inserted as-is, with no JSON escaping.
- Unknown `{{tokens}}` are sent literally. The docs do not say this; production
  traffic to Alga on 2026-10-15 showed it.
- Action retries are immediate. The docs name a retries option without a
  schedule.
- `fire-alert`'s `webhookDataExtra` adds fields to alert webhook `data` that
  Level does not document. Treat anything set there as unverified.

Not modeled: group/tag/custom-field writes and the automations, activities
and custom-field REST endpoints (all answer 501); custom-field references and
any alert-specific variables in automations (Level documents none); webhook
endpoint management through the API; Level's own request-log UI.

Consumer drift (resolved): Level's device schema carries `disks` (`disk_type`,
`model`, `serial_number`, `size`) and no `disk_partitions`. Alga's
`LevelIoDevice` type and device mapper read the documented `disks` field, so
the emulator's payload and Alga's mapping agree. Level reports physical
capacity only; mapped storage entries carry `total_gb` without `free_gb` or
`utilization_percent`. `ee/server/src/__tests__/integration/levelioEmulatorApiClient.integration.test.ts` runs the mapper against the
emulator's `disks` payload.

## Huntress

Reviewed 2026-10-20 against the live Huntress API reference at
[api.huntress.io/docs](https://api.huntress.io/docs) and its OpenAPI document
[api.huntress.io/v1/swagger_doc.json](https://api.huntress.io/v1/swagger_doc.json)
(fetched 2026-10-20), cross-read against the third-party mirror at
[github.com/api-evangelist/huntress](https://github.com/api-evangelist/huntress)
(`openapi/huntress-*-api-openapi.yml`). No live Huntress account, credential or
request was used; only the public documents above.

Documented and modeled:

- HTTP Basic auth, `Authorization: Basic base64(api_key:api_secret)`. Every
  operation documents a single auth failure response: `403` "There was an issue
  with your API credential or permissions."
- `GET /v1/account` → `{ account: {...} }` with `id`, `name`, `subdomain`,
  `status` (`enabled|disabled`), `support_type`
  (`huntress_supported|partner_supported|not_applicable`),
  `neighborhood_watch`, `billing_address`, `shipping_address`.
- Singular/plural response wrappers: `{ organization }`, `{ agent }`,
  `{ incident_report }`, `{ escalation }`; `{ organizations|agents|
  incident_reports|escalations, pagination }`.
- Pagination: `limit` 1–500 default 10, opaque `page_token`, and a `pagination`
  object of `next_page_token` / `next_page_url` ("Only displays when another
  page can be accessed").
- Sorting: `sort_direction` `asc|desc` default `desc`, `sort_field` default
  `id` with the per-resource enums — organizations `id|created_at|updated_at|
  name|key`, agents and incident reports `id|created_at|updated_at`,
  escalations `id|severity|due_at|created_at|updated_at`.
- Filters: organizations `name|key`; agents `organization_id|platform
  (windows|darwin|linux)|hostname|os|version`; incident reports
  `indicator_type` (the 13-value enum) `|status|severity|platform|
  organization_id|agent_id|psa_ticket_eid`; escalations `status|severity|
  subtype|organization_id|psa_ticket_eid`.
- Organization, Agent, IncidentReport, Escalation and EscalationWithEntities
  field names and types, including `Agent.ipv4_address` as "the primary address
  from" `ipv4_addresses`, `IncidentReport.remediations` as the first 10 items
  with `total_count`/`has_more`, and `psa_ticket_eids` on incident reports and
  escalations.
- `GET /v1/incident_reports/{id}` serves reports whose `status` is `draft`;
  the list endpoint does not, and `draft` is not a documented `status` filter
  value.
- The list endpoint serves `Escalation` (no `entities`); only
  `GET /v1/escalations/{id}` serves `EscalationWithEntities`.
- `POST /v1/escalations/{id}/resolution`: 201 `{ escalation,
  resolution_method }` with `resolution_method` `rule` (determination + scope
  supplied), `dismiss` (both omitted on an Unwanted Access escalation) or
  `direct` (a type that takes no parameters); 400 invalid parameters, 403
  credential/permission ("the default account API key is read-only"), 409
  already resolved, 422 not resolvable through the API. `determination`
  (`expected|unauthorized`), `scope` (`account|organization|identity`),
  `expiration_date`, `ip_address` and `revoke_and_disable_identities` follow
  the documented parameter rules.
- Rate limiting: 60 requests/minute per account on a sliding window, answered
  with 429.

Emulator choices, not confirmed against Huntress:

- The JSON body of an error. The docs give statuses and descriptions only, so
  every failure is `{"error":"<the documented description>"}`.
- `Retry-After` on a 429. The header is not documented, but Alga's client
  honours it, so the `rate-limit` fault sets it.
- `next_page_token: null` on the last page. The docs describe only presence or
  absence of a token; Alga's client treats both the same way.
- `page_token` contents: unpadded base64 of `<sort value>|<id>`, resumed by
  keyset comparison. The documented example token is base64 of a timestamp, so
  the shape matches; the semantics are ours. An undecodable token answers 400.
- An out-of-range `limit` is clamped to 1–500 and a non-numeric one falls back
  to the default 10; Huntress documents the bounds but no rejection. An unknown
  `sort_field`, `sort_direction` or filter enum value, and a non-integer path
  id, answer 400 ("there is an unexpected value in the API request").
- `severity` sorting ranks `low < high < critical`.
- 404 bodies for `GET`-by-id on an unknown record. Huntress documents 404 only
  in its general status table (the `PATCH`/`DELETE` operations describe one);
  the `GET` operations list 200 and 403 alone.
- Incident status transitions. The statuses are documented but no transition
  graph is, so `update-incident` accepts any documented status, stamps
  `status_updated_at` on a change and sets `closed_at` only for `closed`.
- Deleting an organization or agent leaves `organization_id`/`agent_id` on
  existing incident reports and escalation `organizations` entries (the
  escalation then reports the org id with a placeholder name) — that is the
  "dropped off" path Alga has to survive, not an observed Huntress behavior.
- `Identity` entity `details` on an escalation. The schema example shows an
  `Agent` entity only (`hostname`, `platform`, `os`, `last_callback_at`);
  identity details are whatever the seeder supplies.
- `actual_usages` contents on the organization detail response: present only
  when seeded, with no modeled sub-schema.
- 501 `EmulatorUnsupportedOperation` for the documented `/v1` surface that is
  not modeled (identities, signals, reports, SIEM, remote access, invoices,
  memberships, reseller, comments, remediation writes, agent isolation,
  unwanted-access rules, known VPNs, and the `/v1/accounts/{account_id}/*`
  reseller-scoped mirrors). That is an emulator diagnostic, not a Huntress
  response.

Unverified / documentation conflicts recorded rather than resolved:

- `due_at` is a documented escalation `sort_field` with no corresponding field
  in the Escalation schema. The emulator keeps a seedable `due_at` for sorting
  and never serializes it.
- Escalation `status`: the live schema and the `status` filter both say
  `open|overdue|resolved`, but the mirrored spec's `Escalation` /
  `EscalationWithEntities` schemas say `open|sent|resolved` while its filter
  says `open|overdue|resolved`. The emulator follows the live spec; `sent` is
  rejected as a filter value.
- `type_code` and `psa_ticket_eids` (escalations and incident reports) and
  `Agent.ipv4_addresses` are in the live spec but absent from the mirror, which
  is the older snapshot. Modeled from the live spec.
- IncidentReport `status`: the model documents `sent|closed|dismissed|draft`
  while the list filter documents `sent|closed|dismissed|auto_remediating|
  deleting|partner_dismissed`. The emulator accepts the union (and Alga's
  `HuntressIncidentStatus` covers the six filter values, not `draft`).
- The docs' general status table lists both 401 ("your request could not be
  authenticated") and 403 (permissions), but no operation declares a 401. The
  emulator always answers 403, which is what the per-operation contract says.
- Whether Huntress enforces the rate limit per credential or per account IP
  pair, and what body accompanies a real 429, is not documented.

Consumer drift (open): Alga's `HuntressClient.getAccount()` reads
`GET /v1/account` **unwrapped**, while the live spec and this emulator return
`{ "account": {...} }`. Against real Huntress that leaves `accountName` and
`accountSubdomain` undefined in `rmm_integrations.settings`, which degrades the
portal deep links `buildPortalUrl` writes into tickets and the connect toast.
`ee/server/src/__tests__/integration/huntressEmulatorApiClient.integration.test.ts`
asserts the documented wrapped body and names the client fix; that assertion
flips when the client unwraps it.
