'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IStockMovement, IStockUnit } from '@alga-psa/types';
import {
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  recordStockMovement,
  ensureStockLevel,
  assertLocationWritable,
  publishInventoryEvent,
  timestampPayload,
} from '../lib';
import { loanerActionErrorFrom, normalizeDueDate } from './loanerRestockErrors';

async function requireInvPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'inventory', action))) {
    throw new Error(`Permission denied: inventory ${action} required`);
  }
}

export type LoanerActionError = ActionMessageError | ActionPermissionError;

async function withLoanerActionErrors<T>(work: () => Promise<T>): Promise<T | LoanerActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = loanerActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

async function publishStockUnitUpdated(
  tenant: string,
  unitId: string,
  serviceId: string | null | undefined,
  userId: string,
  changedFields: string[],
): Promise<void> {
  await publishInventoryEvent('INVENTORY_STOCK_UNIT_UPDATED', timestampPayload({
    tenant,
    unit_id: unitId,
    service_id: serviceId ?? undefined,
    user_id: userId,
    changed_fields: changedFields,
  }));
}

/**
 * Loaner dispatch (design §6.E). A serialized unit goes out on loan to a client:
 * `in_stock → on_loan`, set `client_id` + `loan_due_at`, clear location. NO COGS,
 * NO invoice — a loaner is not a sale, and it is excluded from quantity_on_hand.
 */
export const loanOut = withAuth(
  async (
    user,
    { tenant },
    unitId: string,
    input: { client_id: string; loan_due_at?: string | Date | null },
  ): Promise<IStockMovement | LoanerActionError> => {
    return withLoanerActionErrors(async () => {
    await requireInvPerm(user, 'update');
    if (!input?.client_id) throw new Error('client_id is required to loan out a unit');
    const loanDueAt = normalizeDueDate(input.loan_due_at);
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const unit = (await trx('stock_units').where({ tenant, unit_id: unitId }).first()) as IStockUnit | undefined;
      if (!unit) throw new Error('Stock unit not found');
      if (unit.status !== 'in_stock') {
        throw new Error(`Unit must be in_stock to loan out (current status: ${unit.status})`);
      }
      // A tech can't loan stock out of another tech's van (F036).
      await assertLocationWritable(trx, tenant, (user as any)?.user_id, unit.location_id);
      return recordStockMovement(trx, tenant, {
        movement_type: 'loan_out',
        service_id: unit.service_id,
        quantity: 1,
        unit_id: unitId,
        from_location_id: unit.location_id ?? null,
        source_doc_type: 'loan',
        performed_by: user.user_id,
        unitPatch: {
          status: 'on_loan',
          client_id: input.client_id,
          loan_due_at: loanDueAt,
          location_id: null,
        },
      });
    });
    });
  },
);

/**
 * Loaner return (design §6.E). A unit comes back from loan into stock:
 * `on_loan → in_stock`, restore location, clear client_id + loan_due_at.
 */
export const loanReturn = withAuth(
  async (user, { tenant }, unitId: string, input: { location_id: string }): Promise<IStockMovement | LoanerActionError> => {
    return withLoanerActionErrors(async () => {
    await requireInvPerm(user, 'update');
    if (!input?.location_id) throw new Error('location_id is required to return a loaner');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const unit = (await trx('stock_units').where({ tenant, unit_id: unitId }).first()) as IStockUnit | undefined;
      if (!unit) throw new Error('Stock unit not found');
      if (unit.status !== 'on_loan') {
        throw new Error(`Unit must be on_loan to return (current status: ${unit.status})`);
      }
      // Returning into a location writes there — same van scoping applies (F036).
      await assertLocationWritable(trx, tenant, (user as any)?.user_id, input.location_id);
      await ensureStockLevel(trx, tenant, unit.service_id, input.location_id);
      return recordStockMovement(trx, tenant, {
        movement_type: 'loan_in',
        service_id: unit.service_id,
        quantity: 1,
        unit_id: unitId,
        to_location_id: input.location_id,
        source_doc_type: 'loan',
        performed_by: user.user_id,
        unitPatch: {
          status: 'in_stock',
          location_id: input.location_id,
          client_id: null,
          loan_due_at: null,
        },
      });
    });
    });
  },
);

/**
 * Extend (or change) an out-on-loan unit's due date. A due-date change is not a
 * physical stock movement, so it patches `stock_units.loan_due_at` only and writes
 * NO ledger entry — the movement ledger records physical changes, not schedule ones.
 */
export const updateLoanDueDate = withAuth(
  async (
    user,
    { tenant },
    unitId: string,
    input: { loan_due_at: string | Date | null },
  ): Promise<IStockUnit | LoanerActionError> => {
    return withLoanerActionErrors(async () => {
      await requireInvPerm(user, 'update');
      const loanDueAt = normalizeDueDate(input?.loan_due_at);
      const { knex: db } = await createTenantKnex();
      const updated = await withTransaction(db, async (trx: Knex.Transaction) => {
        const unit = (await trx('stock_units').where({ tenant, unit_id: unitId }).first()) as IStockUnit | undefined;
        if (!unit) throw new Error('Stock unit not found');
        if (unit.status !== 'on_loan') {
          throw new Error(`Unit must be on_loan to change its due date (current status: ${unit.status})`);
        }
        // No assertLocationWritable — an on-loan unit has no location to scope against.
        const [row] = await trx('stock_units')
          .where({ tenant, unit_id: unitId })
          .update({ loan_due_at: loanDueAt, updated_at: trx.fn.now() })
          .returning('*');
        return row as IStockUnit;
      });
      await publishStockUnitUpdated(tenant, updated.unit_id, updated.service_id, user.user_id, ['loan_due_at']);
      return updated;
    });
  },
);

export interface LoanerOutRow {
  unit_id: string;
  service_id: string;
  service_name: string | null;
  sku: string | null;
  serial_number: string;
  mac_address: string | null;
  client_id: string | null;
  client_name: string | null;
  loaned_at: string | Date | null;
  loan_due_at: string | Date | null;
}

/**
 * Loaners-out report (design §6.E): which units are out, with whom, since when, and
 * when due back. `loaned_at` comes from the latest `loan_out` movement so the screen
 * can show "N days out" without a schema change.
 */
export const loanersOutReport = withAuth(async (user, { tenant }): Promise<LoanerOutRow[] | LoanerActionError> => {
  return withLoanerActionErrors(async () => {
  await requireInvPerm(user, 'read');
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const latestLoanOut = trx('stock_movements')
      .where({ tenant, movement_type: 'loan_out' })
      .groupBy('unit_id')
      .select('unit_id')
      .max('created_at as loaned_at')
      .as('lo');
    return trx('stock_units as su')
      .leftJoin('service_catalog as sc', function () {
        this.on('su.service_id', '=', 'sc.service_id').andOn('su.tenant', '=', 'sc.tenant');
      })
      .leftJoin('clients as c', function () {
        this.on('su.client_id', '=', 'c.client_id').andOn('su.tenant', '=', 'c.tenant');
      })
      .leftJoin(latestLoanOut, 'lo.unit_id', 'su.unit_id')
      .where({ 'su.tenant': tenant, 'su.status': 'on_loan' })
      .select(
        'su.unit_id',
        'su.service_id',
        'sc.service_name',
        'sc.sku',
        'su.serial_number',
        'su.mac_address',
        'su.client_id',
        'c.client_name',
        'lo.loaned_at',
        'su.loan_due_at',
      )
      .orderBy('su.loan_due_at', 'asc') as unknown as Promise<LoanerOutRow[]>;
  });
  });
});
