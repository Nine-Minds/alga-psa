# Fix plan — 2 security findings in `emailProviderActions.ts`

Review card `b0ef6d7a-d45e-5373-bc9c-6bd7ead0c021` · PR
[#3984](https://github.com/Nine-Minds/alga-psa/pull/3984) · merge `ad16c90abfee`.
PR 3984 fixed the equivalent authorization gaps in `emailSettingsActions.ts`
(outbound transport) but left the adjacent **inbound provider** actions in
`packages/integrations/src/actions/email-actions/emailProviderActions.ts`
unguarded. This plan records the original baseline at `e54c9397a9`; later
commits on this branch already implemented most of its fixes. The current
implementation and verification are tracked in
`docs/security/email-provider-actions-security-review.md`.

Both findings are **confirmed real** against the code as it stands. Evidence and
the concrete fix follow.

---

## Finding 1 — authz · high: low-privilege users can replace / disable / delete inbound mail providers

### 1a. The defect, precisely

Every mutating provider action is wrapped only in `withAuth` (authentication),
with **no `hasPermission` call and no client-user rejection before it touches the
database or the network**. `withAuth` establishes *who* the caller is; it does
not check *what they may do*. Confirmed by direct read:

| Action | Definition | Guard present? |
|---|---|---|
| `upsertEmailProvider` | `emailProviderActions.ts:850-909` | **none** — first statement is `createTenantKnex()` then straight into `knex.transaction` |
| `createEmailProvider` | `:983-1003` | **none** — delegates to `upsertEmailProvider` |
| `updateEmailProvider` | `:1005-1033` | **none** |
| `deleteEmailProvider` | `:1325-1342` | **none** — reaches `EmailProviderService().deleteProvider` |
| `resyncImapProvider` | `:1352-1398` | **none** |
| `testEmailProviderConnection` | `:1400-1407` | **none** (also Finding 2) |
| `retryMicrosoftSubscriptionRenewal` | `:1633-1640` | **none** |
| `getEmailProviders` (read) | `:713-848` | **none** — returns `client_secret`, `access_token`, `refresh_token` columns (`:734-814`) to any authenticated caller |

Contrast with the **same file's** diagnostics actions, which *do* gate on
`hasPermission(user, 'ticket_settings', 'update', knex)`
(`runGmailDiagnostics` `:1681-1684`; `runMicrosoft365Diagnostics` `:1727-1730`),
and with the sibling file PR 3984 hardened, `emailSettingsActions.ts`, which
routes every write/test through `requireOutboundEmailAdmin`
(`emailSettingsActions.ts:188-189, 414-415, 464-466`).

**Attacker path.** A low-privilege *internal* user (any authenticated non-client
session — e.g. a technician without settings rights) calls `upsertEmailProvider`
with the JSON body of an existing Microsoft/Google mailbox. In
`getOrCreateProvider` the caller-supplied `mailbox` matches an existing row
(`:257-260`), so the helper takes the **update** branch and overwrites
`provider_type`, `provider_name`, `sender_display_name`, `is_active`, and
`inbound_ticket_defaults_id` (`:262-276`). Setting `isActive: false` silently
disables tenant inbound mail; changing `providerType` corrupts the row.
`deleteEmailProvider` removes the provider and its vendor config outright
(`EmailProviderLifecycleService.ts:942-955`). None of this requires any
privilege beyond a session.

### 1b. The fix

**Reuse the enforcement point PR 3984 already built — do not write a second
one.** `requireOutboundEmailAdmin(user, knex)` and `isClientUser(user)` live in
`packages/integrations/src/actions/email-actions/mspOutboundEmailAccess.ts:23-42`.
They reject client-portal users, then require `ticket_settings:update`
(MSP-only in the permission catalog). That is exactly the boundary the merged PR
established, and its module header already anticipates this reuse.

Add, as the **first statements inside the `try`/body of each action, before any
other `tenantDb`/DB/network work**, the pattern already used by
`updateEmailSettings` (`emailSettingsActions.ts:187-189`):

```ts
const { knex } = await createTenantKnex();
const access = await requireOutboundEmailAdmin(user, knex);
if (!access.allowed) return <denial in this action's result shape>;
```

Each action returns the denial in its own result shape (do not change signatures):

- `upsertEmailProvider` / `updateEmailProvider` → `actionError('Permission denied: Cannot manage email providers', 'errors.permissionDenied')`.
- `deleteEmailProvider` → same `actionError`.
- `resyncImapProvider` / `testEmailProviderConnection` → `emailProviderOperationError(access.message, 'unexpected')` (these return `EmailProviderOperationResult`).
- `retryMicrosoftSubscriptionRenewal` → `{ success: false, message: access.message }`.
- `getEmailProviders` → return `{ providers: [] }` for the unauthorized (its existing catch already degrades to empty); gate reads too so stored secrets are not disclosed.

Actions currently destructure `_user`; rename to `user` where guarding
(`deleteEmailProvider` `:1326`, `resyncImapProvider` `:1353`,
`testEmailProviderConnection` `:1401`).

`createEmailProvider` is covered transitively — it only calls
`upsertEmailProvider` (`:1002`), which re-runs `withAuth` + the new guard. Add
the guard to `createEmailProvider` as well for defense in depth, since it is a
public entry point and may diverge later.

**Is a shared helper the right home?** Yes, and it already exists. The single
un-bypassable enforcement point is `requireOutboundEmailAdmin`; using it here
means the inbound-provider actions and the outbound-settings actions share one
authorization definition, so a future permission change (e.g. the planned
dedicated `email_provider:*` permission noted in that module) lands in one place.
No new abstraction is warranted.

---

## Finding 2 — ssrf · high: caller-controlled IMAP endpoints enable server-side requests and credential forwarding

### 2a. The defect, precisely

Two caller-controlled values flow into outbound connections with no
outbound-target policy:

1. **OAuth token endpoint.** `persistImapConfig` stores caller-supplied
   `oauth_token_url`, `host`, `port`, `oauth_client_id/secret`, `refresh_token`
   verbatim (`:644-699`). In `testEmailProviderConnection`, when the OAuth access
   token is missing/expired, the code loads the stored refresh token and client
   secret (`:1438-1458`) and issues `axios.post(config.oauth_token_url, params,…)`
   (`:1460-1464`) — **axios follows redirects by default**, and there is no
   scheme/host/IP validation. A caller can set `oauth_token_url` to
   `http://169.254.169.254/…` or an internal host and trigger a POST from the
   application network.

2. **Credential forwarding via endpoint swap.** On update/upsert,
   `persistImapConfig` preserves the previously stored refresh token and client
   secret through `COALESCE(EXCLUDED.…, existing)` (`:689-691`) while accepting a
   **new** `oauth_token_url` (`:683`). So a caller changes only the token URL to
   an attacker endpoint, invokes the test, and the stored refresh token + client
   secret are POSTed to the attacker (`:1447-1464`).

3. **IMAP socket.** The subsequent `new ImapFlow({ host: config.host, port: … })`
   + `client.connect()` (`:1508-1521`) opens a socket to the caller-controlled
   host/port — a second SSRF primitive (port scan / internal service probe).

The authz fix (Finding 1) narrows the caller set to MSP `ticket_settings:update`
holders, but does **not** close this: an MSP settings admin (or a hijacked such
session) can still pivot into the cluster's internal network or exfiltrate
tenant mail credentials. SSRF needs its own, independent control.

Note the Microsoft/Google OAuth paths are **not** affected — their token
endpoints are fixed vendor URLs, not caller-supplied. This is IMAP-specific.

### 2b. The fix

Three layers, innermost first:

**(i) Shared outbound-target policy (the general mechanism).** The repo already
has two near-duplicate guards and a standing `// LEVERAGE: pattern ssrf-guard`
marker flagging exactly this (`server/src/lib/webhooks/ssrf.ts:80`;
pinned-fetch sibling `server/src/lib/net/safeFetch.ts`). Both live under
`server/` and are unreachable from `packages/integrations`. Per the
general-over-specific standard, lift the validate-only core into a package
`packages/integrations` can import — `@alga-psa/shared` (e.g.
`shared/lib/net/outboundTarget.ts`) exporting
`assertSafeOutboundTarget(url, { schemes })`: parse URL, enforce scheme
allowlist, reject `localhost`/`*.localhost`, resolve DNS (`all: true`), and
block loopback / link-local / private / CGNAT (100.64/10) / metadata (169.254)
/ reserved for **every** resolved address — the blocklist already enumerated in
`ssrf.ts:4-13`. Re-point `server/src/lib/webhooks/ssrf.ts` at the shared core so
there is one definition, not three. Honor an explicit deployment-level allowlist
env for legitimate on-prem targets (mirrors the existing
`WEBHOOK_SSRF_ALLOW_PRIVATE` escape hatch, `ssrf.ts:22-24`).

**(ii) Guard the token POST.** In `testEmailProviderConnection`, before
`axios.post` (`:1462`): `await assertSafeOutboundTarget(config.oauth_token_url,
{ schemes: ['https'] })` and set `maxRedirects: 0` on the request so a redirect
cannot bounce to an internal target after validation. On rejection return
`emailProviderOperationError('IMAP OAuth token endpoint is not an allowed
target.', 'missing_config')`. (Residual DNS-rebind TOCTOU between validation and
axios's own resolution is noted in scope below.)

**(iii) Guard the IMAP socket.** Before `new ImapFlow(...)` (`:1508`), validate
`config.host` through the same policy with the **mail-server** profile: private
destinations permitted only via the deployment allowlist (on-prem IMAP on an RFC
1918 address is a legitimate, supported deployment — see risks). Reject
otherwise before connecting.

**(iv) Bind credentials to their issuer.** Stop `persistImapConfig` from
carrying a stored refresh token / client secret across a token-endpoint change.
When incoming `oauth_token_url` differs from the stored row's value, drop the
`COALESCE` preservation for `refresh_token`, `oauth_client_secret`, and
`access_token` (null them) and require reauthorization — the same principle
`persistMicrosoftConfig` already enforces for a changed client ID
(`:320-328`, reconnect-required error). This defeats the forward-the-token
attack even for an authorized caller.

---

## 3. Proof — tests to add

All new tests mirror the mocking already proven in
`emailSettingsActions.outboundAccess.test.ts` (hoisted `vi.mock` of
`@alga-psa/db`, `@alga-psa/auth` `withAuth` passthrough, `@alga-psa/auth/rbac`
`hasPermission`, and a `tenantDb().table()` stub that **throws on any DB access**
so "rejected before touching the DB" is asserted structurally).

New file `emailProviderActions.authorization.test.ts`:

1. **client user rejected before DB** — `upsertEmailProvider` with
   `user_type: 'client'`: expect `actionError`/`errors.permissionDenied`,
   `hasPermission` **not** called, zero `tableCalls`. *Fails pre-fix:* today the
   call proceeds into `knex.transaction` and hits the DB stub.
2. **MSP user without `ticket_settings:update` rejected** — `grant()` empty for
   each of upsert, update, delete, resync, `testEmailProviderConnection`,
   `retryMicrosoftSubscriptionRenewal`: expect the denial shape and no DB/network
   access. *Fails pre-fix:* no permission check exists, so each reaches its
   transaction / service call.
3. **MSP user with `ticket_settings:update` passes the gate** —
   `hasPermission` called with `('ticket_settings','update',…)` and execution
   reaches the first DB call. *Guards against over-blocking.*
4. **`getEmailProviders` does not disclose secrets to an unauthorized caller** —
   returns `{ providers: [] }` and never reads the vendor-config tables.
   *Fails pre-fix:* it queries and returns `client_secret`/`refresh_token`.

New file `emailProviderActions.ssrf.test.ts` (unit, inject `lookup`/`fetch` so
no real network, matching `safeFetch.test.ts`):

5. **token endpoint resolving to a private/metadata IP is rejected before
   `axios.post`** — stub an IMAP oauth2 provider whose `oauth_token_url` host
   resolves to `169.254.169.254` / `127.0.0.1` / `10.x`: expect the target-not-
   allowed error, `axios.post` **not** called, no `ImapFlow` constructed.
   *Fails pre-fix:* `axios.post` is invoked against the internal URL.
6. **IMAP host resolving to a private IP is rejected before connect** (mail
   profile, allowlist off). *Fails pre-fix:* `ImapFlow.connect` is called.
7. **changing `oauth_token_url` clears stored refresh token / client secret** —
   drive `persistImapConfig` with a new token URL and assert the merged row nulls
   `refresh_token`/`oauth_client_secret` (reauth required) rather than
   `COALESCE`-preserving them. *Fails pre-fix:* `:689-691` preserves them, so the
   old credentials would be forwarded on the next test.
8. **allowlisted private target permitted** — with the deployment allowlist env
   set, a private on-prem IMAP host passes. *Guards against breaking supported
   on-prem installs.*

Where a true DB round-trip is needed (test 7 against real merge semantics), add
an integration test alongside
`server/src/test/integration/emailProviderCreation.test.ts`.

---

## 4. Scope deliberately excluded, and reviewer risks

### Current implementation update (2026-11-10)

The original plan scoped out pinned-DNS transports, but the implementation
requirement for this repair now includes them. The shared outbound-target
resolver returns a vetted address after checking every DNS answer. OAuth HTTPS
requests use a pinned `https.Agent`, disable proxy routing, and reject redirects;
ImapFlow receives the pinned lookup callback for the initial socket and any TLS
upgrade. OAuth endpoints are HTTPS/443 only, while IMAP is limited to ports 143
and 993. This removes the validate-then-resolve gap described in the historical
scope note below. The existing explicit IMAP private-target allowlist remains
scoped to mail-server addresses only.

**Not doing in this card:**

- **A dedicated `email_provider:*` permission.** Reuse `ticket_settings:update`,
  matching PR 3984 and the `mspOutboundEmailAccess` header's stated follow-up. A
  new permission is a catalog/seed migration, out of scope for a security fix.
- **Historical baseline note, superseded:** the original plan proposed
  validate-then-POST with redirects disabled and listed DNS pinning as a
  follow-up. The current implementation update above replaces that limitation:
  token requests and IMAP sockets are pinned to validated addresses.
- **Microsoft/Google token endpoints** — fixed vendor URLs, not caller-supplied;
  untouched.
- **Rotating already-stored IMAP credentials** that may have been planted before
  this fix — this plan prevents new exfiltration, not forensic cleanup.

**Risks a reviewer must weigh:**

1. **On-prem IMAP regression (highest).** Blocking private/RFC-1918 hosts in
   layer (iii) will break legitimate customers whose mail server is on a private
   address. The deployment allowlist env **must** ship with the guard and be
   documented, or self-hosted inbound IMAP breaks. Default-deny with an explicit
   opt-in is the correct posture but is a behavior change for existing installs —
   call it out in the review guide.
2. **Credential-clearing UX.** Layer (iv) must trigger only on an actual
   `oauth_token_url` change, not on every save (which would wipe working
   credentials). Mirror `persistMicrosoftConfig`'s "reconnect required" error so
   the UI explains why reauth is needed.
3. **Authz false-negatives.** `getEmailProviders` feeds the provider list UI; if
   the gate is too strict, MSP admins see an empty list. Test 3 pins the positive
   path. Confirm the provider-list page is reached only by MSP settings users
   (all current callers are MSP-side forms/pages — verified: every caller of
   these actions is a UI component under `packages/integrations`/`ee/server`, no
   background/server-internal caller invokes them without a session).
4. **`createEmailProvider` double-guard** is intentional (defense in depth); it
   adds one redundant `hasPermission` on the create path. Acceptable.

---

## Summary

Both findings are real and independent. Finding 1 is closed by reusing the
existing `requireOutboundEmailAdmin` guard at the top of every mutating/reading
provider action — one shared enforcement point, no new abstraction. Finding 2 is
closed by a shared outbound-target policy (lifted from the duplicated `server/`
guards the repo already carries a LEVERAGE marker for), applied to the OAuth
token POST and the IMAP socket, plus binding stored credentials to their issuing
endpoint. Regression tests assert each denial happens *before* any DB or network
access and that the positive paths still work.
