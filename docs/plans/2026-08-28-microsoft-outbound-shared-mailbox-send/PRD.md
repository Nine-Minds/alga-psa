# Microsoft Outbound Email From Shared Mailboxes

## Problem

Outbound email through Microsoft Graph fails with HTTP 403 whenever the configured sending mailbox is not the mailbox of the user who authorized the connection. Most MSP service desks run on a shared mailbox, so this is the normal case rather than an edge case.

Two defects combine to produce it.

`MICROSOFT_EMAIL_OAUTH_SCOPES` in `shared/services/email/microsoftGraphEndpoints.ts:12` requests `Mail.Read`, `Mail.Read.Shared`, `Mail.Send`, `User.Read`, and `offline_access`. It does not request `Mail.Send.Shared`. Delegated `Mail.Send` authorizes sending only as the signed-in user. Sending as any other mailbox requires `Mail.Send.Shared`.

`MicrosoftGraphAdapter.sendMail` at `shared/services/email/providers/MicrosoftGraphAdapter.ts:491` posts to `/users/{mailbox}/sendMail` unconditionally. The read path already distinguishes the two cases: `getMailboxPath()` returns `/me` when the configured mailbox matches the authenticated user, and `/users/{mailbox}` otherwise. The send path never got that treatment, so even a personal mailbox is addressed as though it belonged to someone else.

Inbound mail is unaffected because `Mail.Read.Shared` is requested. A tenant can read its shared mailbox every day and still never send from it.

A third defect compounds the failure. When the Graph provider fails to initialize, `TenantEmailService.getEmailProvider()` falls back to the system Resend provider and the send carries the tenant's own from-address. The shared Resend account only has `algapsa.com` verified, so Resend returns 403 for every tenant sending domain.

The outbound Graph path shipped in `187db3db76` on 2026-08-02. `Mail.Send.Shared` has been absent since then, so this is an original defect rather than a regression.

## Production evidence

Joymode Business Solutions (tenant `917d38c4-092e-4577-9f2a-547d671bc9c3`, mailbox `service@joymode.io`) has sent no outbound notification since 2026-08-13.

| Window | Attempts | Outcome |
| --- | --- | --- |
| 2026-08-13 | 3 | Sent through the Resend fallback, from `noreply@algapsa.com` |
| 2026-08-14 to 2026-08-27 | 98 | Failed, Microsoft Graph 403 |
| 2026-08-14 to 2026-08-18 | 44 | Failed, Resend 403, `joymode.io` not a verified domain |

The live access token on that provider carries `email Mail.Read Mail.Read.Shared Mail.Send openid profile User.Read` and identifies the authenticated user as `munjal@techff.com`. The configured mailbox is `service@joymode.io`, so the send resolves to `/users/service@joymode.io/sendMail` without `Mail.Send.Shared`.

Across all active Microsoft providers, the presence of `Mail.Send.Shared` predicts success exactly. Five providers fail with the identical error and none hold the scope: `service@joymode.io`, `support@hody.dev`, `support@meihlstech.com`, `support@itxp.com.au`, and one since-deleted provider. One provider sends successfully, `helpdesk@mycompguy.co`, whose Entra admin granted `Mail.Send.Shared` tenant-wide. There are no counterexamples in either direction.

Nineteen active providers currently sit in the failing configuration. Four more have a mailbox that matches the authenticated user and are blocked only by the hardcoded `/users/` path.

## Goals

Restore outbound email for tenants sending from a shared mailbox, without requiring every one of them to reconfigure Exchange.

Stop addressing a personal mailbox as though it were someone else's.

Stop the system fallback provider from attempting sends it cannot complete, and make the resulting failure legible to an administrator.

Tell an administrator what is actually wrong when a send is rejected, so the next occurrence does not require a database investigation.

## Non-goals

App-only authentication through the client credentials flow. That removes this entire class of failure and is the correct long-term design, but it changes the consent model and needs its own scoping work. It is tracked separately.

Any change to Teams behavior, bindings, or credentials.

Any change to inbound mail processing.

Automatic remediation of the affected tenants. Each one must reauthorize, because a new scope cannot be added to an existing grant.

## Product behavior

### Scope request

Connect and reconnect request `https://graph.microsoft.com/Mail.Send.Shared` alongside the existing scopes. Existing connections keep working under their current grant until the tenant reconnects. A tenant sending from a shared mailbox must reconnect before outbound email recovers.

### Send path resolution

`sendMail` resolves the mailbox path the same way the read path does. When the configured mailbox matches the authenticated user, the send posts to `/me/sendMail`. Otherwise it posts to `/users/{mailbox}/sendMail`. A tenant whose service mailbox is the authorizing user's own mailbox recovers without reconnecting and without any Exchange change.

### Fallback from-address

When the system provider handles a send for a tenant, the from-address is a verified system domain. The tenant's display name is preserved in the from-name, and the tenant's address moves to `Reply-To`. A tenant sending domain is never handed to the shared Resend account.

### Provisioned app registration

Requesting a scope only works if the app registration declares it. The registration we provision through `createMicrosoftEmailApplicationManifest` declares `Mail.Read`, `Mail.Read.Shared`, `offline_access`, and `User.Read`, and `packages/integrations/src/lib/microsoftEmailSetup.test.ts:51` asserts that `Mail.Send` never appears in the manifest. That assertion is a holdover from the period when the connector was documented as inbound-only.

The manifest declares the outbound permissions as well, and the assertion inverts to require them. Without this, a tenant onboarded through the automated setup path cannot send outbound mail at all, and reconnecting does not help, because administrator consent covers only declared permissions. Twenty-eight of forty-two providers sit on the shared platform registration; the rest are provisioned or tenant-owned and need the manifest change to have any path to sending.

### Failure reporting

A 403 from Graph records which precondition is missing. The stored error distinguishes an absent `Mail.Send.Shared` scope, which the token proves directly, from an Exchange delegation failure, which it cannot. The provider health surface shows the outbound state, so an administrator can see that sending is broken without reading `email_sending_logs`.

## Rollout

1. Ship the send path resolution and the fallback from-address change. Neither needs a reconnect, and the four matched-mailbox tenants recover on deploy.
2. Ship the scope addition and the failure reporting.
3. Notify the affected tenants that they must reconnect the mailbox. Include the Exchange Send As step, since the scope alone does not grant the Exchange permission.
4. Watch `email_sending_logs` for Microsoft providers. A reconnected tenant that still returns 403 is missing Send As on the mailbox rather than the scope.

## Customer remediation

Reconnecting grants the scope. It does not grant the Exchange permission.

The authorizing user needs Send As on the shared mailbox, granted in the Microsoft 365 admin center under Teams & groups, Shared mailboxes, Manage mailbox permissions, or through Exchange PowerShell:

```powershell
Add-RecipientPermission -Identity "<mailbox>" -Trustee "<authorizing user>" -AccessRights SendAs -Confirm:$false
```

Send As is the correct grant. Send on Behalf renders in Outlook as "user on behalf of mailbox", which exposes the authorizing user's address to the tenant's own clients.

Full Access is not sufficient and does not imply Send As. A tenant whose inbound mail works has Full Access already, which says nothing about its ability to send. Exchange permission changes can take up to an hour to take effect.

Shared mailboxes have sign-in disabled, so the authorizing user is always a licensed human account. That constraint is what makes app-only authentication the better long-term answer.

## Risks

Adding a scope changes the consent screen. A tenant whose administrator previously consented may now need administrator approval again, depending on their consent policy. Reconnect can fail for tenants that could previously connect unattended.

A tenant that reconnects but never configures Send As sees the same 403 and may reasonably conclude the fix did not work. Step 3 of the rollout has to state both requirements together.

`Mail.Send.Shared` widens what the connection can do. It authorizes sending as any mailbox the user has been delegated in Exchange, not only the configured one. Exchange delegation remains the constraint that bounds it.

## Acceptance criteria

- Connect and reconnect request `Mail.Send.Shared`.
- A send from a mailbox that matches the authenticated user posts to `/me/sendMail`.
- A send from any other mailbox posts to `/users/{mailbox}/sendMail`.
- A tenant holding `Mail.Send.Shared` and Send As sends successfully from a shared mailbox.
- The system fallback provider never sends from an unverified tenant domain, and the tenant address appears in `Reply-To`.
- A 403 caused by a missing scope is recorded differently from a 403 caused by Exchange delegation.
- Inbound processing, Teams, and every non-Microsoft outbound provider are unchanged.
