'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { IService, IServicePrice, ITicketMaterial, IStockUnit } from '@alga-psa/types';
import { isMspPrincipalUserType } from '@alga-psa/types';
import type { Knex } from 'knex';
import {
  addMaterial,
  deleteMaterial,
  listMaterials,
  MaterialValidationError,
  queryAvailableStockUnits,
  queryCatalogPickerItems,
  queryServicePrices,
} from '@alga-psa/inventory/lib';
import { InsufficientStockError, stockConflictResultFrom } from '@alga-psa/inventory/lib/consume';
import type { StockConflictResult } from '@alga-psa/inventory/lib/stockConflict';
import { authorizeTicketRecordAccess } from '../lib/ticketRecordAuthorization';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type TicketMaterialActionError = ActionMessageError | ActionPermissionError;

function ticketMaterialActionErrorFrom(error: unknown): TicketMaterialActionError | null {
  if (error instanceof Error) {
    if (error.message.includes('Permission denied')) {
      return permissionError(error.message);
    }
    if (
      error instanceof MaterialValidationError ||
      error instanceof InsufficientStockError ||
      error.message === 'Cannot delete a billed material.'
    ) {
      return actionError(error.message);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected material values is invalid. Please refresh and try again.', 'features/tickets:errors.material.invalidValue');
  }
  if (dbError?.code === '23502') {
    return dbError.column
      ? actionError(
          `Missing required material field: ${dbError.column}.`,
          'features/tickets:errors.material.missingFieldNamed',
          { field: dbError.column },
        )
      : actionError('Missing required material field.', 'features/tickets:errors.material.missingField');
  }
  if (dbError?.code === '23503') {
    return actionError('The selected ticket, client, product, or stock unit is no longer valid. Please refresh and try again.', 'features/tickets:errors.material.referenceInvalid');
  }
  if (dbError?.code === '23505') {
    return actionError('This material conflicts with an existing ticket material or stock assignment. Please refresh and try again.', 'features/tickets:errors.material.conflict');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the material values is not allowed. Please review the form and try again.', 'features/tickets:errors.material.valueNotAllowed');
  }

  return null;
}

export interface CatalogPickerSearchOptions {
  search?: string;
  page?: number;
  limit?: number;
  is_active?: boolean;
  item_kinds?: Array<'service' | 'product'>;
  billing_methods?: Array<'fixed' | 'hourly' | 'usage' | 'per_unit'>;
}

export type CatalogPickerItem = Pick<
  IService,
  'service_id' | 'service_name' | 'billing_method' | 'unit_of_measure' | 'item_kind' | 'sku' | 'product_category'
> & {
  default_rate: number;
  cost: number | null;
  cost_currency: string | null;
} & import('@alga-psa/inventory/lib/integrationTypes').PickerStockFields;

export const searchServiceCatalogForPicker = withAuth(async (
  user,
  { tenant },
  options: CatalogPickerSearchOptions = {}
): Promise<{ items: CatalogPickerItem[]; totalCount: number }> => {
  if (!isMspPrincipalUserType(user.user_type)) return { items: [], totalCount: 0 };
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'service', 'read', trx)
      || !await hasPermission(user, 'inventory', 'read', trx)) {
      return { items: [], totalCount: 0 };
    }
    const { items, totalCount } = await queryCatalogPickerItems(trx, tenant, options);
    return { items: items as CatalogPickerItem[], totalCount };
  });
});

export const getServicePrices = withAuth(async (
  user,
  { tenant },
  serviceId: string
): Promise<IServicePrice[]> => {
  if (!isMspPrincipalUserType(user.user_type)) return [];
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'service', 'read', trx)
      || !await hasPermission(user, 'inventory', 'read', trx)) {
      return [];
    }
    return queryServicePrices(trx, tenant, serviceId);
  });
});

export const listTicketMaterials = withAuth(async (
  user,
  { tenant },
  ticketId: string
): Promise<ITicketMaterial[] | TicketMaterialActionError> => {
  try {
    if (!isMspPrincipalUserType(user.user_type)) {
      throw new Error('Permission denied: MSP ticket access required');
    }
    if (!await hasPermission(user, 'ticket', 'read')) {
      throw new Error('Permission denied: ticket read required');
    }
    const { knex: db } = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      await authorizeTicketRecordAccess({ trx, tenant, user, ticketId, action: 'read' });
      return (await listMaterials(trx, tenant, 'ticket', ticketId)) as ITicketMaterial[];
    });
  } catch (error) {
    const expected = ticketMaterialActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const addTicketMaterial = withAuth(async (
  user,
  { tenant },
  input: {
    ticket_id: string;
    client_id: string;
    service_id: string;
    quantity: number;
    rate: number;
    currency_code: string;
    description?: string | null;
    unit_id?: string | null; // serialized: the picked stock unit to deliver
    /** Set only after the user confirmed a stockConflict result with overrideable=true. */
    allow_reserved_override?: boolean;
  }
): Promise<ITicketMaterial | TicketMaterialActionError | StockConflictResult> => {
  try {
    if (!isMspPrincipalUserType(user.user_type)) {
      throw new Error('Permission denied: MSP ticket access required');
    }
    if (!await hasPermission(user, 'ticket', 'update')) {
      throw new Error('Permission denied: ticket update required');
    }
    const { knex: db } = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      await authorizeTicketRecordAccess({ trx, tenant, user, ticketId: input.ticket_id, action: 'update' });
      return (await addMaterial(
        trx,
        tenant,
        { ...input, parent_type: 'ticket', parent_id: input.ticket_id },
        (user as any)?.user_id ?? null,
      )) as ITicketMaterial;
    });
  } catch (error) {
    // Stock-level refusals travel as a structured, serializable result so the dialog can
    // show the refusal or the override prompt (thrown messages do not cross the boundary).
    // LEVERAGE: pattern stock-conflict-action-mapping — the stockConflictResultFrom -> actionErrorFrom sequence repeats in tickets, projects and billing add actions.
    const conflict = stockConflictResultFrom(error);
    if (conflict) return conflict;
    const expected = ticketMaterialActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/** In-stock serialized units available to pick when adding a serialized product as a material. */
export const listAvailableStockUnitsForMaterial = withAuth(async (
  user,
  { tenant },
  serviceId: string
): Promise<IStockUnit[]> => {
  if (!(await hasPermission(user, 'inventory', 'read'))) return [];
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    return queryAvailableStockUnits(trx, tenant, serviceId);
  });
});

export const deleteTicketMaterial = withAuth(async (
  user,
  { tenant },
  ticketMaterialId: string
): Promise<void | TicketMaterialActionError> => {
  try {
    if (!isMspPrincipalUserType(user.user_type)) {
      throw new Error('Permission denied: MSP ticket access required');
    }
    if (!await hasPermission(user, 'ticket', 'update')) {
      throw new Error('Permission denied: ticket update required');
    }
    const { knex: db } = await createTenantKnex();
    await withTransaction(db, async (trx: Knex.Transaction) => {
      const material = await tenantDb(trx, tenant)
        .table('ticket_materials')
        .where({ ticket_material_id: ticketMaterialId })
        .first('ticket_id') as { ticket_id: string } | undefined;
      if (!material) return;
      await authorizeTicketRecordAccess({ trx, tenant, user, ticketId: material.ticket_id, action: 'update' });
      await deleteMaterial(trx, tenant, 'ticket', ticketMaterialId, (user as any)?.user_id ?? null);
    });
  } catch (error) {
    const expected = ticketMaterialActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});
