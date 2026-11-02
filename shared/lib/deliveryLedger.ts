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

export type DeliveryKey = Record<string, string>;
export type DeliveryFinishState = 'sent' | 'failed' | 'sending';

export const COMMENT_EMAIL_LEDGER: DeliveryLedger = {
  table: 'ticket_comment_email_deliveries',
  keyColumns: ['comment_id', 'recipient'],
  normalized: ['recipient'],
};

function qualify(ledger: DeliveryLedger, tenant: string, key: DeliveryKey): Record<string, string> {
  const out: Record<string, string> = { tenant };
  for (const column of ledger.keyColumns) {
    const value = key[column];
    if (typeof value !== 'string' || value.length === 0) throw new Error(`delivery ledger key is missing ${column}`);
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

/** Co-managed deliveries (in-app, email, per audience recipient). Rows exist only for served tenants. */
export const CO_MANAGED_LEDGER: DeliveryLedger = {
  table: 'co_management_deliveries',
  keyColumns: ['delivery_kind', 'source_id', 'recipient'],
  normalized: ['recipient'],
  // Routing rows are written `pending` when the transition commits and delivered later (or by recovery).
  reclaimable: ['pending', 'failed'],
};
