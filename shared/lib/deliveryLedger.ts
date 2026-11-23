import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * The delivery claim protocol, extracted from base's comment-email ledger.
 *
 *   claim:  INSERT state='sending' ON CONFLICT DO NOTHING. A fresh insert wins. An existing
 *           row is re-claimed only from a reclaimable state (`failed`, plus `pending` for
 *           routing). Every successful claim is
 *           one real send attempt: a fresh insert starts at `attempts = 1` (column default) and
 *           every re-claim adds 1, whichever state it took over. `sent` and `sending`
 *           rows are never re-claimed: `sending` is deliberately not leased, because an unknown
 *           provider outcome needs operator reconciliation, not a duplicate delivery.
 *   finish: moves a `sending` row to `sent` | `failed`. Finishing as `sending` records
 *           `requires_reconciliation` (the provider outcome is unknown).
 *
 * One protocol, several ledgers: a ledger is a table plus the columns that (with `tenant`)
 * make a delivery unique. Base keeps `ticket_comment_email_deliveries`; co-managed deliveries
 * use `co_management_deliveries`. The ledger is chosen by served state, so exactly one writer
 * owns each send.
 */
export interface DeliveryLedger {
  table: string;
  /** Columns that, with `tenant`, identify one delivery. */
  keyColumns: readonly string[];
  /** Key columns compared case-insensitively (stored trimmed and lower-cased). */
  normalized?: readonly string[];
  /**
   * States a claim may take over besides a fresh insert. Default `['failed']`. A ledger whose
   * rows are written ahead of delivery (routing: `pending`) adds `pending`. `sending` and
   * `sent` are never reclaimable.
   */
  reclaimable?: readonly ('pending' | 'failed')[];
}

/**
 * Key values are canonicalized to strings by `qualify`: strings pass through unchanged (existing ledgers),
 * a Date becomes ISO-8601 UTC (`toISOString`), a finite integer becomes its decimal form. Anything else is rejected.
 * Timestamp and integer key columns (e.g. schedule reminders) can therefore be passed as `Date` / `number`
 * without every caller re-deriving the canonical form; the canonical string matches the PK on both
 * `onConflict` and `where`.
 */
export type DeliveryKeyValue = string | number | Date;
export type DeliveryKey = Record<string, DeliveryKeyValue>;
export type DeliveryFinishState = 'sent' | 'failed' | 'sending';

export const COMMENT_EMAIL_LEDGER: DeliveryLedger = {
  table: 'ticket_comment_email_deliveries',
  keyColumns: ['comment_id', 'recipient'],
  normalized: ['recipient'],
};

function canonicalKeyValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : undefined;
  return undefined;
}

function qualify(ledger: DeliveryLedger, tenant: string, key: DeliveryKey): Record<string, string> {
  const out: Record<string, string> = { tenant };
  for (const column of ledger.keyColumns) {
    const value = canonicalKeyValue(key[column]);
    if (value === undefined) throw new Error(`delivery ledger key is missing ${column}`);
    out[column] = ledger.normalized?.includes(column) ? value.trim().toLowerCase() : value;
  }
  return out;
}

/** @returns true when this caller now owns the send. */
export async function claimDelivery(
  db: Knex | Knex.Transaction,
  ledger: DeliveryLedger,
  tenant: string,
  key: DeliveryKey,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const table = () => tenantDb(db, tenant).table(ledger.table);
  const qualified = qualify(ledger, tenant, key);
  const inserted = await table()
    .insert({ ...extra, ...qualified, state: 'sending' })
    .onConflict(['tenant', ...ledger.keyColumns])
    .ignore()
    .returning(ledger.keyColumns[0]);
  if (inserted.length) return true;
  const retried = await table().where(qualified).whereIn('state', [...(ledger.reclaimable ?? ['failed'])]).update({
    state: 'sending',
    updated_at: new Date(),
    attempts: db.raw('attempts + 1'),
    last_error: null,
    error_code: null,
    requires_reconciliation: false,
  });
  return retried > 0;
}

export async function finishDelivery(
  db: Knex | Knex.Transaction,
  ledger: DeliveryLedger,
  tenant: string,
  key: DeliveryKey,
  state: DeliveryFinishState,
  outcome?: { error?: string; errorCode?: string },
): Promise<void> {
  const { tenant: _tenant, ...where } = qualify(ledger, tenant, key);
  await tenantDb(db, tenant).table(ledger.table).where(where).where({ state: 'sending' }).update({
    state,
    updated_at: new Date(),
    last_error: outcome?.error || null,
    error_code: outcome?.errorCode || null,
    requires_reconciliation: state === 'sending',
  });
}

/**
 * Flag claims that never finished: `sending` rows of the given delivery kinds older than `olderThanMs` lost their
 * worker between claim and finish, so the provider outcome is unknown. They are marked `requires_reconciliation`
 * and are never re-sent (`claimDelivery` does not reclaim `sending`). Returns the number flagged. Each kind family
 * (routing, SLA) passes its own kinds, so recovery is one query rather than a copy per family.
 */
export async function flagStaleSendingDeliveries(
  db: Knex | Knex.Transaction,
  ledger: DeliveryLedger,
  tenant: string,
  kinds: readonly string[],
  olderThanMs: number,
): Promise<number> {
  return tenantDb(db, tenant).table(ledger.table)
    .whereIn('delivery_kind', [...kinds]).where({ state: 'sending', requires_reconciliation: false })
    .where('updated_at', '<', new Date(Date.now() - olderThanMs))
    .update({ requires_reconciliation: true, error_code: 'unknown_outcome', last_error: 'Delivery was claimed but never finished; reconcile before resending.', updated_at: new Date() });
}

/** Co-managed deliveries (in-app, email, per audience recipient). Rows exist only for served tenants. */
export const CO_MANAGED_LEDGER: DeliveryLedger = {
  table: 'co_management_deliveries',
  keyColumns: ['delivery_kind', 'source_id', 'recipient'],
  normalized: ['recipient'],
  // Routing rows are written `pending` when the transition commits and delivered later (or by recovery).
  reclaimable: ['pending', 'failed'],
};

/**
 * Schedule entry reminders: one delivery per (entry, occurrence start, user, lead). `entry_id` is the master entry
 * for recurring series. `occurrence_start` is timestamptz and `lead_minutes` an integer; build keys with
 * `scheduleReminderKey` so both are canonical (ISO-8601 UTC, decimal).
 */
export const SCHEDULE_REMINDER_LEDGER: DeliveryLedger = {
  table: 'schedule_entry_reminder_deliveries',
  keyColumns: ['entry_id', 'occurrence_start', 'user_id', 'lead_minutes'],
};

export function scheduleReminderKey(parts: {
  entryId: string;
  occurrenceStart: Date | string;
  userId: string;
  leadMinutes: number;
}): DeliveryKey {
  const start = parts.occurrenceStart instanceof Date ? parts.occurrenceStart : new Date(parts.occurrenceStart);
  if (Number.isNaN(start.getTime())) throw new Error('delivery ledger key is missing occurrence_start');
  if (!Number.isSafeInteger(parts.leadMinutes) || parts.leadMinutes < 0) throw new Error('delivery ledger key is missing lead_minutes');
  return {
    entry_id: parts.entryId,
    occurrence_start: start.toISOString(),
    user_id: parts.userId,
    lead_minutes: String(parts.leadMinutes),
  };
}
