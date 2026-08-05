# Microsoft 365 Provider Setup (Outlook / Exchange Online)

Connect a Microsoft 365 mailbox to turn incoming messages into tickets and,
optionally, send outbound email from the same mailbox. The connector uses
delegated Microsoft Graph access on behalf of the user who authorizes it.
Providers settings can guide administrators through using the Alga platform
app, creating a tenant-owned app through Microsoft Graph, or entering an
existing app manually.

> Existing Microsoft connections must be reauthorized before outbound use so
> the delegated token includes `Mail.Send`. A provider showing **Ready** only
> confirms that its Microsoft credentials are configured.

## Prerequisites

* A Microsoft Entra administrator who can grant tenant consent. Automated
  tenant-owned setup also requires a role allowed to create app registrations,
  service principals, and credentials, such as Application Administrator or
  Cloud Application Administrator.
* A licensed user mailbox or a shared mailbox the authorizing user can read.
* An AlgaPSA user with `system_settings:update` permission.
* Outbound HTTPS access to `graph.microsoft.com` and
  `login.microsoftonline.com`. A public inbound URL is optional because AlgaPSA
  falls back to polling when Microsoft cannot validate the webhook endpoint.

## Choose the hosted or self-hosted path

### Hosted AlgaPSA

Hosted deployments can use AlgaPSA's platform Microsoft app:

* **Use the Alga platform app** in the guided setup to create a tenant-specific
  Email profile without entering client credentials.
* A tenant-owned Microsoft app takes precedence when it is selected for Outlook
  email. Use the automated or manual tenant-owned setup when the organization
  explicitly requires its own app registration.

### Self-hosted or appliance AlgaPSA

Create and bind your own Entra app. Register your deployment's exact callback
URL and allow outbound HTTPS to `login.microsoftonline.com` and
`graph.microsoft.com`.

A public HTTPS notification URL is optional. Expose
`https://<your-host>/api/email/webhooks/microsoft` only if you want webhook
delivery for a user mailbox. If Microsoft cannot validate that URL, AlgaPSA
uses polling over outbound HTTPS instead.

Operator-level app secrets and environment variables remain compatibility
fallbacks. Use the Microsoft profile in the UI for normal setup so the app used
by Outlook email is explicit.

## Set up the Microsoft app and Email profile

Open **Settings → Integrations → Providers**, then select **Set up Microsoft
Email**. Choose one of:

* **Use the Alga platform app** — enter the Microsoft tenant ID or verified
  domain. Alga creates a pending Email profile and provides the tenant-scoped
  administrator-consent step.
* **Create an app in this tenant** — sign in with a Microsoft administrator. A
  setup-only PKCE flow creates the application, service principal, and client
  secret through Microsoft Graph. Alga stores the generated secret directly in
  its tenant secret provider and discards the short-lived bootstrap token.
* **Enter an existing app manually** — open the existing profile form and follow
  the tenant-owned registration steps below.

The automated option is unavailable when the deployment does not have a
multi-tenant setup application configured. The other choices remain available
independently.

After either guided option creates a profile, complete **Grant administrator
consent**. The profile remains unavailable for Outlook email until the callback
records consent and selects it for the Email service in one transaction. This
tenant-wide app consent is separate from authorizing the individual mailbox.

## Required Microsoft permissions

Add these permissions as **Microsoft Graph → Delegated permissions**. The
Microsoft mailbox OAuth flow requests exactly these four scopes:

| Permission | Why AlgaPSA requests it |
| --- | --- |
| `Mail.Read` | Reads the signed-in user's mailbox. It also permits message and folder access used for that user's change-notification subscription. |
| `Mail.Read.Shared` | Reads shared or delegated mailboxes that the signed-in user can already access. It does not grant Exchange mailbox access. |
| `Mail.Send` | Sends outbound email as the configured mailbox when Microsoft 365 is selected under **Settings → Email → Outbound Email**. It does not grant Exchange **Send As** rights for a shared mailbox. |
| `offline_access` | Requests a refresh token so polling, reconciliation, and subscription maintenance can continue without another interactive sign-in. |

Do not add **Application permissions** for this connector. `Mail.ReadWrite` is
not required: inbound ingestion remains read-only, and outbound sending uses
delegated `Mail.Send`.

Microsoft lists these delegated permissions as not requiring admin consent by
default. Your tenant can still restrict user consent. Grant tenant-wide admin
consent when your consent policy requires it, or when you want administrators to
approve the scopes for all authorizing users in advance. Granting admin consent
does not change them into application permissions.

See Microsoft's references for
[Graph mail permissions](https://learn.microsoft.com/graph/permissions-reference#mail-permissions),
[`offline_access`](https://learn.microsoft.com/entra/identity-platform/scopes-oidc#the-offline_access-scope),
and [delegated consent policy](https://learn.microsoft.com/graph/permissions-overview#delegated-access-scenarios).

## Before you authorize

Confirm all of the following:

* The app's supported account type is **Accounts in any organizational
  directory**. AlgaPSA starts authorization through the Microsoft `common`
  authority.
* The **Web** redirect URI in Entra exactly matches the value displayed by Alga
  PSA: `https://<your-host>/api/auth/microsoft/callback`. Scheme, host, path, and
  trailing slash must match.
* You copied the client secret **Value**, not its Secret ID. The value is shown
  only when the secret is created.
* The Microsoft app is enabled for **Outlook email** and selected in the Outlook
  email service row under **Which Microsoft app each service uses**.
* The user who will complete OAuth can open the configured mailbox. For a shared
  mailbox, complete the additional checks in
  [Connect a shared mailbox](#connect-a-shared-mailbox).

## Register a tenant-owned Entra app

1. In the [Microsoft Entra admin center](https://entra.microsoft.com), open
   **App registrations** and create an app.
2. Select **Accounts in any organizational directory** as the supported account
   type.
3. Under **Authentication**, add the callback from AlgaPSA as a **Web** redirect
   URI: `https://<your-host>/api/auth/microsoft/callback`.
4. Under **API permissions**, add `Mail.Read`, `Mail.Read.Shared`, `Mail.Send`,
   and `offline_access` as delegated permissions.
5. If your tenant policy requires administrator approval, select **Grant admin
   consent** for the tenant.
6. Under **Certificates & secrets**, create a client secret and copy its
   **Value** immediately.

## Configure the Microsoft profile

1. Open **Settings → Integrations → Providers**.
2. In the Microsoft section, select **New app registration**.
3. Enter a display name, the **Client ID**, **Tenant ID**, and **Client secret**.
   Use the directory ID for the Microsoft 365 tenant. Use `common` only when
   your deployment deliberately uses a multi-tenant app with common authority.
4. Under **Services this app can handle**, enable **Outlook email**, then create
   the profile.
5. Under **Which Microsoft app each service uses**, select that app for
   **Outlook email**. A default app is not a substitute for this service binding.

AlgaPSA stores the client secret server-side. The inbound provider form does
not ask for the client ID or secret. See
[`provider-setup-order.md`](../../integrations/provider-setup-order.md) when the
same app also supports sign-in, calendar, or Teams.

## Add the inbound provider

1. Open **Settings → Email → Inbound Email**.
2. Select **Add Email Provider**, then choose **Microsoft 365**.
3. Enter the following values:
   * **Configuration Name**: an internal name for this connection.
   * **Email Address**: the user or shared mailbox to ingest.
   * **Inbound Ticket Defaults**: the optional defaults for new tickets.
   * **Folder Filters**: use `Inbox`. The form accepts multiple folder names,
     but Microsoft setup currently subscribes only to the first entry and
     maintenance reconciliation uses Inbox.
   * **Max Emails Per Sync**: between 1 and 1000. The default is 50.
   * **Redirect URI**: leave the generated value unchanged unless the matching
     Entra redirect URI was also changed.
4. Select **Authorize Access**. Sign in as the user whose delegated access Alga
   PSA should use, then approve the consent prompt.

The popup closes after AlgaPSA stores the access and refresh tokens. A user
mailbox normally attempts webhook setup. Polling is also a connected and
supported delivery mode.

## Connect a shared mailbox

Use delegated access. Do not sign in as the shared mailbox and do not add an
application-level mail permission.

1. Set **Email Address** on the AlgaPSA provider to the shared mailbox address.
2. Sign in during **Authorize Access** with a normal licensed Microsoft 365 user
   account.
3. In Exchange Online, grant that user **Read and manage (Full Access)** to the
   shared mailbox. `Mail.Read.Shared` lets Graph use access the user already
   has; it does not assign Full Access.
4. To send outbound email from the shared mailbox, also grant that user **Send
   As** permission. Delegated `Mail.Send` does not assign this Exchange right.
5. Before authorizing AlgaPSA, verify that the user can open the shared mailbox
   in Outlook or Outlook on the web.

Microsoft Graph does not support Outlook change-notification subscriptions on
shared or delegated folders with `Mail.Read.Shared`. A shared-mailbox provider
therefore relies on AlgaPSA's polling delivery. Setup still attempts a webhook
subscription first, so Microsoft can return a subscription access error during
authorization. Do not add application permissions to work around that error;
they are not used by this delegated connector. Leave the provider enabled and
check its delivery mode and last-ingested time after the next polling cycle.

If OAuth succeeds for the user's own mailbox but the shared mailbox returns
HTTP 403, check these in order:

1. Confirm the user can open the shared mailbox in Outlook or Outlook on the
   web.
2. Confirm `Mail.Read.Shared` is present and consented in the token/app setup.
3. Reauthorize the provider, then run **Test Connection** or Microsoft 365
   diagnostics again.

Microsoft documents the distinction between
[`Mail.Read.Shared`](https://learn.microsoft.com/graph/permissions-reference#mailreadshared)
and [Exchange Full Access](https://learn.microsoft.com/exchange/recipients-in-exchange-online/manage-permissions-for-recipients).

## Webhooks, subscriptions, and polling

For a user mailbox, AlgaPSA attempts to create a `changeType: created`
subscription for the watched folder at
`https://<your-host>/api/email/webhooks/microsoft`. The subscription uses the
same delegated `Mail.Read` access as message retrieval. There is no separate
Graph webhook permission.

Microsoft validates the public notification URL while the subscription is
created. This network handshake is separate from mailbox authorization. A
validation failure means Microsoft cannot use the webhook delivery path; it
does not by itself mean the mail permissions are wrong.

At runtime:

* New subscriptions are created for about 60 hours.
* Maintenance runs every 15 minutes, looks 24 hours ahead, and renews or
  recreates subscriptions before they expire.
* Webhook providers also reconcile Inbox every 15 minutes as a safety net. After
  three reconciliation runs import mail without a webhook delivery, AlgaPSA
  switches the provider to polling.
* Polling runs every 3 minutes by default and needs only outbound HTTPS.
* Polling providers retry webhook registration every 24 hours and when you use
  **Test Connection**.

Inbound processing remains read-only in both modes. Refresh tokens are stored
server-side and are used to renew access tokens for background work and
outbound delivery.

## Enable outbound Microsoft Graph email

Connecting a Microsoft mailbox makes it available for selection but does not
change the tenant's outbound provider automatically.

1. Open **Settings → Email → Outbound Email**.
2. Select **Microsoft 365 (Microsoft Graph)**.
3. Select the connected sending mailbox and save. The sender and ticketing From
   address are tied to that mailbox; arbitrary From spoofing is not supported.
4. Use **Test Outbound Email** to verify the connection and optionally send a
   test message.

AlgaPSA sends through `/users/{mailbox}/sendMail` and requests that Microsoft
save a copy in Sent Items. A Graph 403 generally means `Mail.Send` consent or,
for a shared mailbox, Exchange **Send As** permission is missing. Reconnect the
provider after adding or changing delegated permissions.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| **Authorize Access** is disabled | Open **Settings → Integrations → Providers**. Enable a Microsoft app for Outlook email and select it in the Outlook email service row, or confirm the hosted platform setup is ready. |
| Microsoft shows **Need admin approval** | The tenant's consent policy blocks user consent. Ask an authorized Entra administrator to grant tenant-wide admin consent for the four delegated scopes. |
| OAuth reports a redirect error | Compare the displayed redirect URI with the Entra **Web** redirect URI character for character. Confirm the app supports accounts in any organizational directory. |
| OAuth succeeds, but the shared mailbox returns 403 | Confirm Exchange Full Access for the authorizing user, then confirm and re-consent `Mail.Read.Shared`. Graph consent does not grant mailbox membership. |
| Shared-mailbox authorization reports a subscription access error | Microsoft does not support delegated change notifications for shared folders. Do not add application permissions. Leave the provider enabled and check polling delivery and last-ingested time after the next cycle. |
| Subscription creation or validation fails | Confirm public DNS, valid TLS, and inbound access to `/api/email/webhooks/microsoft`. The provider can remain connected in polling mode while you fix reachability. Shared mailboxes are expected to poll. |
| New mail does not create tickets | Check delivery mode and last-ingested time. Polling needs outbound access to Microsoft. Webhook mode also needs public inbound access. Use **Test Connection** to check Graph access and retry webhook registration. |
| Token refresh fails after working previously | The refresh token or consent may have expired or been revoked, or the bound app's client ID/secret changed. Restore the issuing app credentials if appropriate, then reauthorize the mailbox. |
| Mail from a custom folder is missing | Set **Folder Filters** to `Inbox` and reauthorize. Multiple/custom Microsoft folders are not currently reliable across subscription maintenance and reconciliation. |
| The provider is Ready, but AlgaPSA sends no replies | Select the mailbox under **Settings → Email → Outbound Email**, reconnect it if it predates `Mail.Send`, and run the outbound test. |
| The outbound test returns 403 | Reconnect the mailbox to grant `Mail.Send`. For a shared mailbox, also verify that the authorizing user has Exchange **Send As** permission. |
