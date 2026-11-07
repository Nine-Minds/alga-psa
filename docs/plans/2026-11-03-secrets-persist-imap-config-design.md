# Design — bind IMAP credentials to the full destination identity

Card: `3276c089-8da6-589b-b32c-dd2045b14002` — *Security: secrets in persistImapConfig*
Finding: **secrets · high** at `packages/integrations/src/actions/email-actions/emailProviderActions.ts:661`
Fingerprint: `.../emailProviderActions.ts#persistImapConfig`

## Finding confirmed

`persistImapConfig` computes `issuerChanged` from only the OAuth token URL, authorize URL, client ID and
client secret. The **IMAP destination** — `host`, `port`, `secure`/STARTTLS mode, `username`, and auth type —
is excluded. So an outbound-email administrator can point an existing provider at an attacker-controlled
host while leaving password/OAuth fields blank: the stored `imap_password_<id>` and (when
`issuerChanged === false`) the stored refresh/access tokens are retained (lines 674-691, 743-761), and
`testEmailProviderConnection` later loads them and builds `ImapFlow` against the new host (lines
1602-1635). The result is credential exfiltration to a caller-chosen server.

## Proposed change (single file)

Replace the OAuth-only `issuerChanged` with a **credential-scope identity** comparison captured in the same
row load, and treat any change to that identity as invalidating the stored secret material:

1. Define `credentialScope(row)` over the complete destination identity:
   `{ host, port, secure, username, authType, oauth_token_url, oauth_authorize_url, oauth_client_id,
   present(client_secret) }`. Compare the freshly supplied `config` against `existing` field by field
   (null-normalized), exactly as `issuerChanged` is computed today.
2. Keep `assertSafeOutboundUrl` for the OAuth endpoints and additionally run the shared outbound-address
   policy against the resolved **IMAP destination** (`imap://`/`imaps://{host}:{port}` or the
   `connect()` the code uses) so a changed host cannot be stored unless it passes the same policy as other
   outbound integrations.
3. When `scopeChanged` is true, transactionally delete **all** applicable secrets for the provider before
   writing the new config row: `imap_password_<id>`, `imap_refresh_token_<id>`,
   `imap_oauth_client_secret_<id>` (and any access-token key). A password or client secret supplied in the
   same save is written immediately after, forming the new scope. Do not carry a `refresh_token` across a
   scope change (today it is written only when `!issuerChanged`; that must become `!scopeChanged`).
4. Require an explicit replacement/reconnect: after a scope change with no replacement credential, the
   provider row is saved but has no usable secret; `testEmailProviderConnection` must fail closed with a
   clear "credentials cleared — re-enter password or reconnect OAuth" message rather than dialing with a
   stale secret. No code path may read a secret whose scope differs from the row's identity.

Keep the change inside `persistImapConfig` and the connection test; do not alter the token-refresh path's
contract beyond reading the (now scope-bound) secret.

## Regression coverage

Add/extend the email-provider action tests (mock `getSecretProviderInstance`, `tenantDb`):

- changing `host` (or port/secure/username/authType) with blank password/token → password and token
  secrets are deleted, not retained; connection test fails closed.
- changing only OAuth issuer fields still deletes tokens + client secret (existing behavior preserved).
- saving a new password/client secret alongside a host change stores it under the new scope.
- unchanged scope retains secrets (no spurious deletion).
- destination URL that fails the outbound policy is rejected before any write.

Each negative test must fail against current `main` and pass after the change.

## Acceptance

`security-finding-resolved` confirms the finding is fixed with the tests above (or refuted with evidence).
No other finding is in scope.
