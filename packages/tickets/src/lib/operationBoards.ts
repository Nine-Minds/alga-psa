import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IBoard, IUserWithRoles } from '@alga-psa/types';
import { resolveOperationBoardIds, type ScopedOperation } from '@alga-psa/authorization/operationScope';

/**
 * The boards a picker may offer for one operation: Add Ticket (`create`), a ticket filter (`read`), or the
 * destination of an existing ticket (`update`). The set comes from the authorization layer
 * (`resolveOperationBoardIds`), so a co-managed seat technician and a bundle that narrows boards are decided in
 * one place, and the set is applied in the query: nothing is filtered after the fetch.
 * An unrestricted caller's query is exactly the tenant's board list.
 */
export async function listBoardsForOperation(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  operation: ScopedOperation,
  options: { includeInactive?: boolean } = {},
): Promise<IBoard[]> {
  const boardIds = await resolveOperationBoardIds(trx, { tenant, user, action: operation });
  const query = tenantDb(trx, tenant).table<IBoard>('boards');
  if (options.includeInactive === false) query.where({ is_inactive: false });
  if (boardIds !== null) {
    if (boardIds.length === 0) return [];
    query.whereIn('board_id', boardIds);
  }
  return query.orderBy('display_order', 'asc').orderBy('board_name', 'asc');
}
