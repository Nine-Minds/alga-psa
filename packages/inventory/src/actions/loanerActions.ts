'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IStockMovement, IStockUnit } from '@alga-psa/types';
import {
  actionError,
  permissionError,
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

async function requireInvPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'inventory', action))) {
    throw new Error(`Permission denied: inventory ${action} required`);
  }
}

export type LoanerActionError = ActionMessageError | ActionPermissionError;

// Human labels for the 8 raw unit statuses, so a status-guard error reads like a
// sentence and never leaks a snake_case enum value into a toast.
const STATUS_LABELS: Record<string, string> = {
  in_stock: 'In stock',
  allocated: 'Allocated',
  in_transit: 'In transit',
  on_loan: 'On loan',
  delivered: 'Delivered',
  returned: 'Returned',
  in_rma: 'In RMA',
  retired: 'Retired',
};

function humanStatus(raw: string): string {
  return STATUS_LABELS[raw] ?? raw.replace(/_/g, ' ');
}

/** Pull the `(current status: X)` the guard messages embed, so the mapper can humanize it. */
function currentStatusOf(message: string): string | null {
  const m = message.match(/\(current status: ([^)]+)\)/);
  return m ? m[1] : null;
}

function loanerActionErrorFrom(error: unknown): LoanerActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }

    switch (error.message) {
      case 'client_id is required to loan out a unit':
        return actionError('Choose a client before loaning out the unit.');
      case 'location_id is required to return a loaner':
        return actionError('Choose a return location.');
      case 'loan_due_at must be a valid date':
        return actionError('Choose a valid due date.');
      case 'Stock unit not found':
        return actionError('Stock unit not found. It may have been updated or deleted. Refresh and try again.');
    }

    // Status guards throw with the raw enum embedded; translate to a sentence here.
    if (error.message.startsWith('Unit must be in_stock ')) {
      const status = currentStatusOf(error.message);
      return actionError(
        status
          ? `This unit can't be loaned out — it's currently ${humanStatus(status)}.`
          : "This unit can't be loaned out.",
      );
    }
    if (error.message.startsWith('Unit must be on_loan ')) {
      const status = currentStatusOf(error.message);
      return actionError(
        status
          ? `This unit isn't out on loan — it's currently ${humanStatus(status)}.`
          : "This unit isn't out on loan.",
      );
    }
  }

  const dbError = error as { code?: string };
  // A serial/MAC typed where a UUID is expected casts to `22P02`; without pickers this
  // is defense-in-depth, but the raw Knex SQL text must never reach a toast.
  if (dbError?.code === '22P02') {
    return actionError("That doesn't look like a valid record reference. Pick the unit and client from the lists.");
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected loaner records is no longer valid. Refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This loaner update conflicts with an existing record. Refresh and try again.');
  }

  return null;
}

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

/** Reject a `loan_due_at` we can't store as a real timestamp before it hits the DB. */
function normalizeDueDate(value: string | Date | null | undefined): string | Date | null {
  if (value == null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error('loan_due_at must be a valid date');
  return value;
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
