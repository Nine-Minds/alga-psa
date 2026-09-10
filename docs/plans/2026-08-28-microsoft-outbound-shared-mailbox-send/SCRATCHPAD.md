# Scratchpad

## How the failure was traced

Reported as "outbound email notifications not sending" for Joymode Business Solutions.

Tenant resolution:

```sql
select tenant, client_name, email from tenants where client_name ilike '%joymode%';
-- 917d38c4-092e-4577-9f2a-547d671bc9c3, munjal@joymode.io
```

`email_sending_logs` gave the outage boundary immediately. Grouping by day and status showed the last success on 2026-08-13 and nothing but failures afterwards. Grouping by `error_message` gave the two distinct causes without any log searching.

`email_provider_health` and the Loki app logs were both dead ends here. The Graph error code never reaches the logs: `toProviderError` in `packages/email/src/providers/MicrosoftGraphEmailProvider.ts` logs `status`, `code`, `requestId`, but `code` arrives already flattened to an axios value such as `ERR_BAD_REQUEST`. The useful evidence was entirely in `email_sending_logs.error_message` and in the token itself. F013 exists to close that gap.

## Decoding the stored token

The access token in `microsoft_email_provider_config` is a plain JWT, not encrypted at rest. Decoding the payload settled the diagnosis in one step, and it is the fastest check for any future report of this shape.

Run from a `sebastian` pod, which already has DB env vars and `pg` under `/app`:

```js
// claims.cjs, run as: cd /app && node claims.cjs
const { Client } = require('pg');
const c = new Client({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER_SERVER, password: process.env.DB_PASSWORD_SERVER,
  database: process.env.DB_NAME_SERVER,
});
(async () => {
  await c.connect();
  const r = await c.query(
    'select access_token from microsoft_email_provider_config where tenant = $1',
    ['<tenant-uuid>']
  );
  const p = r.rows[0].access_token.split('.')[1];
  const n = p.replace(/-/g, '+').replace(/_/g, '/');
  console.log(JSON.parse(Buffer.from(n.padEnd(Math.ceil(n.length / 4) * 4, '='), 'base64').toString()));
  await c.end();
})();
```

For Joymode this returned `upn: munjal@techff.com` and `scp: email Mail.Read Mail.Read.Shared Mail.Send openid profile User.Read`. The mailbox is `service@joymode.io`. Mailbox does not equal `upn`, and `Mail.Send.Shared` is absent, so the send is unauthorized before Exchange is ever consulted.

## Why the correlation is conclusive

Running the same decode across every active Microsoft provider and joining it to 30 days of `email_sending_logs` produced a clean split with no counterexamples:

- Five providers failing with the identical 403 message. None hold `Mail.Send.Shared`.
- One provider sending successfully, `helpdesk@mycompguy.co`, 174 sends. It holds `Mail.Send.Shared`.

The mycompguy tenant did not get the scope from us, since we never request it. Their Entra administrator granted the delegated permission on the enterprise application, so it lands in `scp` on consent. That is the only reason any tenant sends from a shared mailbox today.

## Population, as of 2026-08-28

Of 40 active Microsoft providers with a decodable token:

- 19 send from a mailbox other than the authenticated user and lack `Mail.Send.Shared`. These need both a reconnect and an Exchange Send As grant.
- 4 send from a mailbox that matches the authenticated user. These are broken only by the hardcoded `/users/` path and recover on deploy, with no reconnect.
- 6 already hold `Mail.Send.Shared`. These are unaffected.

A further 10 providers have no decodable token. Their state is unknown and they should be re-checked after the deploy.

Failing providers with recorded 403s: `service@joymode.io` (98), `support@hody.dev` (188), `support@meihlstech.com` (9), `support@itxp.com.au` (2), and provider `3145d5f1` (2, since deleted). `support@meihlstech.com` has since acquired `Mail.Send.Shared` and should recover on its own.

## The Resend fallback interaction

Joymode shows both error types interleaved between 2026-08-14 and 2026-08-18, which initially looked like a send-time fallback chain. It is not one. `BaseEmailService` has no send-time fallback. The fallback lives in `TenantEmailService.getEmailProvider()` and only fires when the tenant provider fails to *initialize*.

The interleaving comes from `TenantEmailService.instances`, a per-process singleton map. Different `sebastian` pods held different cached providers over that window. Pods where `assertMailSendConsent` threw had cached the system Resend provider; pods where it passed sent through Graph. Both appear in the same minute in the logs.

That also explains why the Resend errors stop on 2026-08-18 while the Graph errors continue. Once every pod's token carried `Mail.Send`, initialization stopped throwing and the fallback stopped being reachable. The tenant moved from one broken path to a different broken path.

Anyone reasoning about provider selection from log timestamps alone needs to account for this cache. Two adjacent log lines can come from processes with different provider state.

## Why Full Access is not evidence of Send As

Inbound works for every affected tenant, which proves the authorizing user has Full Access to the mailbox. In Exchange these are separate grants and Full Access does not imply Send As. Do not treat healthy inbound as evidence that sending will work once the scope lands.

There is no Graph API for reading Send As. It is `Get-RecipientPermission` in Exchange PowerShell only, so we cannot check it from our side and cannot pre-flight it during connect. This is a hard limit on how good the connect-time validation can get, and it is a strong argument for the app-only path, where the permission is not needed at all.

## Cross-tenant appearance

`munjal@techff.com` sending as `service@joymode.io` looks like cross-tenant delegation, which Exchange Online does not support. It is not. Our inbound reads hit `/users/service@joymode.io` with that user's delegated token and succeed daily, and Graph only permits that within one tenant. `joymode.io` is an additional verified domain on the `techff.com` Entra tenant. Send As is grantable normally.

The stored `microsoft_email_provider_config.tenant_id` is `951536bd-...` (the Nine Minds tenant) while the token's `tid` is `92bbe6d8-...`. That mismatch is widespread across providers and is unrelated to this failure. Worth a separate look.

## Related

- `187db3db76` introduced outbound Graph sending on 2026-08-02, without `Mail.Send.Shared`.
- Teams already uses app-only auth: `ee/packages/microsoft-teams/src/lib/graphAuth.ts:23`. Email is the outlier at `MicrosoftGraphAdapter.ts:388`, which only ever does `grant_type: 'refresh_token'`.
- `packages/emulators/msgraph/src/core.ts:366` already models the client credentials grant, so the emulator can cover an app-only path when it is built.

## Draft implementation verification

- The maintained `packages/emulators/msgraph` now captures `POST /v1.0/me/sendMail` and `POST /v1.0/users/{encoded-mailbox}/sendMail` in its `send-mails` state view. Adapter smoke coverage uses that simulator to assert the actual route and payload, but it cannot prove delegated `Mail.Send.Shared`, a refreshed grant, Exchange Send As, or delivery by a real Microsoft tenant.
- Focused adapter tests additionally exercise the `/me/sendMail` and `/users/{mailbox}/sendMail` selection directly. The Graph simulator is not a real Microsoft tenant send.
- The system fallback rejects a missing or malformed configured sender rather than passing an invalid tenant identity to the shared provider. A configured system sender remains an operator-managed verified-domain requirement; Resend verification cannot be inferred locally.
- The system-Resend fallback smoke drives `TenantEmailService.sendEmail` through failed tenant-provider initialization into the system factory, then asserts the resulting provider message has the parsed `EMAIL_FROM` address, tenant display name, and tenant Reply-To.
- Existing OAuth grants do not gain `Mail.Send.Shared` automatically. Shared-mailbox tenants must reconnect to receive it, then separately receive Exchange Send As permission.
