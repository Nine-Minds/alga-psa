import { Knex } from 'knex';
import {
  IStockLevel,
  IStockMovement,
  IStockUnit,
  StockMovementSourceDocType,
} from '@alga-psa/types';
import { ensureStockLevel } from './levels';
import { recordStockMovement } from './movements';
import { assertLocationWritable } from './scope';
import {
  loadTrackedInventorySettings,
  PendingStockUnitEventPayload,
  CoreStockWarning,
} from './receive';
import {
  collectStockLowSignalAfterConsume,
  type PendingStockLowSignal,
} from './stockLowSignal';

export interface AdjustStockInput {
  service_id: string;
  location_id: string;
  delta: number;
  reason: string;
  serials?: Array<{ serial_number: string; mac_address?: string | null }>;
  /** Internal reuse seam for count approval: retire these exact in-stock units. */
  unit_ids?: string[];
  source_doc_type?: StockMovementSourceDocType;
  source_doc_id?: string | null;
  /** Overrides used when count approval creates a found serialized unit. */
  unit_cost?: number | null;
  cost_currency?: string | null;
  unit_notes?: string | null;
  /** Count approval historically relied on the database constraint for this check. */
  skip_mac_uniqueness_check?: boolean;
}

export interface AdjustStockCoreResult {
  movements: IStockMovement[];
  /** unit_ids retired (negative delta) or created (positive delta). */
  unit_ids: string[];
  warnings: CoreStockWarning[];
  /** Publish these only after commit; count approval intentionally ignores them today. */
  stock_unit_created_events: PendingStockUnitEventPayload[];
  stock_unit_updated_events: PendingStockUnitEventPayload[];
  /** Publish only after commit. Null unless a downward adjustment crosses the reorder point. */
  pending_stock_low_event: PendingStockLowSignal | null;
}

export interface RetireStockInput {
  service_id: string;
  location_id: string;
  quantity?: number;
  reason: string;
  unit_ids?: string[];
}

export interface RetireStockCoreResult {
  movements: IStockMovement[];
  unit_ids: string[];
  warnings: CoreStockWarning[];
  stock_unit_updated_events: PendingStockUnitEventPayload[];
}

/** Session-free manual/cycle-count adjustment core. */
export async function adjustStockCore(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  input: AdjustStockInput,
): Promise<AdjustStockCoreResult> {
  const { service_id: serviceId, location_id: locationId, delta } = input;
  if (!serviceId) throw new Error('service_id is required');
  if (!locationId) throw new Error('location_id is required');
  if (!Number.isInteger(delta) || delta === 0) throw new Error('delta must be a non-zero integer');
  const trimmedReason = (input.reason ?? '').trim();
  if (!trimmedReason) throw new Error('reason is required for a stock adjustment');

  await assertLocationWritable(trx, tenant, userId, locationId);
  const settings = await loadTrackedInventorySettings(trx, tenant, serviceId);
  await ensureStockLevel(trx, tenant, serviceId, locationId);
  const movements: IStockMovement[] = [];
  const unitIds: string[] = [];
  const warnings: CoreStockWarning[] = [];
  const magnitude = Math.abs(delta);
  const sourceDocType = input.source_doc_type ?? 'manual';

  if (settings.is_serialized) {
    if (delta < 0) {
      let units: IStockUnit[];
      if (input.unit_ids && input.unit_ids.length > 0) {
        const selected = (await trx('stock_units')
          .where({ tenant, service_id: serviceId, location_id: locationId, status: 'in_stock' })
          .whereIn('unit_id', input.unit_ids)
          .forUpdate()) as IStockUnit[];
        const selectedById = new Map(selected.map((unit) => [unit.unit_id, unit]));
        units = input.unit_ids.map((unitId) => selectedById.get(unitId)).filter(Boolean) as IStockUnit[];
      } else {
        units = (await trx('stock_units')
          .where({ tenant, service_id: serviceId, location_id: locationId, status: 'in_stock' })
          .orderBy('received_at', 'asc')
          .limit(magnitude)) as IStockUnit[];
      }
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
        movements.push(
          await recordStockMovement(trx, tenant, {
            movement_type: 'adjust',
            service_id: serviceId,
            quantity: 1,
            unit_id: unit.unit_id,
            from_location_id: locationId,
            reason: trimmedReason,
            source_doc_type: sourceDocType,
            source_doc_id: input.source_doc_id ?? null,
            performed_by: userId,
            unitPatch: { status: 'retired' },
          }),
        );
        unitIds.push(unit.unit_id);
      }
    } else {
      const serials = (input.serials ?? []).map((s) => ({
        serial_number: (s.serial_number ?? '').trim(),
        mac_address: s.mac_address ? String(s.mac_address).trim() : null,
      }));
      if (serials.length !== magnitude || serials.some((s) => !s.serial_number)) {
        throw new Error(
          `A positive serialized adjustment requires exactly ${magnitude} real serial number(s); got ${serials.filter((s) => s.serial_number).length}`,
        );
      }

      const seen = new Set<string>();
      for (const s of serials) {
        if (seen.has(s.serial_number)) throw new Error(`Duplicate serial_number in batch: ${s.serial_number}`);
        seen.add(s.serial_number);
        const existing = await trx('stock_units')
          .where({ tenant, service_id: serviceId, serial_number: s.serial_number })
          .first();
        if (existing) throw new Error(`Serial number already exists: ${s.serial_number}`);
        if (s.mac_address && !input.skip_mac_uniqueness_check) {
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
            unit_cost: input.unit_cost !== undefined ? input.unit_cost : settings.average_cost ?? null,
            cost_currency: input.cost_currency !== undefined ? input.cost_currency : settings.cost_currency,
            received_at: trx.fn.now(),
            notes: input.unit_notes ?? `Found via adjustment: ${trimmedReason}`,
          })
          .returning('*')) as IStockUnit[];
        movements.push(
          await recordStockMovement(trx, tenant, {
            movement_type: 'adjust',
            service_id: serviceId,
            quantity: 1,
            unit_id: unit.unit_id,
            to_location_id: locationId,
            reason: trimmedReason,
            source_doc_type: sourceDocType,
            source_doc_id: input.source_doc_id ?? null,
            performed_by: userId,
          }),
        );
        unitIds.push(unit.unit_id);
      }
    }

    const pendingStockLowEvent = delta < 0
      ? await collectStockLowSignalAfterConsume(
          trx,
          tenant,
          serviceId,
          locationId,
          movements.length,
        )
      : null;

    return {
      movements,
      unit_ids: unitIds,
      warnings,
      stock_unit_created_events: delta > 0
        ? unitIds.map((unitId) => ({
            tenant,
            unit_id: unitId,
            service_id: serviceId,
            user_id: userId,
            changed_fields: undefined,
          }))
        : [],
      stock_unit_updated_events: delta < 0
        ? unitIds.map((unitId) => ({
            tenant,
            unit_id: unitId,
            service_id: serviceId,
            user_id: userId,
            changed_fields: ['status'],
          }))
        : [],
      pending_stock_low_event: pendingStockLowEvent,
    };
  }

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
    movements.push(
      await recordStockMovement(trx, tenant, {
        movement_type: 'adjust',
        service_id: serviceId,
        quantity: magnitude,
        from_location_id: locationId,
        reason: trimmedReason,
        source_doc_type: sourceDocType,
        source_doc_id: input.source_doc_id ?? null,
        performed_by: userId,
      }),
    );
  } else {
    movements.push(
      await recordStockMovement(trx, tenant, {
        movement_type: 'adjust',
        service_id: serviceId,
        quantity: magnitude,
        to_location_id: locationId,
        reason: trimmedReason,
        source_doc_type: sourceDocType,
        source_doc_id: input.source_doc_id ?? null,
        performed_by: userId,
      }),
    );
  }

  const pendingStockLowEvent = delta < 0
    ? await collectStockLowSignalAfterConsume(trx, tenant, serviceId, locationId, magnitude)
    : null;

  return {
    movements,
    unit_ids: unitIds,
    warnings,
    stock_unit_created_events: [],
    stock_unit_updated_events: [],
    pending_stock_low_event: pendingStockLowEvent,
  };
}

/** Session-free retirement/disposal core. */
export async function retireStockCore(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  input: RetireStockInput,
): Promise<RetireStockCoreResult> {
  if (!input?.service_id) throw new Error('service_id is required');
  if (!input?.location_id) throw new Error('location_id is required');
  const trimmedReason = (input.reason ?? '').trim();
  if (!trimmedReason) throw new Error('reason is required to retire stock');

  await assertLocationWritable(trx, tenant, userId, input.location_id);
  const settings = await loadTrackedInventorySettings(trx, tenant, input.service_id);
  await ensureStockLevel(trx, tenant, input.service_id, input.location_id);
  const movements: IStockMovement[] = [];
  const unitIds: string[] = [];
  const warnings: CoreStockWarning[] = [];

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
      movements.push(
        await recordStockMovement(trx, tenant, {
          movement_type: 'retire',
          service_id: input.service_id,
          quantity: 1,
          unit_id: unit.unit_id,
          from_location_id: unit.location_id ?? input.location_id,
          reason: trimmedReason,
          source_doc_type: 'manual',
          performed_by: userId,
          unitPatch: { status: 'retired' },
        }),
      );
      unitIds.push(unit.unit_id);
    }
  } else {
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
    movements.push(
      await recordStockMovement(trx, tenant, {
        movement_type: 'retire',
        service_id: input.service_id,
        quantity,
        from_location_id: input.location_id,
        reason: trimmedReason,
        source_doc_type: 'manual',
        performed_by: userId,
      }),
    );
  }

  return {
    movements,
    unit_ids: unitIds,
    warnings,
    stock_unit_updated_events: unitIds.map((unitId) => ({
      tenant,
      unit_id: unitId,
      service_id: input.service_id,
      user_id: userId,
      changed_fields: ['status'],
    })),
  };
}
