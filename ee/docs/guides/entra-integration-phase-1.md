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
- Subscription tier: Pro or Premium
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
- Available on Pro and Premium when the `entra-integration-cipp` flag is enabled for the tenant.
- Uses the classic CIPP API for managed tenant and user enumeration.
- Requires the **CIPP-API function app host** (for example `my-cipp-api.azurewebsites.net`) — not
  the CIPP frontend an operator signs into — and a **CIPP API key**, taken from
  Settings → CIPP → API access in CIPP itself. An Azure client secret is not this credential.
- Best when your MSP already uses CIPP and wants to reuse that API boundary.

Switching connection types automatically clears stale credentials for the previous type.

Both connect paths validate before they persist. The CIPP dialog tests the candidate credential
against the tenant list and keeps Save disabled until that test passes; the Direct OAuth callback
probes Microsoft Graph with the freshly exchanged token before writing anything, so a sign-in that
completes without admin consent leaves no connection record at all. A failed connect never disturbs
a connection the tenant already had.

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

Remaining flags:

- `entra-integration-client-sync-action`
- `entra-integration-cipp` — soft-launch control for the CIPP connection option

Retired flags. `entra-integration-ui` (the master gate), `entra-integration-field-sync`
and `entra-integration-ambiguous-queue` no longer exist. Access to the Entra surface is
edition + tier + RBAC only:

```
EE edition  +  assertTierAccess(TIER_FEATURES.ENTRA_SYNC)  [Pro+]  +  system_settings read/update
```

A tenant that fails the check gets the tier 403 from the API routes and an upgrade notice
on the route — there is no "disabled" 404 any more. Field rules and the review queue
render for every tenant that can reach the screen.

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
- Read the pre-consent disclosure: the exact Graph scopes with plain-English glosses, and the
  contact-effect contract (matched by email within the mapped client; unmatched become new
  contacts; existing fields are not overwritten unless enabled; nothing is ever deleted). It can be
  copied for a change record.
- Choose `direct` or `cipp` from the connection chooser, which states each option's prerequisites.
- For direct: confirm the interstitial (a Global Administrator must consent; the connection then
  runs as a service principal), complete OAuth, and the callback validates before persisting.
- For CIPP: enter the CIPP-API host and API key, press Test connection, then Save.

2. Discover Tenants
- Run discovery to populate managed Entra tenants.

3. Map Tenants to Clients
- Review `auto-matched`, `needs review`, and skipped rows.
- Confirm mappings explicitly (no hidden writes during preview).
- Importing a discovered tenant as a new client is confirmed, with a warning listing
  similarly-named existing clients.

4. Initial Sync
- Run initial sync once at least one mapping is confirmed.

## Sync Behavior and Safety Rules

Default behavior is additive/linking, not destructive:

- Email-normalized match links to existing contacts.
- No match creates new contact under mapped client.
- Multiple plausible matches queue reconciliation items.
- Name-only similarity does not auto-link.
- Sync never deletes contacts.
- Disabled/deleted upstream Entra users mark linked contacts inactive, and only while the
  `markInactiveWhenDisabled` rule is on. It defaults on (this was previously unconditional), and
  turning it off means a disabled Microsoft account leaves its contact alone.
- Contacts carry their provenance: the contact record shows that a directory maintains it, its
  sign-in name and last sync, and an inactive contact says whether the Microsoft account was
  disabled or deleted rather than leaving "Inactive" unexplained.

Field overwrite controls:

- Only fields enabled in `entra_sync_settings.field_sync_config` may overwrite local contact values.
- If a field toggle is off, local value remains authoritative.
- All overwrite rules default to off, and are visible to every tenant that can reach the screen
  (they used to be hidden behind a default-off feature flag).
- Editing a contact field that an enabled rule syncs warns inline, so the edit is not silently
  reverted by the next run.

## Manual Sync Paths

- Console header: `Sync now` starts the all-tenant workflow.
- Console → Clients: per-client preview and sync.
- Client details: `Sync Entra Now` starts the single-client workflow for a mapped client. Shown
  only to users who hold `system_settings:update`, which is what the server enforces.
- The setup wizard's last step is a pilot: preview one client, sync that one client, and the
  remaining clients unlock only once its run has completed.

All sync execution paths run via Temporal workflows and persist run + per-tenant results.

## After Setup: the Operations Console

Once one real sync has completed, the Entra route switches from the setup wizard to the
operations console and never switches back — a connection that later breaks is an attention item,
not a return to onboarding. Its tabs carry `?tab=` deep links:

- **Overview** — the attention list (broken connection, failing clients grouped by that one root
  cause, review-queue backlog, never-synced clients, automatic sync off), the last real sync, and
  schedule/connection/mapping state.
- **Sync & schedule** — automatic sync on/off and cadence. Writes `entra_sync_settings` and
  reconciles the tenant's Temporal schedule immediately. Automatic sync defaults to **off**.
- **Clients** — search, state filters, and per-client preview / sync / unlink.
- **Field rules** — the overwrite rules (all default off) and the named
  "mark contacts inactive when the Microsoft account is disabled" rule (defaults on, preserving
  the previous unconditional behaviour). "Preview effect" runs a preflight with the pending rules.
- **Review queue** — ambiguous matches, resolvable to an existing contact, to a new contact, or
  dismissed. A dismissal is recorded with actor, time and reason, and the identity is not queued
  again.
- **History** — filters by trigger and failures, pagination, CSV export, and runs identified by
  **client name** rather than Microsoft tenant GUID. Preflights appear labelled as previews.
- **Connection** — test, rotate the credential in place, export the connection record, disconnect
  (confirmed), and the tenant mapping table.

## Preflight (Preview Before Writing)

`POST /api/integrations/entra/sync/preflight` classifies every identity in one mapped client —
create / link / needs decision / mark inactive / no change — and writes nothing but an audit row
with `is_dry_run = true`. It runs the real reconciliation with writes disabled rather than a
parallel implementation, so its counts are the counts the following sync reports on unchanged
data. Dry runs are excluded from every health aggregate and from the setup→console switch.

## Notifications

Runs notify tenant admins when the sync needs a person: identities landing in the review queue,
and repeated failure (the second consecutive failed or partial run — one failed run is usually
transient). An optional per-run digest is off by default. Stored in
`entra_sync_settings.notification_config`.

## Rollout Order (Recommended)

1. Deploy schema + EE code. Entra is reachable by any Pro+ tenant with the permission,
   so the gate is tier, not a flag.
2. Ensure the remaining flag definitions exist using `ensure_entra_phase1_flags`.
3. Validate discovery and mapping quality on pilot tenants. The setup wizard's preflight
   previews contact changes for one client without writing anything, so this no longer
   requires a leap of faith.
4. For tenants needing CIPP, enable `entra-integration-cipp`. Its retirement is an ops
   decision — flip per tenant, then globally, then retire.
5. Enable `entra-integration-client-sync-action` after mapping/sync operations are stable.
6. Expand tenant targeting incrementally.

Field overwrite policy is no longer a rollout step: the rules ship visible and default to
off, so a tenant that has not opted in already has the safe behaviour. Turning
`entra-integration-cipp` off hides the CIPP connection option without deleting
connection/mapping/run history data.
