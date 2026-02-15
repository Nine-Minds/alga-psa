# PRD — Tactical RMM Integration

- Slug: `tacticalrmm-integration`
- Date: `2026-02-13`
- Status: Draft

## Summary

Add a Tactical RMM integration that works in both Community Edition (CE) and Enterprise Edition (EE). The integration should:

- Connect to a Tactical RMM instance using either API key auth or username/password (Knox token) auth (including optional TOTP).
- Sync Tactical inventory into Alga Assets (clients/sites/agents -> clients/assets + mappings).
- Support near-real-time updates via Tactical alert-action webhooks (alerts only), plus optional alert backfill via the Tactical alerts API.
- Fit the existing multi-provider RMM platform patterns established by the NinjaOne integration (shared DB tables, org mapping, device sync, asset fields).

## Problem

Alga currently has an RMM integration pattern (NinjaOne) that syncs devices and supports webhooks, but it is EE-oriented and provider-specific. We want to support Tactical RMM as an additional provider, available in both CE and EE, and integrate it cleanly into the existing Assets system and the “RMM” Integrations settings tab.

## Goals

1. CE + EE: Tactical RMM appears in Settings -> Integrations -> RMM and can be configured in both editions.
2. Connection management:
   - Support Tactical API key auth.
   - Support Tactical username/password auth with TOTP handling (checkcreds + login).
   - Store credentials securely (tenant secrets) and show masked status in UI.
3. Inventory sync:
   - Sync Tactical Clients into `rmm_organization_mappings`.
   - Map Tactical Clients to Alga Clients (companies) via UI.
   - Sync Tactical Agents into Alga Assets using the beta API at fleet scale.
4. Asset enrichment:
   - Populate core RMM fields on `assets` (`rmm_provider`, `rmm_device_id`, `rmm_organization_id`, `agent_status`, `last_seen_at`, `last_rmm_sync_at`).
   - Populate cached “RMM vitals” fields when available (current user, uptime, LAN/WAN IP).
   - Add support for Tactical’s “overdue” state (distinct from offline).
5. Realtime (alerts):
   - Provide a webhook endpoint for Tactical alert actions with shared-secret header validation.
   - On webhook receive, upsert `rmm_alerts` and trigger a targeted “sync single agent” refresh.
6. Optional: alerts backfill via Tactical alerts API for historical visibility.

## Non-goals

- Remote access (MeshCentral / remote background): explicitly deferred.
- Full “device created/updated/deleted” webhooks (Tactical doesn’t provide them natively; only alerts).
- Patch deployment / remediation (scan + display only, if we even include scan hooks).
- Deep ticket-automation parity with NinjaOne (auto ticket creation/rules) unless explicitly requested later.

## Users and Primary Flows

Primary user: MSP admin / system admin configuring integrations.

Flows:
1. Configure Tactical:
   - Open Settings -> Integrations -> RMM -> Tactical RMM.
   - Enter instance base URL.
   - Choose auth mode:
     - API key: paste key, save, verify.
     - Username/password: enter creds, if TOTP required prompt for code, login, store token.
2. Sync Tactical Clients:
   - Click “Sync Clients” (organizations).
   - Map Tactical Clients to Alga Clients (companies) in an org mapping table.
3. Sync Assets:
   - Click “Sync Devices”.
   - Alga upserts Assets and extension records and creates external mappings.
4. Realtime alerts:
   - Admin copies webhook URL + secret, configures Tactical alert-action webhook with `X-Alga-Webhook-Secret`.
   - Alerts trigger/resolve -> Alga receives webhook -> stores alert -> refreshes affected asset.
5. Optional: “Sync Alerts” to backfill alerts from Tactical.

## UX / UI Notes

- Tactical RMM should appear next to NinjaOne under the Integrations “RMM” category tab.
- Settings card should match the “feel” of NinjaOne settings:
  - Status panel (connected/disconnected, last sync, counts).
  - Credential management section (masked + update).
  - Sync buttons.
  - Organization mapping section.
  - Webhook section (URL, header name, secret, payload template).
- Since Tactical is CE + EE, the Tactical settings UI must not rely on EE-only dynamic imports.

## Requirements

### Functional Requirements

1. Connection status
   - Show whether Tactical is configured and reachable.
   - Show instance URL and auth mode.
2. Credential storage
   - Store and retrieve per-tenant credentials via secret provider.
   - Mask secrets in UI (show only last 4 chars).
3. Sync clients (organizations)
   - Fetch Tactical Clients via beta API.
   - Upsert `rmm_organization_mappings` for provider `tacticalrmm`.
4. Org mapping management
   - Allow selecting an Alga Client for each Tactical Client mapping.
   - Persist `auto_sync_assets` toggles.
5. Sync devices (agents)
   - For each mapped Tactical Client:
     - fetch sites (paged) and agents (paged and filtered by `client_id`).
     - upsert `assets` + extension data.
     - upsert `tenant_external_entity_mappings` for the agent.
     - mark missing agents as inactive (optional; see Open Questions).
6. Agent status mapping
   - Compute `online|offline|overdue` using the provided deterministic rules from `last_seen`, `offline_time`, `overdue_time`.
   - Persist status to `assets.agent_status`.
7. Realtime alerts via webhooks
   - Provide `POST /api/webhooks/tacticalrmm`.
   - Validate `X-Alga-Webhook-Secret`.
   - Accept a small JSON contract (required: `agent_id`; optional: `alert_id`, `event`, `severity`, `message`, `alert_time`, `client_id`, `site_id`).
   - Upsert `rmm_alerts` and associate to an asset when possible.
   - Trigger “sync single agent” after alert receives/resolves.
8. Alert backfill (optional but planned)
   - Use Tactical alerts endpoint to fetch active/recent alerts and upsert into `rmm_alerts`.
9. Software inventory ingestion (bulk, cached)
   - Use Tactical `GET /software/` to ingest cached software inventory without per-agent refresh.

### Non-functional Requirements

- Fleet-scale pagination: use beta endpoints with `page_size=1000` and loop pages.
- Resilience:
  - Handle 401 by re-authing (username/password mode) or failing with actionable error (API key mode).
  - Avoid per-agent “refresh” calls by default (software refresh is expensive).
- Multi-provider safety: Tactical must not break NinjaOne; providers must co-exist in the same tenant.

## Data / API / Integrations

Tactical endpoints (assume base URL `https://<tactical-host>`):

- Auth (username/password):
  - `POST /api/v2/checkcreds/` `{ username, password }` -> `{ totp: true }` or short-lived token
  - `POST /api/v2/login/` `{ username, password, twofactor? }` -> Knox token response
  - Auth header: `Authorization: Token <knox_token>`
- Auth (api key):
  - Auth header: `X-API-KEY: <key>`
- Inventory (beta API):
  - `GET /api/beta/v1/client/`
  - `GET /api/beta/v1/site/?page_size=1000&page=N`
  - `GET /api/beta/v1/agent/?client_id=<client_pk>&page_size=1000&page=N`
- Alerts:
  - `PATCH /api/alerts/` with filter body for backfill/top-N
- Software:
  - `GET /api/software/` bulk cached software inventory
  - `PUT /api/software/<agent_id>/` per-agent refresh (non-goal by default)

Alga DB tables involved:
- `rmm_integrations` (one row per tenant+provider; store instance_url, is_active, settings JSON including webhook secret and auth mode).
- `rmm_organization_mappings` (Tactical Client PK mapped to Alga Client).
- `assets` + extension tables (workstation/server fields; cached “vitals” fields already exist).
- `tenant_external_entity_mappings` (agent_id crosswalk; store client/site in metadata).
- `rmm_alerts` for alert ingestion and association.

## Security / Permissions

- Configuration actions require settings permissions (same posture as NinjaOne).
- Secrets stored in tenant secret store (never in plaintext in DB tables).
- Webhook endpoint is unauthenticated but must require shared-secret header and be explicitly enabled/configured by admin.

## Observability

- Minimal: structured logs for sync start/finish/errors and webhook receives.
- (Optional) publish existing event-bus events where appropriate (RMM_WEBHOOK_RECEIVED, RMM_DEVICE_UPDATED, etc.) to align with NinjaOne patterns.

## Rollout / Migration

- Add `tacticalrmm` provider to RMM provider unions in Typescript.
- Potential migration if we choose to add new agent status value (`overdue`) to UI filters and any code expecting only online/offline/unknown.
- Ensure `/api/webhooks/tacticalrmm` is added to API auth middleware skip paths.

## Open Questions

- Should we treat Tactical “overdue” as a first-class `agent_status` enum value everywhere (recommended), or map it to `offline`?
- Do we support marking assets as inactive when agents disappear from Tactical (requires a “full inventory snapshot” delete detection)?
- Asset type mapping: do we classify Tactical agents as workstation vs server based on OS string heuristics, or introduce a Tactical-specific mapping override?
- Should alert backfill be limited to “active only” or allow recent resolved (time window)?

## Acceptance Criteria (Definition of Done)

1. Tactical RMM is visible and configurable in CE and EE under Integrations -> RMM.
2. Admin can connect using API key or username/password (with TOTP when required), and connection status is shown.
3. Admin can sync Tactical Clients and map them to Alga Clients.
4. Admin can sync Tactical Agents into Alga Assets; assets show provider + agent status + last seen where available.
5. Tactical alert-action webhook can be configured with custom headers; Alga validates `X-Alga-Webhook-Secret`, records alerts, and refreshes the affected asset.
6. Optional: alerts backfill and bulk software inventory ingestion work without per-agent refresh calls.
