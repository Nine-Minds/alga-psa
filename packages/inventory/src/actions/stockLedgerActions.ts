'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  adjustStockCore,
  queryStockAtLocation,
  queryStockLevelsForProduct,
  receiveStockCore,
  retireStockCore,
  publishInventoryEvent,
  timestampPayload,
  type AdjustStockCoreResult,
  type LocationStockRow,
  type ReceiveStockCoreResult,
  type RetireStockCoreResult,
  type StockLevelRow,
  type CoreStockWarning,
} from '../lib';

async function requireInvPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'inventory', action))) {
    throw new Error(`Permission denied: inventory ${action} required`);
  }
}

export type StockLedgerActionError = ActionMessageError | ActionPermissionError;

function stockLedgerActionErrorFrom(error: unknown): StockLedgerActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }
    switch (error.message) {
      case 'service_id is required':
        return actionError('Select a product before receiving stock.');
      case 'location_id is required':
        return actionError('Select a location before receiving stock.');
      case 'quantity must be a positive integer':
        return actionError('Quantity must be a positive whole number.');
      case 'unit_cost must be a non-negative integer (cents)':
        return actionError("Unit cost can't be negative.");
      case 'Inventory not enabled for this product':
        return actionError('Inventory is not enabled for this product.');
      case 'Stock tracking is disabled for this product':
        return actionError('Stock tracking is disabled for this product.');
      case 'Each serialized unit requires a serial_number':
        return actionError('Each serialized unit needs a serial number.');
    }
    if (
      error.message.startsWith('Currency mismatch:') ||
      error.message.startsWith('Serialized receipt requires exactly') ||
      error.message.startsWith('Duplicate serial in batch:') ||
      error.message.startsWith('Duplicate MAC in batch:') ||
      error.message.startsWith('Serial already exists for this product:') ||
      error.message.startsWith('MAC address already exists:')
    ) {
      return actionError(error.message);
    }
  }
  const dbError = error as { code?: string };
  if (dbError?.code === '23503') {
    return actionError('The selected product or location is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('A stock unit with the same serial number or MAC address already exists.');
  }
  return null;
}

async function withStockLedgerActionErrors<T>(work: () => Promise<T>): Promise<T | StockLedgerActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = stockLedgerActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

export type StockWarning = CoreStockWarning;
export type ReceiveStockResult = Omit<ReceiveStockCoreResult, 'stock_unit_created_events'>;
export type AdjustStockResult = Omit<
  AdjustStockCoreResult,
  'stock_unit_created_events' | 'stock_unit_updated_events' | 'pending_stock_low_event'
>;
export type RetireStockResult = Omit<RetireStockCoreResult, 'stock_unit_updated_events'>;
export type { StockLevelRow, LocationStockRow };

/** Manual ad-hoc receipt with no purchase order. */
export const receiveStockManual = withAuth(
  async (
    user,
    { tenant },
    input: {
      service_id: string;
      location_id: string;
      quantity: number;
      unit_cost: number;
      cost_currency?: string;
      serials?: Array<{
        serial_number: string;
        mac_address?: string | null;
        warranty_expires_at?: string | Date | null;
        warranty_term?: string | null;
      }>;
    },
  ): Promise<ReceiveStockResult | StockLedgerActionError> => {
    try {
      await requireInvPerm(user, 'create');
      const { knex: db } = await createTenantKnex();
      const core = await withTransaction(db, (trx: Knex.Transaction) =>
        receiveStockCore(trx, tenant, user.user_id, input),
      );
      for (const payload of core.stock_unit_created_events) {
        await publishInventoryEvent('INVENTORY_STOCK_UNIT_CREATED', timestampPayload(payload));
      }
      const { stock_unit_created_events: _pending, ...result } = core;
      return result;
    } catch (error) {
      const expected = stockLedgerActionErrorFrom(error);
      if (expected) return expected;
      throw error;
    }
  },
);

/** Manual signed stock adjustment. */
export const adjustStock = withAuth(
  async (
    user,
    { tenant },
    serviceId: string,
    locationId: string,
    delta: number,
    reason: string,
    opts?: { serials?: Array<{ serial_number: string; mac_address?: string | null }> },
  ): Promise<AdjustStockResult> => {
    await requireInvPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    const core = await withTransaction(db, (trx: Knex.Transaction) =>
      adjustStockCore(trx, tenant, user.user_id, {
        service_id: serviceId,
        location_id: locationId,
        delta,
        reason,
        serials: opts?.serials,
      }),
    );
    for (const payload of core.stock_unit_created_events) {
      await publishInventoryEvent('INVENTORY_STOCK_UNIT_CREATED', timestampPayload(payload));
    }
    for (const payload of core.stock_unit_updated_events) {
      await publishInventoryEvent('INVENTORY_STOCK_UNIT_UPDATED', timestampPayload(payload));
    }
    if (core.pending_stock_low_event) {
      await publishInventoryEvent('INVENTORY_STOCK_LOW', core.pending_stock_low_event);
    }
    const {
      stock_unit_created_events: _created,
      stock_unit_updated_events: _updated,
      pending_stock_low_event: _stockLow,
      ...result
    } = core;
    return result;
  },
);

/** Retire/dispose stock. */
export const retireStock = withAuth(
  async (
    user,
    { tenant },
    input: {
      service_id: string;
      location_id: string;
      quantity?: number;
      reason: string;
      unit_ids?: string[];
    },
  ): Promise<RetireStockResult> => {
    await requireInvPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    const core = await withTransaction(db, (trx: Knex.Transaction) =>
      retireStockCore(trx, tenant, user.user_id, input),
    );
    for (const payload of core.stock_unit_updated_events) {
      await publishInventoryEvent('INVENTORY_STOCK_UNIT_UPDATED', timestampPayload(payload));
    }
    const { stock_unit_updated_events: _pending, ...result } = core;
    return result;
  },
);

/** On-hand balances for a product across locations. */
export const getStockLevelsForProduct = withAuth(
  async (user, { tenant }, serviceId: string): Promise<StockLevelRow[] | StockLedgerActionError> =>
    withStockLedgerActionErrors(async () => {
      await requireInvPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, (trx: Knex.Transaction) => queryStockLevelsForProduct(trx, tenant, serviceId));
    }),
);

/** On-hand balances for every product at one location. */
export const getStockAtLocation = withAuth(
  async (user, { tenant }, locationId: string): Promise<LocationStockRow[] | StockLedgerActionError> =>
    withStockLedgerActionErrors(async () => {
      await requireInvPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, (trx: Knex.Transaction) => queryStockAtLocation(trx, tenant, locationId));
    }),
);
