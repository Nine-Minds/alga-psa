# Tactical RMM Integration (Admin Guide)

AlgaPSA connects to [Tactical RMM](https://tacticalrmm.com/), an open-source RMM
platform, to bring your monitored devices into AlgaPSA as assets and to turn
Tactical alerts into AlgaPSA records. The core integration reads from Tactical: it
syncs clients and agents, ingests alerts by webhook and backfill, and pulls cached
software inventory. It is available in both Community and Enterprise editions.
Enterprise Edition adds remote actions that run scripts and commands on agents from
workflows. Each tenant connects a single Tactical instance.

## Before you connect (on the Tactical server)

Set two things on Tactical first, or the connection test and sync will fail.

- **Enable the Beta API.** AlgaPSA syncs inventory through Tactical's beta API,
  which is off by default. Set `BETA_API_ENABLED = True` in Tactical and restart
  it. While it is off, the inventory endpoints return `404`.
- **Use the API host, not the dashboard.** Tactical serves its API on the `api.`
  subdomain, for example `https://api.example.com`. The dashboard host (`rmm.`)
  serves the web app and answers every path with its own HTML, so a connection
  pointed there looks like it succeeds but syncs nothing.

## Connect to Tactical RMM

Go to **Settings → Integrations → RMM → Tactical RMM**. Enter the Tactical **API
host** as the Instance URL, then choose how AlgaPSA authenticates:

- **API key.** Paste a Tactical API key. AlgaPSA sends it as the `X-API-KEY`
  header.
- **Username and password (Knox token).** Enter Tactical credentials. AlgaPSA logs
  in for a Knox token and refreshes it automatically. If the account uses TOTP,
  AlgaPSA asks for the current code.

Save, then click **Test Connection**. AlgaPSA stores the credentials as tenant
secrets (`tacticalrmm_api_key`, or `tacticalrmm_username`, `tacticalrmm_password`,
and `tacticalrmm_knox_token`) and never returns them to the browser, so the form
shows only a masked value. The connection itself lives in `rmm_integrations` under
provider `tacticalrmm`, which records the instance URL, auth mode, active state,
and last sync time.

**Disconnect** clears the stored secrets and marks the connection inactive. It
keeps your organization mappings, so reconnecting later does not start over.

## Sync clients and map them to AlgaPSA

Click **Sync Clients** to pull Tactical Clients into AlgaPSA. Each one becomes a
row in `rmm_organization_mappings`. In the **Organization Mapping** section, assign
each Tactical Client to an AlgaPSA client and use the **Auto-sync** toggle to
control whether that organization's devices import. Map a Tactical Client to an
AlgaPSA client before you sync devices, so its agents land on the right client.

## Sync devices into assets

Click **Sync Devices** to import agents from the organizations you mapped with
Auto-sync on. AlgaPSA creates or updates one asset per agent, tags the asset with
its source (`rmm_provider = 'tacticalrmm'`, plus the Tactical agent id and
organization id), and links the agent to the asset in
`tenant_external_entity_mappings` under `integration_type = 'tacticalrmm'`.

Each asset shows the agent's status as `online`, `offline`, or `overdue`.
Tactical's `overdue` state stays distinct from offline. AlgaPSA also stores the
last-seen time and cached vitals such as current user, uptime, and LAN/WAN IP when
Tactical reports them. When an agent disappears from Tactical, AlgaPSA leaves its
asset in place rather than deactivating it.

## Receive alerts

Tactical pushes alerts to AlgaPSA over a webhook. In the **Webhooks** section, copy
the **Webhook URL** and **Header Secret**, then add an alert-action webhook in
Tactical that posts to that URL and sends the `X-Alga-Webhook-Secret` header. The
settings page shows a payload template; only `agent_id` is required.

When an alert arrives, AlgaPSA records it in `rmm_alerts`, links it to the matching
asset, and refreshes that agent. An event whose type contains `resolve` marks the
alert resolved; anything else opens or updates an active alert. Click **Sync
Alerts** to backfill currently active alerts from Tactical for history.

## Ingest software inventory

Click **Ingest Software** to pull Tactical's cached software inventory in bulk for
your mapped agents. AlgaPSA writes it to the software catalog and links it to each
asset. This reads Tactical's cached data and does not trigger a per-agent refresh.

## Remote actions (Enterprise Edition)

Enterprise Edition can drive Tactical from workflows. A workflow can list and
inspect agents, run a script or a shell command on an agent, and reboot an agent,
all through the same stored credentials. These actions run on the endpoint, so
scope them carefully.

## Permissions

Connecting, disconnecting, syncing, and editing mappings require the
`system_settings` permission. The webhook endpoint does not use a login session.
It validates the `X-Alga-Webhook-Secret` header against the tenant's stored
`tacticalrmm_webhook_secret`.

## Related topics

- [Asset Management System](../features/asset_management.md) — the asset model that
  device sync writes into.
