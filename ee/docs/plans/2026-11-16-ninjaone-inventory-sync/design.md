# Design — NinjaOne Fleet Compliance: partial/timed-out software sync must not blank the panel

Card `be1f8626` · XOGENT ticket `alga-2026-0002953` · branch
`feature/ninjaone-fleet-compliance-partial-or-timed-out-s` · app `:3566`.
Step: Design Session (conn — XO desk).

## What is actually wrong (three defects, not one)

The ticket reads as one bug ("Failed to load compliance summary"). The code says it is three, and they have to be
fixed together or the panel will keep lying about which one happened.

1. **Two failure domains share one state variable.** `NinjaOneComplianceDashboard` keeps a single `error` and a single
   `if (error || !summary)` branch. `fetchSummary` sets it, and so do `handleSyncSoftware` / `handleSyncPatches`
   (`compliance.summaryError` — "Failed to load compliance summary"). A sync failure therefore unmounts the summary,
   the metrics **and the sync buttons that could retry it** — the one state from which the user cannot recover.
2. **A fleet operation reports a boolean.** `syncSoftwareInventory` (`softwareSync.ts:422`) and `syncPatchStatus`
   (`patchSync.ts:173`) set `success = assetsFailed === 0`. 830 of 831 devices updated reads exactly like a total
   failure, and the counts that were already accumulated (`assetsProcessed/Updated/Failed`) are discarded by the action
   (`triggerSoftwareInventorySync` returns `{ success, result }` with no `error`), so the UI has nothing to say but the
   wrong sentence.
3. **Whole-fleet work runs inside the request.** `triggerSoftwareInventorySync` awaits `syncSoftwareInventory` inline:
   batches of 25, one provider call per device, `await 1000 ms` between batches (`softwareSync.ts:326-418`). 831 devices
   = 34 batches ≈ **33 s of pauses plus 831 HTTP round trips** inside a server action. A timeout is not an edge case at
   this size — it is the designed behaviour, and it lands on the same `summaryError` sentence as defect 2.

The established fact that `getRmmComplianceSummary` returns its own wording on a caught error confirms the message XOGENT
saw came from a **sync**, not from the summary query.

## Design

Four parts: a background job (the mechanism), partial as a first-class outcome, actions that schedule instead of run, and
a panel that keeps the two failure domains apart.

### A. `rmm-inventory-sync` — one background job for both inventory syncs

The repo already has the right substrate: `IJobRunner` (`packages/jobs/src/lib/jobs/interfaces/IJobRunner.ts`) with
`scheduleJob`/`singletonKey`, handlers registered centrally in `server/src/lib/jobs/registerAllHandlers.ts`, and progress
rows in `job_details` read by `getJobProgressAction` (`packages/jobs/src/actions/job-actions/getJobProgressAction.ts`).
The RMM pollers are the worked example (`packages/jobs/src/lib/handlers/rmmAlertPollingHandlers.ts`).

- New handler `packages/jobs/src/lib/handlers/rmmInventorySyncHandler.ts`, job name constant `rmm-inventory-sync`,
  registered with `timeoutMs: 1800000` (30 min) and `retry: { maxAttempts: 2 }` — a run that dies mid-fleet is
  idempotent (upserts), so one automatic retry is worth 30 minutes of lost provider traffic.
- Job data: `{ tenantId, integrationId, provider: 'ninjaone', kind: 'software' | 'patches', assetIds?, trackChanges?,
  performedBy? }` where `performedBy` is only carried for audit, never for authorization (the action already
  authorized).
- One job name for both kinds, dispatched through a small table rather than two registrations:
  ```ts
  const INVENTORY_SYNC_RUNNERS = {
    software: (tenant, integrationId, opts) => syncSoftwareInventory(tenant, integrationId, opts),
    patches:  (tenant, integrationId, opts) => syncPatchStatus(tenant, integrationId, opts),
  } as const;
  ```
  This is the same "provider/kind registry" shape the RMM pollers use, and adding a third inventory kind later is one
  entry plus one translation key — not a new job, new progress plumbing and new UI state.
- The handler **re-checks eligibility before touching the provider**, mirroring `rmmDeviceSyncHandler`: integration
  row exists and `is_active`, tenant not `suspended_at`, no `reconnect_required`. A queued job that outlives a
  disconnect must be a no-op, not an API-key error in someone's settings panel.
- Per-batch progress: the sync functions take an optional `onProgress?: (done: number, total: number) => void`, and the
  handler writes a `job_details` row per batch (same shape as `kbArticleImportHandler.updateJobProgress`). The UI polls
  `getJobProgressAction(jobId)` and renders "412 / 831 devices".
- Durable outcome on completion, written to the integration's own settings (the same jsonb that already carries
  `tokenLifecycle`):
  ```ts
  settings.inventorySync[kind] = {
    status: 'succeeded' | 'partial' | 'failed',
    assetsProcessed, assetsUpdated, assetsFailed,
    errorCount, errors: string[],        // capped
    startedAt, completedAt, jobId,
  }
  ```
  `getRmmComplianceSummary` gains an `inventorySync` field carrying this, so the panel shows the last run's result after
  a reload with **no new table and no new read action**.

### B. Partial is a first-class outcome

Both sync result types gain `status: 'succeeded' | 'partial' | 'failed'`:

- `succeeded` — ran to completion, `assetsFailed === 0`
- `partial` — ran to completion, `assetsFailed > 0` (the XOGENT case: 830 devices updated, 1 failed)
- `failed` — threw, or the integration became unusable mid-run

`success` stays (`assetsFailed === 0`) so nothing that reads it changes behaviour, but after this card **nothing branches
on it for user-facing messaging** — the handler maps `status` and the panel words the message from counts.

`errors[]` is capped at the first 20 messages plus `errorCount`, so a bad fleet cannot write a megabyte of device errors
into `rmm_integrations.settings`.

### C. The trigger actions become schedulers

`triggerSoftwareInventorySync` and `triggerPatchStatusSync` keep their permission check (`asset:update`) and integration
lookup, then:

```ts
await scheduleInventorySync({ tenant, integrationId, provider: 'ninjaone', kind, userId });
return { success: true, jobId };
```

- Return type narrows to `{ success: boolean; jobId?: string; error?: string }`; `success: false` now means only a
  **structural refusal** — not permitted, not configured, or a run already in flight. The calls to
  `syncSoftwareInventory` / `syncPatchStatus` disappear from the action entirely; that deletion is what satisfies
  "831 devices without a request timeout".
- **Duplicate guard, durable rather than backend-specific.** `singletonKey:
  rmm-inventory-sync:${tenant}:${integrationId}:${kind}` is passed (pg-boss honours it), but Temporal's `scheduleJob`
  dedupe is not something to bet a UI on. So the action also reads `settings.inventorySync[kind]`: if its `status` is
  `running` **and** the recorded `jobId` is still non-terminal in `jobs`, reply `{ success: true, jobId }` (same id,
  the panel just attaches to the running sync). A `running` record whose job is terminal is stale — the job died
  without writing an outcome — and is overwritable.
- Drop `revalidatePath('/msp/assets')` from the scheduler: nothing has changed yet. The handler revalidates after it
  writes.
- Compatibility: the only caller is the dashboard (established fact), so the signature change is contained. A dashboard
  from the previous release calling the new action still gets `success: true` and refetches; it shows stale counts for
  one deploy, no crash.

### D. The panel separates summary failure from sync failure

State split — the structural rule:

- `summaryError` fed **only** by `fetchSummary`. `if (summaryError || !summary)` renders the "unavailable + Retry" card,
  as today.
- `syncState`: `null | { kind, jobId, phase: 'running', done?, total? } | { kind, phase: 'partial' | 'failed' | 'done',
  assetsUpdated, assetsFailed, errors, message? }`. Seeded from `summary.inventorySync[kind]` on mount, so a sync result
  survives a reload.

Rendering:

- Summary unavailable → unchanged card (message is the summary's own), no sync buttons — there is nothing to attach them
  to, and Retry is the action that matters there.
- Summary present → metrics + **always-visible sync buttons** (disabled only while a run for that kind is in flight) +
  a sync strip under them:
  - running: `Syncing software inventory… 412 / 831 devices` (from polled job progress)
  - partial: `Software inventory updated on 828 devices · 3 failed` with a `Details` disclosure listing the capped
    device errors
  - failed: `Software sync failed: <reason>` + Retry
- Polling: while `syncState.jobId` is set, poll `getJobProgressAction(jobId)` every 2 s and stop on unmount or on a
  terminal status; then one `fetchSummary()` to pick up the durable outcome. No client-side timeout — a 30-minute sync
  is exactly the case this exists for.
- i18n: new keys under `integrations.rmm.ninjaOne.compliance.sync.*` (running/partial/failed/updated/failedCount/
  details/retry) in every locale, including the pseudo-locales. `compliance.summaryError` keeps its wording and gains
  exactly one consumer (criterion 3). Its current misuse as a sync message is deleted, not rewritten.

## Deliberately out of scope

- **No scheduled software refresh, no cron.** The ticket raises it; no acceptance criterion needs it; a daily
  full-fleet walk per tenant is a cost decision, not a defect fix. Follow-up card if the captain wants it.
- **No wiring of the unused single-device `syncDeviceSoftware`.** No caller, no requirement; it is a per-device refresh
  feature, not this fix.
- **No incremental/delta software fetch.** Provider capability question; the 33-minute background walk is acceptable,
  an inline one was not.
- **No change to `rmm-device-sync` or its reconciler**, and **no schema migration** — settings jsonb carries the
  outcome.

## Order of work

1. `status` + capped `errors` + `onProgress` in `softwareSync.ts` and `patchSync.ts` (+ unit tests: partial stays
   partial, counts preserved, threshold at one failure).
2. `rmmInventorySyncHandler` + the kind registry + registration in `registerAllHandlers.ts` (unit tests: eligibility
   no-op, progress rows written per batch, outcome written to settings, throw → `failed`).
3. Actions → schedulers (+ unit tests: the sync module is **not** imported/called by the action, duplicate guard,
   permission refusal, `jobId` returned).
4. Dashboard split + polling + i18n (+ component test: a partial sync keeps metrics and buttons and shows counts; only a
   summary failure renders the unavailable card; progress text updates).
5. `getRmmComplianceSummary` returns `inventorySync` (+ test).

## Risks

- **Job runner differences (pg-boss CE vs Temporal EE).** Mitigated by making the durable `settings.inventorySync`
  guard primary and `singletonKey` secondary, so correctness does not depend on a backend's dedupe semantics.
- **Sticky `running`.** A job killed hard writes no outcome; the terminal-job check in the guard is what unsticks it.
- **Host restart mid-fleet.** The retry re-walks the fleet; upserts make that idempotent, and progress rows start over —
  the strip says "syncing" with a lower count, which is truthful.
- **Progress polling cost.** One 2 s poll per open dashboard during a run, each a single indexed read; acceptable.
- **Semantics of `success`.** Two spellings of "how did it go" is a smell; the design keeps `success` only for
  compatibility and states plainly in code comments that `status` is the user-facing truth. Removing `success` outright
  is a later cleanup once no caller reads it.

## Acceptance trace

| Criterion | Where it is satisfied |
| --- | --- |
| Partial sync keeps summary + buttons, reports updated/failed | B (`status: partial`, counts) + D (sync strip) |
| Throw/timeout shows a sync-specific error, panel stays | A (job) + C (no work in the request) + D (`syncState.failed`) |
| "Failed to load compliance summary" only for the summary | D (single consumer) |
| 831-device sync completes without a request timeout | C (scheduling returns immediately) + A (30 min job budget) |
| Patch sync behaves the same for the first three | A (shared handler/kind) + B + D (kind-parameterized strip) |
