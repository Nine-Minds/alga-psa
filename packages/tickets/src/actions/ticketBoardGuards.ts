import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { CodedError } from '@alga-psa/ui/lib/errorHandling';

/**
 * Rejects moves onto a board that cannot receive tickets. Inactive boards are
 * hidden from every queue view, so a ticket parked there is invisible to
 * technicians until an admin re-enables the board.
 */
export async function assertBoardAcceptsTickets(
  trx: Knex.Transaction,
  tenant: string,
  boardId: string,
): Promise<void> {
  const board = await tenantDb(trx, tenant)
    .table('boards')
    .select('board_id', 'is_inactive')
    .where({ board_id: boardId })
    .first();

  if (!board) {
    throw new CodedError('Board not found', 'BOARD_NOT_FOUND');
  }

  if (board.is_inactive) {
    throw new CodedError('The destination board is inactive', 'BOARD_INACTIVE');
  }
}
