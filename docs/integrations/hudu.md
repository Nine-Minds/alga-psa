# Hudu Integration (Admin Guide)

AlgaPSA connects to [Hudu](https://www.hudu.com/), an IT documentation platform,
so you can see a client's Hudu documentation and credentials without leaving
AlgaPSA. The integration is **read-only**: AlgaPSA pulls from Hudu and never
writes back. It is an **Enterprise Edition** feature, and each tenant connects a
single Hudu instance.

## Connect to Hudu

Go to **Settings → Integrations → Hudu**. Enter your Hudu **base URL** and an
**API key**, then connect. AlgaPSA tests the connection before saving and reports
a clear error for a bad key (401), a wrong base URL (404), or an unreachable host.

The API key and base URL are stored as tenant secrets (`hudu_api_key`,
`hudu_base_url`). The key is never returned to the browser, so the form never
shows it again. To rotate the key, enter a new one; to keep the existing key,
change the base URL and leave the key blank.

**Disconnect** clears the stored credentials and marks the connection inactive. It
keeps your company and asset mappings, so reconnecting later does not start over.

## Map companies to clients

Open the **Company Mapping** manager in the Hudu settings. AlgaPSA auto-suggests
matches between Hudu companies and AlgaPSA clients, and you confirm or change
them. Mappings are stored in `tenant_external_entity_mappings` under
`integration_type = 'hudu'`, `alga_entity_type = 'client'`. A client must be
mapped before its Hudu documentation appears on its record.

## Map and import assets

Hudu groups assets by layout, not by type. In the **Asset Layout Map** settings,
assign each Hudu asset layout to an AlgaPSA asset type, or mark a layout
**Don't import** to skip it. You can also create a new custom asset type straight
from a layout, and AlgaPSA derives the type's fields from the layout's fields.

Once layouts are mapped, import assets individually or in bulk, then sync to pick
up later changes. A sync flags assets that were archived or removed in Hudu, and a
multi-source guard keeps a connected RMM as the authority for an asset's name and
serial number. The asset-import field mapping is documented in
[Custom Asset Types](../features/custom_asset_types.md).

## View documentation and credentials

Once a client is connected, its record gains Hudu surfaces:

- **Hudu tab** — the client's Hudu assets and knowledge-base articles.
- **Passwords tab** — the client's Hudu credentials. Values are hidden by default
  and revealed on demand. Each reveal is recorded in the audit log.
- **Documents** — a Hudu section on the client's Documents tab, plus a
  cross-client Hudu tab on the Documents page.

## Permissions

Connecting, disconnecting, and editing mappings require the `system_settings`
permission. Viewing a client's Hudu surfaces follows that client's documentation
access.

## Related topics

- [Custom Asset Types](../features/custom_asset_types.md) — how Hudu layouts map to
  asset types and how layout fields land on an asset.
- [Asset Management System](../features/asset_management.md) — the broader asset
  model the import writes into.
