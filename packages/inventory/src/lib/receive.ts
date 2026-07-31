import { Knex } from 'knex';
import { IProductInventorySettings, IStockMovement, IStockUnit } from '@alga-psa/types';
import { ensureStockLevel } from './levels';
import { recordStockMovement } from './movements';
import { assertLocationWritable } from './scope';

export interface CoreStockWarning {
  code: 'insufficient_stock' | 'negative_on_hand';
  message: string;
  service_id: string;
  location_id: string;
  requested: number;
  available: number;
}

export interface ReceiveStockInput {
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
}

export interface PendingStockUnitEventPayload {
  tenant: string;
  unit_id: string;
  service_id: string;
  user_id: string;
  changed_fields?: string[];
}

export interface ReceiveStockCoreResult {
  movements: IStockMovement[];
  unit_ids: string[];
  /** New moving-average cost (non-serialized only; null/unchanged for serialized). */
  average_cost: number | null;
  warnings: CoreStockWarning[];
  /** Publish INVENTORY_STOCK_UNIT_CREATED only after the caller commits. */
  stock_unit_created_events: PendingStockUnitEventPayload[];
}

/** Load and lock stock-tracked settings for receipt/adjustment cost calculations. */
export async function loadTrackedInventorySettings(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
): Promise<IProductInventorySettings> {
  const settings = (await trx('product_inventory_settings')
    .where({ tenant, service_id: serviceId })
    .forUpdate()
    .first()) as IProductInventorySettings | undefined;
  if (!settings) throw new Error('Inventory not enabled for this product');
  if (!settings.track_stock) throw new Error('Stock tracking is disabled for this product');
  return settings;
}

/** Sum on-hand across locations before a receipt changes the maintained level cache. */
export async function totalProductOnHand(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
): Promise<number> {
  const row = await trx('stock_levels')
    .where({ tenant, service_id: serviceId })
    .sum<{ s: string | null }>('quantity_on_hand as s')
    .first();
  return Number(row?.s ?? 0);
}

/**
 * Session-free manual receipt core. The caller owns the transaction and publishes
 * the returned stock-unit event payloads only after commit.
 */
export async function receiveStockCore(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  input: ReceiveStockInput,
): Promise<ReceiveStockCoreResult> {
  if (!input?.service_id) throw new Error('service_id is required');
  if (!input?.location_id) throw new Error('location_id is required');
  const quantity = input.quantity;
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('quantity must be a positive integer');
  const unitCost = input.unit_cost;
  if (!Number.isInteger(unitCost) || unitCost < 0) {
    throw new Error('unit_cost must be a non-negative integer (cents)');
  }

  await assertLocationWritable(trx, tenant, userId, input.location_id);
  const settings = await loadTrackedInventorySettings(trx, tenant, input.service_id);
  const costCurrency = input.cost_currency ?? settings.cost_currency;
  if (input.cost_currency && input.cost_currency !== settings.cost_currency) {
    throw new Error(
      `Currency mismatch: receipt is ${input.cost_currency} but product cost currency is ${settings.cost_currency}`,
    );
  }

  await ensureStockLevel(trx, tenant, input.service_id, input.location_id);
  const movements: IStockMovement[] = [];
  const unitIds: string[] = [];

  if (settings.is_serialized) {
    const serials = input.serials ?? [];
    if (serials.length !== quantity) {
      throw new Error(`Serialized receipt requires exactly ${quantity} serial(s); got ${serials.length}`);
    }

    const seenSerials = new Set<string>();
    const seenMacs = new Set<string>();
    for (const s of serials) {
      const serial = (s.serial_number ?? '').trim();
      if (!serial) throw new Error('Each serialized unit requires a serial_number');
      if (seenSerials.has(serial.toLowerCase())) throw new Error(`Duplicate serial in batch: ${serial}`);
      seenSerials.add(serial.toLowerCase());
      const mac = s.mac_address ? String(s.mac_address).trim() : null;
      if (mac) {
        if (seenMacs.has(mac.toLowerCase())) throw new Error(`Duplicate MAC in batch: ${mac}`);
        seenMacs.add(mac.toLowerCase());
      }
    }

    for (const s of serials) {
      const serial = s.serial_number.trim();
      const mac = s.mac_address ? String(s.mac_address).trim() : null;
      const existingSerial = await trx('stock_units')
        .where({ tenant, service_id: input.service_id })
        .whereRaw('LOWER(serial_number) = LOWER(?)', [serial])
        .first();
      if (existingSerial) throw new Error(`Serial already exists for this product: ${serial}`);
      if (mac) {
        const existingMac = await trx('stock_units')
          .where({ tenant })
          .whereRaw('LOWER(mac_address) = LOWER(?)', [mac])
          .first();
        if (existingMac) throw new Error(`MAC address already exists: ${mac}`);
      }

      const [unit] = (await trx('stock_units')
        .insert({
          tenant,
          service_id: input.service_id,
          serial_number: serial,
          mac_address: mac,
          status: 'in_stock',
          location_id: input.location_id,
          warranty_expires_at: s.warranty_expires_at ?? null,
          warranty_term: s.warranty_term ?? null,
          unit_cost: unitCost,
          cost_currency: costCurrency,
          received_at: trx.fn.now(),
        })
        .returning('*')) as IStockUnit[];
      unitIds.push(unit.unit_id);
      movements.push(
        await recordStockMovement(trx, tenant, {
          movement_type: 'receipt',
          service_id: input.service_id,
          quantity: 1,
          unit_id: unit.unit_id,
          to_location_id: input.location_id,
          unit_cost: unitCost,
          cost_currency: costCurrency,
          source_doc_type: 'manual',
          performed_by: userId,
        }),
      );
    }

    return {
      movements,
      unit_ids: unitIds,
      average_cost: settings.average_cost ?? null,
      warnings: [],
      stock_unit_created_events: unitIds.map((unitId) => ({
        tenant,
        unit_id: unitId,
        service_id: input.service_id,
        user_id: userId,
      })),
    };
  }

  const oldQty = await totalProductOnHand(trx, tenant, input.service_id);
  const oldAvg = settings.average_cost ?? 0;
  movements.push(
    await recordStockMovement(trx, tenant, {
      movement_type: 'receipt',
      service_id: input.service_id,
      quantity,
      to_location_id: input.location_id,
      unit_cost: unitCost,
      cost_currency: costCurrency,
      source_doc_type: 'manual',
      performed_by: userId,
    }),
  );

  const denom = oldQty + quantity;
  const newAvg = denom > 0 ? Math.round((oldQty * oldAvg + quantity * unitCost) / denom) : unitCost;
  await trx('product_inventory_settings')
    .where({ tenant, service_id: input.service_id })
    .update({ average_cost: newAvg, updated_at: trx.fn.now() });

  return {
    movements,
    unit_ids: unitIds,
    average_cost: newAvg,
    warnings: [],
    stock_unit_created_events: [],
  };
}
