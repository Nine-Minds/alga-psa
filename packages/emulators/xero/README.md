# Xero revocation coverage

The vendor surface accepts `POST /connect/revocation` with HTTP Basic client
authentication and a form-encoded `token` refresh token. Confidential clients
provide their secret; PKCE clients use `client_id:`. Successful revocation has
HTTP 200 and an empty body, following [Xero's token documentation](https://developer.xero.com/documentation/guides/oauth2/token-types).

Revocation clears the application's connected organisations and its refresh
credentials, including rotated credentials. The emulator models one resource
owner per application; it does not distinguish multiple Xero users authorizing
the same client. Access credentials are invalidated immediately. This is a
local deterministic model, not evidence of Xero's access-JWT propagation timing.

Repeated, unknown, and another client's tokens return 200 without changing
unrelated credentials. This follows [RFC 7009 section 2.2](https://www.rfc-editor.org/rfc/rfc7009.html#section-2.2);
these edge responses have not been verified against a live Xero sandbox.
Invalid client authentication returns 401 before token lookup. Direct access-token
revocation is not modeled; callers must send their refresh token.

Alga has two endpoint settings for this same route: `XERO_OAUTH_REVOKE_URL`
for denied OAuth callback cleanup, and `XERO_REVOCATION_URL` for the Xero client
service endpoint resolver. Both must point at the emulator's `/connect/revocation`.

Native behavioral tests are in `tests/tokenLifecycle.test.ts`; they exercise the
actual HTTP surface, refresh rejection, connection removal, repeat/unknown
requests, and client isolation. Existing token and accounting smoke tests run
alongside them.

`tests/accountingCleanup.test.ts` additionally invokes Alga's real
`revokeAccountingOAuthGrant` over HTTP, with request-journal assertions and a
guard against external destinations. It verifies credential rejection and
connection removal, plus best-effort failure handling that preserves the grant.
Auth/state/logger dependencies are isolated; this is native consumer coverage,
not the full OAuth callback, disconnect UI, or a running-worker journey. See the
[suite parity inventory](../PROTOCOL_PARITY.md) for remaining gaps.
