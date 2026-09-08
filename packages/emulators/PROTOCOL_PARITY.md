# Provider protocol coverage

Reviewed 2026-09-08. This inventory supplements the [suite guide](README.md).
It records bounded evidence, not complete vendor compatibility. F037 remains
incomplete. Native test results below are recorded runs, not a claim that the
current revision passed the full CI or browser matrix.

| Surface | Implemented and exercised | Evidence boundary / remaining gap |
| --- | --- | --- |
| Teams organizer lookup | Both workspace and EE `saveTeamsIntegrationSettings` obtain a token and resolve an organizer by UPN through native Graph HTTP; journal proves the token POST and user GET. Graph also accepts directory object ID and preserves unknown-user 404. Both save actions preserve existing settings after an unresolved organizer and recover when the directory user becomes available. | [Consumer tests](msgraph/tests/teamsOrganizerRouting.test.ts), [wire tests](msgraph/tests/smoke.test.ts). Auth/storage seams are isolated. This does not exercise a browser profile form, tenant consent, SSO, or live directory behavior. Production and absent-gate override rejection are separate action tests. |
| QBO consumer refresh/retry | Actual `QboClientService` recovers from API 401 through HTTP refresh, persists replacement credentials, and retries once. Revoked refresh does not overwrite credentials or replay; another API 401 stops after one refresh. | [Consumer tests](qbo/tests/clientRecoveryConsumer.test.ts). Native Axios/vendor HTTP with private memory secret storage and mocked disconnect coordination. This does not prove cross-process refresh locking, a database transaction, or Intuit retry-window parity. |
| QBO revocation | Basic authentication + JSON token; either access or refresh token can revoke the modeled grant family. Independent grants survive; invalid/foreign clients cannot revoke it. | [HTTP tests](qbo/tests/tokenRevocation.test.ts). Unknown/repeated success and grant-family invalidation are RFC-based model choices, not live Intuit observations. Existing immediate refresh-token consumption still lacks Intuit retry-window parity. |
| Xero revocation | Basic authentication + form refresh token, empty 200; removes connected organisations and rotated credentials. | [Lifecycle HTTP tests](xero/tests/tokenLifecycle.test.ts), [model limits](xero/README.md). One resource owner per client; immediate access-token invalidation is deterministic emulation, not measured JWT propagation. Unknown/repeated/foreign-token success follows RFC 7009. Direct access-token revocation is not modeled. |
| Actual accounting cleanup consumers | Real `revokeAccountingOAuthGrant` for each provider reaches the journaled vendor route. Success rejects credentials; Xero also verifies connection removal after fresh authorization. Failed cleanup logs without throwing and preserves usable credentials. | [QBO consumer](qbo/tests/accountingCleanupConsumer.test.ts), [Xero consumer](xero/tests/accountingCleanup.test.ts). Native HTTP with guards against external destinations; auth/state/logger seams are isolated. This is the cleanup helper, not the entire denied OAuth callback, database rollback, disconnect UI, or a running worker. |
| Stripe callback redirects | HTTP 302/307 count as delivery failures; redirect destination receives no request and independent callbacks still receive valid signed payloads. | [Redirect tests](stripe/tests/webhookRedirect.test.ts). SDK verification covers signatures and delivery time; no live sandbox capture, exhaustive event schema, or automatic retry/backoff parity is implied. |
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
uses that endpoint. Current CI configuration builds and starts the authored worker in both editions
and the traditional Temporal worker in EE, with strict readiness and retained
per-process routing evidence. That configuration has not yet completed a green
image/browser run. Native compiled authored-workflow execution proves its
state-node persistence boundary, without provider actions. Running-process
provider journeys, the remaining
Temporal constructors, denied callback/disconnect journeys, and optional
sanitized live-provider drift checks remain explicit follow-up work.

Existing Graph calendar/OAuth/notification contract checks are listed in the
[suite guide](README.md#unsupported-graph-operations). Named calendars, Microsoft
SSO/complete consent and scope enforcement, rich/lifecycle notifications, and
complete vendor payload schemas remain outside that coverage. Graph's explicit
501 `EmulatorUnsupportedOperation` is an emulator diagnostic, not a vendor
response contract. A successful route must never stand in for an unsupported one.
