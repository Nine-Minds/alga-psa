'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IVendor } from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  createVendorCore,
  deactivateVendorCore,
  queryVendor,
  queryVendors,
  updateVendorCore,
  type UpdateVendorInput,
} from '../lib/vendors';
import { isVendorCoreError, type VendorCoreError } from '../lib/vendorErrors';

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

/** Map a typed core error to the translated message this action has always returned. */
function vendorCoreActionError(error: VendorCoreError): ActionMessageError {
  switch (error.code) {
    case 'name_required':
      return actionError('Vendor name is required', 'features/inventory:errors.vendors.nameRequired');
    case 'duplicate_name':
      return actionError(error.message, 'features/inventory:errors.vendors.duplicateName', { name: error.details.name ?? '' });
    case 'has_open_purchase_orders':
      return actionError('Cannot deactivate a vendor with open purchase orders', 'features/inventory:errors.vendors.hasOpenPurchaseOrders');
    default:
      return actionError('Vendor not found', 'features/inventory:errors.vendors.notFound');
  }
}

async function withVendorCoreErrors<T>(work: () => Promise<T>): Promise<T | ActionMessageError> {
  try {
    return await work();
  } catch (error) {
    if (isVendorCoreError(error)) return vendorCoreActionError(error);
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
        return (await queryVendors(trx, tenant, { includeInactive: opts?.includeInactive })).data;
      });
    });
  },
);

export const getVendor = withAuth(
  async (user, { tenant }, vendorId: string): Promise<IVendor | null | VendorActionError> => {
    return withVendorActionErrors(async () => {
      await requireVendorPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, (trx: Knex.Transaction) => queryVendor(trx, tenant, vendorId));
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
  async (user, { tenant }, vendorId: string, patch: UpdateVendorInput): Promise<IVendor | VendorActionError> => {
    if (!(await hasPermission(user, 'vendor', 'update'))) {
      return permissionError('Permission denied: vendor update required', 'features/inventory:errors.permissions.vendorUpdate');
    }
    const { knex: db } = await createTenantKnex();
    return withVendorCoreErrors(() =>
      withTransaction(db, (trx: Knex.Transaction) => updateVendorCore(trx, tenant, vendorId, patch)),
    );
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
    return withVendorCoreErrors(() =>
      withTransaction(db, (trx: Knex.Transaction) => deactivateVendorCore(trx, tenant, vendorId)),
    );
  },
);
