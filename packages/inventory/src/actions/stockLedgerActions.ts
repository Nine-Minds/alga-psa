'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IStockLevel, IStockMovement, IStockUnit, IProductInventorySettings } from '@alga-psa/types';
import {
  assertLocationWritable,
  availableQuantity,
  ensureStockLevel,
  publishInventoryEvent,
  recordStockMovement,
  timestampPayload,
} from '../lib';

/**
 * Ad-hoc stock ledger actions (design §6.A, §6.D): manual receipts with no PO,
 * adjustments, retirements, and stock-level reads. Every stock change flows
 * through the movement primitive — this file never writes stock_movements or
 * mutates stock_levels / unit status directly.
 */

async function requireInvPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'inventory', action))) {
    throw new Error(`Permission denied: inventory ${action} required`);
  }
}

/** A non-fatal warning surfaced back to the caller instead of throwing (insufficient/negative stock). */
export interface StockWarning {
  code: 'insufficient_stock' | 'negative_on_hand';
  message: string;
  service_id: string;
  location_id: string;
  requested: number;
  available: number;
}

/**
 * Load inventory settings, asserting the product is stock-tracked. Locked: several
 * callers recompute the moving average (a read-modify-write on this row), so
 * concurrent receipts must serialize on it (F020).
 */
async function loadTrackedSettings(
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

/** Sum of on-hand for a product across all locations (used as the moving-average base qty). */
async function totalOnHand(trx: Knex.Transaction, tenant: string, serviceId: string): Promise<number> {
  const row = await trx('stock_levels')
    .where({ tenant, service_id: serviceId })
    .sum<{ s: string | null }>('quantity_on_hand as s')
    .first();
  return Number(row?.s ?? 0);
}

export interface ReceiveStockResult {
  movements: IStockMovement[];
  unit_ids: string[];
  /** New moving-average cost (non-serialized only; null/unchanged for serialized). */
  average_cost: number | null;
  warnings: StockWarning[];
}

/**
 * Manual ad-hoc receipt with NO purchase order (design §6.A).
 *
 * - Serialized: one stock_units row per serial (in_stock, location set, exact unit_cost),
 *   then a per-unit `receipt` movement. Requires serials.length === quantity and enforces
 *   serial + MAC uniqueness.
 * - Non-serialized: one batch `receipt` movement, plus a moving-average recompute of
 *   product_inventory_settings.average_cost using the on-hand total BEFORE the receipt:
 *     new_avg = round((oldQty·oldAvg + recvQty·recvCost) / (oldQty + recvQty)).
 */
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
  ): Promise<ReceiveStockResult> => {
    await requireInvPerm(user, 'create');
    if (!input?.service_id) throw new Error('service_id is required');
    if (!input?.location_id) throw new Error('location_id is required');
    const quantity = input.quantity;
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('quantity must be a positive integer');
    const unitCost = input.unit_cost;
    if (!Number.isInteger(unitCost) || unitCost < 0) {
      throw new Error('unit_cost must be a non-negative integer (cents)');
    }

    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // A tech can't receive into another tech's van (F032).
      await assertLocationWritable(trx, tenant, (user as any)?.user_id, input.location_id);
      const settings = await loadTrackedSettings(trx, tenant, input.service_id);
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
        // Enforce serial + MAC uniqueness within the batch and against existing units.
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
          // Insert the in_stock unit FIRST, then record the per-unit receipt movement.
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
          const movement = await recordStockMovement(trx, tenant, {
            movement_type: 'receipt',
            service_id: input.service_id,
            quantity: 1,
            unit_id: unit.unit_id,
            to_location_id: input.location_id,
            unit_cost: unitCost,
            cost_currency: costCurrency,
            source_doc_type: 'manual',
            performed_by: user.user_id,
          });
          movements.push(movement);
        }
        // Serialized units carry exact per-unit costs; no moving-average maintained.
        return { movements, unit_ids: unitIds, average_cost: settings.average_cost ?? null, warnings: [] };
      }

      // Non-serialized: one batch receipt + moving-average recompute (base qty BEFORE receipt).
      const oldQty = await totalOnHand(trx, tenant, input.service_id);
      const oldAvg = settings.average_cost ?? 0;
      const movement = await recordStockMovement(trx, tenant, {
        movement_type: 'receipt',
        service_id: input.service_id,
        quantity,
        to_location_id: input.location_id,
        unit_cost: unitCost,
        cost_currency: costCurrency,
        source_doc_type: 'manual',
        performed_by: user.user_id,
      });
      movements.push(movement);

      const denom = oldQty + quantity;
      const newAvg = denom > 0 ? Math.round((oldQty * oldAvg + quantity * unitCost) / denom) : unitCost;
      await trx('product_inventory_settings')
        .where({ tenant, service_id: input.service_id })
        .update({ average_cost: newAvg, updated_at: trx.fn.now() });

      return { movements, unit_ids: unitIds, average_cost: newAvg, warnings: [] };
    });

    for (const unitId of result.unit_ids) {
      await publishInventoryEvent('INVENTORY_STOCK_UNIT_CREATED', timestampPayload({
        tenant,
        unit_id: unitId,
        service_id: input.service_id,
        user_id: user.user_id,
      }));
    }

    return result;
  },
);

export interface AdjustStockResult {
  movements: IStockMovement[];
  /** unit_ids retired (negative delta) or created (positive delta) for serialized products. */
  unit_ids: string[];
  warnings: StockWarning[];
}

/**
 * Manual stock adjustment (design §6.D). `reason` is REQUIRED. `delta` is signed:
 * positive adds, negative removes.
 *
 * - Non-serialized: a single `adjust` movement (to_location for +, from_location for −).
 *   A removal that would drive on-hand negative is surfaced as a soft warning, not blocked.
 * - Serialized: a removal retires the oldest in_stock units at the location; an increase
 *   REQUIRES the real serial numbers of the found units (F051 — fabricated ADJ-*
 *   placeholders polluted serial search and advisory lookups) — one movement per unit.
 */
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
    if (!serviceId) throw new Error('service_id is required');
    if (!locationId) throw new Error('location_id is required');
    if (!Number.isInteger(delta) || delta === 0) throw new Error('delta must be a non-zero integer');
    const trimmedReason = (reason ?? '').trim();
    if (!trimmedReason) throw new Error('reason is required for a stock adjustment');

    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Location-scoped write enforcement: a tech can't adjust another tech's van.
      await assertLocationWritable(trx, tenant, (user as any)?.user_id, locationId);
      const settings = await loadTrackedSettings(trx, tenant, serviceId);
      await ensureStockLevel(trx, tenant, serviceId, locationId);
      const movements: IStockMovement[] = [];
      const unitIds: string[] = [];
      const warnings: StockWarning[] = [];
      const magnitude = Math.abs(delta);

      if (settings.is_serialized) {
        if (delta < 0) {
          // Loss: retire the oldest in_stock units at this location (FIFO by received_at).
          const units = (await trx('stock_units')
            .where({ tenant, service_id: serviceId, location_id: locationId, status: 'in_stock' })
            .orderBy('received_at', 'asc')
            .limit(magnitude)) as IStockUnit[];
          if (units.length < magnitude) {
            warnings.push({
              code: 'insufficient_stock',
              message: `Requested to remove ${magnitude} serialized unit(s) but only ${units.length} in stock; adjusting what is present.`,
              service_id: serviceId,
              location_id: locationId,
              requested: magnitude,
              available: units.length,
            });
          }
          for (const unit of units) {
            const movement = await recordStockMovement(trx, tenant, {
              movement_type: 'adjust',
              service_id: serviceId,
              quantity: 1,
              unit_id: unit.unit_id,
              from_location_id: locationId,
              reason: trimmedReason,
              source_doc_type: 'manual',
              performed_by: user.user_id,
              unitPatch: { status: 'retired' },
            });
            movements.push(movement);
            unitIds.push(unit.unit_id);
          }
        } else {
          // Found: create new in_stock units carrying the units' REAL serials (F051).
          const serials = (opts?.serials ?? []).map((s) => ({
            serial_number: (s.serial_number ?? '').trim(),
            mac_address: s.mac_address ? String(s.mac_address).trim() : null,
          }));
          if (serials.length !== magnitude || serials.some((s) => !s.serial_number)) {
            throw new Error(
              `A positive serialized adjustment requires exactly ${magnitude} real serial number(s); got ${serials.filter((s) => s.serial_number).length}`,
            );
          }
          // Uniqueness: serial per product, MAC tenant-wide (same rules as receiving).
          const seen = new Set<string>();
          for (const s of serials) {
            if (seen.has(s.serial_number)) throw new Error(`Duplicate serial_number in batch: ${s.serial_number}`);
            seen.add(s.serial_number);
            const existing = await trx('stock_units')
              .where({ tenant, service_id: serviceId, serial_number: s.serial_number })
              .first();
            if (existing) throw new Error(`Serial number already exists: ${s.serial_number}`);
            if (s.mac_address) {
              const existingMac = await trx('stock_units').where({ tenant, mac_address: s.mac_address }).first();
              if (existingMac) throw new Error(`MAC address already exists: ${s.mac_address}`);
            }
          }
          for (const s of serials) {
            const [unit] = (await trx('stock_units')
              .insert({
                tenant,
                service_id: serviceId,
                serial_number: s.serial_number,
                mac_address: s.mac_address,
                status: 'in_stock',
                location_id: locationId,
                unit_cost: settings.average_cost ?? null,
                cost_currency: settings.cost_currency,
                received_at: trx.fn.now(),
                notes: `Found via adjustment: ${trimmedReason}`,
              })
              .returning('*')) as IStockUnit[];
            const movement = await recordStockMovement(trx, tenant, {
              movement_type: 'adjust',
              service_id: serviceId,
              quantity: 1,
              unit_id: unit.unit_id,
              to_location_id: locationId,
              reason: trimmedReason,
              source_doc_type: 'manual',
              performed_by: user.user_id,
            });
            movements.push(movement);
            unitIds.push(unit.unit_id);
          }
        }
        return { movements, unit_ids: unitIds, warnings };
      }

      // Non-serialized: single adjust movement.
      if (delta < 0) {
        const level = (await trx('stock_levels')
          .where({ tenant, service_id: serviceId, location_id: locationId })
          .first()) as IStockLevel | undefined;
        const onHand = Number(level?.quantity_on_hand ?? 0);
        if (onHand - magnitude < 0) {
          warnings.push({
            code: 'negative_on_hand',
            message: `Adjustment of -${magnitude} would drive on-hand negative (current ${onHand}); applied anyway.`,
            service_id: serviceId,
            location_id: locationId,
            requested: magnitude,
            available: onHand,
          });
        }
        const movement = await recordStockMovement(trx, tenant, {
          movement_type: 'adjust',
          service_id: serviceId,
          quantity: magnitude,
          from_location_id: locationId,
          reason: trimmedReason,
          source_doc_type: 'manual',
          performed_by: user.user_id,
        });
        movements.push(movement);
      } else {
        const movement = await recordStockMovement(trx, tenant, {
          movement_type: 'adjust',
          service_id: serviceId,
          quantity: magnitude,
          to_location_id: locationId,
          reason: trimmedReason,
          source_doc_type: 'manual',
          performed_by: user.user_id,
        });
        movements.push(movement);
      }
      return { movements, unit_ids: unitIds, warnings };
    });

    const eventType = delta > 0 ? 'INVENTORY_STOCK_UNIT_CREATED' : 'INVENTORY_STOCK_UNIT_UPDATED';
    for (const unitId of result.unit_ids) {
      await publishInventoryEvent(eventType, timestampPayload({
        tenant,
        unit_id: unitId,
        service_id: serviceId,
        user_id: user.user_id,
        changed_fields: delta > 0 ? undefined : ['status'],
      }));
    }

    return result;
  },
);

export interface RetireStockResult {
  movements: IStockMovement[];
  unit_ids: string[];
  warnings: StockWarning[];
}

/**
 * Retire / dispose stock (design §6.D). `reason` is REQUIRED.
 *
 * - Serialized: retire specific units by `unit_ids`, else the oldest in_stock units at
 *   the location (FIFO). Each → `retire` movement, unit `→ retired`.
 * - Non-serialized: one `retire` movement from the location for `quantity`. An over-retire
 *   is surfaced as a soft warning, not blocked.
 */
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
    if (!input?.service_id) throw new Error('service_id is required');
    if (!input?.location_id) throw new Error('location_id is required');
    const trimmedReason = (input.reason ?? '').trim();
    if (!trimmedReason) throw new Error('reason is required to retire stock');

    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // A tech can't retire stock out of another tech's van (F033).
      await assertLocationWritable(trx, tenant, (user as any)?.user_id, input.location_id);
      const settings = await loadTrackedSettings(trx, tenant, input.service_id);
      await ensureStockLevel(trx, tenant, input.service_id, input.location_id);
      const movements: IStockMovement[] = [];
      const unitIds: string[] = [];
      const warnings: StockWarning[] = [];

      if (settings.is_serialized) {
        let units: IStockUnit[];
        if (input.unit_ids && input.unit_ids.length > 0) {
          units = (await trx('stock_units')
            .where({ tenant, service_id: input.service_id, status: 'in_stock' })
            .whereIn('unit_id', input.unit_ids)) as IStockUnit[];
          if (units.length < input.unit_ids.length) {
            warnings.push({
              code: 'insufficient_stock',
              message: `Some requested units are not in_stock and were skipped (${units.length}/${input.unit_ids.length}).`,
              service_id: input.service_id,
              location_id: input.location_id,
              requested: input.unit_ids.length,
              available: units.length,
            });
          }
        } else {
          const quantity = input.quantity ?? 0;
          if (!Number.isInteger(quantity) || quantity <= 0) {
            throw new Error('quantity (or unit_ids) is required to retire serialized stock');
          }
          units = (await trx('stock_units')
            .where({ tenant, service_id: input.service_id, location_id: input.location_id, status: 'in_stock' })
            .orderBy('received_at', 'asc')
            .limit(quantity)) as IStockUnit[];
          if (units.length < quantity) {
            warnings.push({
              code: 'insufficient_stock',
              message: `Requested to retire ${quantity} unit(s) but only ${units.length} in stock; retiring what is present.`,
              service_id: input.service_id,
              location_id: input.location_id,
              requested: quantity,
              available: units.length,
            });
          }
        }
        for (const unit of units) {
          const movement = await recordStockMovement(trx, tenant, {
            movement_type: 'retire',
            service_id: input.service_id,
            quantity: 1,
            unit_id: unit.unit_id,
            from_location_id: unit.location_id ?? input.location_id,
            reason: trimmedReason,
            source_doc_type: 'manual',
            performed_by: user.user_id,
            unitPatch: { status: 'retired' },
          });
          movements.push(movement);
          unitIds.push(unit.unit_id);
        }
        return { movements, unit_ids: unitIds, warnings };
      }

      // Non-serialized: batch retire from the location.
      const quantity = input.quantity ?? 0;
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error('quantity must be a positive integer to retire non-serialized stock');
      }
      const level = (await trx('stock_levels')
        .where({ tenant, service_id: input.service_id, location_id: input.location_id })
        .first()) as IStockLevel | undefined;
      const onHand = Number(level?.quantity_on_hand ?? 0);
      if (onHand - quantity < 0) {
        warnings.push({
          code: 'insufficient_stock',
          message: `Requested to retire ${quantity} but only ${onHand} on hand; retired anyway (on-hand may go negative).`,
          service_id: input.service_id,
          location_id: input.location_id,
          requested: quantity,
          available: onHand,
        });
      }
      const movement = await recordStockMovement(trx, tenant, {
        movement_type: 'retire',
        service_id: input.service_id,
        quantity,
        from_location_id: input.location_id,
        reason: trimmedReason,
        source_doc_type: 'manual',
        performed_by: user.user_id,
      });
      movements.push(movement);
      return { movements, unit_ids: unitIds, warnings };
    });

    for (const unitId of result.unit_ids) {
      await publishInventoryEvent('INVENTORY_STOCK_UNIT_UPDATED', timestampPayload({
        tenant,
        unit_id: unitId,
        service_id: input.service_id,
        user_id: user.user_id,
        changed_fields: ['status'],
      }));
    }

    return result;
  },
);

export interface StockLevelRow extends IStockLevel {
  location_name: string | null;
  /** Derived: quantity_on_hand - reserved_quantity - held_quantity. */
  available: number;
}

/** On-hand balances for a product across every location, with derived available qty (design §6.F). */
export const getStockLevelsForProduct = withAuth(
  async (user, { tenant }, serviceId: string): Promise<StockLevelRow[]> => {
    await requireInvPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const rows = (await trx('stock_levels as sl')
        .leftJoin('stock_locations as loc', function () {
          this.on('sl.location_id', '=', 'loc.location_id').andOn('sl.tenant', '=', 'loc.tenant');
        })
        .where({ 'sl.tenant': tenant, 'sl.service_id': serviceId })
        .select('sl.*', 'loc.name as location_name')
        .orderBy('loc.name', 'asc')) as Array<IStockLevel & { location_name: string | null }>;
      return rows.map((r) => ({ ...r, available: availableQuantity(r) }));
    });
  },
);

export interface LocationStockRow extends IStockLevel {
  service_name: string | null;
  sku: string | null;
  /** Derived: quantity_on_hand - reserved_quantity - held_quantity. */
  available: number;
}

/** On-hand balances for every product at a location, with derived available qty. */
export const getStockAtLocation = withAuth(
  async (user, { tenant }, locationId: string): Promise<LocationStockRow[]> => {
    await requireInvPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const rows = (await trx('stock_levels as sl')
        .leftJoin('service_catalog as sc', function () {
          this.on('sl.service_id', '=', 'sc.service_id').andOn('sl.tenant', '=', 'sc.tenant');
        })
        .where({ 'sl.tenant': tenant, 'sl.location_id': locationId })
        .select('sl.*', 'sc.service_name', 'sc.sku')
        .orderBy('sc.service_name', 'asc')) as Array<IStockLevel & { service_name: string | null; sku: string | null }>;
      return rows.map((r) => ({ ...r, available: availableQuantity(r) }));
    });
  },
);
