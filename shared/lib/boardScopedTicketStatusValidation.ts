import type { Knex } from 'knex';

import { TicketModel } from '../models/ticketModel';

type BoardScopedTicketStatusSelection = {
  trx: Knex | Knex.Transaction;
  tenant: string;
  boardId?: string | null;
  statusId?: string | null;
  statusLabel?: string;
};

export async function assertBoardScopedTicketStatusSelection({
  trx,
  tenant,
  boardId,
  statusId,
  statusLabel = 'Ticket status',
}: BoardScopedTicketStatusSelection): Promise<void> {
  if (!statusId) {
    return;
  }

  if (!boardId) {
    throw new Error(`${statusLabel} requires a selected board`);
  }

  const validationResult = await TicketModel.validateStatusBelongsToBoard(
    statusId,
    boardId,
    tenant,
    trx as Knex.Transaction
  );

  if (!validationResult.valid) {
    throw new Error(`${statusLabel} must belong to the selected board`);
  }
}
