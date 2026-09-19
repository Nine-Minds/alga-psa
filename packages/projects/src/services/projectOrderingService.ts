import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withCoManagedOperationalTransaction } from '@alga-psa/licensing';
import { OrderingService } from '../lib/orderingUtils';

type Scope = { projectId: string } | { phaseId: string; statusId: string };
type OrderedRow = { id: string; order_key: string | null };

function scopedRows(trx: Knex.Transaction, tenant: string, scope: Scope) {
  const db = tenantDb(trx, tenant);
  return 'projectId' in scope
    ? db.table('project_phases').where('project_id', scope.projectId).select('phase_id as id', 'order_key')
    : db.table('project_tasks').where({ phase_id: scope.phaseId, project_status_mapping_id: scope.statusId })
        .select('task_id as id', 'order_key');
}

function needsRepair(rows: OrderedRow[]): boolean {
  for (let index = 0; index < rows.length; index++) {
    const key = rows[index].order_key;
    if (!key || (index > 0 && rows[index - 1].order_key! >= key)) return true;
    // Ask the same fractional-indexing implementation used by moves to validate
    // every key, including the final row and a one-item group.
    try { OrderingService.generateKeyForPosition(key, null); }
    catch { return true; }
  }
  return false;
}

/** Repair and regeneration share the caller's transaction and admission locks. */
async function writeOrderKeys(
  conn: Knex | Knex.Transaction,
  tenant: string,
  scope: Scope,
  force: boolean,
): Promise<boolean> {
  return withCoManagedOperationalTransaction(conn, tenant, async trx => {
    const isPhase = 'projectId' in scope;
    const query = scopedRows(trx, tenant, scope).orderByRaw('order_key ASC NULLS LAST');
    if (isPhase) query.orderBy('end_date');
    const rows = await query.orderBy(isPhase ? 'phase_id' : 'task_id') as OrderedRow[];
    if (rows.length === 0 || (!force && !needsRepair(rows))) return false;
    const table = isPhase ? 'project_phases' : 'project_tasks';
    const primaryKey = isPhase ? 'phase_id' : 'task_id';
    const keys = OrderingService.generateInitialKeys(rows.length);
    for (let index = 0; index < rows.length; index++) {
      await tenantDb(trx, tenant).table(table).where(primaryKey, rows[index].id)
        .update({ order_key: keys[index], updated_at: trx.fn.now() });
    }
    return true;
  });
}

export const regenerateTaskOrderKeys = (conn: Knex | Knex.Transaction, tenant: string, phaseId: string, statusId: string) =>
  writeOrderKeys(conn, tenant, { phaseId, statusId }, true);
export const repairTaskOrderKeys = (conn: Knex | Knex.Transaction, tenant: string, phaseId: string, statusId: string) =>
  writeOrderKeys(conn, tenant, { phaseId, statusId }, false);
export const regeneratePhaseOrderKeys = (conn: Knex | Knex.Transaction, tenant: string, projectId: string) =>
  writeOrderKeys(conn, tenant, { projectId }, true);
export const repairPhaseOrderKeys = (conn: Knex | Knex.Transaction, tenant: string, projectId: string) =>
  writeOrderKeys(conn, tenant, { projectId }, false);
