# RMM Phase 2 — Scheduled Incremental Device Sync

## Problem statement

Device and asset data from RMM integrations only refreshes when a human presses
**Full sync** in Integrations → RMM. Nothing in the product schedules a device
sync for any provider.

This was found from a customer report: their Level.io integration shows
`sync_status = completed`, 25 assets ingested, and correct data — frozen at the
moment of the last manual full sync. The Assets tab is not broken; it is showing
a snapshot that nothing refreshes.

Evidence from production (2026-08-12):

| provider | integrations | active | ever full sync | ever incremental |
|---|---:|---:|---:|---:|
| ninjaone | 17 | 15 | 15 | 0 |
| huntress | 10 | 10 | 0 | 10 |
| levelio | 9 | 9 | 8 | 0 |
| tacticalrmm | 3 | 2 | 0 | 0 |
| tanium | 2 | 1 | 2 | 0 |

Huntress's incremental count is incident polling, not device sync — it reuses
`last_incremental_sync_at` as an incident cursor. No device sync has ever run on
a schedule for any provider.

Two adjacent defects surfaced in the same investigation:

1. **NinjaOne's incremental device sync is already built and dormant.**
   `syncDevicesIncremental` exists in `ninjaone/sync/syncStrategy.ts` and is
   reachable from a server action that computes `since` from
   `last_incremental_sync_at ?? last_full_sync_at ?? now-24h`. Nothing calls it
   on a timer, which is why the column is empty for all 17 integrations.
2. **Level.io's device mapper never populates five columns.** `wan_ip` is
   hardcoded `null`; `agent_version`, `pending_patches`,
   `pending_software_patches` and `failed_patches` are absent from the mapper's
   `extension` object, so `upsertAssetExtension` writes `null` every sync. All
   25 assets on the reporting tenant have those five columns null, permanently.

## User value

An MSP connects an RMM integration and sees device inventory that stays current
without anyone remembering to press a button. Operators choose how often each
connection syncs, so a large estate can sync nightly while a small one syncs
hourly.

## Goals

- A recurring, per-integration device sync that runs without human action.
- Operators can set the interval per integration in Integrations → RMM.
- Incremental sync (delta since last run) for every provider that can support
  it, so the recurring cost is proportional to what changed.
- Level.io device records populate every extension column its API can supply.

## Non-goals

- Alert/incident polling. That already exists (`rmm-alert-reconciliation`,
  `huntress-incident-poll`) and is out of scope except where this work shares
  its reconciler.
- Webhook/callback delivery. The Level.io callback already refreshes a single
  device on alert; it is complementary and unchanged here.
- Changing what the Assets UI renders.
- Backfilling historical device state.
- New provider integrations.

## Target users and flows

**MSP administrator** — connects an RMM integration, sets a sync interval,
expects Assets to stay current thereafter.

Primary flow:
1. Integrations → RMM → open a connected integration.
2. Set **Device sync** interval (or disable it).
3. Save. A recurring job is created for that integration.
4. Assets reflect provider state within one interval, without manual action.

Secondary flow: an operator changes the interval or disables sync; the
reconciler recreates or cancels the recurring job to match within a few minutes.

## Provider capability

Incremental support differs per provider and drives most of the work:

| provider | full sync today | incremental today | phase 2 work |
|---|---|---|---|
| ninjaone | works (15/17) | **built, dormant** | schedule it; verify `since` semantics |
| levelio | works (8/9) | none | build delta; API is cursor-paginated (`starting_after`), devices carry `last_seen_at` to filter against |
| tacticalrmm | **0/3 ever synced** | none | investigate why no integration has synced before scheduling anything |
| tanium | full only (2/2) | none | build delta or schedule full at low cadence |
| huntress | no device sync | column used for incidents | determine whether device sync exists at all; may reduce to alerts-only |

`tacticalrmm` and `huntress` may prove to be scheduling no-ops. The plan treats
"determine whether a device sync path exists" as explicit work rather than
assuming one.

## Existing machinery to reuse

`packages/jobs/src/lib/handlers/rmmAlertPollingHandlers.ts` already implements
the exact pattern needed, for alerts:

- One IJobRunner recurring job per integration, `singletonKey`
  `<job>:<tenant>:<integration>`.
- `intervalMinutesToCron(minutes)` — both backends take cron.
- A reconciler that scans integrations every few minutes and creates, recreates
  or cancels jobs to match live state, re-checking eligibility per run.
- IJobRunner means pg-boss cron on CE and Temporal Schedules on EE, for free.

Phase 2 adds a second job type alongside it rather than inventing a mechanism.
Provider eligibility must be a **separate list** from
`RMM_ALERT_POLLING_PROVIDERS`, because the two capabilities do not coincide:
Level.io syncs devices but polls no alerts; Huntress polls incidents but may not
sync devices.

## Data model

`rmm_integrations` already carries what is needed:

- `settings` jsonb — add `deviceSync: { enabled: boolean, intervalMinutes: number }`,
  mirroring the existing `alertPolling` shape.
- `last_incremental_sync_at` — exists, unused for device sync. Becomes the delta
  cursor.
- `last_full_sync_at`, `last_sync_at`, `sync_status`, `sync_error` — reused.

No migration is required for scheduling. A migration **is** required only if
provider settings need defaults backfilled; default-on-read is preferred.

Level.io field gaps are writes to existing `workstation_assets` /
`server_assets` columns; no schema change.

## UX notes

In the existing per-integration panel in Integrations → RMM:

- **Device sync** toggle (enabled/disabled).
- **Interval** control in minutes, clamped like the existing pollers. Suggested
  bounds 15–1440 with a default of 60; a full sync is far heavier than an alert
  poll, so the floor is deliberately higher than `alertPolling`'s 5.
- Show **last synced** (`last_incremental_sync_at ?? last_full_sync_at`) and
  `sync_error` when the last run failed.
- Manual **Full sync** stays exactly as it is.

No new page. There is no existing UI for `alertPolling.intervalMinutes`, so this
is the first interval control in this panel.

## Risks

- **API cost and rate limits.** A recurring sync per integration multiplies
  provider API calls. Incremental mitigates it; the interval floor and clamping
  are the guardrails. Level.io's list endpoints cap at 100 per page.
- **Level.io has no server-side delta.** `starting_after` is pagination, not a
  filter. A delta likely means fetching the device list and filtering on
  `last_seen_at`, which reduces write volume but not read volume. If that proves
  true, Level.io's honest cadence is lower than NinjaOne's.
- **`tacticalrmm` has never synced.** Scheduling a broken path produces a
  recurring failure. Investigate before enabling.
- **Reconciler churn.** Adding a second job type to a loop that creates and
  cancels schedules risks thrash if eligibility is computed inconsistently.
- **CE/EE split.** Level.io, NinjaOne and Tanium sync code lives under `ee/`;
  TacticalRMM's lives in `packages/integrations`. The job framework is CE-capable,
  so CE must degrade cleanly for providers whose sync engine it cannot import.

## Rollout

1. Ship with `deviceSync.enabled` defaulting to **off**, so no tenant gets a new
   recurring API load without opting in.
2. Enable for the reporting tenant first and confirm `last_incremental_sync_at`
   advances and asset values change.
3. Default new integrations to on once cadence is proven.

## Open questions

- Does Level.io's device list endpoint accept any server-side filter that avoids
  a full page walk?
- Why has no TacticalRMM integration ever completed a sync?
- Does Huntress have a device sync path, or is it alerts-only by design?
- Should a failing scheduled sync disable itself after N consecutive failures,
  or keep retrying at interval? (Default assumption: keep retrying; surface
  `sync_error` in the UI.)

## Acceptance criteria

- An integration with `deviceSync.enabled` and an interval set has exactly one
  recurring job, keyed per tenant+integration.
- Disabling it, or deactivating the integration, cancels the job within one
  reconciler pass.
- Changing the interval recreates the job at the new cadence.
- A scheduled run advances `last_incremental_sync_at` and updates asset rows.
- A scheduled run failure records `sync_error` and leaves the schedule intact.
- NinjaOne scheduled runs use the existing `syncDevicesIncremental` path.
- Level.io asset rows populate `agent_version`, `wan_ip`, `pending_patches`,
  `pending_software_patches` and `failed_patches` wherever the API supplies them;
  fields the API genuinely does not expose are documented as such in the
  scratchpad rather than left silently null.
- CE and EE both schedule and run device syncs for providers available in that
  edition.
