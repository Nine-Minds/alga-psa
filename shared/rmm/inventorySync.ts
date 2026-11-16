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
