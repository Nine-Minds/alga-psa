# Scratchpad — RMM scheduled device sync

## How this started

Native-speaker reviewer reported: "RMM integration works under Integrations →
RMM, but values are not updating in the Assets tab." Investigated against
production tenant `a1152b3f-23d4-48c1-b421-e2f30e349624` (read-only SELECTs).

The integration was healthy. The data was a frozen snapshot.

## Findings (2026-08-12, production)

Tenant `a1152b3f…`:

```
provider                 | levelio
is_active                | t
connected_at             | 2026-07-28 13:12:26+00
last_sync_at             | 2026-08-11 18:39:52+00
last_full_sync_at        | 2026-08-11 18:39:52+00
last_incremental_sync_at | (null)
sync_status              | completed
settings                 | {"provider_settings": {"levelio": {}}}
```

- 27 assets, 25 from RMM, all `workstation`.
- The Temporal workflow id `levelio:full:a1152b3f…:0eba3b38…:1786473591719`
  carries `Date.now()` — epoch ms 1786473591719 = 2026-08-11 18:39:51Z, one
  second before `last_rmm_sync_at`. **That manual full sync is what wrote the
  data, and nothing has touched it since.**

Config is not the problem: all nine Level.io integrations have empty
`provider_settings`, and none has ever run an incremental sync. The reporting
tenant is configured identically to every other one.

### Why nothing recurs

`startLevelIoSyncWorkflow` (`levelio/sync/transport.ts:45`) calls
`client.workflow.start()` with no `cronSchedule` and no Schedule handle. Its only
callers are server actions — `full_sync`, `scope_sync` — i.e. button clicks.

The recurring-job framework that *does* exist
(`packages/jobs/src/lib/handlers/rmmAlertPollingHandlers.ts`) selects on:

```js
const RMM_ALERT_POLLING_PROVIDERS = ['ninjaone', 'tacticalrmm'];
.whereIn('provider', [...RMM_ALERT_POLLING_PROVIDERS, 'huntress'])
```

Level.io is not in that list, and that framework polls **alerts**, not devices.
No amount of tenant configuration would have enabled a device sync.

### Callbacks

`ee/server/src/app/api/webhooks/levelio/route.ts:150` does refresh a device:

```js
// Best-effort: refresh the affected device without blocking the response.
startLevelIoDeviceSyncWorkflow({ tenantId, integrationId, deviceId, waitForResult: false })
```

But only the device an alert fired on. Alert counts per Level.io tenant:

```
55f6a1b8… 187   latest 2026-06-17
46208df6… 184   latest 2026-06-26
5c6c48a0…  13   latest 2026-08-11   ← callbacks demonstrably work on this deployment
a1152b3f…   1   latest 2026-06-25   ← reporting tenant: one, at setup time
5 others    0
```

Callbacks are a per-device push on alert, not an inventory refresh. Even working
perfectly they leave quiet machines stale.

## The dormant NinjaOne incremental sync

`ee/server/src/lib/integrations/ninjaone/sync/syncStrategy.ts` implements
`syncDevicesIncremental` (two strategies, lines 172 and 253).
`ninjaoneActions.ts:888` computes the cursor:

```js
const since = integration.last_incremental_sync_at
  || integration.last_full_sync_at
  || new Date(Date.now() - 24*60*60*1000).toISOString();
```

It is reachable only from a server action. Production shows `ever_incremental =
0` across all 17 NinjaOne integrations — the code has never run. **Scheduling may
be most of the work for this provider.** Verify `since` semantics before reuse.

No other provider implements `syncDevicesIncremental`.

## Level.io mapper gaps

`ee/server/src/lib/integrations/levelio/mappers/deviceMapper.ts:125-140`.

Column census across the reporting tenant's 25 `workstation_assets` rows:

| always populated (25/25) | partial | **always null (0/25)** |
|---|---|---|
| os_type, os_version, current_user, lan_ip, last_reboot_at, antivirus_status, pending_os_patches | uptime_seconds (19) | agent_version, wan_ip, pending_patches, pending_software_patches, failed_patches |

`wanIp: null` is hardcoded (line 136). The other four are absent from the
mapper's `extension` object entirely, so `upsertAssetExtension` writes `?? null`
on every sync forever. `uptime_seconds` is 19/25 because Level.io only reports it
for online devices.

The mapper already reads `device.security`, `device.operating_system` and
`device.network_interfaces`, so the payload is richer than what is mapped —
worth re-reading the API response before concluding a field is unavailable.

## F027 answered: Level.io has no server-side delta

`levelApiClient.listDevices()` accepts only `group_id` and `ancestor_group_id`.
`starting_after` is a pagination cursor by item id, not a time filter, and
`limit` caps at 100.

So an incremental Level.io sync is the same page walk as a full sync, filtered
on `last_seen_at` after the fetch. It cuts ingest writes and mapping work, **not
API reads**. Do not treat it as a cheap call when choosing a cadence — the
interval floor matters more for Level.io than for NinjaOne.

Filter semantics chosen (pinned by tests):
- inclusive at the cursor, so a device changing in the same instant the previous
  run recorded is not dropped;
- a device with null or unparseable `last_seen_at` is always considered, so
  absent data cannot exclude a device from every incremental run forever.

Also spotted while reading the client: `listUpdates({ status: 'available' |
'installed' })` already exists and the full sync uses it for
`pendingOsPatches`. That is the likely source for the missing
`pending_patches` / `pending_software_patches` / `failed_patches` columns
(F049-F051) — check its payload before concluding Level.io does not expose them.

## Decisions

- **All five providers in scope** (user decision, 2026-08-13). Note tacticalrmm
  has 0/3 integrations that ever synced — investigate before scheduling.
- **Build incremental**, not scheduled-full (user decision). NinjaOne's exists;
  the rest need building.
- **Per-integration UI** in Integrations → RMM (user decision). No interval UI
  exists today for `alertPolling` either, so this is the first one.
- **Field gaps included** in this phase (user decision).
- Device-sync provider eligibility is a **separate list** from
  `RMM_ALERT_POLLING_PROVIDERS` — the capabilities do not coincide (Level.io
  syncs devices, polls no alerts; Huntress polls incidents, device path unknown).
- Interval floor 15 min, default 60, ceiling 1440 — deliberately higher than
  `alertPolling`'s 5-minute floor because a device sync is far heavier.
- Ship `deviceSync.enabled` default **off**; no tenant gets new recurring API
  load without opting in.

## Useful commands

Read-only production queries (primary is currently `pgvector-coord-1`; note it
was `coord-0` previously — check `-l role=master` before assuming):

```sh
kubectl get pods -n stackgres-pgvector -l role=master
kubectl exec -n stackgres-pgvector pgvector-coord-1 -c postgres-util -- \
  psql -d server -x -c "SELECT provider, is_active, last_full_sync_at, \
  last_incremental_sync_at, sync_status, settings FROM rmm_integrations \
  WHERE tenant='<uuid>';"
```

Per-provider fleet view:

```sql
SELECT provider, count(*), count(*) FILTER (WHERE is_active) AS active,
       count(last_full_sync_at) AS ever_full,
       count(last_incremental_sync_at) AS ever_incremental
FROM rmm_integrations GROUP BY provider ORDER BY 2 DESC;
```

Extension-column census for a tenant:

```sql
SELECT count(*) rows, count(os_type) os_type, count(agent_version) agent_ver,
       count(lan_ip) lan_ip, count(uptime_seconds) uptime,
       count(pending_patches) pending, count(antivirus_status) av
FROM workstation_assets WHERE tenant='<uuid>';
```

## Gotchas

- `assets.last_rmm_sync_at` is written by the ingestion service on every upsert;
  `rmm_integrations.last_sync_at` is written by the sync engine. They can
  disagree if a device sync touches one device.
- The ingestion service **skips creating** an asset when the RMM organization has
  no client mapping (`"No mapped client for external scope X"`), but still
  **updates** assets that already exist. A tenant can therefore look partly
  synced. Not the cause here — this tenant has 4 org mappings — but it is the
  other common failure mode for "assets not appearing".
- Tenant secrets are not in Postgres; the webhook secret lives in the secret
  provider (`levelio_webhook_secret`). A wrong secret shows as 401s in the
  provider's delivery log, not as anything visible in our DB.
- `packages/jobs` is the IJobRunner abstraction — never reach for pg-boss
  directly; EE refuses it.
