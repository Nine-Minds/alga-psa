/**
 * Invoice lifecycle audit writer + reader.
 *
 * Finalize, unfinalize and delete write a row to `audit_logs` inside the SAME
 * transaction as the change, so a failed audit rolls the change back. Modelled
 * on accountingAudit.ts: the `app.current_tenant` GUC is set explicitly on the
 * transaction because `auditLog` silently no-ops when it is unset, and server
 * actions never establish it.
 *
 * Row shape: table_name = 'invoices', record_id = invoice id,
 * details = { invoiceNumber, before: {status, finalized_at}, after: {status, finalized_at} }.
 */

import type { Knex } from 'knex';
import { auditLog } from './auditLog';
import { tenantDb } from './tenantDb';

export type InvoiceAuditOperation =
  | 'invoice_finalized'
  | 'invoice_unfinalized'
  | 'invoice_deleted';

export interface InvoiceAuditState {
  status: string | null;
  finalized_at: string | Date | null;
}

export interface InvoiceAuditParams {
  invoiceId: string;
  userId?: string | null;
  invoiceNumber?: string | null;
  before: InvoiceAuditState;
  after: InvoiceAuditState;
  /** Extra context merged into `details` (never overrides before/after). */
  extraDetails?: Record<string, unknown>;
}

export const INVOICE_AUDIT_TABLE = 'invoices';
export const INVOICE_AUDIT_OPERATIONS: InvoiceAuditOperation[] = [
  'invoice_finalized',
  'invoice_unfinalized',
  'invoice_deleted',
];

function normalizeState(state: InvoiceAuditState): { status: string | null; finalized_at: string | null } {
  const finalizedAt = state.finalized_at;
  return {
    status: state.status ?? null,
    finalized_at: finalizedAt instanceof Date
      ? finalizedAt.toISOString()
      : (finalizedAt ?? null),
  };
}

/**
 * Must be called with the transaction that performs the change. Throws if the
 * audit row cannot be written (auditLog rethrows), rolling the change back.
 */
export async function writeInvoiceAudit(
  trx: Knex.Transaction,
  tenant: string,
  operation: InvoiceAuditOperation,
  params: InvoiceAuditParams,
): Promise<void> {
  await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', tenant]);
  const before = normalizeState(params.before);
  const after = normalizeState(params.after);
  await auditLog(trx, {
    userId: params.userId ?? undefined,
    operation,
    tableName: INVOICE_AUDIT_TABLE,
    recordId: params.invoiceId,
    changedData: { status: after.status, finalized_at: after.finalized_at },
    details: {
      ...params.extraDetails,
      tenant,
      invoiceNumber: params.invoiceNumber ?? null,
      before,
      after,
    },
  });
}

export interface InvoiceHistoryEntry {
  audit_id: string;
  operation: string;
  user_id: string | null;
  /** Display name of the acting user, when audit_logs.user_id is a real user. */
  actor_name: string | null;
  timestamp: string | Date;
  invoice_number: string | null;
  before: { status: string | null; finalized_at: string | null } | null;
  after: { status: string | null; finalized_at: string | null } | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lifecycle audit rows for one invoice, oldest first. Includes rows written by
 * the REST engine and UI actions (both go through writeInvoiceAudit).
 */
export async function listInvoiceAuditHistory(
  knex: Knex | Knex.Transaction,
  tenant: string,
  invoiceId: string,
): Promise<InvoiceHistoryEntry[]> {
  const db = tenantDb(knex, tenant);
  const rows = await db.table('audit_logs')
    .where({ table_name: INVOICE_AUDIT_TABLE, record_id: invoiceId })
    .whereIn('operation', INVOICE_AUDIT_OPERATIONS)
    .orderBy('timestamp', 'asc')
    .select('audit_id', 'operation', 'user_id', 'timestamp', 'details') as Array<{
      audit_id: string;
      operation: string;
      user_id: string | null;
      timestamp: string | Date;
      details: any;
    }>;

  if (rows.length === 0) return [];

  const actorIds = [...new Set(
    rows
      .map((row) => row.user_id)
      .filter((id): id is string => typeof id === 'string' && UUID_PATTERN.test(id)),
  )];
  const actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const users = await db.table('users')
      .whereIn('user_id', actorIds)
      .select('user_id', 'first_name', 'last_name', 'username', 'email') as Array<Record<string, string | null>>;
    for (const u of users) {
      const full = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
      actorNames.set(String(u.user_id), full || u.username || u.email || String(u.user_id));
    }
  }

  return rows.map((row) => {
    const details = typeof row.details === 'string' ? safeParse(row.details) : (row.details ?? {});
    return {
      audit_id: row.audit_id,
      operation: row.operation,
      user_id: row.user_id,
      actor_name: row.user_id ? actorNames.get(row.user_id) ?? null : null,
      timestamp: row.timestamp,
      invoice_number: details.invoiceNumber ?? null,
      before: details.before ?? null,
      after: details.after ?? null,
    };
  });
}

function safeParse(value: string): Record<string, any> {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
