'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IRmaCase, IStockUnit, RmaStatus } from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { publishInventoryEvent, recordStockMovement, timestampPayload } from '../lib';
import { resolveTenantCurrency } from '../lib';

/**
 * RMA / return-path lifecycle (design §6.G).
 *
 * Two tracks share one `rma_cases` table:
 *  - STANDARD (return-first): open → awaiting_return → returned → sent_to_vendor → resolve → closed.
 *  - ADVANCE-REPLACEMENT (replacement-first): open → replacement_received → replacement_deployed →
 *    dead_unit_owed → (dead unit returned | charged) → closed.
 *
 * Every stock change routes through the movement primitive. Note `return_defective` and `rma_out`
 * are deliberately NOT sellable-on-hand movements: a returned/in-RMA unit must not become sellable.
 */

async function requireInvPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'inventory', action))) {
    throw new Error(`Permission denied: inventory ${action} required`);
  }
}

export type RmaActionError = ActionMessageError | ActionPermissionError;

function rmaActionErrorFrom(error: unknown): RmaActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }

    switch (error.message) {
      case 'returned_unit_id is required':
        return actionError('Returned unit ID is required.');
      case 'dead_unit_due_date is required':
        return actionError('Choose a due date for the returned dead unit.');
      case 'serial_number is required for the replacement unit':
        return actionError('Enter the replacement unit serial number.');
      case 'location_id is required for the replacement unit':
        return actionError('Select the receiving location for the replacement unit.');
      case 'location_id is required':
        return actionError('Select a location before receiving the return.');
      case 'vendor_id is required':
        return actionError('Select a vendor before sending the RMA.');
      case 'No replacement unit recorded for this RMA':
        return actionError('This RMA has no replacement unit recorded. Please refresh and try again.');
      case 'RMA case not found':
        return actionError('RMA case not found. It may have been updated or deleted. Please refresh and try again.');
      case 'Stock unit not found':
        return actionError('Returned stock unit not found. Please refresh and choose another unit.');
      case 'RMA case has no associated product service_id':
        return actionError('This RMA is missing product details. Please refresh and try again.');
      case 'RMA case has no returned unit':
        return actionError('This RMA has no returned unit recorded. Please refresh and try again.');
    }

    if (error.message.startsWith('RMA is in status')) {
      return actionError(`RMA status changed. ${error.message}`);
    }
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '23503') {
    return actionError('One of the selected RMA records is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('A stock unit with that serial number or MAC address already exists.');
  }

  return null;
}

async function withRmaActionErrors<T>(operation: () => Promise<T>): Promise<T | RmaActionError> {
  try {
    return await operation();
  } catch (error) {
    const expected = rmaActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
}

async function loadRma(trx: Knex.Transaction, tenant: string, rmaId: string): Promise<IRmaCase> {
  // Every caller is a status transition, so the row lock is the transition mutex:
  // concurrent transitions serialize here and assertStatus() is authoritative (F021).
  const rma = await trx('rma_cases').where({ tenant, rma_id: rmaId }).forUpdate().first();
  if (!rma) throw new Error('RMA case not found');
  return rma as IRmaCase;
}

function assertStatus(rma: IRmaCase, allowed: RmaStatus[]): void {
  if (!allowed.includes(rma.status)) {
    throw new Error(`RMA is in status '${rma.status}'; expected one of: ${allowed.join(', ')}`);
  }
}

/** The RMA's product service_id (set when the case was opened from the unit). */
function rmaServiceId(rma: IRmaCase): string {
  if (!rma.service_id) throw new Error('RMA case has no associated product service_id');
  return rma.service_id;
}

async function loadUnit(trx: Knex.Transaction, tenant: string, unitId: string): Promise<IStockUnit> {
  const unit = await trx('stock_units').where({ tenant, unit_id: unitId }).first();
  if (!unit) throw new Error('Stock unit not found');
  return unit as IStockUnit;
}

async function patchRma(
  trx: Knex.Transaction,
  tenant: string,
  rmaId: string,
  patch: Record<string, unknown>,
): Promise<IRmaCase> {
  const [row] = await trx('rma_cases')
    .where({ tenant, rma_id: rmaId })
    .update({ ...patch, updated_at: trx.fn.now() })
    .returning('*');
  if (!row) throw new Error('RMA case not found');
  return row as IRmaCase;
}

async function publishStockUnitUpdated(
  tenant: string,
  unitId: string | null | undefined,
  serviceId: string | null | undefined,
  userId: string,
  changedFields: string[],
): Promise<void> {
  if (!unitId) return;
  await publishInventoryEvent('INVENTORY_STOCK_UNIT_UPDATED', timestampPayload({
    tenant,
    unit_id: unitId,
    service_id: serviceId ?? undefined,
    user_id: userId,
    changed_fields: changedFields,
  }));
}

async function publishStockUnitCreated(
  tenant: string,
  unitId: string | null | undefined,
  serviceId: string | null | undefined,
  userId: string,
): Promise<void> {
  if (!unitId) return;
  await publishInventoryEvent('INVENTORY_STOCK_UNIT_CREATED', timestampPayload({
    tenant,
    unit_id: unitId,
    service_id: serviceId ?? undefined,
    user_id: userId,
  }));
}

/** Fields needed to receive a fresh replacement unit into sellable stock. */
interface NewUnitInput {
  serial_number: string;
  location_id: string;
  mac_address?: string | null;
  unit_cost?: number | null;
  cost_currency?: string | null;
  warranty_expires_at?: string | Date | null;
  warranty_term?: string | null;
  notes?: string | null;
}

/** Insert a new serialized unit as `in_stock` at a location (the row a `rma_in` receipt then references). */
async function createInStockUnit(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  input: NewUnitInput,
): Promise<IStockUnit> {
  const serial = (input?.serial_number ?? '').trim();
  if (!serial) throw new Error('serial_number is required for the replacement unit');
  if (!input?.location_id) throw new Error('location_id is required for the replacement unit');

  const settings = await trx('product_inventory_settings')
    .where({ tenant, service_id: serviceId })
    .select('cost_currency')
    .first();
  const defaultCurrency = await resolveTenantCurrency(trx, tenant);

  const [row] = await trx('stock_units')
    .insert({
      tenant,
      service_id: serviceId,
      serial_number: serial,
      mac_address: input.mac_address ?? null,
      status: 'in_stock',
      location_id: input.location_id,
      unit_cost: input.unit_cost ?? null,
      cost_currency: input.cost_currency ?? settings?.cost_currency ?? defaultCurrency,
      warranty_expires_at: input.warranty_expires_at ?? null,
      warranty_term: input.warranty_term ?? null,
      received_at: trx.fn.now(),
      notes: input.notes ?? null,
    })
    .returning('*');
  return row as IStockUnit;
}

/**
 * Receive a freshly-created in-stock unit via an `rma_in` movement (replacement intake).
 * When `unit_cost` is omitted, defaults from the returned (dead) unit — a free replacement
 * is not free stock; it inherits the replaced unit's cost so future COGS/margin stay truthful.
 */
async function receiveReplacementUnit(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  input: NewUnitInput,
  rmaId: string,
  performedBy: string,
): Promise<IStockUnit> {
  let unitInput = input;
  if (input.unit_cost == null) {
    const rma = await trx('rma_cases').where({ tenant, rma_id: rmaId }).select('returned_unit_id').first();
    if (rma?.returned_unit_id) {
      const dead = await trx('stock_units')
        .where({ tenant, unit_id: rma.returned_unit_id })
        .select('unit_cost', 'cost_currency')
        .first();
      if (dead?.unit_cost != null) {
        unitInput = {
          ...input,
          unit_cost: Number(dead.unit_cost),
          cost_currency: input.cost_currency ?? dead.cost_currency ?? null,
        };
      }
    }
  }

  const unit = await createInStockUnit(trx, tenant, serviceId, unitInput);
  await recordStockMovement(trx, tenant, {
    movement_type: 'rma_in',
    service_id: serviceId,
    quantity: 1,
    unit_id: unit.unit_id,
    to_location_id: unit.location_id ?? null,
    unit_cost: unit.unit_cost ?? null,
    cost_currency: unit.cost_currency,
    reason: 'RMA replacement received',
    source_doc_type: 'rma',
    source_doc_id: rmaId,
    performed_by: performedBy,
  });
  return unit;
}

// ---------------------------------------------------------------------------
// STANDARD track (return-first)
// ---------------------------------------------------------------------------

/** Open a standard RMA against a deployed unit. Derives product/client/asset from the unit. */
export const openRma = withAuth(
  async (
    user,
    { tenant },
    input: { returned_unit_id: string; reason?: string | null },
  ): Promise<IRmaCase | RmaActionError> => withRmaActionErrors(async () => {
    await requireInvPerm(user, 'create');
    if (!input?.returned_unit_id) throw new Error('returned_unit_id is required');
    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const unit = await loadUnit(trx, tenant, input.returned_unit_id);
      const [row] = await trx('rma_cases')
        .insert({
          tenant,
          rma_type: 'standard',
          returned_unit_id: unit.unit_id,
          service_id: unit.service_id,
          client_id: unit.client_id ?? null,
          asset_id: unit.asset_id ?? null,
          reason: input.reason ?? null,
          status: 'awaiting_return',
          created_by: user.user_id,
        })
        .returning('*');
      const rma = row as IRmaCase;
      return {
        rma,
        event: {
          tenant,
          rma_id: rma.rma_id,
          rma_reference: rma.rma_reference ?? null,
          client_id: rma.client_id ?? null,
          service_id: rma.service_id ?? null,
          serial_number: unit.serial_number ?? null,
        },
      };
    });

    await publishInventoryEvent('INVENTORY_RMA_CREATED', result.event);
    return result.rma;
  }),
);

/** Client returns the defective unit. delivered → returned (NOT sellable). */
export const receiveReturn = withAuth(
  async (user, { tenant }, rmaId: string, input: { location_id: string }): Promise<IRmaCase | RmaActionError> => withRmaActionErrors(async () => {
    await requireInvPerm(user, 'update');
    if (!input?.location_id) throw new Error('location_id is required');
    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const rma = await loadRma(trx, tenant, rmaId);
      assertStatus(rma, ['awaiting_return']);
      const serviceId = rmaServiceId(rma);
      if (!rma.returned_unit_id) throw new Error('RMA case has no returned unit');

      await recordStockMovement(trx, tenant, {
        movement_type: 'return_defective',
        service_id: serviceId,
        quantity: 1,
        unit_id: rma.returned_unit_id,
        to_location_id: input.location_id,
        reason: 'RMA defective return',
        source_doc_type: 'rma',
        source_doc_id: rmaId,
        performed_by: user.user_id,
        unitPatch: { status: 'returned', location_id: input.location_id },
      });

      return {
        rma: await patchRma(trx, tenant, rmaId, { status: 'returned' }),
        unit_id: rma.returned_unit_id,
        service_id: serviceId,
      };
    });

    await publishStockUnitUpdated(tenant, result.unit_id, result.service_id, user.user_id, ['status', 'location_id']);
    return result.rma;
  }),
);

/** Ship the returned unit out to the vendor. returned → in_rma. */
export const sendToVendor = withAuth(
  async (
    user,
    { tenant },
    rmaId: string,
    input: { vendor_id: string; rma_reference?: string | null },
  ): Promise<IRmaCase | RmaActionError> => withRmaActionErrors(async () => {
    await requireInvPerm(user, 'update');
    if (!input?.vendor_id) throw new Error('vendor_id is required');
    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const rma = await loadRma(trx, tenant, rmaId);
      assertStatus(rma, ['returned']);
      const serviceId = rmaServiceId(rma);
      if (!rma.returned_unit_id) throw new Error('RMA case has no returned unit');
      const unit = await loadUnit(trx, tenant, rma.returned_unit_id);

      await recordStockMovement(trx, tenant, {
        movement_type: 'rma_out',
        service_id: serviceId,
        quantity: 1,
        unit_id: unit.unit_id,
        from_location_id: unit.location_id ?? null,
        reason: 'RMA sent to vendor',
        source_doc_type: 'rma',
        source_doc_id: rmaId,
        performed_by: user.user_id,
        unitPatch: { status: 'in_rma' },
      });

      return {
        rma: await patchRma(trx, tenant, rmaId, {
          status: 'sent_to_vendor',
          vendor_id: input.vendor_id,
          rma_reference: input.rma_reference ?? rma.rma_reference ?? null,
        }),
        unit_id: unit.unit_id,
        service_id: serviceId,
      };
    });

    await publishStockUnitUpdated(tenant, result.unit_id, result.service_id, user.user_id, ['status']);
    return result.rma;
  }),
);

/** Vendor ships a brand-new replacement unit. Receive it (rma_in → in_stock); status 'replaced'. */
export const resolveReplacement = withAuth(
  async (user, { tenant }, rmaId: string, input: NewUnitInput): Promise<IRmaCase | RmaActionError> => withRmaActionErrors(async () => {
    await requireInvPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const rma = await loadRma(trx, tenant, rmaId);
      assertStatus(rma, ['sent_to_vendor']);
      const serviceId = rmaServiceId(rma);

      const unit = await receiveReplacementUnit(trx, tenant, serviceId, input, rmaId, user.user_id);

      return {
        rma: await patchRma(trx, tenant, rmaId, {
          status: 'replaced',
          replacement_unit_id: unit.unit_id,
        }),
        unit_id: unit.unit_id,
        service_id: serviceId,
      };
    });

    await publishStockUnitCreated(tenant, result.unit_id, result.service_id, user.user_id);
    return result.rma;
  }),
);

/** Vendor repairs the same unit and returns it. in_rma → in_stock; case closed. */
export const resolveRepair = withAuth(
  async (user, { tenant }, rmaId: string, input: { location_id: string }): Promise<IRmaCase | RmaActionError> => withRmaActionErrors(async () => {
    await requireInvPerm(user, 'update');
    if (!input?.location_id) throw new Error('location_id is required');
    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const rma = await loadRma(trx, tenant, rmaId);
      assertStatus(rma, ['sent_to_vendor']);
      const serviceId = rmaServiceId(rma);
      if (!rma.returned_unit_id) throw new Error('RMA case has no returned unit');

      await recordStockMovement(trx, tenant, {
        movement_type: 'rma_in',
        service_id: serviceId,
        quantity: 1,
        unit_id: rma.returned_unit_id,
        to_location_id: input.location_id,
        reason: 'RMA repaired and returned to stock',
        source_doc_type: 'rma',
        source_doc_id: rmaId,
        performed_by: user.user_id,
        unitPatch: { status: 'in_stock', location_id: input.location_id, client_id: null, asset_id: null },
      });

      return {
        rma: await patchRma(trx, tenant, rmaId, { status: 'closed', closed_at: trx.fn.now() }),
        unit_id: rma.returned_unit_id,
        service_id: serviceId,
      };
    });

    await publishStockUnitUpdated(tenant, result.unit_id, result.service_id, user.user_id, ['status', 'location_id', 'client_id', 'asset_id']);
    return result.rma;
  }),
);

/** Vendor credits us for the dead unit (unit retired); status 'credited'. */
export const resolveCredit = withAuth(
  async (user, { tenant }, rmaId: string): Promise<IRmaCase | RmaActionError> => withRmaActionErrors(async () => {
    await requireInvPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const rma = await loadRma(trx, tenant, rmaId);
      assertStatus(rma, ['sent_to_vendor']);
      const serviceId = rmaServiceId(rma);
      if (!rma.returned_unit_id) throw new Error('RMA case has no returned unit');
      const unit = await loadUnit(trx, tenant, rma.returned_unit_id);

      await recordStockMovement(trx, tenant, {
        movement_type: 'retire',
        service_id: serviceId,
        quantity: 1,
        unit_id: unit.unit_id,
        from_location_id: unit.location_id ?? null,
        reason: 'RMA resolved via vendor credit',
        source_doc_type: 'rma',
        source_doc_id: rmaId,
        performed_by: user.user_id,
        unitPatch: { status: 'retired' },
      });

      return {
        rma: await patchRma(trx, tenant, rmaId, { status: 'credited' }),
        unit_id: unit.unit_id,
        service_id: serviceId,
      };
    });

    await publishStockUnitUpdated(tenant, result.unit_id, result.service_id, user.user_id, ['status']);
    return result.rma;
  }),
);

/** No replacement/credit — scrap the dead unit (retired); case closed. */
export const resolveScrap = withAuth(
  async (user, { tenant }, rmaId: string): Promise<IRmaCase | RmaActionError> => withRmaActionErrors(async () => {
    await requireInvPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const rma = await loadRma(trx, tenant, rmaId);
      assertStatus(rma, ['sent_to_vendor', 'returned']);
      const serviceId = rmaServiceId(rma);
      if (!rma.returned_unit_id) throw new Error('RMA case has no returned unit');
      const unit = await loadUnit(trx, tenant, rma.returned_unit_id);

      await recordStockMovement(trx, tenant, {
        movement_type: 'retire',
        service_id: serviceId,
        quantity: 1,
        unit_id: unit.unit_id,
        from_location_id: unit.location_id ?? null,
        reason: 'RMA resolved via scrap',
        source_doc_type: 'rma',
        source_doc_id: rmaId,
        performed_by: user.user_id,
        unitPatch: { status: 'retired' },
      });

      return {
        rma: await patchRma(trx, tenant, rmaId, { status: 'closed', closed_at: trx.fn.now() }),
        unit_id: unit.unit_id,
        service_id: serviceId,
      };
    });

    await publishStockUnitUpdated(tenant, result.unit_id, result.service_id, user.user_id, ['status']);
    return result.rma;
  }),
);

// ---------------------------------------------------------------------------
// ADVANCE-REPLACEMENT track (replacement-first)
// ---------------------------------------------------------------------------

/** Open an advance-replacement RMA (replacement ships before the dead unit comes back). */
export const openAdvanceRma = withAuth(
  async (
    user,
    { tenant },
    input: { returned_unit_id: string; reason?: string | null; vendor_id?: string | null },
  ): Promise<IRmaCase | RmaActionError> => withRmaActionErrors(async () => {
    await requireInvPerm(user, 'create');
    if (!input?.returned_unit_id) throw new Error('returned_unit_id is required');
    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const unit = await loadUnit(trx, tenant, input.returned_unit_id);
      const [row] = await trx('rma_cases')
        .insert({
          tenant,
          rma_type: 'advance_replacement',
          returned_unit_id: unit.unit_id,
          service_id: unit.service_id,
          client_id: unit.client_id ?? null,
          asset_id: unit.asset_id ?? null,
          vendor_id: input.vendor_id ?? null,
          reason: input.reason ?? null,
          status: 'open',
          created_by: user.user_id,
        })
        .returning('*');
      const rma = row as IRmaCase;
      return {
        rma,
        event: {
          tenant,
          rma_id: rma.rma_id,
          rma_reference: rma.rma_reference ?? null,
          client_id: rma.client_id ?? null,
          service_id: rma.service_id ?? null,
          serial_number: unit.serial_number ?? null,
        },
      };
    });

    await publishInventoryEvent('INVENTORY_RMA_CREATED', result.event);
    return result.rma;
  }),
);

/** Replacement arrives first. Receive it into stock (rma_in → in_stock); status 'replacement_received'. */
export const recordReplacementReceived = withAuth(
  async (user, { tenant }, rmaId: string, input: NewUnitInput): Promise<IRmaCase | RmaActionError> => withRmaActionErrors(async () => {
    await requireInvPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const rma = await loadRma(trx, tenant, rmaId);
      assertStatus(rma, ['open']);
      const serviceId = rmaServiceId(rma);

      const unit = await receiveReplacementUnit(trx, tenant, serviceId, input, rmaId, user.user_id);

      return {
        rma: await patchRma(trx, tenant, rmaId, {
          status: 'replacement_received',
          replacement_unit_id: unit.unit_id,
        }),
        unit_id: unit.unit_id,
        service_id: serviceId,
      };
    });

    await publishStockUnitCreated(tenant, result.unit_id, result.service_id, user.user_id);
    return result.rma;
  }),
);

/**
 * Deploy the replacement to the client and relink the SAME asset to the new unit (F132):
 * asset's live serial/MAC + stock_unit_id point at the replacement; the old unit's asset back-pointer
 * is cleared. Replacement unit in_stock → delivered. Status 'replacement_deployed'.
 */
export const deployReplacement = withAuth(
  async (user, { tenant }, rmaId: string): Promise<IRmaCase | RmaActionError> => withRmaActionErrors(async () => {
    await requireInvPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const rma = await loadRma(trx, tenant, rmaId);
      // Both tracks converge here (F039): 'replacement_received' is the
      // advance-replacement track; 'replaced' is the standard track after
      // resolveReplacement received the vendor's new unit into stock. Without the
      // latter, a standard RMA dead-ended with the client's asset still pointing at
      // the dead unit and the fresh unit stranded in stock.
      assertStatus(rma, ['replacement_received', 'replaced']);
      const serviceId = rmaServiceId(rma);
      if (!rma.replacement_unit_id) throw new Error('No replacement unit recorded for this RMA');
      const repl = await loadUnit(trx, tenant, rma.replacement_unit_id);
      const now = new Date().toISOString();

      // Relink the existing asset to the replacement unit (carry live serial + MAC).
      if (rma.asset_id) {
        await trx('assets')
          .where({ tenant, asset_id: rma.asset_id })
          .update({
            serial_number: repl.serial_number,
            stock_unit_id: repl.unit_id,
            attributes: trx.raw(`COALESCE(attributes, '{}'::jsonb) || ?::jsonb`, [
              JSON.stringify({ mac_address: repl.mac_address ?? null }),
            ]),
            updated_at: trx.fn.now(),
          });
        // Clear the dead unit's asset back-pointer so only the replacement owns the asset.
        if (rma.returned_unit_id) {
          await trx('stock_units')
            .where({ tenant, unit_id: rma.returned_unit_id })
            .update({ asset_id: null, updated_at: trx.fn.now() });
        }
      }

      await recordStockMovement(trx, tenant, {
        movement_type: 'consume',
        service_id: serviceId,
        quantity: 1,
        unit_id: repl.unit_id,
        from_location_id: repl.location_id ?? null,
        unit_cost: repl.unit_cost ?? null,
        cost_currency: repl.cost_currency,
        reason: 'RMA advance-replacement deployed to client',
        source_doc_type: 'rma',
        source_doc_id: rmaId,
        performed_by: user.user_id,
        unitPatch: {
          status: 'delivered',
          client_id: rma.client_id ?? null,
          asset_id: rma.asset_id ?? null,
          delivered_at: now,
          location_id: null,
        },
      });

      return {
        rma: await patchRma(trx, tenant, rmaId, { status: 'replacement_deployed' }),
        replacement_unit_id: repl.unit_id,
        returned_unit_id: rma.returned_unit_id ?? null,
        service_id: serviceId,
      };
    });

    await publishStockUnitUpdated(tenant, result.replacement_unit_id, result.service_id, user.user_id, [
      'status',
      'client_id',
      'asset_id',
      'delivered_at',
      'location_id',
    ]);
    await publishStockUnitUpdated(tenant, result.returned_unit_id, result.service_id, user.user_id, ['asset_id']);
    return result.rma;
  }),
);

/** Start the dead-unit-owed clock: client still holds the dead unit, due back by `due_date`. */
export const markDeadUnitOwed = withAuth(
  async (user, { tenant }, rmaId: string, dueDate: string | Date): Promise<IRmaCase | RmaActionError> => withRmaActionErrors(async () => {
    await requireInvPerm(user, 'update');
    if (!dueDate) throw new Error('dead_unit_due_date is required');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const rma = await loadRma(trx, tenant, rmaId);
      assertStatus(rma, ['replacement_deployed']);
      return patchRma(trx, tenant, rmaId, {
        status: 'dead_unit_owed',
        dead_unit_due_date: dueDate,
      });
    });
  }),
);

/** The dead unit comes back and is forwarded to the vendor (return_defective → rma_out); case closed. */
export const recordDeadUnitReturned = withAuth(
  async (user, { tenant }, rmaId: string): Promise<IRmaCase | RmaActionError> => withRmaActionErrors(async () => {
    await requireInvPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const rma = await loadRma(trx, tenant, rmaId);
      assertStatus(rma, ['dead_unit_owed']);
      const serviceId = rmaServiceId(rma);
      if (!rma.returned_unit_id) throw new Error('RMA case has no returned unit');

      // Dead unit physically returns from the client...
      await recordStockMovement(trx, tenant, {
        movement_type: 'return_defective',
        service_id: serviceId,
        quantity: 1,
        unit_id: rma.returned_unit_id,
        reason: 'Dead unit returned by client',
        source_doc_type: 'rma',
        source_doc_id: rmaId,
        performed_by: user.user_id,
        unitPatch: { status: 'returned', client_id: null },
      });
      // ...then is shipped out to the vendor.
      await recordStockMovement(trx, tenant, {
        movement_type: 'rma_out',
        service_id: serviceId,
        quantity: 1,
        unit_id: rma.returned_unit_id,
        reason: 'Dead unit forwarded to vendor',
        source_doc_type: 'rma',
        source_doc_id: rmaId,
        performed_by: user.user_id,
        unitPatch: { status: 'in_rma' },
      });

      return {
        rma: await patchRma(trx, tenant, rmaId, {
          status: 'closed',
          dead_unit_returned_at: trx.fn.now(),
          closed_at: trx.fn.now(),
        }),
        unit_id: rma.returned_unit_id,
        service_id: serviceId,
      };
    });

    await publishStockUnitUpdated(tenant, result.unit_id, result.service_id, user.user_id, ['status', 'client_id']);
    return result.rma;
  }),
);

/** Deadline missed — bill the client for the unreturned dead unit. Status 'charged' (then closeRma). */
export const chargeForUnreturned = withAuth(
  async (user, { tenant }, rmaId: string): Promise<IRmaCase | RmaActionError> => withRmaActionErrors(async () => {
    await requireInvPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const rma = await loadRma(trx, tenant, rmaId);
      assertStatus(rma, ['dead_unit_owed']);
      return patchRma(trx, tenant, rmaId, { status: 'charged' });
    });
  }),
);

/** Terminal close for any resolved-but-open case (replaced / credited / charged / returned ...). */
export const closeRma = withAuth(
  async (user, { tenant }, rmaId: string): Promise<IRmaCase | RmaActionError> => withRmaActionErrors(async () => {
    await requireInvPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const rma = await loadRma(trx, tenant, rmaId);
      if (rma.status === 'closed') return rma;
      return patchRma(trx, tenant, rmaId, { status: 'closed', closed_at: trx.fn.now() });
    });
  }),
);

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** List RMA cases, newest first. Optionally filter by status and/or rma_type. */
export const listRmaCases = withAuth(
  async (
    user,
    { tenant },
    filter?: { status?: RmaStatus; rma_type?: IRmaCase['rma_type'] },
  ): Promise<IRmaCase[] | RmaActionError> => {
    return withRmaActionErrors(async () => {
      await requireInvPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        const query = trx('rma_cases as r')
          .leftJoin('clients as c', function () {
            this.on('r.client_id', '=', 'c.client_id').andOn('r.tenant', '=', 'c.tenant');
          })
          .leftJoin('vendors as v', function () {
            this.on('r.vendor_id', '=', 'v.vendor_id').andOn('r.tenant', '=', 'v.tenant');
          })
          .leftJoin('service_catalog as sc', function () {
            this.on('r.service_id', '=', 'sc.service_id').andOn('r.tenant', '=', 'sc.tenant');
          })
          .leftJoin('stock_units as su', function () {
            this.on('r.returned_unit_id', '=', 'su.unit_id').andOn('r.tenant', '=', 'su.tenant');
          })
          .where({ 'r.tenant': tenant })
          .select(
            'r.*',
            'c.client_name',
            'v.vendor_name',
            'sc.service_name',
            'sc.sku as service_sku',
            'su.serial_number as returned_serial_number',
            'su.mac_address as returned_mac_address',
            'su.unit_cost as returned_unit_cost',
            'su.cost_currency as returned_unit_cost_currency',
            trx.raw(`CASE
              WHEN r.status = 'sent_to_vendor' THEN GREATEST(
                0,
                FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(r.updated_at, r.opened_at, now()))) / 86400)
              )::int
              ELSE NULL
            END as age_days`),
          );
        if (filter?.status) query.andWhere({ 'r.status': filter.status });
        if (filter?.rma_type) query.andWhere({ 'r.rma_type': filter.rma_type });
        return (await query.orderBy('r.opened_at', 'desc')) as IRmaCase[];
      });
    });
  },
);

export type DeadUnitOwedRow = IRmaCase & { days_remaining: number | null };

/** Dashboard report: dead units owed to vendors, soonest-due first, with days remaining. */
export const deadUnitsOwedReport = withAuth(async (user, { tenant }): Promise<DeadUnitOwedRow[] | RmaActionError> => {
  return withRmaActionErrors(async () => {
    await requireInvPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const rows = (await trx('rma_cases as r')
        .leftJoin('clients as c', function () {
          this.on('r.client_id', '=', 'c.client_id').andOn('r.tenant', '=', 'c.tenant');
        })
        .leftJoin('vendors as v', function () {
          this.on('r.vendor_id', '=', 'v.vendor_id').andOn('r.tenant', '=', 'v.tenant');
        })
        .leftJoin('service_catalog as sc', function () {
          this.on('r.service_id', '=', 'sc.service_id').andOn('r.tenant', '=', 'sc.tenant');
        })
        .leftJoin('stock_units as su', function () {
          this.on('r.returned_unit_id', '=', 'su.unit_id').andOn('r.tenant', '=', 'su.tenant');
        })
        .where({ 'r.tenant': tenant, 'r.status': 'dead_unit_owed' })
        .select(
          'r.*',
          'c.client_name',
          'v.vendor_name',
          'sc.service_name',
          'sc.sku as service_sku',
          'su.serial_number as returned_serial_number',
          'su.mac_address as returned_mac_address',
          'su.unit_cost as returned_unit_cost',
          'su.cost_currency as returned_unit_cost_currency',
        )
        .orderBy('r.dead_unit_due_date', 'asc')) as IRmaCase[];
      const now = Date.now();
      return rows.map((r) => ({
        ...r,
        days_remaining: r.dead_unit_due_date
          ? Math.ceil((new Date(r.dead_unit_due_date).getTime() - now) / 86400000)
          : null,
      }));
    });
  });
});
