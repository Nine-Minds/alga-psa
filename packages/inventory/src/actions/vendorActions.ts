'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IVendor, PurchaseOrderStatus } from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { createVendorCore } from '../lib/vendors';

/** Open PO statuses that block deactivating the vendor they belong to. */
const OPEN_PO_STATUSES: PurchaseOrderStatus[] = ['draft', 'open', 'partially_received'];

export type VendorActionError = ActionMessageError | ActionPermissionError;

function vendorActionErrorFrom(error: unknown): VendorActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }
  }
  return null;
}

async function withVendorActionErrors<T>(work: () => Promise<T>): Promise<T | VendorActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = vendorActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

async function requireVendorPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'vendor', action))) {
    throw new Error(`Permission denied: vendor ${action} required`);
  }
}

export const listVendors = withAuth(
  async (user, { tenant }, opts?: { includeInactive?: boolean }): Promise<IVendor[] | VendorActionError> => {
    return withVendorActionErrors(async () => {
      await requireVendorPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        const q = trx('vendors').where({ tenant });
        if (!opts?.includeInactive) q.andWhere({ is_active: true });
        return (await q.orderBy('vendor_name', 'asc')) as IVendor[];
      });
    });
  },
);

export const getVendor = withAuth(
  async (user, { tenant }, vendorId: string): Promise<IVendor | null | VendorActionError> => {
    return withVendorActionErrors(async () => {
      await requireVendorPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        const row = await trx('vendors').where({ tenant, vendor_id: vendorId }).first();
        return (row ?? null) as IVendor | null;
      });
    });
  },
);

export const createVendor = withAuth(
  async (
    user,
    { tenant },
    input: {
      vendor_name: string;
      contact_name?: string | null;
      email?: string | null;
      phone?: string | null;
      website?: string | null;
      payment_terms?: string | null;
      account_number?: string | null;
      notes?: string | null;
    },
  ): Promise<IVendor | VendorActionError> => {
    if (!(await hasPermission(user, 'vendor', 'create'))) {
      return permissionError('Permission denied: vendor create required', 'features/inventory:errors.permissions.vendorCreate');
    }
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const result = await createVendorCore(trx, tenant, input);
      if (result.ok === true) return result.vendor;
      if (result.code === 'name_required') {
        return actionError('Vendor name is required', 'features/inventory:errors.vendors.nameRequired');
      }
      return actionError(`A vendor named "${result.name}" already exists`, 'features/inventory:errors.vendors.duplicateName', { name: result.name });
    });
  },
);

export const updateVendor = withAuth(
  async (
    user,
    { tenant },
    vendorId: string,
    patch: Partial<
      Pick<
        IVendor,
        | 'vendor_name'
        | 'contact_name'
        | 'email'
        | 'phone'
        | 'website'
        | 'payment_terms'
        | 'account_number'
        | 'notes'
        | 'is_active'
      >
    >,
  ): Promise<IVendor | VendorActionError> => {
    if (!(await hasPermission(user, 'vendor', 'update'))) {
      return permissionError('Permission denied: vendor update required', 'features/inventory:errors.permissions.vendorUpdate');
    }
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      if (typeof patch.vendor_name === 'string') {
        const vendorName = patch.vendor_name.trim();
        if (!vendorName) return actionError('Vendor name is required', 'features/inventory:errors.vendors.nameRequired');
        const conflict = await trx('vendors')
          .where({ tenant })
          .whereRaw('LOWER(vendor_name) = LOWER(?)', [vendorName])
          .andWhereNot({ vendor_id: vendorId })
          .first();
        if (conflict) return actionError(`A vendor named "${vendorName}" already exists`, 'features/inventory:errors.vendors.duplicateName', { name: vendorName });
      }

      const update: Record<string, unknown> = { updated_at: trx.fn.now() };
      for (const k of [
        'vendor_name',
        'contact_name',
        'email',
        'phone',
        'website',
        'payment_terms',
        'account_number',
        'notes',
        'is_active',
      ] as const) {
        if (k in patch) update[k] = (patch as any)[k];
      }
      if (typeof update.vendor_name === 'string') update.vendor_name = (update.vendor_name as string).trim();

      const [row] = await trx('vendors').where({ tenant, vendor_id: vendorId }).update(update).returning('*');
      if (!row) return actionError('Vendor not found', 'features/inventory:errors.vendors.notFound');
      return row as IVendor;
    });
  },
);

/**
 * Deactivate a vendor. Guarded: cannot deactivate while the vendor still has
 * open purchase orders (status in draft/open/partially_received).
 */
export const deactivateVendor = withAuth(
  async (user, { tenant }, vendorId: string): Promise<IVendor | VendorActionError> => {
    if (!(await hasPermission(user, 'vendor', 'update'))) {
      return permissionError('Permission denied: vendor update required', 'features/inventory:errors.permissions.vendorUpdate');
    }
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const openPo = await trx('purchase_orders')
        .where({ tenant, vendor_id: vendorId })
        .whereIn('status', OPEN_PO_STATUSES)
        .first();
      if (openPo) return actionError('Cannot deactivate a vendor with open purchase orders', 'features/inventory:errors.vendors.hasOpenPurchaseOrders');

      const [row] = await trx('vendors')
        .where({ tenant, vendor_id: vendorId })
        .update({ is_active: false, updated_at: trx.fn.now() })
        .returning('*');
      if (!row) return actionError('Vendor not found', 'features/inventory:errors.vendors.notFound');
      return row as IVendor;
    });
  },
);
