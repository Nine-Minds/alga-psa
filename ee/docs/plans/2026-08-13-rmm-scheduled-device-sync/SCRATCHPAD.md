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

## F047-F052 answered: what Level.io actually exposes

Checked against `LevelIoDevice`, `LevelIoNetworkInterface` and `LevelIoUpdate`
in `levelApiClient.ts`. Of the five columns that were permanently null on the
reporting tenant, exactly one is mappable:

| column | API | outcome |
|---|---|---|
| `pending_patches` | total of `listUpdates({status:'available'})` | **mapped** |
| `agent_version` | no field on LevelIoDevice at all | not exposed |
| `wan_ip` | network_interfaces carry LAN data only — ip_addresses, gateway, dhcp_server, dns_servers | not exposed |
| `failed_patches` | LevelIoUpdate has is_available / installed_on, no failure state | not exposed |
| `pending_software_patches` | needs the OS/software split below | not derivable yet |

Three of them are provider limitations, not mapper bugs. The original
`wanIp: null` was correct; it just looked like an oversight.

**Latent mislabel found while doing this.** The sync counts *every* available
update into `pendingOsPatches` regardless of category, so that column is really
"all pending updates" and has been since it was written. `LevelIoUpdate.category`
is typed `string` and the only value observed anywhere is `'Security Updates'`
(a Windows Update category). Splitting OS from software patches needs Level.io's
category taxonomy; guessing an allowlist would produce numbers that look precise
and are not. Both columns therefore receive the same total today, and the split
is left as follow-up work with the constraint written on the args type.

Worth confirming with Level.io (or a live payload) which categories exist before
anyone attempts the split.

## F032 answered: TacticalRMM has no bulk device sync to schedule

Production (2026-08-14), all three integrations:

```
55f6a1b8  active   connected 2026-06-17  last_sync_at 2026-06-17 18:03  sync_status pending
46208df6  active   connected 2026-06-26  last_sync_at 2026-06-26 14:06  sync_status pending
1052ba6d  inactive       —              —                              sync_status pending
```

`sync_status` has never left `'pending'` and `last_full_sync_at` is null on all
three — not because a sync failed, but because **nothing writes those columns
for this provider**. Tenant 55f6a1b8 has 16 tacticalrmm assets, all ingested in
a single burst at 2026-06-17 18:03:14, and none since.

The reason: TacticalRMM's entire sync surface is
`packages/integrations/src/lib/rmm/tacticalrmm/syncSingleAgent.ts` — one agent
at a time, triggered by the webhook at
`server/src/app/api/webhooks/tacticalrmm/route.ts`. It writes `sync_status` on
the `tenant_external_entity_mappings` row for that agent, never on
`rmm_integrations`. There is no full-sync engine, no device-list walk, and no
strategy to adapt.

So the 16 assets came from 16 webhook deliveries, not from a sync. This provider
is in the same position Level.io was in for callbacks: devices refresh only when
they generate an event.

**Consequence for this plan.** F033/F034 as written ("repair the sync, then add
incremental") are really "build a device sync for TacticalRMM", which is a
different and larger piece of work than adapting an existing one. It does not
belong in this phase. TacticalRMM stays out of RMM_DEVICE_SYNC_PROVIDERS, and a
scheduled sync for it should be planned separately once someone decides whether
`/agents` bulk listing is worth building against.

Caution for whoever picks that up: `sync_status` on rmm_integrations is
effectively unused for this provider, so any UI that reads it for TacticalRMM is
reading a value nothing maintains.

## F035 answered: Huntress has no device inventory to sync

`huntressClient.ts` exposes `getAgent(id)` and nothing that lists agents, so
there is no device list to walk. More decisively, `organizations/orgSync.ts`
writes `auto_sync_assets: false` for every Huntress organization mapping — the
integration deliberately does not treat Huntress as an asset source. It is an
incident product here; its recurring work is `huntress-incident-poll`, which
already exists and is unaffected by any of this.

Huntress stays out of RMM_DEVICE_SYNC_PROVIDERS, and its use of
`last_incremental_sync_at` as an incident-poll cursor is left alone. Anything
that later adds a Huntress device sync must not reuse that column for two
meanings.

## F031 answered: Tanium can full sync, but not from a job

`triggerTaniumFullSync` in `taniumActions.ts` works and writes
`last_full_sync_at` — production shows both Tanium integrations have completed
one. There is no incremental path and no time filter in the gateway client.

The blocker is not the sync, it is how it is reached. The action is wrapped in
`withAdvancedAssetsAccess`, which is `withAuth` plus a tier assertion, and its
first act is `hasPermission(user, 'system_settings', 'update')`. A scheduled run
has no acting user. Scheduling Tanium means first extracting the sync out of the
server action into an engine that a job can call — the same shape as Level.io's
`runLevelIoFullSync`, which is exactly why Level.io was adaptable in an
afternoon and this is not.

Deferred rather than bodged. Passing a synthetic user into a permission check to
satisfy a scheduler would put a fake principal into an authorisation decision,
which is a bad trade for one provider's cadence.

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

## Correction: TacticalRMM did have a bulk device sync (2026-08-14)

The earlier entry claiming "TacticalRMM has no bulk device sync at all — only
syncSingleAgent driven by webhooks" was **wrong**, and the conclusion drawn from
it (that Tactical could never be scheduled) was wrong with it.

`syncTacticalRmmDevices` has existed all along in
`packages/integrations/src/actions/integrations/tacticalRmmActions.ts`: it walks
`/beta/v1/site/`, then `/beta/v1/agent/?client_id=<org>` for every
auto-sync-enabled organization mapping, and upserts each agent as an asset. What
misled the earlier investigation was looking at `syncSingleAgent.ts` and the
webhook path, and at production state — tenant `55f6a1b8` has 16 assets from one
2026-06-17 burst, which is what a webhook trickle looks like, not evidence that
no bulk path exists.

Tactical was therefore in the same category as Tanium, not a category of its own:
a working bulk sync that a job could not reach.

### Why it could not simply be exported

`tacticalRmmActions.ts` carries `'use server'`, and **every export from such a
module becomes a callable RPC endpoint**. Exporting the sync so the job could
import it would have published an unauthenticated device-sync endpoint. So the
body moved to `lib/rmm/tacticalrmm/deviceSync.ts` (a plain module), together with
the eight helpers it shares with the action — `tenantScopedTable`,
`publishRmmSyncEvent`, `axiosErrorToMessage`, `buildConfiguredTacticalClient`,
`inferAssetTypeFromTacticalAgent`, `extractOsFields`, `extractVitals`,
`createTacticalAssetRecord` — and the tenant-secret name constants moved to
`shared.ts`. The action is now a permission check plus a delegate call.

No synthetic user was needed: `publishRmmSyncEvent` already computes
`actorType: args.actorUserId ? 'USER' : 'SYSTEM'`, so a scheduled run passing no
actor is attributed to SYSTEM, which is correct. A manual run still passes the
operator's `user_id`.

### Incremental semantics

Same shape as Level.io: `/beta/v1/agent/` accepts only `client_id`, no time
filter, so "incremental" is the same page walk filtered client-side on
`last_seen` (`tacticalAgentChangedSince`). Inclusive at the boundary;
missing/unparseable `last_seen` is always considered. Fewer ingest writes, same
number of API reads — do not mistake it for a cheap call.

This is only safe because the sync **never deletes** (`items_deleted` is
hardcoded 0). A filtered listing plus orphan-removal would have deleted every
device that had not been seen recently.

### Notable difference from the other two providers

Tactical's sync lives in `packages/integrations`, not under `ee/`, so its
strategy is registered from `@alga-psa/integrations/...` rather than
`@enterprise/...` — scheduled device sync for Tactical works in CE as well as EE.
It is also the only provider with both capabilities, so its alert schedule and
device schedule converge independently.

The strategy wraps the engine in `runWithTenant`. The NinjaOne and Level.io
strategies call `createTenantKnex()` without one; that currently works because
all their table access passes an explicit tenant, but it relies on ambient
context a job does not have. Worth aligning them.

### Remaining exclusions

- **huntress**: no agent listing at all (`getAgent(id)` only), `orgSync` sets
  `auto_sync_assets: false`. Nothing to schedule.
- **tanium**: working full sync behind `withAdvancedAssetsAccess`; needs exactly
  the extraction Tactical just had. `user` appears on one line of its 178-line
  body — the permission check.

## Tanium brought to parity (2026-08-16)

Same extraction as Tactical, with one extra obligation.

`triggerTaniumFullSync` was wrapped in `withAdvancedAssetsAccess`, which is
`withAuth` **plus** `assertTierAccess(TIER_FEATURES.ADVANCED_ASSETS)`. The
permission check is about the acting user and belongs on the action; the tier
check is about the *tenant's* entitlement and had to travel with the work —
otherwise scheduling a sync would be a way around a paid feature.
`assertTenantTierAccess(tenantId, feature)` already existed as the session-free
form of the same check, so the engine calls that. A source-level contract test
pins it, including that the session-based `assertTierAccess` is *not* used
(it reads `getSession()`, which a job does not have).

**API shape is unchanged.** `triggerTaniumFullSync` keeps its name, its no-arg
call from `TaniumIntegrationSettings.tsx:190`, and its result fields. The
existing unit tests call the inner function as
`(triggerTaniumFullSync as any)({}, { tenant })`, which still works.

### Two corrections made while extracting

- The old body stamped `last_full_sync_at` on every run. An incremental run must
  not: `resolveDeviceSyncCursor` falls back to `last_full_sync_at`, so an
  incremental would have stood in for a full sweep it never performed. Now
  conditional on `syncType === 'full'`.
- `items_deleted` can only ever be 0 from this path. `markMappedAssetDeleted`
  fires on `snapshot.lifecycleState === 'deleted' | 'tombstoned'`, and Tanium's
  mapper emits only `'offline'` or `'active'`. Worth knowing: it means deletion
  is snapshot-driven rather than set-difference, which is what makes the
  incremental filter safe — an endpoint outside the window is simply not
  visited, and nothing infers its absence.

### Deliberate difference from Tactical's strategy

Tanium sets `success = errors.length === 0`, so a single failing endpoint fails
the run and the strategy throws, holding the cursor. That means a permanently
broken endpoint re-reads the same window every interval instead of advancing.
Taken knowingly: a stalled cursor is loud (`sync_status 'error'`, the failure in
`sync_error`, the schedule visibly retrying) where skipped devices are silent.
Tactical's engine reports `success: true` with per-agent errors, so it advances.

### Test reach

The Tactical tests live in `packages/`, which CI runs. These Tanium ones live in
`ee/server/src/__tests__/`, and `sebastian-ee` is excluded from both nx test runs
in the unit workflow — so they pass locally but **do not gate anything in CI**.
Unchanged by this work, but it is the reason `taniumActions.test.ts` already had
8 failures before any of it: nothing had been running them.
