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
import {
  deleteVendorProductCore,
  queryVendorProducts,
  upsertVendorProductCore,
  type VendorProductListRow,
} from '../lib/vendorProducts';
import { isVendorCoreError } from '../lib/vendorErrors';

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

    if (isVendorCoreError(error)) {
      switch (error.code) {
        case 'vendor_and_product_required':
          return actionError('Choose both a vendor and a product before saving the offer.', 'features/inventory:errors.vendorProducts.vendorAndProductRequired');
        case 'unit_cost_invalid':
          return actionError('Vendor cost must be a non-negative amount.', 'features/inventory:errors.vendorProducts.costNonNegative');
        case 'vendor_not_found':
        case 'product_not_found':
          return actionError('The selected vendor or product is no longer valid. Please refresh and try again.', 'features/inventory:errors.vendorProducts.recordInvalid');
      }
    }
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '23503') {
    return actionError('The selected vendor or product is no longer valid. Please refresh and try again.', 'features/inventory:errors.vendorProducts.recordInvalid');
  }
  if (dbError?.code === '23505') {
    return actionError('This vendor offer already exists. Refresh and edit the existing offer.', 'features/inventory:errors.vendorProducts.duplicate');
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
  ): Promise<VendorProductListRow[] | VendorProductActionError> => {
    return withVendorProductActionErrors(async () => {
      await requireVendorPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, (trx: Knex.Transaction) => queryVendorProducts(trx, tenant, filter));
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
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => upsertVendorProductCore(trx, tenant, input));
    });
  },
);

export const deleteVendorProduct = withAuth(
  async (user, { tenant }, vendorId: string, serviceId: string): Promise<{ removed: boolean } | VendorProductActionError> => {
    return withVendorProductActionErrors(async () => {
      await requireVendorPerm(user, 'update');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, (trx: Knex.Transaction) => deleteVendorProductCore(trx, tenant, vendorId, serviceId));
    });
  },
);
