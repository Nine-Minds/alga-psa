import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

export async function seedBoardTicketStatusesFromStandards(
  trx: Knex.Transaction,
  tenant: string,
  boardId: string,
  userId: string | null
): Promise<number> {
  const tenantScopedTable = <Row extends object = Record<string, any>>(table: string) =>
    tenantDb(trx, tenant).table<Row>(table);

  const existingStatus = await tenantScopedTable('statuses')
    .where({ board_id: boardId, status_type: 'ticket' })
    .first('status_id');

  if (existingStatus) {
    return 0;
  }

  const standardStatuses = await tenantDb(trx, tenant).table('standard_statuses')
    .where({ item_type: 'ticket' })
    .orderBy('display_order', 'asc')
    .orderBy('name', 'asc');

  if (standardStatuses.length === 0) {
    return 0;
  }

  const statusColumns = await tenantDb(trx, tenant).table('statuses').columnInfo();
  const hasStatusColumn = (columnName: string) => Object.prototype.hasOwnProperty.call(statusColumns, columnName);
  const now = new Date().toISOString();

  await tenantScopedTable('statuses').insert(standardStatuses.map((status: any) => ({
    tenant,
    board_id: boardId,
    name: status.name,
    status_type: 'ticket',
    order_number: status.display_order,
    is_closed: normalizeBoolean(status.is_closed),
    is_default: normalizeBoolean(status.is_default),
    created_by: userId,
    ...(hasStatusColumn('item_type') ? { item_type: 'ticket' } : {}),
    ...(hasStatusColumn('standard_status_id') ? { standard_status_id: status.standard_status_id } : {}),
    ...(hasStatusColumn('created_at') ? { created_at: now } : {}),
    ...(hasStatusColumn('updated_at') ? { updated_at: now } : {})
  })));

  return standardStatuses.length;
}
