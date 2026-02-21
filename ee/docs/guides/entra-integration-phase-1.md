# Microsoft Entra Integration (EE) — Phase 1 Setup and Usage

## Scope

This guide documents Enterprise Edition Phase 1 of Microsoft Entra integration:

- Partner-level connection (`direct` Microsoft OAuth or `cipp` API token).
- Managed tenant discovery and tenant-to-client mapping.
- Initial/manual/recurring contact sync through Temporal workflows.
- Additive, non-destructive sync behavior.

All user-visible Entra surfaces are feature-flag gated.

## Prerequisites

- Edition: `NEXT_PUBLIC_EDITION=enterprise`
- Internal MSP user account (client portal users are denied)
- RBAC:
  - View endpoints/actions: `system_settings.read`
  - Connect/map/sync/resolve endpoints/actions: `system_settings.update`

## Connection Path Decision Guide

Choose one connection type per tenant:

1. `direct` (Microsoft OAuth)
- Use this when you want first-party delegated auth directly against Microsoft Graph.
- Requires Microsoft OAuth app credentials (tenant secret, env, or app secret fallback).
- Best when you control OAuth app registration and consent flow.

2. `cipp` (CIPP API)
- Use this when CIPP is your operational control plane for managed tenant/user enumeration.
- Requires CIPP base URL and API token.
- Best when your MSP already uses CIPP and wants to reuse that API boundary.

Switching connection types automatically clears stale credentials for the previous type.

## Required Secret Names

Entra secret constants are defined in `ee/server/src/lib/integrations/entra/secrets.ts`.

Shared Microsoft credential keys:

- `microsoft_client_id`
- `microsoft_client_secret`
- `microsoft_tenant_id`

Direct Entra token keys:

- `entra_direct_access_token`
- `entra_direct_refresh_token`
- `entra_direct_token_expires_at`
- `entra_direct_partner_tenant_id`
- `entra_direct_token_scope`

CIPP keys:

- `entra_cipp_base_url`
- `entra_cipp_api_token`

Secret provider compatibility:

- All Entra credentials/tokens are resolved through `getSecretProviderInstance()`.
- Tenant secrets support env/filesystem/vault provider chains (no plaintext token storage requirement in DB).

## Credential Resolution Order (Direct)

For direct Microsoft OAuth credentials, resolution order is:

1. Tenant secrets (`microsoft_client_id` + `microsoft_client_secret`, optional `microsoft_tenant_id`)
2. Environment variables (`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`)
3. App secrets (`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`)

## Feature Flags (Phase 1)

Required flags:

- `entra-integration-ui`
- `entra-integration-client-sync-action`
- `entra-integration-cipp`
- `entra-integration-field-sync`
- `entra-integration-ambiguous-queue`

Create/check default Phase 1 flag definitions through platform feature flag API:

```bash
curl -X POST \
  "$BASE_URL/api/v1/platform-feature-flags" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $MASTER_TENANT_API_KEY" \
  -d '{"__action":"ensure_entra_phase1_flags"}'
```

Enable tenant targeting for a flag:

```bash
curl -X POST \
  "$BASE_URL/api/v1/platform-feature-flags/$FLAG_ID/tenants" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $MASTER_TENANT_API_KEY" \
  -d '{"__action":"add","tenantId":"TENANT_UUID"}'
```

## Setup Workflow (Wizard)

The settings wizard follows four explicit write-gated steps:

1. Connect
- Choose `direct` or `cipp`.
- For direct: start OAuth, complete callback, validate connection.
- For CIPP: save base URL/token, validate tenant list access.

2. Discover Tenants
- Run discovery to populate managed Entra tenants.

3. Map Tenants to Clients
- Review `auto-matched`, `needs review`, and skipped rows.
- Confirm mappings explicitly (no hidden writes during preview).

4. Initial Sync
- Run initial sync once at least one mapping is confirmed.

## Sync Behavior and Safety Rules

Default behavior is additive/linking, not destructive:

- Email-normalized match links to existing contacts.
- No match creates new contact under mapped client.
- Multiple plausible matches queue reconciliation items.
- Name-only similarity does not auto-link.
- Sync never deletes contacts.
- Disabled/deleted upstream Entra users mark linked contacts inactive.

Field overwrite controls:

- Only fields enabled in `entra_sync_settings.field_sync_config` may overwrite local contact values.
- If a field toggle is off, local value remains authoritative.

## Manual Sync Paths

- Settings: `Sync All Tenants Now` starts all-tenant workflow.
- Client details: `Sync Entra Now` starts single-client workflow for mapped client.
- Mapping confirm flow can optionally start initial sync immediately.

All sync execution paths run via Temporal workflows and persist run + per-tenant results.

## Rollout Order (Recommended)

1. Deploy schema + EE code with all Entra flags disabled.
2. Ensure Phase 1 flags exist using `ensure_entra_phase1_flags`.
3. Enable `entra-integration-ui` for internal test tenants only.
4. For test tenants needing CIPP, enable `entra-integration-cipp`.
5. Validate discovery and mapping quality on pilot tenants.
6. Enable `entra-integration-field-sync` only after field overwrite policy is approved.
7. Enable `entra-integration-ambiguous-queue` for support teams handling reconciliation.
8. Enable `entra-integration-client-sync-action` after mapping/sync operations are stable.
9. Expand tenant targeting incrementally.

Turning UI flags off hides Entra surfaces immediately without deleting connection/mapping/run history data.
