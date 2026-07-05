'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IVendor, PurchaseOrderStatus } from '@alga-psa/types';

/** Open PO statuses that block deactivating the vendor they belong to. */
const OPEN_PO_STATUSES: PurchaseOrderStatus[] = ['draft', 'open', 'partially_received'];

async function requireVendorPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'vendor', action))) {
    throw new Error(`Permission denied: vendor ${action} required`);
  }
}

export const listVendors = withAuth(
  async (user, { tenant }, opts?: { includeInactive?: boolean }): Promise<IVendor[]> => {
    await requireVendorPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const q = trx('vendors').where({ tenant });
      if (!opts?.includeInactive) q.andWhere({ is_active: true });
      return (await q.orderBy('vendor_name', 'asc')) as IVendor[];
    });
  },
);

export const getVendor = withAuth(
  async (user, { tenant }, vendorId: string): Promise<IVendor | null> => {
    await requireVendorPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const row = await trx('vendors').where({ tenant, vendor_id: vendorId }).first();
      return (row ?? null) as IVendor | null;
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
  ): Promise<IVendor> => {
    await requireVendorPerm(user, 'create');
    const vendorName = (input.vendor_name ?? '').trim();
    if (!vendorName) throw new Error('Vendor name is required');

    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      // vendor_name is unique per tenant; surface a clean error instead of a raw constraint violation.
      const existing = await trx('vendors')
        .where({ tenant })
        .whereRaw('LOWER(vendor_name) = LOWER(?)', [vendorName])
        .first();
      if (existing) throw new Error(`A vendor named "${vendorName}" already exists`);

      const [row] = await trx('vendors')
        .insert({
          tenant,
          vendor_name: vendorName,
          contact_name: input.contact_name ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          website: input.website ?? null,
          payment_terms: input.payment_terms ?? null,
          account_number: input.account_number ?? null,
          notes: input.notes ?? null,
          is_active: true,
        })
        .returning('*');
      return row as IVendor;
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
  ): Promise<IVendor> => {
    await requireVendorPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      if (typeof patch.vendor_name === 'string') {
        const vendorName = patch.vendor_name.trim();
        if (!vendorName) throw new Error('Vendor name is required');
        const conflict = await trx('vendors')
          .where({ tenant })
          .whereRaw('LOWER(vendor_name) = LOWER(?)', [vendorName])
          .andWhereNot({ vendor_id: vendorId })
          .first();
        if (conflict) throw new Error(`A vendor named "${vendorName}" already exists`);
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
      if (!row) throw new Error('Vendor not found');
      return row as IVendor;
    });
  },
);

/**
 * Deactivate a vendor. Guarded: cannot deactivate while the vendor still has
 * open purchase orders (status in draft/open/partially_received).
 */
export const deactivateVendor = withAuth(
  async (user, { tenant }, vendorId: string): Promise<IVendor> => {
    await requireVendorPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const openPo = await trx('purchase_orders')
        .where({ tenant, vendor_id: vendorId })
        .whereIn('status', OPEN_PO_STATUSES)
        .first();
      if (openPo) throw new Error('Cannot deactivate a vendor with open purchase orders');

      const [row] = await trx('vendors')
        .where({ tenant, vendor_id: vendorId })
        .update({ is_active: false, updated_at: trx.fn.now() })
        .returning('*');
      if (!row) throw new Error('Vendor not found');
      return row as IVendor;
    });
  },
);
