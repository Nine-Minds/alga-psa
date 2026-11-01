'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { IService, IServicePrice, ITicketMaterial, IStockUnit } from '@alga-psa/types';
import type { Knex } from 'knex';
import {
  addMaterial,
  deleteMaterial,
  listMaterials,
  MaterialValidationError,
  queryAvailableStockUnits,
  queryCatalogPickerItems,
  queryServicePrices,
  recordStockConsumption,
  recordStockMovement,
  collectStockLowSignalAfterConsume,
  publishInventoryEvent,
} from '@alga-psa/inventory/lib';
import { z } from 'zod';
import { InsufficientStockError, stockConflictResultFrom } from '@alga-psa/inventory/lib/consume';
import type { StockConflictResult } from '@alga-psa/inventory/lib/stockConflict';
import {
  actionError,
  CodedError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type TicketMaterialActionError = ActionMessageError | ActionPermissionError;

function ticketMaterialActionErrorFrom(error: unknown): TicketMaterialActionError | null {
  if (error instanceof Error) {
    if (error instanceof CodedError && error.code === 'TICKET_MATERIAL_EDIT') {
      return actionError(error.message, error.messageKey);
    }
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
  category_id?: string;
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
  _user,
  { tenant },
  options: CatalogPickerSearchOptions = {}
): Promise<{ items: CatalogPickerItem[]; totalCount: number }> => {
  if (options.category_id !== undefined) z.string().uuid().parse(options.category_id);
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const { items, totalCount } = await queryCatalogPickerItems(trx, tenant, options);
    return { items: items as CatalogPickerItem[], totalCount };
  });
});

const ticketCatalogCategoryScopeSchema = z.object({
  item_kinds: z.array(z.enum(['service', 'product'])).min(1).optional(),
  billing_methods: z.array(z.enum(['fixed', 'hourly', 'usage', 'per_unit'])).min(1).optional(),
}).strict();

/** Same item filters the picker searches with, so only categories holding matching items are offered. */
export type TicketCatalogCategoryScope = z.infer<typeof ticketCatalogCategoryScopeSchema>;

export const getTicketCatalogCategories = withAuth(async (
  user,
  { tenant },
  scope: TicketCatalogCategoryScope = {},
): Promise<Array<{ category_id: string; category_name: string }>> => {
  if (!await hasPermission(user, 'ticket', 'read')) {
    throw new Error('Permission denied: ticket read required to load catalog categories');
  }
  const { item_kinds: itemKinds, billing_methods: billingMethods } = ticketCatalogCategoryScopeSchema.parse(scope);
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);
  const query = db.table('service_categories as c')
    .distinct('c.category_id', 'c.category_name', 'c.display_order');
  db.tenantJoin(query, 'service_catalog as sc', 'sc.category_id', 'c.category_id');
  query.where('sc.is_active', true);
  if (itemKinds) query.whereIn('sc.item_kind', itemKinds);
  if (billingMethods) query.whereIn('sc.billing_method', billingMethods);
  const rows: Array<{ category_id: string; category_name: string }> = await query
    .orderBy('c.display_order', 'asc')
    .orderBy('c.category_name', 'asc');
  return rows.map(({ category_id, category_name }) => ({ category_id, category_name }));
});

export const getServicePrices = withAuth(async (
  _user,
  { tenant },
  serviceId: string
): Promise<IServicePrice[]> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    return queryServicePrices(trx, tenant, serviceId);
  });
});

export const listTicketMaterials = withAuth(async (
  user,
  { tenant },
  ticketId: string
): Promise<ITicketMaterial[] | TicketMaterialActionError> => {
  try {
    if (!await hasPermission(user, 'ticket', 'read')) {
      throw new Error('Permission denied: ticket read required');
    }
    const { knex: db } = await createTenantKnex();
    return (await listMaterials(db, tenant, 'ticket', ticketId)) as ITicketMaterial[];
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
    if (!await hasPermission(user, 'ticket', 'update')) {
      throw new Error('Permission denied: ticket update required');
    }
    const { knex: db } = await createTenantKnex();
    return (await addMaterial(
      db,
      tenant,
      { ...input, parent_type: 'ticket', parent_id: input.ticket_id },
      (user as any)?.user_id ?? null,
    )) as ITicketMaterial;
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
    if (!await hasPermission(user, 'ticket', 'update')) {
      throw new Error('Permission denied: ticket update required');
    }
    const { knex: db } = await createTenantKnex();
    await deleteMaterial(db, tenant, 'ticket', ticketMaterialId, (user as any)?.user_id ?? null);
  } catch (error) {
    const expected = ticketMaterialActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const updateTicketMaterial = withAuth(async (
  user, { tenant }, materialId: string, input: { quantity: number; description: string },
) => {
  if (!await hasPermission(user, 'ticket', 'update')) {
    return permissionError('Permission denied: ticket update required');
  }
  const parsed = z.object({
    quantity: z.number().int().min(1).max(2147483647),
    description: z.string().trim().max(2000),
  }).safeParse(input);
  if (!parsed.success || !z.string().uuid().safeParse(materialId).success) {
    return actionError('Enter a positive whole-number quantity and a description of at most 2,000 characters.', 'features/tickets:chargeEdit.errors.invalidInput');
  }
  const { knex } = await createTenantKnex();
  try {
    const signal = await withTransaction(knex, async (trx) => {
      const db = tenantDb(trx, tenant);
      const material = await db.table('ticket_materials')
        .where({ ticket_material_id: materialId }).forUpdate().first();
      // Editing billed rows would invalidate both their invoice and inventory cost attribution.
      if (!material || material.is_billed) {
        throw new CodedError('Billed or removed entries cannot be edited. Refresh and try again.', 'TICKET_MATERIAL_EDIT', 'features/tickets:chargeEdit.errors.notEditable');
      }
      if (!Number.isSafeInteger(Number(material.rate) * parsed.data.quantity)) {
        throw new CodedError('This quantity would exceed the supported total amount.', 'TICKET_MATERIAL_EDIT', 'features/tickets:chargeEdit.errors.amountTooLarge');
      }
      let pendingStockLow: Awaited<ReturnType<typeof collectStockLowSignalAfterConsume>> = null;
      if (Number(material.quantity) !== parsed.data.quantity) {
        const settings = await db.table('product_inventory_settings')
          .where({ service_id: material.service_id }).forShare().first();
        const movements = await db.table('stock_movements')
          .where({ service_id: material.service_id, source_doc_type: 'ticket_material', source_doc_id: materialId })
          .whereIn('movement_type', ['consume', 'return_restock'])
          .orderBy('created_at', 'desc')
          .select('movement_type', 'quantity', 'from_location_id', 'unit_id', 'cogs_cost', 'cost_currency');
        if (settings?.is_serialized || movements.some((movement) => movement.unit_id)) {
          throw new CodedError('Serialized materials must keep quantity 1. Add or remove individual units instead.', 'TICKET_MATERIAL_EDIT', 'features/tickets:chargeEdit.errors.serialized');
        }
        const consumed = movements.reduce((total, movement) =>
          total + (movement.movement_type === 'consume' ? 1 : -1) * Number(movement.quantity), 0);
        if ((settings?.track_stock && consumed !== Number(material.quantity)) || (!settings?.track_stock && consumed !== 0)) {
          throw new CodedError('Inventory tracking changed after this material was added. Reconcile its stock before changing quantity.', 'TICKET_MATERIAL_EDIT', 'features/tickets:chargeEdit.errors.trackingChanged');
        }
        if (settings?.track_stock) {
          const locationId = movements.find((movement) => movement.movement_type === 'consume')?.from_location_id;
          if (!locationId || movements.some((movement) =>
            movement.movement_type === 'consume' && movement.from_location_id !== locationId)) {
            throw new CodedError('The original stock location is missing or inconsistent. Reconcile this material before changing quantity.', 'TICKET_MATERIAL_EDIT', 'features/tickets:chargeEdit.errors.locationInvalid');
          }
          const difference = parsed.data.quantity - Number(material.quantity);
          const options = {
            service_id: material.service_id, source_doc_type: 'ticket_material' as const,
            source_doc_id: materialId, quantity: Math.abs(difference), performed_by: user.user_id,
            client_id: material.client_id, location_id: locationId,
          };
          if (difference > 0) {
            await recordStockConsumption(trx, tenant, options);
            pendingStockLow = await collectStockLowSignalAfterConsume(trx, tenant, material.service_id, locationId, difference);
          } else {
            const costCurrencies = new Set(movements.filter((movement) => movement.cogs_cost != null).map((movement) => movement.cost_currency));
            if (costCurrencies.size > 1) {
              throw new CodedError('Stock costs use different currencies. Reconcile this material before reducing quantity.', 'TICKET_MATERIAL_EDIT', 'features/tickets:chargeEdit.errors.costCurrency');
            }
            const costKnown = movements.every((movement) => movement.cogs_cost != null);
            const netCost = movements.reduce((total, movement) => total + Number(movement.cogs_cost), 0);
            await recordStockMovement(trx, tenant, {
              ...options, movement_type: 'return_restock', to_location_id: locationId,
              cogs_cost: costKnown ? -Math.round(netCost * Math.abs(difference) / Number(material.quantity)) : null,
              cost_currency: costCurrencies.values().next().value ?? null,
              reason: 'Unbilled ticket material quantity reduced',
            });
          }
        }
      }
      await db.table('ticket_materials').where({ ticket_material_id: materialId, is_billed: false })
        .update({ ...parsed.data, description: parsed.data.description || null, updated_at: new Date().toISOString() });
      return pendingStockLow;
    });
    if (signal) await publishInventoryEvent('INVENTORY_STOCK_LOW', signal);
  } catch (error) {
    const expected = ticketMaterialActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
