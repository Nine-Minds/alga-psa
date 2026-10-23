# Datto RMM Integration (Admin Guide)

AlgaPSA connects to [Datto RMM](https://www.datto.com/products/rmm) (formerly
CentraStage) to bring your monitored devices into AlgaPSA as assets, map Datto
sites to AlgaPSA clients, and turn Datto alerts into AlgaPSA records. It is
available in AlgaPSA Pro (Enterprise Edition). Each tenant connects a single
Datto RMM account.

The integration talks to the Datto RMM v2 REST API with an API key and secret.
Polling is the guaranteed path for alerts. A webhook is an optional fast path.

## Before you connect (in Datto RMM)

### Create a dedicated API user

Create a user in Datto RMM just for AlgaPSA, so you can revoke or rotate its
access without touching anyone else's, and so its activity is easy to spot in
the Datto audit log. Give it a security level with the access below.

| What AlgaPSA does | Datto access needed |
|---|---|
| Test Connection, Sync Sites | Read access to the account and its sites |
| Sync Devices, scheduled sync | Read access to devices and device audits |
| Alert polling, Sync Alerts, webhook | Read access to alerts |
| Ingest Software | Read access to device audits (software) |
| Reboot component list | Read access to components |
| Resolve alert when ticket closes (optional) | Write access to alerts |
| Reboot / Run component (optional) | Permission to run quick jobs |

Read access is enough for sync, alerts, and software. Add write access only for
the two optional features, and only if you want them. A user whose security
level is restricted to a subset of the account gets `403` from the account-level
endpoints; see [Troubleshooting](#troubleshooting).

### Enable API access and generate the key and secret

1. In Datto RMM, open the API user's profile and turn on API access for it.
2. Generate the **API key** and **API secret** for that user. Datto shows the
   secret once, so copy both somewhere safe before you leave the page.

Regenerating the key or secret in Datto invalidates the old pair. Paste the new
values into AlgaPSA and Save again.

### Find your platform

Datto hosts accounts on named platforms: **Pinotage**, **Merlot**, **Concord**,
**Vidal**, **Zinfandel**, and **Syrah**. Your platform is the first part of the
address you use to sign in to Datto RMM, for example `https://merlot.rmm.datto.com`
is Merlot. The API lives at `https://<platform>-api.centrastage.net`.

## Connect to Datto RMM

Go to **Settings → Integrations → RMM → Datto RMM**.

1. Choose your **Platform**. Pick **Custom URL** only if Datto gave you a
   different API host; AlgaPSA adds the trailing `/api` for you. The host must be
   a Datto host (`*.centrastage.net` or `*.rmm.datto.com`) over `https`, and any
   other URL is rejected on Save. This keeps the API key and secret from being
   sent anywhere but Datto.
2. Paste the **API key** and **API secret**.
3. Click **Save**, then **Test Connection**.

Test Connection signs in, reads the account, and reads the first page of sites.
On success it shows the account name with the site and device counts and marks
the connection active. It tells you which kind of failure happened:

- **Credentials rejected.** Check the key, secret, and platform.
- **Permission missing.** The API user signed in but its security level cannot
  read a resource. The message names the resource, for example
  `/v2/account/sites`.
- **Network.** AlgaPSA could not reach Datto. Check the platform or custom URL.

AlgaPSA stores the credentials as tenant secrets (`datto_rmm_api_key`,
`datto_rmm_api_secret`) and never returns them to the browser, so the form shows
only a masked key and "Saved (enter to update)" for the secret. Leave a field
blank when you Save to keep the stored value. Changing the key, secret, or
platform deactivates the connection until the next successful Test Connection.
If you change the platform or custom URL (the host), you must also enter the API
key and API secret again; Save is refused otherwise, so stored credentials are
never sent to a host you just typed without you confirming them.
The connection itself lives in `rmm_integrations` under provider `datto`.

Datto tokens last about 100 hours. AlgaPSA caches the token as a tenant secret
(`datto_rmm_access_token`) and signs in again when it expires. If Datto rejects
the key and secret at sign-in, AlgaPSA marks the integration as
needing reconnection and the scheduled jobs skip it until you Save new
credentials or run Test Connection successfully.

**Disconnect** (it asks you to confirm) removes the stored key, secret, and token
and marks the connection inactive. It also resets the webhook secret, so after
reconnecting, copy the new **Header Secret** into your Datto webhooks (see
[Webhook](#webhook-optional-fast-path)). It keeps your site mappings and the
assets already synced, so reconnecting later does not start over. Inactive
connections stop their scheduled jobs within a few minutes.

## Sync sites and map them to AlgaPSA clients

Click **Sync Sites** to pull your Datto sites into AlgaPSA. Each site becomes a
row in `rmm_organization_mappings`. Re-syncing refreshes names and metadata only;
it never changes a client, contact, or Auto-sync choice you made.

In **Site Mapping**, assign each Datto site to an AlgaPSA client:

- **Suggestions.** When a site's Autotask company name, or failing that its own
  name, matches an AlgaPSA client name exactly (ignoring case), the row shows a
  **Suggested: client** button. Click it to accept. AlgaPSA never assigns a
  client on its own, and a name shared by several clients is not suggested.
- **Changing a client.** Re-pointing a mapped site moves its assets to the new
  client, so AlgaPSA asks you to confirm and shows how many assets will move.
- **Auto-sync.** Turn it on for each site whose devices should import. Datto
  on-demand sites start with Auto-sync off.
- **Default Contact.** Pick the contact from the mapped client that alert tickets
  for this site should use. If none is set AlgaPSA falls back to the client's
  primary contact. **Add new contact** in the picker creates one inline.
- **People.** Controls what sync does with a device's signed-in user: off,
  suggest, or auto-assign. Matching uses the **Signed-in users** panel under the
  table.
- **Billing profile.** Appears when the client has more than one profile; choose
  which one this site's alert tickets bill to.
- **Create clients for unmapped sites.** Creates an AlgaPSA client for each
  unmapped site (or links the site to an existing client with the same name) and
  maps it. **Create clients for new sites automatically** does the same for
  sites that later syncs find. Both need the `client` **create** permission as
  well as settings access; turning the automatic option on is refused without
  it, because scheduled syncs create clients with nobody present.

## Sync devices into assets

Click **Sync Devices** to import devices from sites that have a mapped client and
Auto-sync turned on. AlgaPSA creates or updates one asset per device, tags it with
its source (`rmm_provider = 'datto'`, plus the Datto device uid and site uid),
and links the device to the asset in `tenant_external_entity_mappings` under
`integration_type = 'datto'`.

Each asset carries the device's online or offline status, last seen time, last
logged-in user, internal and external IP, operating system, agent version,
last reboot, antivirus and patch status, and whether a reboot is required. Hardware
details (serial number, make and model, CPU, memory, disks) come from Datto's
device audit. AlgaPSA only reads the audit again when the device's last audit
date changed, so repeat syncs stay inside Datto's rate limit. Servers, desktops
and laptops, printers and network devices, ESXi hosts, and mobile devices map to
the matching asset types. When a device is deleted in Datto, AlgaPSA keeps its
asset and marks it deleted (and offline) rather than removing it.

## Scheduled device sync

The **Scheduled device sync** card keeps assets current without clicking
**Sync Devices**. Turn it on and set the interval, between 15 and 1440 minutes
(default 60). The scheduled job is incremental: Datto has no server-side change
feed, so it walks the devices and ingests those seen or audited since the last
run. A failed run does not disable the schedule; it retries at the next interval.
The manual **Sync Devices** button always runs a full sync and works independently
of the schedule.

## Alerts

### Polling (guaranteed)

Alert polling runs from the **Alert automation** card that appears once the
connection is active. Turn it on and choose an interval between 5 and 60
minutes (default 15). Each run reads the account's open alerts for your mapped
sites, creates or updates them in `rmm_alerts`, and resolves any AlgaPSA alert
that no longer appears as open in Datto. Muted alerts and alerts from unmapped
sites are not ingested, but they still count as open: muting an alert or
unmapping its site does not resolve the AlgaPSA alert or auto-close its ticket. Alert rules, maintenance windows, and
ticket creation use the same automation settings as the other RMM providers.

Click **Sync Alerts** to run one reconciliation immediately.

### Webhook (optional fast path)

A webhook delivers alerts within seconds instead of waiting for the next poll.
Datto's webhook settings support custom headers, so the secret is sent in a
header and never in the URL.

In the **Alerts** section, copy these values from AlgaPSA:

- **Webhook URL**: `https://<your AlgaPSA host>/api/webhooks/datto?tenant=<tenant id>`.
  The tenant id is not a secret.
- **Custom Header Name**: `X-Alga-Webhook-Secret`
- **Header Secret**: a random secret AlgaPSA generates the first time you view
  this section. **Regenerate secret** replaces it (it asks you to confirm); the
  old value stops working at once, so update the header in Datto right after.
  Disconnecting also resets it.
- **Body Template (alert triggered)** and, optionally, **Body Template (alert
  resolved)**.

Then in Datto RMM, set up the webhook with:

1. **URL** set to the Webhook URL.
2. A **custom header** named `X-Alga-Webhook-Secret` whose value is the Header
   Secret. Datto takes custom headers on its webhook settings: either globally
   on the Global Webhooks page (see
   [Datto's Global Webhooks help](https://rmm.datto.com/help/en/Content/3NEWUI/Setup/Integrations/GlobalWebhooks.htm))
   or on the webhook response of an individual monitor or monitor policy. Set
   the header wherever you configure the webhook, because AlgaPSA rejects any
   request that arrives without it.
3. **Content type** `application/json` and the **Body Template** from AlgaPSA.
   Datto replaces placeholders such as `[alert_uid]` and `[device_uid]` when it
   sends the request. Add the resolved template to a separate response if you
   want Datto to tell AlgaPSA when an alert clears.

The body only has to identify the alert (`alertUid`). AlgaPSA then reads the full
alert from the Datto API, so the diagnostics are accurate and no free text from
the alert has to survive being embedded in JSON. Datto may redeliver a webhook;
AlgaPSA ignores duplicates. Requests with a missing or wrong secret get `401`.
Like polling, the webhook only handles alerts from sites that are mapped to an
AlgaPSA client; an alert from an unmapped site, or a muted alert, is
acknowledged and ignored. An ignored delivery is not remembered as a duplicate,
so if Datto redelivers it after you map the site, it is processed. AlgaPSA
answers the webhook before refreshing the alert's device from Datto, so a slow
or rate-limited device read does not hold up the delivery.
Even with a webhook configured, keep polling on: it is what resolves alerts whose
resolve webhook never arrived.

### Resolve the Datto alert when the ticket closes (optional)

Turn on **Resolve the Datto alert when its ticket closes** to have AlgaPSA call
Datto's resolve endpoint when the ticket created from an alert is closed. It is
off by default because it needs an API user with write access to alerts.

With it off, AlgaPSA does not touch the alert in Datto when you close its
ticket, and the AlgaPSA alert stays active because the alert is still open in
Datto. If the alert is still open at the next poll, AlgaPSA treats it as firing
again and opens a **new ticket** for it. This is by design: resolve the alert in
Datto (or let it clear) before or after closing the ticket, or turn this setting
on so closing the ticket resolves it for you.

## Software inventory

Click **Ingest Software** to read the software audit of your mapped devices and
write it to the software catalog and each asset. The button forces a full
re-read of every device's software, one Datto API call per device, so on a large
account it can use a good share of Datto's rate limit; use it sparingly. The
scheduled ingest and **Ingest software during device sync** (which does the same
as part of device sync) only re-read devices whose last audit date advanced since
the previous ingest, adding one Datto API call per changed device.

## Asset actions

On a synced asset's detail page you can:

- **Refresh** the asset from Datto right now.
- **Remote Access → Remote Desktop** opens the device's **Web Remote** session in
  Datto. The option appears when the last device sync found a Web Remote link,
  so opening the menu makes no Datto API call; the link itself is read fresh
  from Datto when you choose it.
- **Reboot** runs your configured **Reboot component** on the device as a quick
  job. Choose the component under **Asset actions** in the settings. The list
  comes from Datto when the API user may read components; if it cannot, paste the
  component's UID instead. With no component set, Reboot reports that none is
  configured.
- **Run component** runs a Datto component on the device as a quick job and
  returns its job id. Only components that already exist in your Datto account
  can run.

Reboot, Run component, and Remote Desktop give control of the endpoint, so on
Datto assets they require the RMM **execute command** permission
(`rmm:execute_command`) on top of asset update, as well as a Datto API user that
is allowed to run quick jobs.

> **Note for technicians:** by default only the **Admin** role has
> `rmm:execute_command`. Users without it do not see Reboot, Run component, or
> Remote Desktop on Datto assets. To give technicians these actions, grant
> the `rmm` **execute_command** permission to their role.

## Permissions

Connecting, disconnecting, syncing, and editing mappings require the
`system_settings` permission in AlgaPSA (read to view, update to change).
Creating clients for sites, by hand or by turning on automatic creation, also
requires `client` **create**. Reboot, Run component, and Remote Desktop on a
Datto asset require `rmm:execute_command` (Admin only by default).
The webhook endpoint does not use a login session; it validates the
`X-Alga-Webhook-Secret` header against the tenant's stored
`datto_rmm_webhook_secret` in constant time.

## Troubleshooting

**`401` or "rejected the API key and secret".** The key and secret do not match,
were regenerated in Datto, or belong to a different platform. Confirm the
platform, paste the current key and secret, Save, then Test Connection. If the
connection was flagged as needing reconnection, this clears it.

**`403` or "security level does not have access to `<path>`".** The API user can
sign in but its security level cannot read that resource. Edit the security level
in Datto to allow reading the account, sites, devices, alerts, and audits (see the
table above), or use an API user with account-wide access. A user restricted to
individual sites cannot use the account-level endpoints AlgaPSA relies on.

**`429` or "rate limit".** Datto limits requests per account over a rolling
window. AlgaPSA backs off automatically using Datto's `Retry-After` header and
retries, pauses every request that uses the same API key until the window
passes, and caps how many Datto requests run at once. If you see this repeatedly,
lengthen the scheduled sync interval, turn off **Ingest software during device
sync**, or avoid running several syncs at once.

**Sites sync but no devices appear.** Devices import only from sites that have a
mapped client and Auto-sync turned on. Check the mapping, then Sync Devices.

**Reboot component list is empty.** The API user may not be allowed to list
components. Paste the component's UID in the field instead.

**Webhook returns `401`.** The header name or secret does not match. Copy both
again from AlgaPSA, and make sure Datto sends the header on every request.

**Alerts do not arrive.** Check that alert polling is on and that the alert's site
is mapped to a client (alerts from unmapped sites are ignored, by poll and by
webhook). **Sync Alerts** runs a poll immediately and shows what it
found.

## Related topics

- [Tactical RMM Integration](tactical-rmm.md) — the Community Edition RMM
  provider, with the same mapping and scheduling model.
- [Asset Management System](../features/asset_management.md) — the asset model that
  device sync writes into.
