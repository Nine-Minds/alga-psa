'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IVendorProduct } from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

// NOTE: 'use server' file — export ONLY async functions (+ erased types).

async function requireVendorPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'vendor', action))) {
    throw new Error(`Permission denied: vendor ${action} required`);
  }
}

export type VendorProductActionError = ActionMessageError | ActionPermissionError;

function vendorProductActionErrorFrom(error: unknown): VendorProductActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }

    switch (error.message) {
      case 'vendor_id and service_id are required':
        return actionError('Choose both a vendor and a product before saving the offer.');
      case 'unit_cost must be a non-negative integer (cents)':
        return actionError('Vendor cost must be a non-negative amount.');
    }
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '23503') {
    return actionError('The selected vendor or product is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This vendor offer already exists. Refresh and edit the existing offer.');
  }

  return null;
}

async function withVendorProductActionErrors<T>(work: () => Promise<T>): Promise<T | VendorProductActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = vendorProductActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

/**
 * Vendor price lists (F053): the distributor's part number and contract cost per
 * (vendor, product). PO lines and reorder suggestions price from these; the
 * preferred offer (one per product, DB-enforced) also drives
 * product_inventory_settings.preferred_vendor_id so existing grouping keeps working.
 */
export const listVendorProducts = withAuth(
  async (
    user,
    { tenant },
    filter?: { vendor_id?: string; service_id?: string },
  ): Promise<Array<IVendorProduct & { service_name: string | null; sku: string | null; vendor_name: string | null }> | VendorProductActionError> => {
    return withVendorProductActionErrors(async () => {
      await requireVendorPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        const q = trx('vendor_products as vp')
          .leftJoin('service_catalog as sc', function () {
            this.on('sc.service_id', '=', 'vp.service_id').andOn('sc.tenant', '=', 'vp.tenant');
          })
          .leftJoin('vendors as v', function () {
            this.on('v.vendor_id', '=', 'vp.vendor_id').andOn('v.tenant', '=', 'vp.tenant');
          })
          .where('vp.tenant', tenant)
          .select('vp.*', 'sc.service_name', 'sc.sku', 'v.vendor_name')
          .orderBy('sc.service_name', 'asc');
        if (filter?.vendor_id) q.andWhere('vp.vendor_id', filter.vendor_id);
        if (filter?.service_id) q.andWhere('vp.service_id', filter.service_id);
        return (await q) as any;
      });
    });
  },
);

export const upsertVendorProduct = withAuth(
  async (
    user,
    { tenant },
    input: {
      vendor_id: string;
      service_id: string;
      vendor_sku?: string | null;
      unit_cost?: number | null; // cents
      cost_currency?: string;
      lead_time_days?: number | null;
      is_preferred?: boolean;
    },
  ): Promise<IVendorProduct | VendorProductActionError> => {
    return withVendorProductActionErrors(async () => {
      await requireVendorPerm(user, 'update');
      if (!input.vendor_id || !input.service_id) throw new Error('vendor_id and service_id are required');
      if (input.unit_cost != null && (!Number.isInteger(input.unit_cost) || input.unit_cost < 0)) {
        throw new Error('unit_cost must be a non-negative integer (cents)');
      }
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        if (input.is_preferred) {
          // Single preferred offer per product (backed by the partial unique index).
          await trx('vendor_products')
            .where({ tenant, service_id: input.service_id, is_preferred: true })
            .andWhereNot({ vendor_id: input.vendor_id })
            .update({ is_preferred: false, updated_at: trx.fn.now() });
        }
        const [row] = await trx('vendor_products')
          .insert({
            tenant,
            vendor_id: input.vendor_id,
            service_id: input.service_id,
            vendor_sku: input.vendor_sku?.trim() || null,
            unit_cost: input.unit_cost ?? null,
            cost_currency: (input.cost_currency ?? 'USD').trim() || 'USD',
            lead_time_days: input.lead_time_days ?? null,
            is_preferred: input.is_preferred ?? false,
          })
          .onConflict(['tenant', 'vendor_id', 'service_id'])
          .merge({
            vendor_sku: input.vendor_sku?.trim() || null,
            unit_cost: input.unit_cost ?? null,
            cost_currency: (input.cost_currency ?? 'USD').trim() || 'USD',
            lead_time_days: input.lead_time_days ?? null,
            is_preferred: input.is_preferred ?? false,
            updated_at: trx.fn.now(),
          })
          .returning('*');

        // Keep the settings-level preferred vendor in sync — reorder grouping reads it.
        if (input.is_preferred) {
          await trx('product_inventory_settings')
            .where({ tenant, service_id: input.service_id })
            .update({ preferred_vendor_id: input.vendor_id, updated_at: trx.fn.now() });
        }
        return row as IVendorProduct;
      });
    });
  },
);

export const deleteVendorProduct = withAuth(
  async (user, { tenant }, vendorId: string, serviceId: string): Promise<{ removed: boolean } | VendorProductActionError> => {
    return withVendorProductActionErrors(async () => {
      await requireVendorPerm(user, 'update');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        const removed = await trx('vendor_products')
          .where({ tenant, vendor_id: vendorId, service_id: serviceId })
          .del();
        return { removed: removed > 0 };
      });
    });
  },
);
