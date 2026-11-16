/**
 * Contract for the whole-fleet RMM inventory sync ('rmm-inventory-sync' job).
 *
 * One definition shared by the scheduling action, the job handler and the
 * Fleet Compliance panel, so the three cannot disagree about the stored shape.
 * The record lives in the integration's own settings jsonb
 * (`rmm_integrations.settings.inventorySync[kind]`); no table is involved.
 *
 * Pure types and helpers only — safe to import from client components.
 */

export const RMM_INVENTORY_SYNC_JOB = 'rmm-inventory-sync';

/** Adding an inventory kind = one entry in the handler's runner table + one translation key. */
export type RmmInventorySyncKind = 'software' | 'patches';
export const RMM_INVENTORY_SYNC_KINDS: readonly RmmInventorySyncKind[] = ['software', 'patches'];

/** How a finished run went. Mirrors `status` on the sync result types. */
export type RmmInventorySyncOutcomeStatus = 'succeeded' | 'partial' | 'failed';

/**
 * Stored while a job is queued or running. The outcome status type has no
 * "running" member on purpose (a finished run is never running); the *stored
 * record* is the widened union below, so the duplicate guard has something
 * durable to read that does not depend on the job backend's dedupe semantics.
 */
export interface RmmInventorySyncRunning {
  status: 'running';
  jobId: string;
  startedAt: string;
  /**
   * Refreshed by the handler on every batch. The stored record — not jobs.status —
   * is the source of liveness: on Temporal the job is forwarded fire-and-forget,
   * so its `jobs` row reads terminal as soon as the event is published.
   */
  heartbeatAt?: string;
  /** Devices done / total, written alongside each heartbeat. */
  done?: number;
  total?: number;
  /**
   * Derived on read (annotateInventorySyncLiveness), never stored: the record is
   * `running` but its heartbeat is older than INVENTORY_SYNC_STALE_MS.
   */
  stale?: boolean;
}

export interface RmmInventorySyncOutcome {
  status: RmmInventorySyncOutcomeStatus;
  assetsProcessed: number;
  assetsUpdated: number;
  assetsFailed: number;
  /** Real total; `errors` is capped. */
  errorCount: number;
  errors: string[];
  startedAt: string;
  completedAt: string;
  jobId: string;
}

export type RmmInventorySyncRecord = RmmInventorySyncRunning | RmmInventorySyncOutcome;

export type RmmInventorySyncSettings = Partial<Record<RmmInventorySyncKind, RmmInventorySyncRecord>>;

/** Reads `settings.inventorySync` from a jsonb value that may arrive as a string. */
export function readInventorySyncSettings(settings: unknown): RmmInventorySyncSettings {
  let parsed: unknown = settings;
  if (typeof settings === 'string') {
    try {
      parsed = JSON.parse(settings);
    } catch {
      return {};
    }
  }
  const raw = (parsed as { inventorySync?: unknown } | null | undefined)?.inventorySync;
  if (!raw || typeof raw !== 'object') return {};
  const out: RmmInventorySyncSettings = {};
  for (const kind of RMM_INVENTORY_SYNC_KINDS) {
    const rec = (raw as Record<string, unknown>)[kind] as RmmInventorySyncRecord | undefined;
    if (rec && typeof rec === 'object' && typeof rec.status === 'string') out[kind] = rec;
  }
  return out;
}

/**
 * Atomic jsonb merge for `settings.inventorySync[kind]`, for use as the
 * `settings` value of an `update()`. Merging in SQL (rather than read-modify-
 * write in JS) keeps concurrent writers of other settings keys — notably
 * `tokenLifecycle` from the proactive token refresh — from being clobbered
 * during a 30-minute run. `knex` is passed in so this module stays dependency-free.
 */
export function inventorySyncSettingsPatch(
  knex: { raw: (sql: string, bindings: unknown[]) => unknown },
  kind: RmmInventorySyncKind,
  record: RmmInventorySyncRecord,
): unknown {
  return knex.raw(
    `jsonb_set(
       jsonb_set(COALESCE(settings, '{}'::jsonb), '{inventorySync}', COALESCE(settings->'inventorySync', '{}'::jsonb), true),
       ARRAY['inventorySync', ?::text],
       ?::jsonb,
       true
     )`,
    [kind, JSON.stringify(record)],
  );
}

/**
 * A running record is live while its last heartbeat (or startedAt, before the
 * first batch) is newer than this. Well above one batch (25–50 devices, a few
 * seconds) so a slow batch never reads as dead.
 */
export const INVENTORY_SYNC_STALE_MS = 5 * 60 * 1000;

export function isInventorySyncRunningFresh(
  record: RmmInventorySyncRunning,
  now: number = Date.now(),
): boolean {
  const last = Date.parse(record.heartbeatAt ?? record.startedAt);
  return Number.isFinite(last) && now - last < INVENTORY_SYNC_STALE_MS;
}

/** Marks running records whose heartbeat has gone stale, so clients never compare clocks. */
export function annotateInventorySyncLiveness(
  settings: RmmInventorySyncSettings,
  now: number = Date.now(),
): RmmInventorySyncSettings {
  const out: RmmInventorySyncSettings = {};
  for (const kind of RMM_INVENTORY_SYNC_KINDS) {
    const rec = settings[kind];
    if (!rec) continue;
    out[kind] = rec.status === 'running' ? { ...rec, stale: !isInventorySyncRunningFresh(rec, now) } : rec;
  }
  return out;
}
