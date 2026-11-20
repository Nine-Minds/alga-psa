# UniFi integration: device sync to assets, offline alerts to tickets

- PSA ticket: alga-2026-0002579
- Branch: `feature/alga-2026-0002579-unifi-integration-alerts-devic`
- Base: `main` @ d6dc22c273
- Status: initial implementation exists in PR #3711 at `347097f12e3b625538aaec7bd848f804e44fe3c9`. Offline-alert architecture requires the next-round revision in §8 before approval.
- Review revision: 2026-11-03 (America/New_York).

## 1. Request

From Discord #feature-requests (qcomer 2026-09-10, Hamish 2026-08-31), and listed as a nice-to-have by a prospect moving off Halo:

1. When a UniFi device goes offline, create a ticket, and resolve it when the device comes back.
2. Sync UniFi devices (gateways, switches, access points) into Alga assets under the right client.

There's no UniFi or Ubiquiti code in the repo today; the `unifi` grep hits are all `unified`. Until this ships, the workaround is to send UniFi alert emails into an inbound email rule that extracts the client.

## 2. What already exists (code-grounded)

Alga already has a provider-agnostic RMM layer. Level.io (`levelio`) is the newest provider built on it, so it's the template to follow. UniFi plugs into the same layer as a new provider. Retain the shared alert-to-ticket pipeline and the network-device ingestion extension in §4.3. The next round also requires a shared observation-to-condition lifecycle and a revision of the reconciliation boundary, described in §8.

| Concern | Existing substrate | Path |
|---|---|---|
| Provider id union | `RmmProvider` | `packages/types/src/interfaces/asset.interfaces.ts:24` (duplicate at `server/src/interfaces/asset.interfaces.tsx:24`) |
| Provider catalogue and capabilities | `RMM_PROVIDER_REGISTRY` | `packages/integrations/src/lib/rmm/providerRegistry.ts` |
| Integration row, org/site → client mapping, alerts, rules | `rmm_integrations` (unique per tenant+provider), `rmm_organization_mappings`, `rmm_alerts`, `rmm_alert_rules`, `rmm_maintenance_windows` | `server/migrations/20251124000001_create_rmm_integration_tables.cjs`, `20260612090000_rmm_alert_handling_corrections.cjs`, `20260619120000_add_default_contact_to_rmm_org_mappings.cjs` |
| Normalized device → asset upsert | `ingestNormalizedRmmDeviceSnapshot()` (writes `assets`, `tenant_external_entity_mappings`, and the workstation/server extension tables) | `shared/rmm/sharedAssetIngestionService.ts`, `shared/rmm/contracts.ts` |
| Alert → ticket pipeline | `processRmmAlertEvent()` handles maintenance windows, rule evaluation, dedup, ticket creation, auto-resolve on reset, and notifications | `shared/rmm/alerts/*` |
| Poll-based alerts | `RmmActiveAlertFetcher` and `runRmmAlertReconciliation()`. Active remote alerts are ingested; poller-ingested local alerts that are no longer active get a synthesized `reset` | `shared/rmm/alerts/reconciliation.ts` |
| Scheduling | `rmm-alert-reconciliation` and `rmm-device-sync` recurring jobs. Provider allow-lists are `RMM_ALERT_POLLING_PROVIDERS` and `RMM_DEVICE_SYNC_PROVIDERS`; registration goes through `ensureFetchersRegistered()` and `ensureRmmDeviceSyncStrategies()` with dynamic `@enterprise` imports | `packages/jobs/src/lib/handlers/rmmAlertPollingHandlers.ts` |
| Sync transport (direct / Temporal) | `runRmmSyncWithTransport()`, env `UNIFI_SYNC_TRANSPORT` / `RMM_SYNC_TRANSPORT` | `ee/server/src/lib/integrations/rmm/sync/syncOrchestration.ts`; Level's Temporal pair is `ee/temporal-workflows/src/{workflows/levelio-sync-workflow.ts,activities/levelio-sync-activities.ts}` |
| Settings UI host | `RmmIntegrationsSetup` (icon map at line 34, dynamic EE settings component at lines 128 and 148), plus the shared `RmmDeviceSyncSettings` | `packages/integrations/src/components/settings/integrations/` |
| Level reference implementation | client, mapper, sync engine, strategy, webhook route, actions, settings UI | `ee/server/src/lib/integrations/levelio/**`, `ee/server/src/lib/actions/integrations/levelIoActions.ts`, `ee/server/src/app/api/webhooks/levelio/route.ts`, `ee/server/src/components/settings/integrations/LevelIoIntegrationSettings.tsx` |
| CE stubs | the CE build gets an empty or 404 version of each EE module | `packages/ee/src/**/levelio/**` and `packages/ee/src/components/settings/integrations/LevelIoIntegrationSettings.tsx` |
| Tier gate | `withAdvancedAssetsAccess` → `assertTierAccess(TIER_FEATURES.ADVANCED_ASSETS)` + `system_settings` RBAC | `levelIoActions.ts:87` |

## 3. UniFi API surface

Ubiquiti offers three official APIs. All of them use API keys; the legacy cookie-based controller API is out of scope.

| API | Base | Use in this integration |
|---|---|---|
| **Site Manager (cloud)** | `https://api.ui.com/v1/` with header `X-API-KEY` | `GET /v1/hosts` (consoles), `GET /v1/sites` (sites with `hostId`), `GET /v1/devices` (devices grouped by host, with status, model, MAC, IP, firmware). One key covers every console the UI account or organization can see, which is how MSPs operate. |
| **Cloud Connector proxy** | `https://api.ui.com/v1/connector/consoles/{hostId}/proxy/network/integration/v1/...` | Per-site Network Integration API calls through the cloud, with no inbound access to the customer's site. Used for site-accurate device lists. |
| **Network Integration API (local)** | `https://{console}/proxy/network/integration/v1/` with a local `X-API-KEY` | `GET /sites`, `GET /sites/{siteId}/devices`, `GET /sites/{siteId}/devices/{id}` (state, ports, uplink, firmware). This is the only option for self-hosted controllers without cloud access. |

Design choice: **Site Manager key + Connector proxy is the default connection mode.** It needs a single credential per MSP, makes no inbound network requirement on customer sites, and covers Ubiquiti-hosted, UniFi OS console, and UniFi OS Server deployments. **Local Integration API** is a second connection mode (base URL + key) for controllers that aren't linked to a UI account. Both modes feed the same normalized client interface, so nothing downstream knows which one was used.

## 4. Design

### 4.1 Provider identity

- Add `'unifi'` to all three `RmmProvider` union copies (`packages/types/src/interfaces/asset.interfaces.ts:24`, `server/src/interfaces/asset.interfaces.tsx:24`, `ee/server/src/interfaces/rmm.interfaces.ts:9`). Add a `// LEVERAGE: pattern rmm-provider-union` marker. The duplicated union is a missing single source, and every new provider pays for it.
- Add a registry entry `{ id: 'unifi', title: 'UniFi', icon: 'unifi', capabilities: { connection, scopeSync, deviceSync, events: true, remoteActions: false }, requiresEnterprise: true }` and widen the `icon` union. Add an icon badge to `RmmIntegrationsSetup.tsx`.
- No DB enum changes are needed: `rmm_integrations.provider` and `assets.rmm_provider` are `varchar(50)`.
- Update the `register_rmm_alert_system_events` payload description text in a new migration only if the schema registry validates provider values. Today it's free text, so no change.

### 4.2 Scope model: UniFi site → Alga client

- Scope is the UniFi **Network site**, and `externalScopeId` is `{hostId}:{siteId}`. MSPs commonly run either one console per customer (one site) or one self-hosted or hosted controller with many sites, each a customer. Mapping at the site level handles both. Mapping at the host level would get the second case wrong.
- `rmm_organization_mappings.external_organization_id = '{hostId}:{siteId}'`, with `external_organization_name` set to the site description and the console name. The existing mapping UI, `default_contact_id`, and auto-create-client behaviour carry over as in Level.
- Scope sync runs `GET /v1/sites` (cloud mode) or `GET /sites` (local mode) and upserts the mappings. Unmapped sites aren't ingested; the shared service already returns `skipped: No mapped client`.

### 4.3 Device sync → assets

**Client** `ee/server/src/lib/integrations/unifi/unifiApiClient.ts`
- Secrets in the tenant secret provider: `unifi_api_key`, plus `unifi_local_base_url` when in local mode. `rmm_integrations.settings` holds `{ connectionMode: 'site_manager' | 'local', deviceSync, alertPolling, offlineGraceMinutes }`. The client never logs the key.
- Handle rate limits: the Site Manager API returns 429 with `Retry-After`. Honour it with bounded retries, then fail fast with an actionable error. On 401/403, set `settings.reconnectRequired` so the job handlers' `isIntegrationReconnectRequired()` stops scheduling against a dead key, matching the existing behaviour.
- Pagination: follow the cursor or offset params of each endpoint. List calls must not silently truncate.

**Mapper** `ee/server/src/lib/integrations/unifi/mappers/deviceMapper.ts` turns a UniFi device into a `NormalizedRmmExternalDeviceSnapshot`:
- `externalDeviceId` is the UniFi device id. Fall back to the normalized MAC when cloud mode only exposes MAC. MAC is the stable hardware identity and survives re-adoption.
- `assetType: 'network_device'` for every adopted UniFi device. Add `unifiDeviceKind` to metadata, derived from features or productLine: `gateway` → `router` (or `firewall` for UXG/UDM Pro class), `switch` → `switch`, `accessPoint` → `access_point`.
- `serialNumber` comes from the serial if exposed, otherwise MAC. `displayName` is the device name, falling back to model + MAC. `location` is the site name. `agentStatus` is `online`/`offline` from `state`. `lastSeenAt` is set where present. `lifecycleState`: `ONLINE` → `active`, `OFFLINE` / `DISCONNECTED` → `offline`. A device missing from the full listing → `deleted`, which the engine handles (see "Engine" below).
- `metadata`: `{ mac, model, productLine, firmwareVersion, firmwareUpdatable, ipAddress, hostId, siteId, uplinkDeviceId }`.

**Network-device ingestion revision.** `sharedAssetIngestionService.pickExtensionTable()` returns `null` for `network_device`, so `network_device_assets` (`device_type`, `management_ip`, `firmware_version`, `port_count`, `supports_poe`, `port_config`; migration `20241112031335`) is never populated by any RMM today. Revise the engine instead of adding a UniFi side-write:
- Extend `NormalizedRmmDeviceExtensionSnapshot` with an optional `networkDevice?: { deviceType: 'switch'|'router'|'firewall'|'access_point'|'load_balancer'; managementIp?; firmwareVersion?; portCount?; supportsPoe?; portConfig? }`.
- `upsertAssetExtension()` gains a `network_device_assets` branch. `device_type` is NOT NULL, so the branch must reject (fail fast) a network-device snapshot that has no `deviceType` rather than inserting a default.
- Unit tests go in `packages/integrations/src/lib/rmm/sharedAssetIngestionService.test.ts`. NinjaOne and Tanium also emit `network_device` and would benefit in follow-ups. They aren't changed here.
- MAC, model, and uplink are written as `asset_facts` (`source_type: 'rmm'`, `provider: 'unifi'`, `namespace: 'unifi'`) via `upsertAssetFact()` in `packages/assets/src/lib/assetFactsService.ts`. That makes them visible in the existing inventory provenance UI without adding columns to `assets`.

**Engine** `ee/server/src/lib/integrations/unifi/sync/syncEngine.ts`, modelled on `levelio/sync/syncEngine.ts`:
- `runUniFiScopeSync`, `runUniFiDeviceSync` (full: list mapped sites → list devices → ingest each), and `runUniFiSingleDeviceSync`.
- The full sync tombstones devices that were previously mapped for this integration but are absent from a *successful, complete* listing of their site. A site whose listing failed must never tombstone (fail closed).
- Update `rmm_integrations.last_sync_at`, `sync_status`, and `sync_error`, following the Level pattern.
- The UniFi APIs have no `updated_since` filter, so `deviceSyncStrategy.ts` (`RmmDeviceSyncStrategy.syncDevicesIncremental`) runs a full sync and ignores `since`. Device counts per MSP are in the hundreds to low thousands, so this is fine.
- Transport goes through `runRmmSyncWithTransport({ provider: 'unifi', ... })`. A Temporal workflow and activity pair mirrors Level's, so large tenants can opt in with `UNIFI_SYNC_TRANSPORT=temporal`.

### 4.4 Offline alerts → tickets

**Revision precedence:** §8 supersedes the lifecycle mechanics below: inventory omission as recovery, integration-wide failure handling, synthetic triggers used to hold uncertain alerts, and UniFi-specific observation state in settings. The original design below records the first implementation; retain its provider metadata, rules, scheduling, UI, and outbound-adapter behavior where compatible with §8.

UniFi has no general alert-list API, but **device state is the alert**. The existing reconciliation substrate is a natural fit:

**`RmmActiveAlertFetcher` for `unifi`** (`ee/server/src/lib/integrations/unifi/alerts/reconciliationFetcher.ts`): one call lists devices across mapped sites. Every device whose state is not online becomes a `triggered` event:
- `activityType: 'DEVICE_OFFLINE'`, `alertClass: unifiDeviceKind`, `sourceType: 'unifi_device_state'`, `conditionIdentity: 'device_offline'`.
- `severity`: `critical` for gateways, `major` for switches, `moderate` for access points. Tenants override this through rules (`severities`, `alertClasses`) and `priorityOverride`.
- `externalDeviceId` and `externalOrganizationId = {hostId}:{siteId}`, so the pipeline resolves the asset, client, and default contact.
- **`externalAlertId` must be per outage, not per device.** `processRmmAlertEvent` reuses a resolved row with the same `external_alert_id` and clears its `ticket_id`, which would erase outage history. The fetcher therefore reuses the id of an existing `active`/`acknowledged`/`suppressed` `rmm_alerts` row for `(integration, device, DEVICE_OFFLINE)` when there is one. Otherwise it mints `unifi:offline:{deviceId}:{firstObservedAtISO}`. Each outage gets its own row and ticket.
- When the device is back online it drops out of the active set. `runRmmAlertReconciliation` then synthesizes the `reset` (these events carry the reconciliation ingest marker), and rule `autoResolveTicket` closes the untouched ticket. Maintenance windows suppress offline tickets during planned work at no extra cost.

**Debounce (flap protection).** `settings.offlineGraceMinutes` (default 5). The fetcher emits a device only once its offline state has persisted for that long. Use the device's last-seen or state-change timestamp when the API provides one; otherwise use a first-observed marker kept in `rmm_integrations.settings.unifiOfflineObservations[deviceId]` and pruned whenever the device is seen online. The reconcile interval comes from the existing `settings.alertPolling.intervalMinutes`, and the default for UniFi is 5 min.

**Scheduling.** Add `'unifi'` to `RMM_ALERT_POLLING_PROVIDERS` and `RMM_DEVICE_SYNC_PROVIDERS`, and register through dynamic `@enterprise/lib/integrations/unifi/...` imports in `ensureFetchersRegistered()` and `ensureDeviceSyncStrategiesRegistered()`, with CE stubs exporting `undefined`. Each provider adds another hand-written registration block here; add `// LEVERAGE: pattern rmm-provider-registration` beside it.

**Outbound adapter.** None: UniFi has no alert to reset. `resetAlertOnTicketClose` is therefore a no-op for UniFi, and the rule editor should hide or disable the option when `provider === 'unifi'`.

**Phase 2 (optional, after the spike in §6): Alarm Manager webhook.** UniFi Network 9.x Alarm Manager can POST to a custom webhook on "device offline/online". Adding `/api/webhooks/unifi` would cut ticket latency from the poll interval to seconds. It would use the Level route shape (tenant query param + `X-Alga-Webhook-Secret` compared with `crypto.timingSafeEqual`; note the Level route at `ee/server/src/app/api/webhooks/levelio/route.ts:52` uses `!==`, which is a separate hardening follow-up), plus the CE 404 stub and a `server/src` re-export. Webhook events would be normalized to the same `externalAlertId` scheme so the poller and webhook dedupe against each other. The poller remains the source of truth for resets.

### 4.5 Server actions

`ee/server/src/lib/actions/integrations/uniFiActions.ts`, mirroring `levelIoActions.ts` one-for-one and wrapped with `withAdvancedAssetsAccess` + `system_settings` read/update:
- `getUniFiSettings`, `saveUniFiConfiguration` (mode, key, local base URL; validates by calling `/v1/hosts` or `/sites` before saving)
- `testUniFiConnection`, `disconnectUniFiIntegration` (deletes secrets, deactivates the integration, unschedules jobs)
- `syncUniFiSites`, `listUniFiSiteMappings`, `updateUniFiSiteMapping`
- `triggerUniFiFullSync`, `syncUniFiSingleDevice`
- `runUniFiAlertCheckNow` (calls `runRmmAlertReconciliation` directly, like `tacticalRmmActions.ts:806`)
- `getUniFiConnectionSummary`
- CE stubs in `packages/ee/src/lib/actions/integrations/` if the Level pattern has them; follow whatever Level does.

### 4.6 UI

`ee/server/src/components/settings/integrations/UniFiIntegrationSettings.tsx`, plus the CE stub and registration in `RmmIntegrationsSetup.tsx`:
- Connection card: mode toggle (Site Manager / Local controller), API key input (masked; shows a "key saved" state and never echoes the key back), base URL for local mode, Test and Disconnect buttons.
- Site mapping table: the existing org-mapping table pattern, relabelled "UniFi site". Columns are console, site, client picker, and default contact.
- Device sync settings: reuse `RmmDeviceSyncSettings`.
- Alerting card: polling interval, offline grace minutes, a "Check now" button, and a link to the shared alert rules and maintenance window editors, which already exist per integration.
- Every interactive element needs a unique `id` (`unifi-*`). Use `@alga-psa/ui` components and theme tokens, and add i18n keys in the same `msp/integrations` namespace and locale files that Level uses, in all shipped locales.

### 4.7 Asset UI

UniFi assets render through the existing RMM-managed asset path (`assetSignals.ts`: `managed = Boolean(asset.rmm_provider)`). `assetRmmActions.ts` `providerLabel` needs a `unifi` → "UniFi" label. Remote actions stay off: the capability is `false`, so `resolveRmmAssetDeviceActions('unifi')` returns none. Confirm the network-device detail panel shows the newly populated `network_device_assets` fields. If no panel reads that table today, adding one is a follow-up and not in scope.

## 5. Delivery slices (each independently mergeable, behind the EE gate)

1. **Substrate:** `'unifi'` in the unions, registry, and icon; the `network_device_assets` branch in shared ingestion, with tests.
2. **Connect and scope:** client (both modes), secrets, actions, settings UI connection card, site sync and mapping.
3. **Device sync:** mapper, engine, strategy, job registration, Temporal pair, asset facts, tombstoning.
4. **Offline alerts:** shared observation-to-condition lifecycle and reconciliation revision (§8), UniFi adapter, per-outage ids and grace, job registration, rule-editor tweak for `resetAlertOnTicketClose`, alerting card.
5. **(Optional) Alarm Manager webhook.**
6. **Docs:** user guide in the website docs following `alga-business-documentation`, covering creating a Site Manager API key, mapping sites, and recommended alert rules.

## 6. Test plan

The next-round behavioral acceptance suite in §8.3 is required in addition to these original checks. Recovery for derived device conditions must be based on explicit healthy evidence, not inventory omission.

Unit tests go in `ee/server/src/__tests__/unit/integrations/unifi*.test.ts`, mirroring the `levelio*` tests:
- Mapper: gateway, switch, and AP map to the correct `deviceType`, severity, and `network_device` extension. Offline states map to `offline`. MAC fallback ids are normalized (lowercase, colon-separated).
- Client: pagination across pages; 429 with `Retry-After` is retried and then raises an actionable error; 401 sets reconnect-required; the key never appears in errors or logs.
- Engine: an unmapped site is skipped; a complete listing tombstones a missing device; a failed site listing tombstones nothing.
- Fetcher: grace window suppresses until elapsed; an existing active row's id is reused; a new outage after reset mints a new id, giving two rows and two tickets.
- Shared ingestion: a `network_device` snapshot upserts `network_device_assets`; a missing `deviceType` throws.

Integration tests use the `integration-testing` skill DB harness and mirror `levelioAlertGroupScoping.integration.test.ts`. Offline poll → ticket created for the mapped client and asset. Back-online poll → synthesized reset → untouched ticket auto-closed. Maintenance window → suppressed, no ticket. Device moved to another site → asset `client_id` changes and contact is cleared (existing behaviour).

Jobs: extend `rmmScheduleConvergence.test.ts` and `rmmDeviceSyncHandler.test.ts` provider lists. `rmmTenantScoped.contract.test.ts` should cover the new actions.

Manual smoke: connect a real Site Manager key (or a UniFi OS Server VM in local mode), map a site, run a sync, see assets appear, unplug an AP, wait for the ticket, plug it back in, and see the ticket close.

## 7. Open questions

1. **API verification spike (blocks slice 2).** Confirm against developer.ui.com, using a real key, that (a) the Connector proxy is enabled for API-key callers on all three console types and its rate limits fit an MSP-sized poll, (b) whether `/v1/devices` or the Integration API exposes a state-change or last-seen timestamp (this decides whether grace needs our own first-observed marker), and (c) whether devices expose a serial or only MAC. If the Connector proxy isn't available, cloud mode falls back to host-level scopes from `/v1/devices`, which loses per-site mapping on multi-site controllers.
2. **Product scope.** Should "offline" also cover the console/host itself (`/v1/hosts` status) and ISP/WAN degradation (`/v1/isp-metrics`)? This plan covers adopted devices only. Host-offline is cheap to add as `alertClass: 'console'`.
3. **Tier.** Plan assumes EE plus the `ADVANCED_ASSETS` entitlement, matching Level, NinjaOne, and Tanium. Should UniFi be CE like Tactical RMM instead, since it's a network inventory and not a paid RMM?
4. **Client devices.** Wi-Fi and wired *clients* (laptops, phones) are explicitly out of scope; only UniFi infrastructure becomes assets. Confirm.

## 8. Next-round revision: shared lifecycle for observed conditions

### 8.1 Assessment and evidence

Review basis: PR #3711 at `347097f12e3b625538aaec7bd848f804e44fe3c9`, compared with main at `85d41c2779`. The existing rules, maintenance windows, deduplication, ticket creation, notifications, and untouched-ticket auto-resolution are the correct downstream integration. Keep those capabilities in `shared/rmm/alerts`.

The missing layer converts observations into durable conditions. A device inventory is not an authoritative active-alert feed. Absence from an inventory response does not establish recovery. The UniFi fetcher currently embeds a condition lifecycle inside `RmmActiveAlertFetcher`, including first-observed timestamps, grace, outage IDs, open-alert lookups, uncertainty handling, and persistence in `settings.unifiOfflineObservations`.

Concrete findings:

1. **False recovery on omission.** In `ee/server/src/lib/integrations/unifi/alerts/reconciliationFetcher.ts`, the empty-site guard covers only `devices.length === 0`. If a previously offline device disappears from a nonempty inventory, its alert is omitted and `runRmmAlertReconciliation` synthesizes a reset. An isolated runtime probe using the actual fetcher and reconciler with mocked database/API dependencies reproduced that reset. Removing a site's client mapping has the same omission problem by code inspection.
2. **Failure crosses client boundaries.** A listing failure for any mapped site aborts the entire fetch before any events reach the pipeline. A runtime probe with an offline device in one successful site and an error in a second site produced zero ingested events. A failed scope must preserve its existing alerts without blocking other successful scopes.
3. **Unknown observations become triggers.** Updating, restarting, and unknown states reuse an existing outage ID but emit another `triggered` event solely to keep the alert alive. A runtime probe confirmed this for `UPDATING`. Holding a condition must not assert a fresh firing observation or enter ticket-creation processing solely because the observation is uncertain.
4. **Lifecycle state is provider-specific.** The fetcher reads open `rmm_alerts` rows to recover outage identity and rewrites a whole JSON observation map in integration settings. The shared lifecycle must own durable state and concurrency semantics instead of requiring each adapter to reproduce them.

Current main already provides `RmmActiveAlertSnapshot.heldExternalAlertIds` and `fetchActiveAlertSnapshot` in `shared/rmm/alerts/reconciliation.ts`. Datto uses them in `ee/server/src/lib/integrations/datto/alertFetcher.ts` to distinguish filtered or unmapped alerts from cleared alerts. Build on that capability. Preserve authoritative provider alert-feed behavior while adding explicit evidence and scope semantics for derived conditions.

These findings are code review and isolated runtime-probe evidence. They do not replace the recorded simulator walkthrough, and they do not establish live UniFi API semantics. Existing happy-path smoke results do not cover these cases.

### 8.2 Required design and implementation scope

Use three composable layers:

| Layer | Responsibility |
|---|---|
| Provider observation adapter | Fetch and normalize device identity, scope, state, observation time, and trustworthy provider timestamps; report which scopes were successfully observed. |
| Shared condition lifecycle | Persist healthy/pending/firing state, first-observed time, stable outage identity, grace evaluation, uncertainty, and explicit recovery. |
| Existing RMM alert pipeline | Apply rules, maintenance windows, deduplication, ticket creation, notifications, and configured recovery actions. |

The shared lifecycle must satisfy these requirements:

- Key state by tenant, integration, scope, subject, and condition identity. UniFi is the first observation-derived provider; the core must not branch on UniFi or store its state in a UniFi settings property.
- Distinguish explicit healthy, explicit failing, uncertain/missing, and no-longer-managed observations. Unknown or missing observations cannot resolve an existing outage. Scope removal must have an explicit management transition that preserves history and does not masquerade as recovery.
- Start a pending condition from confirmed failing evidence. Apply the configured grace before opening an outage. Explicit healthy evidence clears pending state or resolves a firing condition. Define how observation gaps affect pending grace; elapsed time without a trustworthy observation must not by itself emit a trigger.
- Preserve an existing outage during uncertain observations without sending a synthetic trigger. Process successful scopes independently while retaining state for unavailable scopes. An unreachable controller is not proof that every device behind it is offline or healthy; controller/WAN alerting remains the separate product-scope question in §7.
- Maintain one stable ID per outage and a new ID after confirmed recovery followed by another outage. Retry and repeated polling must not duplicate tickets or detach previous ticket history.
- Persist runtime state independently of configuration. Define atomic state transitions, idempotent delivery to the existing pipeline, and protection against concurrent manual/scheduled polls and stale observations. Fetch remote data outside database transactions.
- Preserve active alert IDs, ticket links, and pending first-observed times when transitioning existing UniFi data to the new representation. State the initialization/migration policy explicitly; do not reset or re-ticket existing outages during migration. Remove the legacy observation-map write path once migrated.
- Keep the existing alert rules, maintenance behavior, severity mapping, and asset/client association. Keep device-sync and alert semantics consistent without making alerting depend on asset sync being enabled.

Before implementation, specify the observation contract, transition table, persistence model, migration policy, and ideal UniFi call site. Revise the existing reconciliation contract where needed. This is a focused shared-layer revision; unrelated provider-registration cleanup, a generic workflow language, and migrating every provider to derived conditions are outside this round.

### 8.3 Acceptance criteria and behavioral verification

The next round is complete only when the following behaviors are implemented and verified:

- [ ] Offline observations inside grace produce no ticket; a fresh confirmed offline observation after grace produces one outage and one ticket for the mapped client.
- [ ] Repeated polling preserves the outage ID and ticket. Explicit online recovery resolves the alert and closes only an eligible untouched ticket under the configured rule. A later outage creates new history without rewriting the prior ticket link.
- [ ] A missing device in a nonempty response, an empty response, an unknown/updating state, and an unmapped site do not synthesize recovery. Holding uncertainty alone does not create or recreate a ticket.
- [ ] One failed site preserves its conditions while another successful site's trigger and recovery both proceed. A successful later poll resumes processing the failed scope without losing outage identity.
- [ ] Concurrent manual/scheduled polls, retries, restart/reload, and stale observations cannot overwrite newer state, duplicate an outage/ticket, or resurrect a recovered outage.
- [ ] Migration preserves pending grace timestamps, active outage IDs, ticket links, and resolved history. Tenant, integration, and scope boundaries remain isolated.
- [ ] Existing maintenance-window, rule, auto-resolution, and native provider alert-feed behavior remains correct. Include regression coverage for Datto held alerts and the shared reconciliation path.
- [ ] Run DB-backed integration tests against the migrated schema: at least a complete offline-to-ticket-to-recovery journey and a failure/guard case. Exercise persistence/concurrency with real database queries. Source-string, import-presence, and wiring assertions are not substitutes.
- [ ] Re-run the UniFi simulator walkthrough with missing-device, partial-site-failure, uncertain-state, and repeated-outage cases added. Record any remaining live-controller/API validation limits separately.

The next implementation round must commit this plan revision with the implementation and refresh the review evidence. This section records the required revision; it does not mark the current implementation approved or the new criteria complete.

### 8.4 Implementation contract

#### Observation contract and transitions

An adapter returns observations grouped by independently successful scope. Each device observation carries `scope`, stable `subject`, `conditionIdentity`, provider observation time, normalized evidence (`failing`, `healthy`, or `uncertain`), and the normalized alert attributes needed by the existing pipeline. A successful scope is authoritative only for subjects explicitly returned; omission is `missing`, never healthy. A failed scope has no subject evidence. Scope-management changes are explicit `managed`/`unmanaged` transitions and do not imply recovery. Native alert feeds continue to use the existing active/held external-alert snapshot contract.

| Current state | Evidence | Next state | Delivery |
|---|---|---|---|
| absent/healthy, or unmanaged without an outage | confirmed failing | pending with first trusted failure time | none |
| pending | confirmed failing, observation fresh, elapsed grace met | firing with a new stable outage ID | one triggered transition |
| pending | confirmed failing before grace | pending; update ordered evidence | none |
| pending | healthy | resolved/healthy | none |
| pending | uncertain, missing, failed scope | pending unchanged | none |
| firing | failing | firing; refresh ordered evidence and attributes | no new outage; if an earlier trigger remains suppressed, append one retryable recheck for the same alert ID |
| firing | healthy | resolved; retain outage and ticket link | one reset transition |
| firing | uncertain, missing, failed scope | firing unchanged | none |
| any | scope becomes unmanaged | unmanaged while retaining condition/outage history | no reset |
| unmanaged with an outage | later managed + failing | firing with the same outage and external alert IDs | resume the pending trigger or maintenance recheck |
| unmanaged with an outage | later managed + uncertain | unmanaged; retain the pending delivery and outage identity | none |
| unmanaged with an outage | later managed + healthy | healthy; the old trigger becomes obsolete | one reset transition |

Grace is measured from the first and latest trustworthy failure evidence. If a poll gap makes the adapter unable to prove continuous failure, a new failing observation becomes a new pending anchor; downtime alone never matures pending state. For UniFi, the continuity bound is the maximum of five minutes, twice the configured grace, and twice the configured alert polling interval (five minutes by default). A provider-supplied trustworthy state-change timestamp may anchor the interval only when the preceding evidence is still within that bound. Persist both the latest ordered observation (including uncertain, missing, unavailable, and unmanaged outcomes) and the latest trusted healthy/failing evidence timestamp; only the latter controls grace. Evidence ordering is per condition and uses request-start timestamps so a late stale response cannot override a newer poll; duplicate equal-timestamp fingerprints are idempotent, while conflicting equal-timestamp payloads are recorded as uncertain and cannot transition state.

#### Persistence and delivery

Use a tenant-distributed condition table keyed uniquely by `(tenant, integration_id, scope_key, subject_key, condition_key)` and a durable transition outbox keyed by `(tenant, transition_id)`. State stores management/evidence state, last trusted evidence time/fingerprint, pending anchor, current outage ID, current attributes, and timestamps. Outage IDs are allocated once when the atomic pending-to-firing transition wins; transition rows retain the serialized normalized event and delivery status. All reads and writes include the tenant shard key and integration ID. No foreign key crosses distributed/reference tables.

Remote fetches happen before any transaction. For each result, a short transaction locks the condition row, rejects stale evidence, changes condition state, and inserts a transition row atomically. The unique condition key serializes overlapping polls and ensures only one pending-to-firing winner appends a trigger. Unmanaged transitions use the scope-mapping snapshot start time and the same row lock, so a stale unmapping poll cannot overwrite newer evidence. Transition rows have a per-condition sequence allocated under that lock. A poll exposes only the oldest pending transition for a condition; a later outage cannot enter ticket deduplication until the prior outage's recovery has committed through the pipeline and been acknowledged. Competing consumers may receive that same head transition, while alert-row locking and idempotent acknowledgement make its processing safe. Delivery runs after commit and passes the stable external alert ID through `processRmmAlertEvent`; if delivery fails, the durable outbox remains pending. Each outbox acknowledgement uses its unique `transition_id`, since a trigger, recheck, and recovery can share an external alert ID. Fresh confirmed failing evidence appends at most one pending recheck per outage only while the linked alert is suppressed, so the pipeline can reconsider maintenance eligibility; active alerts do not generate periodic rechecks, uncertainty never appends one, and no recheck allocates another outage. Trigger/recheck delivery locks the same condition row in the pipeline transaction that writes the alert and ticket, and delivery requires the condition to remain firing. A concurrent recovery or management removal therefore suppresses a stale trigger/recheck. Replaying a trigger after recovery marks the obsolete outbox row delivered without invoking ticket creation. Current condition ownership and pending transition ownership exclude lifecycle alert IDs from omission-based alert-feed resets; ownership lookups are limited to candidate active local alert IDs and pending outbox rows and use tenant/integration indexed queries. Only the explicit healthy transition may recover lifecycle-owned alerts. Native provider alert feeds retain omission reconciliation. Pipeline event identity remains the same across retries, so its existing alert deduplication prevents duplicate tickets. Recovery transitions reference the exact outage ID they close.

Trigger delivery has three dispositions: deliver for the current firing outage, defer for that outage while unmanaged, and obsolete after recovery or replacement by a different outage. The outbox drain and transactional pipeline guard use the same decision. A deferred head remains pending and blocks later transitions for that condition; reconciliation reports no ingestion, publishes no trigger, and leaves the transition unacknowledged. Remapping alone or uncertain observations do not resume delivery. A fresh failing observation restores firing state and permits the original pending transition to run with its original outage ID. Explicit healthy evidence supersedes it and permits recovery delivery. Alert/client association is resolved inside the pipeline transaction after acquiring the condition lock.

The shared API is conceptually `reconcileConditionObservations({ tenantId, integrationId, observations, successfulScopes, unmanagedScopes, grace })`, which returns durable pending transitions for the existing RMM pipeline to deliver. Adapters own provider fetch/normalization and per-scope success; the shared lifecycle owns state/order/outbox; the existing pipeline owns rules, maintenance, deduplication, tickets, notifications, and recovery policy. UniFi fetches each mapped site independently, emits failing/healthy/uncertain evidence for recognized infrastructure devices, and marks only successfully listed sites authoritative. Asset sync remains irrelevant to alert scope.

#### Legacy migration and initialization

Add a schema migration for condition state and outbox; provider registration does not remove this need. A retry-safe initializer, serialized by locking the tenant/integration row and condition uniqueness, imports `settings.unifiOfflineObservations` as pending anchors keyed by the mapped site scope and device ID. It imports each active `DEVICE_OFFLINE` `rmm_alerts` row as firing using its existing `external_alert_id`; `metadata.scopeKey` wins, then the external entity mapping's realm, then a deterministic `legacy-unknown:<device>` scope. Unknown legacy scopes are held without being treated as removed management scopes. If incomplete metadata requires the fallback scope, the first matching device observation in a mapped scope rekeys that state while preserving its outage and external alert IDs. Existing rmm alert rows remain the history/ticket authority and are never rewritten to a new external ID. Resolved rows remain untouched as resolved history in `rmm_alerts`; incomplete metadata never causes a replacement ticket. Backfill conflict behavior is `do nothing` for already initialized keys, and the settings JSONB key is removed only after imports commit. Concurrent initializers serialize; reconnect/settings JSONB updates preserve all unrelated configuration.

#### Validation and remaining evidence

Behavioral tests cover transition semantics plus the migrated PostgreSQL schema, tenant isolation, transaction races, outbox retry/restart, pipeline outcomes, held native alerts, and maintenance/rule behavior. The simulator walkthrough is a separate review artifact: verify missing-device, partial-site-failure, uncertain-state, and second-outage scenarios with expected condition/outbox/rmm_alert/ticket rows. Do not claim browser or live-controller acceptance from these server-independent checks.

## Appendix A. Provider touchpoint checklist

Every place a new RMM provider must be registered, taken from a full sweep of `levelio` occurrences outside its own module. No migration is needed: `rmm_integrations.provider` is `varchar(50)` with no CHECK constraint, and Level shipped without one.

**Types and catalogue**
- The three `RmmProvider` unions.
- `providerRegistry.ts`: icon union at line 20, plus the registry entry.
- `packages/types/src/interfaces/rmmProvider.typecheck.test.ts`.

**Display maps**
- `packages/assets/src/lib/rmmProviderDisplay.ts:13`
- `packages/assets/src/actions/inboundActions.ts:9-17` (`KNOWN_RMM_PROVIDERS`)
- `shared/rmm/alerts/ticketCreator.ts:240-246` (`PROVIDER_LABELS`)
- `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx:3923` (icon case)

**Settings UI**
- `RmmIntegrationsSetup.tsx`: `PROVIDER_ICON_STYLES` (providers show as lettered circles, e.g. `'U'`), the `dynamic()` import, and the component map.
- `RmmDeviceSyncSettings.tsx:29` (`DEVICE_SYNC_SUPPORTED_PROVIDERS`).
- Embed `<RmmDeviceSyncSettings provider="unifi">` and `<RmmAlertAutomationSettings provider="unifi">` the same way `LevelIoIntegrationSettings.tsx:539,542` does.
- CE stub component, and add it to `tools/i18n/unwired-baseline.json`.

**Jobs**
- `rmmAlertPollingHandlers.ts`: `RMM_ALERT_POLLING_PROVIDERS` (line 50), `RMM_DEVICE_SYNC_PROVIDERS` (line 63), fetcher and strategy registration, and the provider filter in `reconcileRmmPollingSchedules` (around line 676).
- CE stubs under `packages/ee/src/lib/integrations/unifi/`.
- After a successful connect, call the reconciler the way `ninjaoneActions.ts:501` does, so schedules exist without waiting for the maintenance tick.

**Temporal**
- Workflow and activity pair, exported from `ee/temporal-workflows/src/{workflows,activities}/non-authored-index.ts`.
- Note that Level's `levelIoTransportOverride()` defaults to `'temporal'`, while the generic resolver defaults to `'direct'`. Pick one deliberately for UniFi. The recommendation is to match Level's per-provider override.

**Webhook (phase 2 only)**
- EE route, `server/src/app/api/webhooks/unifi/route.ts` re-export, and `packages/ee` 404 stub.
- `server/src/middleware.ts:200-210` `exactApiKeySkipPaths`.
- `server/src/lib/inboundWebhooks/reservedIntegrationTypes.ts`.
- Tenant-suspension gate test (`tenantSuspensionSurfaceGates.contract.test.ts`).

**Ticket-close subscriber**
- `server/src/lib/eventBus/subscribers/rmmAlertTicketClosedSubscriber.ts:195` only special-cases `ninjaone`. Confirm UniFi falls through to "no outbound adapter" cleanly.

**Disconnect event**
- Publish `INTEGRATION_DISCONNECTED` via `buildIntegrationDisconnectedPayload`, as Level does.
- Update `scripts/lib/workflow-event-emit-sites.mjs` and `server/src/test/unit/workflow-event-contracts/contracts/integrations.ts` for new emit sites.

**i18n**
- `integrations.rmm.unifi.{actions,connection,errors,fields,mappings,status,success,sync,alerting}` in all 11 `server/public/locales/*/msp/integrations.json`.

**OpenAPI**
- `server/src/lib/api/openapi/routes/rmmIntegrations.ts:20` description, then regenerate the route inventory, SDK OpenAPI, and MCP/chat registries. Don't hand-edit the generated files.

**Optional**
- Workflow runtime module (`ee/packages/workflows/src/runtime/actions/registerUniFiWorkflowActions.ts`, registered in `runtime/core.ts`), with `unifi.devices.find` / `unifi.devices.get`. Not in scope for v1.

**Templates to read first**
- `docs/superpowers/specs/2026-06-09-levelio-rmm-integration-design.md`
- `docs/superpowers/plans/2026-06-09-levelio-rmm-integration.md`

The number of hand-maintained provider lists above (about 15) is itself evidence for `// LEVERAGE: pattern rmm-provider-registration`. Drop the marker at each site touched. Don't consolidate in this card.
