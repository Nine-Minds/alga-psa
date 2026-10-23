# PRD — Datto RMM Integration (Community Edition)

> **Update 2026-10-22:** per Nine Minds' direction (integrations with paid services live in EE
> for now), the Datto-specific code moved to `ee/server/src` (`lib/integrations/datto`,
> `lib/actions/integrations/dattoRmmActions.ts`, `components/settings/integrations/`,
> `app/api/webhooks/datto`) behind `@enterprise` seams with CE stubs in `packages/ee/src`.
> The provider is `requiresEnterprise: true` and its actions are `ADVANCED_ASSETS` tier-gated
> like Level/NinjaOne. The contribution is Datto-only: the helpers once extracted from Tactical
> into `lib/rmm/common/*` live in the Datto module instead (Tactical is untouched), and no shared
> ingestion or alert-pipeline behavior changes for other providers. The CE-specific requirements
> below (FR-2 CE provider picker, "not enterprise-gated", the Tactical helper extraction) are
> superseded.

- Slug: `datto-rmm-integration`
- Date: `2026-10-19`
- Status: Draft
- Edition: **Community Edition** (not enterprise-gated), same as Tactical RMM

## Summary

Add Datto RMM (formerly CentraStage) as a Community Edition RMM provider, built on the same
structure as the Tactical RMM integration: a provider module under
`packages/integrations/src/lib/rmm/datto/`, a server-action module
`dattoRmmActions.ts`, a settings panel under **Settings → Integrations → RMM**, alert
ingestion into the shared `rmm_alerts` pipeline, scheduled device sync through the existing
`rmm-device-sync` job, and asset actions (refresh, Web Remote, run component) on the asset
detail page.

## Problem

CE ships exactly one RMM (Tactical). `RmmIntegrationsSetup.tsx` returns
`<TacticalRmmIntegrationSettings />` directly when EE is not available, so CE has no provider
picker. MSPs that run Datto RMM cannot import devices, map sites to clients, or turn RMM alerts
into tickets without an Enterprise license.

## Goals

1. Connect one Datto RMM account per tenant using an API key and secret (OAuth2 password grant).
2. Sync Datto **Sites** into `rmm_organization_mappings` and let admins map each site to an
   Alga client, with a suggested match from the site's `autotaskCompanyName` and `name`.
3. Sync Datto **Devices** into assets through the shared
   `ingestNormalizedRmmDeviceSnapshot` service. Include status, last seen, last user, IPs, OS,
   hardware (from the device audit), antivirus status, patch status, and reboot-required.
4. Ingest Datto **alerts** into `rmm_alerts` through `processRmmAlertEvent`. Polling via the
   reconciliation job is the guaranteed path. A webhook is an optional fast path.
5. Run scheduled device sync and alert polling through the existing job handlers.
6. Bulk-ingest **software inventory** from the device software audit.
7. Asset detail actions: Refresh, open **Web Remote**, and run a ComStore component as a
   quick job (including a configurable "reboot" component).
8. Optionally write back: resolve the Datto alert when the Alga ticket created from it closes.
9. Make the CE RMM tab a provider picker that lists every provider with
   `requiresEnterprise: false`.

## Non-goals

- Workflow actions (the Tactical equivalents live in `ee/packages/workflows`, so they are EE).
- Patch approval or patch policy management from Alga.
- Creating or editing Datto sites, variables, or UDFs from Alga (later phase).
- Datto Backup / Unitrends, Autotask, Sophos, and ConnectSecure. Each gets its own plan.
- Multiple Datto accounts per tenant (`rmm_integrations` is unique on `(tenant, provider)`).

## Users and primary flows

1. **Connect.** The admin picks the Datto platform region (Pinotage, Merlot, Concord, Vidal,
   Zinfandel, Syrah) or enters a custom API URL, then pastes the API key and secret, saves, and
   clicks **Test Connection**.
2. **Sync sites.** **Sync Sites** creates one mapping row per Datto site. The UI suggests an
   Alga client by matching the site name or Autotask company name. The admin confirms the client,
   sets the default notification contact and billing profile, and turns on Auto-sync.
3. **Sync devices.** **Sync Devices** imports devices from auto-sync sites. The scheduled sync
   is configured with the shared `RmmDeviceSyncSettings` card.
4. **Alerts.** The admin turns on alert polling (interval comes from the shared polling settings).
   Optionally, they configure a Datto webhook pointing at `/api/webhooks/datto`. Alert rules,
   maintenance windows, and ticket creation use the shared `RmmAlertAutomationSettings`.
5. **Asset page.** A technician clicks **Remote Access → Remote Desktop**, which opens the
   device's `webRemoteUrl`. They can also click **Refresh** or **Run component**.

## Datto RMM API facts (from the published v2 spec)

| Concern | Detail |
|---|---|
| Base URL | `https://{platform}-api.centrastage.net/api`. Platforms: pinotage, merlot, concord, vidal, zinfandel, syrah. |
| Auth | `POST {base}/auth/oauth/token`, HTTP Basic `public-client:public`, form body `grant_type=password&username={apiKey}&password={apiSecret}`. Bearer token lives about 100 h. Cache it and re-auth on 401. |
| Pagination | `?page=&max=` (max 250). The response has `pageDetails.nextPageUrl`. Follow it until null. |
| Rate limit | Per-account rolling window, readable at `GET /v2/system/request_rate`. Back off on 429 using `Retry-After` or exponential backoff. |
| Sites | `GET /v2/account/sites`. `Site{uid,id,name,description,autotaskCompanyId,autotaskCompanyName,onDemand,devicesStatus,portalUrl}` |
| Devices | `GET /v2/site/{siteUid}/devices`, `GET /v2/account/devices`, `GET /v2/device/{uid}`. `Device{uid,id,hostname,siteUid,deviceClass,deviceType,operatingSystem,a64Bit,online,lastSeen,lastReboot,lastAuditDate,lastLoggedInUser,intIpAddress,extIpAddress,antivirus,patchManagement,rebootRequired,suspended,deleted,warrantyDate,webRemoteUrl,portalUrl,cagVersion,displayVersion,udf}` |
| Hardware | `GET /v2/audit/device/{uid}`, which returns `bios`, `baseBoard`, `systemInfo`, `processors`, `physicalMemory`, `logicalDisks`, `nics`. Printers use `/v2/audit/printer/{uid}` and ESXi hosts use `/v2/audit/esxihost/{uid}`. |
| Software | `GET /v2/audit/device/{uid}/software` (paged) |
| Alerts | `GET /v2/account/alerts/open`, `GET /v2/site/{uid}/alerts/open`, `GET /v2/alert/{uid}`, `POST /v2/alert/{uid}/resolve`. `Alert{alertUid,priority(Critical/High/Moderate/Low/Information/Unknown),alertContext{@class,...},alertMonitorInfo,alertSourceInfo{deviceUid,deviceName,siteUid,siteName},timestamp(epoch ms),resolved,resolvedOn,ticketNumber}` |
| Jobs | `PUT /v2/device/{uid}/quickjob` `{jobName, jobComponent{componentUid, variables[]}}`, `GET /v2/job/{uid}/results/{deviceUid}`, `.../stdout`, `.../stderr`. Only ComStore components already in the account can run. |
| Permissions | API users with a restricted security level get `403` on `/v2/account/*`. Test Connection must say which permission is missing. A site-by-site fallback is possible through `/v2/account/dnet-site-mappings` (see Open Questions). |
| Timestamps | Epoch **milliseconds** everywhere. |

## Requirements

### Functional requirements

**FR-1 Provider registration**
- Reuse the existing `'datto'` slug. It is already in `RmmProvider`
  (`packages/types/src/interfaces/asset.interfaces.ts`, `server/src/interfaces/asset.interfaces.tsx`,
  `ee/server/src/interfaces/rmm.interfaces.ts`), `getRmmProviderDisplayName`, and
  `KNOWN_RMM_PROVIDERS`. Change the display name to "Datto RMM".
- Add a registry entry to `providerRegistry.ts` with `requiresEnterprise: false`, icon `'datto'`,
  and capabilities `{connection, scopeSync, deviceSync, events, remoteActions}` all true.
- Add `'datto'` and `'datto_rmm'` to `RESERVED_INBOUND_WEBHOOK_INTEGRATION_TYPES`.
- Add `datto: 'Datto RMM'` to the provider label map in `shared/rmm/alerts/ticketCreator.ts`.

**FR-2 CE provider picker**
- In `RmmIntegrationsSetup.tsx`, replace the CE branch that returns
  `<TacticalRmmIntegrationSettings />` with the same list/detail picker EE uses. It is fed by
  `getAvailableRmmProviderRegistry({ isEnterprise: false })`. Map `datto` →
  `DattoRmmIntegrationSettings` and add a provider chip (`DRMM`).
- Keep `?rmmProvider=` deep links working. Existing Tactical e2e tests must still pass. They
  assume CE lands directly on the Tactical panel, so either update their navigation or keep
  auto-select when only one provider is available.

**FR-3 Connection and credentials**
- `rmm_integrations` row `provider='datto'`, with `instance_url` set to the normalized API base
  and `settings` JSON holding `{platform, deviceSync, alertPolling, rebootComponentUid,
  softwareIngest, webhookEnabled}`.
- Tenant secrets: `datto_rmm_api_key`, `datto_rmm_api_secret`, `datto_rmm_access_token`,
  `datto_rmm_access_token_expires_at`, `datto_rmm_webhook_secret`. Never return them to the
  browser and mask them in the UI (same as `tacticalRmmSettings.maskSecret`).
- Test Connection calls `GET /v2/account`, then `GET /v2/account/sites?max=1`. It reports the
  account name, device count, and any 403 permission gap.
- Disconnect clears the secrets, sets `is_active=false`, keeps the mappings, and cancels the
  scheduled jobs (same behavior as Tactical).
- When the client gets a 401 even after a fresh token, mark the integration
  `reconnectRequired` so the polling and sync gates in `rmmAlertPollingHandlers.ts` skip it.

**FR-4 Site sync and mapping**
- `syncDattoRmmSites` upserts `rmm_organization_mappings` with
  `external_organization_id=site.uid` and `external_organization_name=site.name`. Store
  `{id, autotaskCompanyId, autotaskCompanyName, onDemand, portalUrl}` in its metadata.
- Suggest a client by case-insensitive exact match on `autotaskCompanyName`, then on `name`,
  against `clients.client_name`. Show it as a suggestion; the admin confirms it. Never
  auto-assign.
- Use the shared mapping UX: `ClientPicker`, default contact, billing profile, auto-sync,
  `RmmOrganizationClientChangeDialog` (moving assets when the client changes), and
  `RmmUserContactMappingPanel`.
- Leave on-demand sites unmapped with auto-sync off by default.

**FR-5 Device sync**
- `runDattoRmmDeviceSync({tenant}, {syncType: 'full'|'incremental', since?})` walks
  `GET /v2/site/{uid}/devices` for each auto-sync mapping and normalizes each device to
  `NormalizedRmmExternalDeviceSnapshot`. It writes through `ingestNormalizedRmmDeviceSnapshot`,
  not a copy of Tactical's bespoke 900-line engine.
- Asset type mapping comes from `deviceType.category` and `deviceClass`:
  Server → `server`; Desktop/Laptop → `workstation`; `deviceClass='printer'` and network
  device / `rmmnetdevice` → `network_device`; ESXi host → `server`; Mobile → `mobile_device`;
  everything else → `unknown`. Unknown falls back to workstation as Tactical does.
- `agentStatus`: `online` → `online`, otherwise `offline`. `suspended` maps to lifecycle
  `offline`. `deleted` maps to `tombstoned`. If a device has vanished, leave its asset in place
  (Tactical parity).
- Extension fields:
  - `currentUser` ← `lastLoggedInUser`
  - `lanIp` ← `intIpAddress`
  - `wanIp` ← `extIpAddress`
  - `osType`/`osVersion` ← `operatingSystem`
  - `agentVersion` ← `displayVersion`
  - `lastRebootAt` ← `lastReboot`
  - `uptimeSeconds` = now − `lastReboot`
  - `antivirusStatus`/`antivirusProduct` ← `antivirus.antivirusStatus`/`antivirusProduct`
  - patch status ← `patchManagement` (`patchStatus`, `patchesApprovedPending`, `patchesNotApproved`, `patchesInstalled`)
  - `systemInfo` also gets `{rebootRequired, warrantyDate, webRemoteUrl, portalUrl, datto_device_id, udf}`
- Hardware enrichment: when `lastAuditDate` differs from the value stored on the mapping, call
  `GET /v2/audit/device/{uid}`. Map `bios.serialNumber` → serial, `systemInfo.manufacturer`/`model`
  → make/model, `processors[0].name` → cpuModel, `sum(physicalMemory.size)` → ramGb, and
  `logicalDisks` → diskUsage. Skip the audit call when `lastAuditDate` is unchanged so sync stays
  inside the rate limit.
- Link each device in `tenant_external_entity_mappings`
  (`integration_type='datto'`, `external_entity_id=device.uid`). Record the numeric `device.id`
  in metadata, because some Datto UIs and webhooks reference it.
- Incremental sync: Datto has no server-side delta, so do the same page walk and filter on
  `lastSeen >= since` or `lastAuditDate >= since`. This is the same approach as
  `tacticalAgentChangedSince`.
- `deviceSyncStrategy.ts` exports `dattoRmmDeviceSyncStrategy`. It wraps the run in
  `runWithTenant` and throws when `success` is false so the job cursor does not advance (copy the
  Tactical comment). Register it in `ensureDeviceSyncStrategiesRegistered` without the
  `@enterprise` alias. Add `'datto'` to `RMM_DEVICE_SYNC_PROVIDERS`.
- `syncDattoSingleDeviceForTenant({tenant, deviceUid})` serves Refresh and webhooks.
- Publish the `rmm` sync events with the same `publishRmmSyncEvent` helper Tactical uses.

**FR-6 Alerts**
- `alertFetcher.ts` (`dattoRmmAlertFetcher`) pages `GET /v2/account/alerts/open`, restricted to
  mapped site uids, and maps each alert with `mapDattoAlertToEvent`:
  - `externalAlertId` = `alertUid`
  - `externalDeviceId` = `alertSourceInfo.deviceUid`
  - `externalOrganizationId` = `alertSourceInfo.siteUid`
  - `deviceName` = `alertSourceInfo.deviceName`
  - `conditionIdentity` = `alertContext['@class']` + `alertMonitorInfo` identity (dedup key)
  - `alertClass` = `alertContext['@class']`, short name such as `perf_disk_usage_ctx`
  - severity: Critical→critical, High→major, Moderate→moderate, Low→minor, Information/Unknown→none
  - `occurredAt` = epoch-ms `timestamp` → ISO
  - `message` built from `diagnostics` plus context fields
  - `activityType`/`sourceType` = `'datto_alert'`
- Register the fetcher as a module side effect and in `ensureFetchersRegistered`. Add `'datto'`
  to `RMM_ALERT_POLLING_PROVIDERS`. Reconciliation resolves Alga alerts that no longer appear
  in the open list.
- Webhook (optional): `server/src/app/api/webhooks/datto/route.ts`. It authenticates with
  `tenant` in the query plus the `X-Alga-Webhook-Secret` header, compared in constant time.
  It dedupes on `rmm_webhook_events (tenant, 'datto', alertUid + event)`. It accepts a JSON body
  that carries at least `alertUid` and `deviceUid`, then calls `GET /v2/alert/{uid}` for the
  authoritative record and sends it through the same mapper. A resolve event (or
  `resolved=true` on the fetched alert) produces kind `reset`. Afterwards it triggers a
  single-device refresh. Suspended tenants get a 200 no-op, as in the Tactical route. Add the
  route to `exactApiKeySkipPaths` in `server/src/middleware.ts` (Level pattern, exact match).
- The settings page shows the webhook URL, secret, and a JSON body template that uses Datto's
  alert placeholders.
- Backfill: **Sync Alerts** runs the fetcher once (Tactical's `backfillTacticalRmmAlerts`
  pattern).
- Outbound (phase 6): `registerRmmAlertOutboundAdapter('datto', …)` resolves the Datto alert
  through `POST /v2/alert/{uid}/resolve` when the linked ticket closes. Gate it behind a settings
  toggle that defaults to off, because it needs an API user with write rights.

**FR-7 Software inventory**
- `ingestDattoRmmSoftwareInventory` calls `GET /v2/audit/device/{uid}/software` for each mapped
  device and writes `software_catalog` / `asset_software` through a provider-neutral helper
  hoisted out of `tacticalRmmActions.ts` (see FR-10). Throttle it with a concurrency limit, and
  only re-ingest devices whose `lastAuditDate` advanced. It can also run on a schedule as an
  opt-in step of the device sync.

**FR-8 Asset device actions**
- `datto/assetDeviceActions.ts` exports `dattoRmmAssetDeviceActions`, wired into
  `resolveRmmAssetDeviceActions`:
  - `refresh` → single-device sync
  - `remoteControlTypes` → `['splashtop']` (rendered as "Remote Desktop") when `webRemoteUrl`
    exists
  - `remoteControlUrl('splashtop')` → `webRemoteUrl`, read fresh from `GET /v2/device/{uid}`
  - `reboot` → quick job using `settings.rebootComponentUid`. If none is configured, throw a
    clear "configure a reboot component" error.
  - `runScript(ref, componentUid)` → `PUT /v2/device/{uid}/quickjob`; returns `{ jobId }`
- Add `datto: ['splashtop']` to `RemoteAccessButton.providerTypes`.
- Gate `runScript` and `reboot` on the existing RMM execute-command permission (migration
  `20260623090000_add_rmm_execute_command_permission`).

**FR-9 Settings UI**: `DattoRmmIntegrationSettings.tsx`, with the same section order as Tactical:
1. Connection: platform select plus custom URL, API key, API secret (masked), Save, Test, Disconnect
2. Status summary: connected, last sync, site/device/alert counts, last error
3. Sites & mapping: Sync Sites, mapping DataTable, suggested-client chip
4. Devices: Sync Devices, Ingest Software, shared `RmmDeviceSyncSettings`
5. Alerts: polling toggle and interval, Sync Alerts, webhook URL/secret/template, outbound resolve toggle
6. Asset actions: reboot component UID input with a component lookup when `/v2/account/components` is permitted
7. Shared `RmmAlertAutomationSettings` and `RmmUserContactMappingPanel`
- Translation keys go under `integrations.rmm.datto.*` in the same namespace Tactical uses.

**FR-10 Shared refactors (do these first, no behavior change)**
- Move `tenantScopedTable`, `publishRmmSyncEvent`, and `axiosErrorToMessage` out of
  `tacticalrmm/deviceSync.ts` into `packages/integrations/src/lib/rmm/common/`. Leave
  re-exports in place so Tactical imports keep working.
- Move the software-catalog upsert helpers (around line 920 of `tacticalRmmActions.ts`) into
  `common/softwareInventory.ts`.

### Non-functional requirements

- Rate limits: one shared token-bucket per tenant client. Concurrency is at most 4 for audit and
  software calls. Honor 429 and `Retry-After`. Log the request count per sync.
- Large estates: page at 250 and stream ingestion per page. A 5k-device full sync must finish
  inside the job timeout. Record timing in SCRATCHPAD during smoke tests.
- Every DB access uses `tenantDb(knex, tenant)` or `runWithTenant` (Citus distribution key).
- Errors shown in the UI must not contain secrets or tokens.
- Unit coverage mirrors `server/src/test/unit/tacticalrmm/*`, with recorded Datto fixtures.

## Data / API / integrations

- **No schema migration is required.** `rmm_integrations.provider` is a free `varchar(50)`
  (its comment already names `'datto'`). The asset cached columns, `rmm_alerts`,
  `rmm_organization_mappings`, `rmm_webhook_events`, and `tenant_external_entity_mappings`
  are all provider-agnostic.
- Exception: if any CHECK constraint or seeded enum lists providers, add `'datto'` to it. Grep
  migrations for `tacticalrmm` during phase 0 and confirm.
- New files:
  ```
  packages/integrations/src/lib/rmm/common/{db.ts,events.ts,errors.ts,softwareInventory.ts}
  packages/integrations/src/lib/rmm/datto/
    dattoApiClient.ts      # OAuth token cache, pagination, 429/401 handling, platform URL normalize
    buildClient.ts         # buildDattoClientForTenant(tenant) from rmm_integrations + secrets
    shared.ts              # platforms list, secret keys, types safe for client components
    mappers.ts             # device → snapshot, audit → hardware, alert → NormalizedRmmAlertEvent
    siteSync.ts
    deviceSync.ts
    deviceSyncStrategy.ts
    syncSingleDevice.ts
    alertFetcher.ts
    alertOutbound.ts       # phase 6
    softwareIngest.ts
    assetDeviceActions.ts
  packages/integrations/src/actions/integrations/dattoRmmActions.ts
  packages/integrations/src/components/settings/integrations/DattoRmmIntegrationSettings.tsx
  server/src/app/api/webhooks/datto/route.ts
  docs/integrations/datto-rmm.md
  server/src/test/unit/dattormm/*.test.ts
  ee/server/src/__tests__/integration/integrations-datto-*.playwright.test.ts
  ```
- Server actions in `dattoRmmActions.ts` mirror the Tactical names, and each wraps `withAuth` plus
  `hasPermission(user,'system_settings',read|update)`:
  `getDattoRmmSettings`, `getDattoRmmConnectionSummary`, `saveDattoRmmConfiguration`,
  `testDattoRmmConnection`, `disconnectDattoRmmIntegration`, `syncDattoRmmSites`,
  `listDattoRmmSiteMappings`, `updateDattoRmmSiteMapping`, `syncDattoRmmDevices`,
  `getDattoRmmWebhookInfo`, `backfillDattoRmmAlerts`, `ingestDattoRmmSoftwareInventory`,
  `syncDattoRmmSingleDevice`, `listDattoRmmComponents`.
- Export the new public modules from `packages/integrations/src/actions/index.ts` and from
  package.json `exports` subpaths (e.g. `./lib/rmm/datto/deviceSyncStrategy`) so the jobs
  package can import them.

## Security / permissions

- Every settings action requires `system_settings`. Device actions that execute code require the
  RMM execute-command permission.
- Webhook: the shared secret goes in a header, never in the query string. Compare it in constant
  time. The tenant id in the query is not a secret. Unknown tenant or bad secret → 401 with no
  detail.
- Recommend a dedicated Datto API user. Read-only covers sync, alerts, and software. Write rights
  are needed only for alert resolve and quick jobs. Document the minimum security level.

## Observability

- Integration status shows `sync_status`, `sync_error`, `last_sync_at`, and
  `last_incremental_sync_at` (existing columns and settings).
- Structured logs per run carry `{tenant, provider:'datto', pages, devices, auditCalls, softwareCalls, http429s, durationMs}`.

## Rollout

- Phase 0 (refactor + CE picker) ships first and has to stay green on the existing Tactical tests.
- Datto ships as one CE feature, with no feature flag beyond the provider registry entry.
- Release note and admin doc go in `docs/integrations/datto-rmm.md`.

## Open questions

1. **Webhook payload/headers.** Can Datto's alert webhook response action set a custom header?
   If it cannot, fall back to an HMAC-style path token (`/api/webhooks/datto/{token}`) as the
   inbound-webhooks module does, rather than putting the secret in the query string. Verify
   against a real account in phase 4. Polling ships regardless.
2. **Restricted API users.** Should we implement the `dnet-site-mappings` per-site fallback (as
   the local `rmm` skill does) when `/v2/account/*` returns 403, or simply require an
   account-read API user? Recommendation: require it in v1 and show a precise error.
3. **Slug.** Reuse `'datto'` (already in every union) or rename it to `'dattormm'` so it does not
   collide with future Datto backup/Autotask work? Recommendation: keep `'datto'`, and use
   distinct slugs (`datto_backup`, `autotask`) for the other products.
4. **Remote-control enum.** Reuse `'splashtop'` as the "Remote Desktop" type (Tactical
   precedent) or add `'web_remote'`? Recommendation: reuse it in v1.

## Acceptance criteria

- In a CE build, Settings → Integrations → RMM lists Tactical RMM and Datto RMM. Neither has an
  Enterprise badge.
- Connecting with valid credentials and running Test Connection shows the account name. Invalid
  credentials show an auth error, and a restricted user shows a permission error.
- After Sync Sites, mapping two sites, and Sync Devices, the mapped sites' devices appear as
  assets with the correct client, type, status, serial, make/model, and last user.
- With polling on, an open Datto alert for a mapped device appears in `rmm_alerts` within one
  interval. When it resolves in Datto, it is resolved in Alga on the next run.
- Scheduled device sync runs at the configured interval and updates `last_incremental_sync_at`.
- Remote Desktop opens the Datto Web Remote URL. Refresh updates the asset. Run component returns
  a job id.
- All new unit tests and the Tactical regression suite pass.
