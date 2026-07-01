'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IStockTransfer, IStockTransferLine } from '@alga-psa/types';
import { recordStockMovement, availableQuantity, assertLocationWritable } from '../lib';

/**
 * Stock transfers — two-step, in-transit moves between locations (design §6.C).
 *
 * Dispatch removes stock from the source (transfer_out); the stock is in-transit and
 * NOT available at the destination until the transfer is received (transfer_in). All
 * stock changes flow through the movement primitive — we never touch stock_levels or
 * unit status directly. Serialized units ride the status machine
 * in_stock → in_transit → in_stock.
 */

async function requireTransferPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'stock_transfer', action))) {
    throw new Error(`Permission denied: stock_transfer ${action} required`);
  }
}

export interface DispatchTransferLineInput {
  service_id: string;
  quantity: number;
  unit_id?: string | null;
}

export interface DispatchTransferInput {
  from_location_id: string;
  to_location_id: string;
  lines: DispatchTransferLineInput[];
  notes?: string | null;
}

/** Load a transfer with its lines (or null if missing). */
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

export const dispatchTransfer = withAuth(
  async (user, { tenant }, input: DispatchTransferInput): Promise<IStockTransfer> => {
    await requireTransferPerm(user, 'create');

    const fromLocation = input.from_location_id;
    const toLocation = input.to_location_id;
    if (!fromLocation || !toLocation) throw new Error('from_location_id and to_location_id are required');
    if (fromLocation === toLocation) throw new Error('Transfer source and destination must differ');
    if (!input.lines || input.lines.length === 0) throw new Error('A transfer requires at least one line');

    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      // A tech can't dispatch stock out of another tech's van (F034).
      await assertLocationWritable(trx, tenant, (user as any)?.user_id, fromLocation);
      const [transfer] = await trx('stock_transfers')
        .insert({
          tenant,
          from_location_id: fromLocation,
          to_location_id: toLocation,
          status: 'dispatched',
          dispatched_by: user.user_id,
          dispatched_at: trx.fn.now(),
          notes: input.notes ?? null,
        })
        .returning('*');

      for (const line of input.lines) {
        const quantity = Number(line.quantity);
        if (!line.service_id) throw new Error('Each transfer line requires a service_id');
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Transfer line quantity must be positive');

        if (line.unit_id) {
          // Serialized: the unit must be in_stock at the source location. Locked so a
          // concurrent dispatch/fulfill cannot claim the same unit (F022).
          const unit = await trx('stock_units').where({ tenant, unit_id: line.unit_id }).forUpdate().first();
          if (!unit) throw new Error(`Stock unit ${line.unit_id} not found`);
          if (unit.service_id !== line.service_id) throw new Error('Stock unit does not match line service_id');
          if (unit.status !== 'in_stock') throw new Error('Only in_stock units can be transferred');
          if (unit.location_id !== fromLocation) throw new Error('Stock unit is not at the transfer source location');
        } else {
          // Non-serialized: source must have enough available stock. Locked so
          // concurrent dispatches serialize on the availability read (F019).
          const level = await trx('stock_levels')
            .where({ tenant, service_id: line.service_id, location_id: fromLocation })
            .forUpdate()
            .first();
          const available = level ? availableQuantity(level) : 0;
          if (available < quantity) {
            throw new Error(`Insufficient available stock at source for service ${line.service_id} (have ${available}, need ${quantity})`);
          }
        }

        await trx('stock_transfer_lines').insert({
          tenant,
          transfer_id: transfer.transfer_id,
          service_id: line.service_id,
          quantity,
          unit_id: line.unit_id ?? null,
        });

        await recordStockMovement(trx, tenant, {
          movement_type: 'transfer_out',
          service_id: line.service_id,
          quantity,
          unit_id: line.unit_id ?? null,
          from_location_id: fromLocation,
          to_location_id: toLocation,
          source_doc_type: 'transfer',
          source_doc_id: transfer.transfer_id,
          performed_by: user.user_id,
          ...(line.unit_id ? { unitPatch: { status: 'in_transit', location_id: null } } : {}),
        });
      }

      return (await loadTransfer(trx, tenant, transfer.transfer_id)) as IStockTransfer;
    });
  },
);

export const receiveTransfer = withAuth(
  async (user, { tenant }, transferId: string): Promise<IStockTransfer> => {
    await requireTransferPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      // Header row lock = transition mutex: a concurrent duplicate receive (or a
      // racing cancel) blocks here and is then rejected by the status guard (F019).
      const transfer = await trx('stock_transfers').where({ tenant, transfer_id: transferId }).forUpdate().first();
      if (!transfer) throw new Error('Transfer not found');
      if (transfer.status !== 'dispatched') throw new Error(`Cannot receive a transfer in status '${transfer.status}'`);

      const lines = (await trx('stock_transfer_lines')
        .where({ tenant, transfer_id: transferId })) as IStockTransferLine[];

      for (const line of lines) {
        await recordStockMovement(trx, tenant, {
          movement_type: 'transfer_in',
          service_id: line.service_id,
          quantity: Number(line.quantity),
          unit_id: line.unit_id ?? null,
          from_location_id: transfer.from_location_id,
          to_location_id: transfer.to_location_id,
          source_doc_type: 'transfer',
          source_doc_id: transferId,
          performed_by: user.user_id,
          ...(line.unit_id ? { unitPatch: { status: 'in_stock', location_id: transfer.to_location_id } } : {}),
        });
      }

      await trx('stock_transfers')
        .where({ tenant, transfer_id: transferId })
        .update({ status: 'received', received_by: user.user_id, received_at: trx.fn.now(), updated_at: trx.fn.now() });

      return (await loadTransfer(trx, tenant, transferId)) as IStockTransfer;
    });
  },
);

/** Cancel a dispatched transfer before receipt: return the in-transit stock to the source. */
export const cancelTransfer = withAuth(
  async (user, { tenant }, transferId: string): Promise<IStockTransfer> => {
    await requireTransferPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      // Same mutex as receiveTransfer: cancel-vs-receive races resolve to exactly one (F019).
      const transfer = await trx('stock_transfers').where({ tenant, transfer_id: transferId }).forUpdate().first();
      if (!transfer) throw new Error('Transfer not found');
      if (transfer.status !== 'dispatched') throw new Error(`Cannot cancel a transfer in status '${transfer.status}'`);

      const lines = (await trx('stock_transfer_lines')
        .where({ tenant, transfer_id: transferId })) as IStockTransferLine[];

      for (const line of lines) {
        // Return the stock to the source: a transfer_in landing back at from_location.
        await recordStockMovement(trx, tenant, {
          movement_type: 'transfer_in',
          service_id: line.service_id,
          quantity: Number(line.quantity),
          unit_id: line.unit_id ?? null,
          from_location_id: transfer.to_location_id,
          to_location_id: transfer.from_location_id,
          reason: 'Transfer cancelled — returned to source',
          source_doc_type: 'transfer',
          source_doc_id: transferId,
          performed_by: user.user_id,
          ...(line.unit_id ? { unitPatch: { status: 'in_stock', location_id: transfer.from_location_id } } : {}),
        });
      }

      await trx('stock_transfers')
        .where({ tenant, transfer_id: transferId })
        .update({ status: 'cancelled', updated_at: trx.fn.now() });

      return (await loadTransfer(trx, tenant, transferId)) as IStockTransfer;
    });
  },
);

export const getTransfer = withAuth(
  async (user, { tenant }, transferId: string): Promise<IStockTransfer | null> => {
    await requireTransferPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => loadTransfer(trx, tenant, transferId));
  },
);

export const listTransfers = withAuth(
  async (
    user,
    { tenant },
    opts?: { status?: IStockTransfer['status']; from_location_id?: string; to_location_id?: string },
  ): Promise<IStockTransfer[]> => {
    await requireTransferPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const q = trx('stock_transfers').where({ tenant });
      if (opts?.status) q.andWhere({ status: opts.status });
      if (opts?.from_location_id) q.andWhere({ from_location_id: opts.from_location_id });
      if (opts?.to_location_id) q.andWhere({ to_location_id: opts.to_location_id });
      return (await q.orderBy('dispatched_at', 'desc')) as IStockTransfer[];
    });
  },
);
