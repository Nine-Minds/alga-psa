import { Knex } from 'knex';
import { IStockTransfer, IStockTransferLine } from '@alga-psa/types';
import { recordStockMovement } from './movements';

async function loadTransfer(
  trx: Knex.Transaction,
  tenant: string,
  transferId: string,
): Promise<IStockTransfer | null> {
  const transfer = await trx('stock_transfers').where({ tenant, transfer_id: transferId }).first();
  if (!transfer) return null;
  const lines = (await trx('stock_transfer_lines')
    .where({ tenant, transfer_id: transferId })
    .orderBy('created_at', 'asc')) as IStockTransferLine[];
  return { ...(transfer as IStockTransfer), lines };
}

export async function queryTransfers(
  trx: Knex.Transaction,
  tenant: string,
  opts?: { status?: IStockTransfer['status']; from_location_id?: string; to_location_id?: string },
): Promise<IStockTransfer[]> {
  const query = trx('stock_transfers').where({ tenant });
  if (opts?.status) query.andWhere({ status: opts.status });
  if (opts?.from_location_id) query.andWhere({ from_location_id: opts.from_location_id });
  if (opts?.to_location_id) query.andWhere({ to_location_id: opts.to_location_id });
  return (await query.orderBy('dispatched_at', 'desc')) as IStockTransfer[];
}

/** Receive a dispatched transfer inside the caller's transaction. */
export async function receiveTransferCore(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  input: { transfer_id: string },
): Promise<IStockTransfer> {
  const transfer = await trx('stock_transfers')
    .where({ tenant, transfer_id: input.transfer_id })
    .forUpdate()
    .first();
  if (!transfer) throw new Error('Transfer not found');
  if (transfer.status !== 'dispatched') {
    throw new Error(`Cannot receive a transfer in status '${transfer.status}'`);
  }

  const lines = (await trx('stock_transfer_lines')
    .where({ tenant, transfer_id: input.transfer_id })) as IStockTransferLine[];
  for (const line of lines) {
    await recordStockMovement(trx, tenant, {
      movement_type: 'transfer_in',
      service_id: line.service_id,
      quantity: Number(line.quantity),
      unit_id: line.unit_id ?? null,
      from_location_id: transfer.from_location_id,
      to_location_id: transfer.to_location_id,
      source_doc_type: 'transfer',
      source_doc_id: input.transfer_id,
      performed_by: userId,
      ...(line.unit_id ? { unitPatch: { status: 'in_stock' as const, location_id: transfer.to_location_id } } : {}),
    });
  }

  await trx('stock_transfers')
    .where({ tenant, transfer_id: input.transfer_id })
    .update({ status: 'received', received_by: userId, received_at: trx.fn.now(), updated_at: trx.fn.now() });
  return (await loadTransfer(trx, tenant, input.transfer_id)) as IStockTransfer;
}
