# Level.io RMM Integration — Design

**Date:** 2026-06-09
**Status:** Approved
**Provider key:** `levelio` · **Display name:** Level · **Edition:** EE-only · **Feature flag:** `levelio-rmm-integration`

## Summary

Add a Level.io RMM integration to Alga PSA, modeled on the existing NinjaOne/Tanium EE
integrations, with Temporal-first sync execution. v1 scope: connection management, Level
group → Alga client mapping, device/asset sync with cached live data, pending-patch counts
from Level's updates endpoint, alerts backfill, and an inbound alert webhook. No new
database tables or migrations — all RMM tables are provider-agnostic.

## Level API facts (v2 REST)

- Base URL fixed at `https://api.level.io` (SaaS; no per-instance URL).
- Auth: static API key sent in the `Authorization` header.
- Pagination: cursor-based (`starting_after`, `limit` 1–100, `has_more`).
- Resources used: `/v2/groups` (hierarchical; the org-mapping unit), `/v2/devices` (rich
  hardware/OS/security detail via `include_*` query flags; `role` of
  workstation/server/domain_controller; `online`, `last_seen_at`, `last_reboot_time`),
  `/v2/alerts` (severities information/warning/critical/emergency; active/resolved),
  `/v2/updates` (OS patch inventory, `status=available|installed`).
- Not available in the API: software inventory, remote access links, device control
  (reboot/run script), webhook registration. Level → Alga webhooks are configured manually
  in Level's automation builder as an HTTP POST action.
- Device list supports `group_id` (direct children) and `ancestor_group_id` (recursive)
  filters; the API has no modified-since filter, so there is no incremental sync.

## Architecture

### Identity & registration

Registration touchpoints (all additive):

| File | Change |
|---|---|
| `packages/types/src/interfaces/asset.interfaces.ts` | Add `'levelio'` to `RmmProvider` union |
| `ee/server/src/interfaces/rmm.interfaces.ts` | Add `'levelio'` to `RmmProvider` union |
| `packages/assets/src/actions/inboundActions.ts` | Add to `KNOWN_RMM_PROVIDERS` |
| `packages/integrations/src/lib/rmm/providerRegistry.ts` | New registry entry; extend `icon` and `featureFlagKey` unions and `RmmProviderAvailabilityContext` |
| `packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx` | Banner icon case, `useFeatureFlag('levelio-rmm-integration')`, dynamic import of EE settings component, `providerSettingsComponents` entry |
| `packages/assets/src/lib/rmmProviderDisplay.ts` | Display name/icon |
| `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx` | Provider icon |
| `packages/types/src/interfaces/rmmProvider.typecheck.test.ts` | Extend typecheck |

Registry entry: `requiresEnterprise: true`, `featureFlagKey: 'levelio-rmm-integration'`,
capabilities `{connection: true, scopeSync: true, deviceSync: true, events: true,
remoteActions: false}`.

### Auth & secrets

Tenant secrets via the secret provider: `levelio_api_key` (entered by the user) and
`levelio_webhook_secret` (generated server-side on first save). The `rmm_integrations` row
uses `provider = 'levelio'`, `instance_url = 'https://api.level.io'`.

### API client

`ee/server/src/lib/integrations/levelio/levelApiClient.ts`

- `LevelIoApiClient`, fetch-based, with a `listAll` cursor-pagination helper (limit 100).
- Methods: `listGroups()`, `listDevices({groupId?, ancestorGroupId?})` with all `include_*`
  detail flags enabled, `getDevice(id)`, `listAlerts({deviceId?, status?})`,
  `resolveAlert(id)`, `listUpdates({deviceId?, status?})`, `testConnection()`
  (`GET /v2/groups?limit=1`).
- Error mapping with user-facing hints: 401 → invalid API key, 429 → rate limited (respect
  `Retry-After`, bounded retries), HTML/non-JSON body → clear error.
- `createLevelIoClient(tenantId)` factory reads secrets; importable by both server actions
  and the Temporal worker (worker resolves `@ee/*` → `ee/server/src/*`).
- Local types for the response subset we consume: `LevelIoGroup`, `LevelIoDevice`,
  `LevelIoAlert`, `LevelIoUpdate`.

### Group → client mapping

- Scope sync lists all groups and upserts them into `rmm_organization_mappings`
  (`external_organization_id` = group id, name, parent group id in mapping metadata so the
  UI can render hierarchy paths such as "Acme Corp / Branch Office").
- Any group may be mapped to a client. During device sync each device is assigned to its
  **deepest mapped ancestor group**: fetch all groups once, build a parent map, walk each
  device's group chain upward to the nearest mapped group. Deterministic when both a parent
  and child are mapped. Devices with no mapped ancestor are skipped.
- One full device sweep per sync (no per-mapping API queries).

### Sync engine (single source of truth)

`ee/server/src/lib/integrations/levelio/sync/syncEngine.ts` — exported functions called by
both the direct transport and Temporal activities (NinjaOne worker pattern; no duplicated
logic):

- `runLevelIoScopeSync(tenantId, integrationId)` — groups → org mappings.
- `runLevelIoFullSync(tenantId, integrationId, options)` — full device sweep with detail
  includes → `ingestNormalizedRmmDeviceSnapshot` (shared service); then one sweep of
  `/v2/updates?status=available` grouped by `device_id` to fill `pending_os_patches`;
  updates `last_full_sync_at`.
- `runLevelIoDeviceSync(tenantId, integrationId, deviceId)` — single-device refresh
  (device + its available updates).
- `runLevelIoAlertsBackfill(tenantId, integrationId)` — active + resolved alerts upserted
  into `rmm_alerts` keyed on `(tenant, integration_id, external_alert_id)`.

Engine emits `RMM_SYNC_STARTED/COMPLETED/FAILED` (and device-level
`RMM_DEVICE_CREATED/UPDATED`) via the Redis stream client, so events fire identically under
both transports. DB access via `getAdminConnection()`.

### Device → snapshot mapping

`ee/server/src/lib/integrations/levelio/mappers/deviceMapper.ts` →
`NormalizedRmmExternalDeviceSnapshot`:

- Asset type: `role` server/domain_controller → `server`; workstation or null →
  `workstation`.
- Display name `nickname ?? hostname`; serial number; `online` → agent status
  online/offline; `last_seen_at` → lastSeenAt; city/country → location.
- Extension: `platform` → osType; `operating_system` → osVersion; `last_logged_in_user` →
  currentUser; uptimeSeconds computed from `last_reboot_time` (only while online);
  `last_reboot_time` → lastRebootAt; lanIp = first private IPv4 found on a non-virtual
  interface (interfaces whose description contains "virtual" are skipped; null if none); `cpus` →
  cpuModel/cpuCores; `total_memory` bytes → ramGb; `disk_partitions` → diskUsage
  (mount point/label, total/free GB, utilization); `security.antivirus_provider/status` →
  antivirus fields; pendingOsPatches from the updates sweep.
- `systemInfo` carries manufacturer, model, security_score, risk, maintenance_mode, tags,
  flag, group id.
- Alert severity: emergency → critical, critical → major, warning → moderate,
  information → minor.

### Temporal-first execution

- `ee/temporal-workflows/src/workflows/levelio-sync-workflow.ts`:
  `levelIoSyncWorkflow({tenantId, integrationId, syncType: 'organizations' | 'full' |
  'alerts', options})` and `levelIoDeviceSyncWorkflow({tenantId, integrationId, deviceId})`.
  Activity proxy options follow NinjaOne: `startToCloseTimeout: '1h'`,
  `heartbeatTimeout: '2m'`, retry max 2 attempts.
- `ee/temporal-workflows/src/activities/levelio-sync-activities.ts`: thin wrappers that
  import the sync engine via `@ee/*` and invoke it.
- Register both in `workflows/non-authored-index.ts` and `activities/non-authored-index.ts`.
  Task queue: `TEMPORAL_JOB_TASK_QUEUE` (default `alga-jobs`).
- Server actions route through the existing `runRmmSyncWithTransport()`
  (`ee/server/src/lib/integrations/rmm/sync/syncOrchestration.ts`) with **both executors
  implemented**. Transport resolution for this provider: `LEVELIO_SYNC_TRANSPORT` →
  `RMM_SYNC_TRANSPORT` → default **`temporal`** (Temporal-first; the direct executor remains
  for local development). Workflow IDs: `levelio:<op>:<tenant>:<integration>:<timestamp>`.

### Server actions

`ee/server/src/lib/actions/integrations/levelIoActions.ts` — `'use server'`, every action
wrapped in `withAdvancedAssetsAccess` (Tanium pattern):

`getLevelIoSettings`, `saveLevelIoConfiguration` (validates the key with a live test call
before persisting; generates webhook secret on first save), `testLevelIoConnection`,
`disconnectLevelIoIntegration` (deactivates row, removes secrets, publishes
`INTEGRATION_DISCONNECTED`), `syncLevelIoOrganizations`,
`listLevelIoOrganizationMappings`, `updateLevelIoOrganizationMapping`,
`triggerLevelIoFullSync`, `backfillLevelIoAlerts`, `syncLevelIoSingleDevice`,
`getLevelIoWebhookInfo`, `getLevelIoConnectionSummary`.

### Inbound webhook

`server/src/app/api/webhooks/levelio/route.ts` (Tactical pattern):

- `POST {baseUrl}/api/webhooks/levelio?tenant=<tenant>` with header
  `X-Alga-Webhook-Secret` checked against `levelio_webhook_secret`.
- Users configure this manually as an HTTP POST action in a Level automation; the settings
  UI documents a recommended JSON payload template:
  `{event, alert_id, device_id, hostname, name, severity, description}` where `event` is
  `alert.triggered` or `alert.resolved`.
- Handler: verify secret → upsert `rmm_alerts` → resolve asset via
  `tenant_external_entity_mappings` → publish `RMM_WEBHOOK_RECEIVED` → fire-and-forget
  single-device sync (start the Temporal workflow without awaiting the result; direct
  best-effort fallback when transport is direct). The webhook response never blocks on sync.

### Settings UI

`ee/server/src/components/settings/integrations/LevelIoIntegrationSettings.tsx`, modeled on
`TaniumIntegrationSettings`: API key entry; test/save/disconnect; sync buttons (groups,
devices, alerts backfill); org-mapping table with hierarchical group paths and client
dropdown; webhook info card with copyable URL/secret and Level automation setup
instructions; connection summary counts. Dynamic-imported from `RmmIntegrationsSetup` via
`@enterprise/components/settings/integrations/LevelIoIntegrationSettings`.

## Error handling

- Client: 401 → "invalid API key" hint surfaced in the settings UI; 429 → bounded retry
  honoring `Retry-After`; malformed/HTML responses → explicit error.
- Sync: per-device ingestion failures are counted (`items_failed`) and logged without
  aborting the sweep; sync-level failures emit `RMM_SYNC_FAILED` and set
  `sync_status = 'failed'` on the integration row.
- Webhook: bad tenant/secret → 400/401; unparseable payloads → 400 with no side effects;
  device-sync kick-off failures are swallowed (alert upsert already committed).

## Testing

Unit tests beside the existing ones in `ee/server/src/__tests__/unit/integrations/`:

- Device mapper: role → asset type, disk partition → diskUsage conversion, uptime from
  last reboot, severity mapping, null-heavy devices.
- Deepest-mapped-ancestor group assignment (parent+child mapped, unmapped device skipped).
- Client: cursor pagination, 429 retry, 401 error hint (mocked fetch).
- Transport resolution: env precedence and the `temporal` default for levelio.
- Extend `rmmProvider.typecheck.test.ts` for the new union member.

## Out of scope (v1)

- Alert → ticket rules engine (currently NinjaOne-specific).
- Remote actions / script execution / triggering Level automations
  (`POST /v2/automations/webhooks/{token}`).
- Software inventory (not exposed by Level's API).
- Incremental sync (no modified-since filter in the API).
- Resolving Level alerts from Alga (`POST /v2/alerts/{id}/resolve`) — easy follow-up.
- Custom field sync (`/v2/custom_fields`).
