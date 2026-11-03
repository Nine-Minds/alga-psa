import { admitOperationalWrite } from '@alga-psa/db';
import { Knex } from 'knex';
import type {
  IProjectStagingLine,
  ProjectMaterialBillingDestination,
  ProjectStagingLineKind,
  ProjectStagingLineStatus,
} from '@alga-psa/types';
import {
  claimCounter,
  claimFifoUnits,
  claimSpecificUnit,
  isUnitClaimRefused,
  freeQuantity,
  lockStockLevel,
  moveCounterClaim,
  releaseClaimedUnits,
  releaseCounter,
  resolveAllocationLocation,
  type AllocationCounter,
  type UnitClaimRefusal,
} from './allocation';
import { evaluateConsumption, InsufficientStockError, stockConflictResultFrom, type StockConflictDetail } from './consume';
import { addMaterial, MaterialValidationError, removeMaterialInTransaction } from './materials';
import type { StockConflictResult } from './stockConflict';
import { resolveTenantCurrency } from './tenantCurrency';

/**
 * Project staging (alga-2026-0002683 C6): reserve -> stage -> install for project equipment, without
 * consuming stock until install. Design of record: ee/docs/plans/2026-10-20-physical-work-tags/
 * design-C6-project-staging.md (D2-D9).
 *
 * - A stock line's claim lives in the SHARED counters / unit status (allocation.ts), so every
 *   availability reader respects it; `reserved` is soft (reserved_quantity), `staged` is hard
 *   (held_quantity). Serialized lines are one unit each, claimed `allocated` with
 *   allocated_staging_line_id.
 * - Install goes through the canonical `addMaterial` (the only writer of project_materials and
 *   the only consumer of stock here), which releases the line's own claim and consumes at its location.
 * - Client lines (client_asset, client_item) are status changes only: no stock_units, movements,
 *   levels, cost or project_materials, ever.
 * - Nothing here bills: billing reads project_materials only.
 *
 * Permission gating lives in the projects action wrappers; this lib owns the semantics. Every write
 * runs inside one transaction (the caller's, when handed one).
 */

function runInTransaction<T>(db: Knex, fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  const maybe = db as unknown as { commit?: unknown; rollback?: unknown };
  if (typeof maybe.commit === 'function' && typeof maybe.rollback === 'function') {
    return fn(db as unknown as Knex.Transaction);
  }
  return db.transaction(fn);
}

export type StagingErrorCode =
  | 'not_found'
  | 'invalid_input'
  | 'invalid_state'
  | 'kit_not_stageable'
  | 'not_a_product'
  | 'wrong_client'
  | 'unit_unavailable'
  | 'in_sealed_box'
  | 'packed_exceeds_quantity'
  | 'already_staged_elsewhere';

/** A refused staging request the user can act on. Stock shortfalls are InsufficientStockError instead. */
export class StagingError extends Error {
  constructor(message: string, public readonly code: StagingErrorCode) {
    super(message);
    this.name = 'StagingError';
  }
}

const ACTIVE_STOCK_STATUSES: ProjectStagingLineStatus[] = ['reserved', 'staged'];
const ACTIVE_CLIENT_STATUSES: ProjectStagingLineStatus[] = ['received', 'staged'];
const BILLING_DESTINATIONS: ProjectMaterialBillingDestination[] = [
  'next_project_invoice',
  'schedule_entry',
  'separate',
  'project_completion',
  'on_hold',
];

interface ProductStagingMeta {
  service_name: string;
  item_kind: string;
  default_rate: number;
  track_stock: boolean;
  is_serialized: boolean;
  is_kit: boolean;
  default_location_id: string | null;
}

async function loadProductMeta(trx: Knex.Transaction, tenant: string, serviceId: string): Promise<ProductStagingMeta | null> {
  const row = await trx('service_catalog as sc')
    .leftJoin('product_inventory_settings as pis', function () {
      this.on('pis.service_id', '=', 'sc.service_id').andOn('pis.tenant', '=', 'sc.tenant');
    })
    .where({ 'sc.tenant': tenant, 'sc.service_id': serviceId })
    .first(
      'sc.service_name',
      'sc.item_kind',
      'sc.default_rate',
      'pis.track_stock',
      'pis.is_serialized',
      'pis.is_kit',
      'pis.default_location_id',
    );
  if (!row) return null;
  return {
    service_name: row.service_name ?? 'product',
    item_kind: row.item_kind,
    default_rate: Number(row.default_rate ?? 0),
    track_stock: Boolean(row.track_stock),
    is_serialized: Boolean(row.track_stock && row.is_serialized),
    is_kit: Boolean(row.is_kit),
    default_location_id: row.default_location_id ?? null,
  };
}

async function loadProject(trx: Knex.Transaction, tenant: string, projectId: string): Promise<{ project_id: string; client_id: string; project_number: string }> {
  const project = await trx('projects')
    .where({ tenant, project_id: projectId })
    .first('project_id', 'client_id', 'project_number');
  if (!project) throw new StagingError('Project not found', 'not_found');
  return project;
}

/** A task must belong to the project it is staged against. */
export async function assertTaskInProject(trx: Knex.Transaction, tenant: string, projectId: string, taskId: string | null | undefined): Promise<void> {
  if (!taskId) return;
  const task = await trx('project_tasks as t')
    .join('project_phases as ph', function () {
      this.on('ph.phase_id', '=', 't.phase_id').andOn('ph.tenant', '=', 't.tenant');
    })
    .where({ 't.tenant': tenant, 't.task_id': taskId, 'ph.project_id': projectId })
    .first('t.task_id');
  if (!task) throw new StagingError('The task does not belong to this project', 'invalid_input');
}

/** pg returns bigint `rate` as a string; staging lines leave this module with numbers. */
export function normalizeStagingLine<T extends { quantity: unknown; rate: unknown }>(row: T): T & { quantity: number; rate: number } {
  return { ...row, quantity: Number(row.quantity), rate: Number(row.rate) };
}

async function lockLine(trx: Knex.Transaction, tenant: string, lineId: string): Promise<IProjectStagingLine> {
  const line = await trx('project_staging_lines').where({ tenant, staging_line_id: lineId }).forUpdate().first();
  if (!line) throw new StagingError('Staging line not found', 'not_found');
  return normalizeStagingLine(line) as IProjectStagingLine;
}

function counterFor(status: ProjectStagingLineStatus): AllocationCounter {
  return status === 'staged' ? 'held_quantity' : 'reserved_quantity';
}

/** A non-serialized stock line that holds a counter claim (tracked products only carry a location). */
function holdsCounter(line: Pick<IProjectStagingLine, 'kind' | 'unit_id' | 'reserved_location_id' | 'status'>): boolean {
  return line.kind === 'stock' && !line.unit_id && Boolean(line.reserved_location_id) && ACTIVE_STOCK_STATUSES.includes(line.status);
}

function shortfallError(name: string, detail: Omit<StockConflictDetail, 'overrideable'>, verb = 'reserve'): InsufficientStockError {
  const free = Math.max(0, detail.free);
  const message = detail.reason === 'on_hand'
    ? `Cannot ${verb} ${detail.requested} of ${name}: ${detail.onHand} on hand.`
    : `Cannot ${verb} ${detail.requested} of ${name}: ${free} free (${detail.reserved} reserved, ${detail.held} on hard hold).`;
  // A reservation never overrides anyone else's claim: there is no partial or forced reserve (D4).
  return new InsufficientStockError(message, free, { ...detail, overrideable: false });
}

function unitRefusalMessage(reason: UnitClaimRefusal, name: string): string {
  switch (reason) {
    case 'not_found':
      return `The selected unit of ${name} was not found.`;
    case 'wrong_product':
      return `The selected unit is not a ${name}.`;
    default:
      return `The selected unit of ${name} is not in stock or is already allocated.`;
  }
}

async function plannedRate(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  currency: string,
  meta: ProductStagingMeta,
): Promise<number> {
  const price = await trx('service_prices').where({ tenant, service_id: serviceId, currency_code: currency }).first('rate');
  return Math.round(Number(price?.rate ?? meta.default_rate ?? 0));
}

// ---------------------------------------------------------------------------------------------
// Reserve

export interface ReserveStagingInput {
  project_id: string;
  task_id?: string | null;
  service_id: string;
  quantity: number;
  /** Non-serialized: the location to reserve at (defaults to the SO rule). Serialized: restricts FIFO. */
  location_id?: string | null;
  /** Serialized: explicit units (one line each). When given, quantity must equal their count. */
  unit_ids?: string[] | null;
  /** Planned rate (minor units) copied to the material at install. Defaults from the price list. */
  rate?: number | null;
  currency_code?: string | null;
  billing_destination?: ProjectMaterialBillingDestination | null;
  billing_schedule_entry_id?: string | null;
}

/**
 * Reserve stock for a project: all or nothing, at one location (D4). Non-serialized tracked stock
 * claims `reserved_quantity` (refused with a typed InsufficientStockError when the location's free
 * stock is short). Serialized stock creates one line per unit, claiming each unit; the whole request
 * fails if any unit cannot be claimed. Untracked products become plain lines with no claim. Kits and
 * non-products are refused.
 */
export async function reserveStagingLines(
  db: Knex,
  tenant: string,
  input: ReserveStagingInput,
  performedBy: string | null,
): Promise<IProjectStagingLine[]> {
  const unitIds = (input.unit_ids ?? []).filter(Boolean);
  const quantity = unitIds.length > 0 ? unitIds.length : Math.floor(Number(input.quantity));
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw new StagingError('quantity must be greater than 0', 'invalid_input');
  }
  if (unitIds.length > 0 && input.quantity != null && Math.floor(Number(input.quantity)) !== unitIds.length) {
    throw new StagingError('quantity must match the number of selected units', 'invalid_input');
  }
  if (new Set(unitIds).size !== unitIds.length) {
    throw new StagingError('A unit was selected twice', 'invalid_input');
  }
  if (input.billing_destination && !BILLING_DESTINATIONS.includes(input.billing_destination)) {
    throw new StagingError('Unknown billing destination', 'invalid_input');
  }
  if (input.billing_destination === 'schedule_entry' && !input.billing_schedule_entry_id) {
    throw new StagingError('A billing schedule entry is required', 'invalid_input');
  }
  if (input.billing_destination !== 'schedule_entry' && input.billing_schedule_entry_id) {
    throw new StagingError('billing_schedule_entry_id is only valid for the schedule entry destination', 'invalid_input');
  }

  return runInTransaction(db, async (trx) => {
    await loadProject(trx, tenant, input.project_id);
    await assertTaskInProject(trx, tenant, input.project_id, input.task_id);

    const meta = await loadProductMeta(trx, tenant, input.service_id);
    if (!meta) throw new StagingError('Product not found', 'not_found');
    if (meta.item_kind !== 'product') {
      throw new StagingError('Only products can be staged', 'not_a_product');
    }
    if (meta.is_kit) {
      throw new StagingError("Kits cannot be staged: stage the kit's components", 'kit_not_stageable');
    }
    if (unitIds.length > 0 && !meta.is_serialized) {
      throw new StagingError('Units can only be selected for serial-numbered products', 'invalid_input');
    }

    const currency = input.currency_code || (await resolveTenantCurrency(trx, tenant));
    const rate = input.rate == null ? await plannedRate(trx, tenant, input.service_id, currency, meta) : Math.round(Number(input.rate));
    if (!Number.isFinite(rate) || rate < 0) throw new StagingError('rate must be 0 or greater', 'invalid_input');

    if (input.location_id) {
      const location = await trx('stock_locations').where({ tenant, location_id: input.location_id }).first('location_id', 'is_active');
      if (!location || location.is_active === false) throw new StagingError('Stock location not found', 'invalid_input');
    }

    const base = {
      tenant,
      project_id: input.project_id,
      task_id: input.task_id ?? null,
      kind: 'stock' as ProjectStagingLineKind,
      status: 'reserved' as ProjectStagingLineStatus,
      service_id: input.service_id,
      rate,
      currency_code: currency,
      billing_destination: input.billing_destination ?? null,
      billing_schedule_entry_id: input.billing_schedule_entry_id ?? null,
      reserved_at: trx.fn.now(),
      reserved_by: performedBy,
      created_by: performedBy,
    };

    if (!meta.track_stock) {
      // Untracked: a plain planning line. Nothing to claim, so nothing can be short.
      const [line] = await trx('project_staging_lines').insert({ ...base, quantity }).returning('*');
      return [normalizeStagingLine(line) as IProjectStagingLine];
    }

    if (meta.is_serialized) {
      const preferred = input.location_id ?? (await resolveAllocationLocation(trx, tenant, input.service_id, meta.default_location_id));
      const lines: IProjectStagingLine[] = [];
      for (let i = 0; i < quantity; i += 1) {
        // The line exists first: the unit's claim column references it.
        const [line] = await trx('project_staging_lines').insert({ ...base, quantity: 1 }).returning('*');
        const claimant = { kind: 'staging_line' as const, id: line.staging_line_id };
        let unitId: string | null = null;
        if (unitIds.length > 0) {
          const claimed = await claimSpecificUnit(trx, tenant, { unitId: unitIds[i], serviceId: input.service_id, claimant });
          if (isUnitClaimRefused(claimed)) throw new StagingError(unitRefusalMessage(claimed.reason, meta.service_name), 'unit_unavailable');
          unitId = claimed.unit.unit_id;
        } else {
          const [unit] = await claimFifoUnits(trx, tenant, {
            serviceId: input.service_id,
            quantity: 1,
            preferredLocationId: preferred,
            locationId: input.location_id ?? null,
            claimant,
          });
          if (!unit) {
            // All or nothing: the transaction rolls back every unit claimed so far.
            throw shortfallError(meta.service_name, {
              reason: 'on_hand',
              free: i,
              onHand: i,
              reserved: 0,
              held: 0,
              requested: quantity,
            });
          }
          unitId = unit.unit_id;
        }
        const [updated] = await trx('project_staging_lines')
          .where({ tenant, staging_line_id: line.staging_line_id })
          .update({ unit_id: unitId, updated_at: trx.fn.now() })
          .returning('*');
        lines.push(normalizeStagingLine(updated) as IProjectStagingLine);
      }
      return lines;
    }

    const location = input.location_id ?? (await resolveAllocationLocation(trx, tenant, input.service_id, meta.default_location_id));
    if (!location) {
      throw shortfallError(meta.service_name, { reason: 'on_hand', free: 0, onHand: 0, reserved: 0, held: 0, requested: quantity });
    }
    const claim = await claimCounter(trx, tenant, {
      serviceId: input.service_id,
      locationId: location,
      column: 'reserved_quantity',
      requested: quantity,
      mode: 'all_or_nothing',
    });
    if (claim.claimed !== quantity) {
      const decision = evaluateConsumption(claim.level, quantity, false);
      throw shortfallError(meta.service_name, decision.detail);
    }
    const [line] = await trx('project_staging_lines')
      .insert({ ...base, quantity, reserved_location_id: location })
      .returning('*');
    return [normalizeStagingLine(line) as IProjectStagingLine];
  });
}

// ---------------------------------------------------------------------------------------------
// Edit a reservation

async function packedQuantity(trx: Knex.Transaction, tenant: string, lineId: string): Promise<number> {
  const row = await trx('staging_container_members').where({ tenant, staging_line_id: lineId }).sum({ q: 'quantity' }).first();
  return Number(row?.q ?? 0);
}

async function assertNotInSealedBox(trx: Knex.Transaction, tenant: string, lineId: string): Promise<void> {
  const sealed = await trx('staging_container_members as m')
    .join('staging_containers as c', function () {
      this.on('c.container_id', '=', 'm.container_id').andOn('c.tenant', '=', 'm.tenant');
    })
    .where({ 'm.tenant': tenant, 'm.staging_line_id': lineId, 'c.status': 'sealed' })
    .first('c.container_id');
  if (sealed) throw new StagingError('This item is packed in a sealed box. Reopen the box first.', 'in_sealed_box');
}

/**
 * Change a non-serialized reservation's quantity (D8). An increase claims the difference under the
 * level lock (all or nothing, refused with a typed shortfall); a decrease releases the difference.
 * It can never drop below what is already packed.
 */
export async function adjustReservation(
  db: Knex,
  tenant: string,
  lineId: string,
  newQuantity: number,
  _performedBy: string | null,
): Promise<IProjectStagingLine> {
  const quantity = Math.floor(Number(newQuantity));
  if (!Number.isFinite(quantity) || quantity < 1) throw new StagingError('quantity must be greater than 0', 'invalid_input');
  return runInTransaction(db, async (trx) => {
    const line = await lockLine(trx, tenant, lineId);
    if (line.kind === 'client_asset' || line.unit_id) {
      throw new StagingError('Serialized and client-asset lines are one unit each', 'invalid_state');
    }
    if (!(line.kind === 'stock' ? ACTIVE_STOCK_STATUSES : ACTIVE_CLIENT_STATUSES).includes(line.status)) {
      throw new StagingError('Only open staging lines can be changed', 'invalid_state');
    }
    const packed = await packedQuantity(trx, tenant, lineId);
    if (quantity < packed) {
      throw new StagingError(`${packed} of this line ${packed === 1 ? 'is' : 'are'} packed; unpack before reducing it`, 'packed_exceeds_quantity');
    }
    const delta = quantity - line.quantity;
    if (delta !== 0 && holdsCounter(line)) {
      const column = counterFor(line.status);
      if (delta > 0) {
        const claim = await claimCounter(trx, tenant, {
          serviceId: line.service_id!,
          locationId: line.reserved_location_id!,
          column,
          requested: delta,
          mode: 'all_or_nothing',
        });
        if (claim.claimed !== delta) {
          const meta = await loadProductMeta(trx, tenant, line.service_id!);
          throw shortfallError(meta?.service_name ?? 'product', evaluateConsumption(claim.level, delta, false).detail);
        }
      } else {
        await releaseCounter(trx, tenant, line.service_id!, line.reserved_location_id, column, -delta);
      }
    }
    const [updated] = await trx('project_staging_lines')
      .where({ tenant, staging_line_id: lineId })
      .update({ quantity, updated_at: trx.fn.now() })
      .returning('*');
    return normalizeStagingLine(updated) as IProjectStagingLine;
  });
}

/** Swap a serialized line's unit while reserved or staged (D8): release the old unit, claim the new one under lock. */
export async function swapUnit(
  db: Knex,
  tenant: string,
  lineId: string,
  newUnitId: string,
  _performedBy: string | null,
): Promise<IProjectStagingLine> {
  return runInTransaction(db, async (trx) => {
    const line = await lockLine(trx, tenant, lineId);
    if (line.kind !== 'stock' || !line.unit_id || !ACTIVE_STOCK_STATUSES.includes(line.status)) {
      throw new StagingError('Only a reserved or staged serialized line can change its unit', 'invalid_state');
    }
    if (line.unit_id === newUnitId) return line;
    await assertNotInSealedBox(trx, tenant, lineId);
    await releaseClaimedUnits(trx, tenant, 'staging_line', [lineId]);
    const claimed = await claimSpecificUnit(trx, tenant, {
      unitId: newUnitId,
      serviceId: line.service_id!,
      claimant: { kind: 'staging_line', id: lineId },
    });
    if (isUnitClaimRefused(claimed)) {
      const meta = await loadProductMeta(trx, tenant, line.service_id!);
      throw new StagingError(unitRefusalMessage(claimed.reason, meta?.service_name ?? 'product'), 'unit_unavailable');
    }
    const [updated] = await trx('project_staging_lines')
      .where({ tenant, staging_line_id: lineId })
      .update({ unit_id: newUnitId, updated_at: trx.fn.now() })
      .returning('*');
    return normalizeStagingLine(updated) as IProjectStagingLine;
  });
}

// ---------------------------------------------------------------------------------------------
// Stage and release

/**
 * Stage one locked line inside the caller's transaction (also used by packing). reserved -> staged
 * moves a non-serialized claim from the soft to the hard counter, which needs the stock to be
 * physically there (on_hand >= held after the move); received -> staged for client lines. Staging an
 * already staged line is a no-op.
 */
export async function stageLineInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  line: IProjectStagingLine,
  performedBy: string | null,
): Promise<IProjectStagingLine> {
  if (line.status === 'staged') return line;
  const fromOk = line.kind === 'stock' ? line.status === 'reserved' : line.status === 'received';
  if (!fromOk) throw new StagingError(`A ${line.status} line cannot be staged`, 'invalid_state');

  if (holdsCounter(line)) {
    const level = await lockStockLevel(trx, tenant, line.service_id!, line.reserved_location_id!, { ensure: true });
    const onHand = Number(level?.quantity_on_hand ?? 0);
    const held = Number(level?.held_quantity ?? 0);
    // A hard hold must be backed by stock on the shelf. A soft reservation can have been consumed
    // by an explicit override (B1), leaving the claim short; staging then refuses rather than hold
    // stock that is not there.
    if (held + line.quantity > onHand) {
      const meta = await loadProductMeta(trx, tenant, line.service_id!);
      throw shortfallError(
        meta?.service_name ?? 'product',
        {
          reason: 'on_hand',
          free: freeQuantity(level) + line.quantity,
          onHand,
          reserved: Number(level?.reserved_quantity ?? 0),
          held,
          requested: line.quantity,
        },
        'stage',
      );
    }
    await moveCounterClaim(trx, tenant, line.service_id!, line.reserved_location_id!, 'reserved_quantity', 'held_quantity', line.quantity);
  }

  const [updated] = await trx('project_staging_lines')
    .where({ tenant, staging_line_id: line.staging_line_id })
    .update({ status: 'staged', staged_at: trx.fn.now(), staged_by: performedBy, updated_at: trx.fn.now() })
    .returning('*');
  return normalizeStagingLine(updated) as IProjectStagingLine;
}

export async function stageLines(
  db: Knex,
  tenant: string,
  lineIds: readonly string[],
  performedBy: string | null,
  opts: { projectId?: string } = {},
): Promise<IProjectStagingLine[]> {
  return runInTransaction(db, async (trx) => {
    const result: IProjectStagingLine[] = [];
    for (const id of lineIds) {
      const line = await lockLine(trx, tenant, id);
      if (opts.projectId && line.project_id !== opts.projectId) throw new StagingError('Staging line not found', 'not_found');
      result.push(await stageLineInTransaction(trx, tenant, line, performedBy));
    }
    return result;
  });
}

async function releaseLineInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  line: IProjectStagingLine,
  performedBy: string | null,
): Promise<IProjectStagingLine> {
  const active = (line.kind === 'stock' ? ACTIVE_STOCK_STATUSES : ACTIVE_CLIENT_STATUSES).includes(line.status);
  if (!active) throw new StagingError(`A ${line.status} line cannot be released`, 'invalid_state');
  await assertNotInSealedBox(trx, tenant, line.staging_line_id);

  if (line.kind === 'stock') {
    if (line.unit_id) {
      await releaseClaimedUnits(trx, tenant, 'staging_line', [line.staging_line_id]);
    } else if (holdsCounter(line)) {
      await lockStockLevel(trx, tenant, line.service_id!, line.reserved_location_id!, { ensure: true });
      await releaseCounter(trx, tenant, line.service_id!, line.reserved_location_id, counterFor(line.status), line.quantity);
    }
  }
  // A released line is in no box.
  await trx('staging_container_members').where({ tenant, staging_line_id: line.staging_line_id }).delete();
  const [updated] = await trx('project_staging_lines')
    .where({ tenant, staging_line_id: line.staging_line_id })
    .update({ status: 'released', released_at: trx.fn.now(), released_by: performedBy, updated_at: trx.fn.now() })
    .returning('*');
  return normalizeStagingLine(updated) as IProjectStagingLine;
}

/** Release reserved/staged (or received) lines: claims are returned, the lines leave their boxes. */
export async function releaseLines(
  db: Knex,
  tenant: string,
  lineIds: readonly string[],
  performedBy: string | null,
  opts: { projectId?: string } = {},
): Promise<IProjectStagingLine[]> {
  return runInTransaction(db, async (trx) => {
    const result: IProjectStagingLine[] = [];
    for (const id of lineIds) {
      const line = await lockLine(trx, tenant, id);
      if (opts.projectId && line.project_id !== opts.projectId) throw new StagingError('Staging line not found', 'not_found');
      result.push(await releaseLineInTransaction(trx, tenant, line, performedBy));
    }
    return result;
  });
}

/** Live (still claiming or held) lines among `lineRows`; installed / released lines are history. */
function isLiveLine(line: Pick<IProjectStagingLine, 'kind' | 'status'>): boolean {
  return (line.kind === 'stock' ? ACTIVE_STOCK_STATUSES : ACTIVE_CLIENT_STATUSES).includes(line.status);
}

async function releaseLiveLinesWhere(
  trx: Knex.Transaction,
  tenant: string,
  scope: (query: Knex.QueryBuilder) => Knex.QueryBuilder,
  performedBy: string | null,
): Promise<number> {
  const rows = await scope(trx('project_staging_lines').where({ tenant }))
    .orderBy('staging_line_id', 'asc')
    .select('staging_line_id', 'kind', 'status');
  const live = rows.filter((r: IProjectStagingLine) => isLiveLine(r));
  if (live.length === 0) return 0;
  // A released line must leave its box, and a sealed box cannot lose members: reopen those boxes first
  // (same rule as releaseAllProjectClaims - the work they were packed for is going away).
  const sealedBoxIds = await trx('staging_container_members as m')
    .join('staging_containers as c', function () {
      this.on('c.container_id', '=', 'm.container_id').andOn('c.tenant', '=', 'm.tenant');
    })
    .where({ 'm.tenant': tenant, 'c.status': 'sealed' })
    .whereIn('m.staging_line_id', live.map((l: { staging_line_id: string }) => l.staging_line_id))
    .pluck('c.container_id');
  if (sealedBoxIds.length > 0) {
    await trx('staging_containers')
      .where({ tenant })
      .whereIn('container_id', sealedBoxIds)
      .update({ status: 'open', sealed_at: null, sealed_by: null, updated_at: trx.fn.now() });
  }
  for (const { staging_line_id } of live) {
    const line = await lockLine(trx, tenant, staging_line_id);
    if (isLiveLine(line)) await releaseLineInTransaction(trx, tenant, line, performedBy);
  }
  return live.length;
}

/**
 * Task delete policy (C6 repair): before tasks are deleted, release every live staging line on them
 * (reserved / staged stock, received / staged client lines) through the same code `releaseLines` uses,
 * so counters and serial units go back to free and the lines leave their boxes. Installed and released
 * lines own history (a project_materials row) and are NOT cascaded away: they are detached
 * (task_id = NULL) and stay on the project. Boxes on the tasks are detached too and stay on the project.
 * project_staging_lines_task_fk and staging_containers_task_fk are NO ACTION, so skipping this helper
 * fails loudly instead of leaving phantom claims. Runs inside the caller's transaction.
 */
export async function releaseStagingForTasks(
  trx: Knex.Transaction,
  tenant: string,
  taskIds: readonly string[],
  performedBy: string | null,
): Promise<{ released: number }> {
  if (taskIds.length === 0) return { released: 0 };
  const ids = [...taskIds];
  const released = await releaseLiveLinesWhere(trx, tenant, (q) => q.whereIn('task_id', ids), performedBy);
  await trx('project_staging_lines').where({ tenant }).whereIn('task_id', ids).update({ task_id: null, updated_at: trx.fn.now() });
  await trx('staging_containers').where({ tenant }).whereIn('task_id', ids).update({ task_id: null, updated_at: trx.fn.now() });
  return { released };
}

export async function releaseStagingForTask(
  trx: Knex.Transaction,
  tenant: string,
  taskId: string,
  performedBy: string | null,
): Promise<{ released: number }> {
  return releaseStagingForTasks(trx, tenant, [taskId], performedBy);
}

/**
 * Project delete: release every live claim (including client lines), then remove the project's boxes,
 * members and lines explicitly - the same rows the project FK cascade would remove, but only after the
 * claims are returned, and before the project's tasks are deleted (the task FK is NO ACTION).
 */
export async function releaseStagingForProject(
  trx: Knex.Transaction,
  tenant: string,
  projectId: string,
  performedBy: string | null,
): Promise<{ released: number }> {
  const released = await releaseLiveLinesWhere(trx, tenant, (q) => q.where({ project_id: projectId }), performedBy);
  const containerIds = trx('staging_containers').where({ tenant, project_id: projectId }).select('container_id');
  await trx('staging_container_members').where({ tenant }).whereIn('container_id', containerIds).delete();
  await trx('staging_containers').where({ tenant, project_id: projectId }).delete();
  await trx('project_staging_lines').where({ tenant, project_id: projectId }).delete();
  return { released };
}

/** Active stock claims on a project (reserved or staged stock lines). */
export async function countActiveStockClaims(db: Knex | Knex.Transaction, tenant: string, projectId: string): Promise<number> {
  const row = await db('project_staging_lines')
    .where({ tenant, project_id: projectId, kind: 'stock' })
    .whereIn('status', ACTIVE_STOCK_STATUSES)
    .count<{ c: string }>('* as c')
    .first();
  return Number(row?.c ?? 0);
}

/**
 * "Release all reserved and staged" for a project being completed or closed (design risk:
 * stale reservations). Lines in sealed boxes are released too: the boxes are reopened first, since
 * the project is done with them.
 */
export async function releaseAllProjectClaims(
  db: Knex,
  tenant: string,
  projectId: string,
  performedBy: string | null,
): Promise<{ released: number }> {
  return runInTransaction(db, async (trx) => {
    const lines = await trx('project_staging_lines')
      .where({ tenant, project_id: projectId, kind: 'stock' })
      .whereIn('status', ACTIVE_STOCK_STATUSES)
      .orderBy('created_at', 'asc')
      .select('staging_line_id');
    if (lines.length === 0) return { released: 0 };
    await trx('staging_containers')
      .where({ tenant, project_id: projectId, status: 'sealed' })
      .whereNull('deleted_at')
      .update({ status: 'open', sealed_at: null, sealed_by: null, updated_at: trx.fn.now() });
    for (const { staging_line_id } of lines) {
      const line = await lockLine(trx, tenant, staging_line_id);
      await releaseLineInTransaction(trx, tenant, line, performedBy);
    }
    return { released: lines.length };
  });
}

// ---------------------------------------------------------------------------------------------
// Install

export type InstallLineResult =
  | { staging_line_id: string; ok: true; project_material_id: string | null }
  | { staging_line_id: string; ok: false; message: string; stockConflict?: StockConflictResult['stockConflict'] };

/**
 * Install staged or reserved lines (D7). Each line runs in ITS OWN transaction so one failure does
 * not undo the others; the result lists every line's outcome. Stock lines create their
 * project_materials row through the canonical addMaterial (consuming the line's own claim at its
 * location, creating the delivered asset after commit); client lines change status only.
 *
 * Must be handed a knex instance, not a transaction: the per-line transactions and addMaterial's
 * post-commit asset creation depend on it.
 */
export async function installLines(
  db: Knex,
  tenant: string,
  lineIds: readonly string[],
  performedBy: string | null,
  opts: { projectId?: string; allowReservedOverride?: boolean } = {},
): Promise<InstallLineResult[]> {
  const results: InstallLineResult[] = [];
  for (const id of lineIds) {
    try {
      const line = (await db('project_staging_lines').where({ tenant, staging_line_id: id }).first()) as IProjectStagingLine | undefined;
      if (!line || (opts.projectId && line.project_id !== opts.projectId)) {
        throw new StagingError('Staging line not found', 'not_found');
      }
      if (line.kind !== 'stock') {
        await db.transaction(async (trx) => {
          const locked = await lockLine(trx, tenant, id);
          if (!ACTIVE_CLIENT_STATUSES.includes(locked.status)) {
            throw new StagingError(`A ${locked.status} line cannot be installed`, 'invalid_state');
          }
          await trx('project_staging_lines')
            .where({ tenant, staging_line_id: id })
            .update({ status: 'installed', installed_at: trx.fn.now(), installed_by: performedBy, updated_at: trx.fn.now() });
        });
        results.push({ staging_line_id: id, ok: true, project_material_id: null });
        continue;
      }
      if (!ACTIVE_STOCK_STATUSES.includes(line.status)) {
        throw new StagingError(`A ${line.status} line cannot be installed`, 'invalid_state');
      }
      const materialInput = {
          parent_type: 'project' as const,
          parent_id: line.project_id,
          service_id: line.service_id!,
          quantity: Number(line.quantity),
          rate: Number(line.rate),
          currency_code: line.currency_code ?? null,
          description: line.description ?? null,
          unit_id: line.unit_id ?? null,
          ...(line.billing_destination ? { billing_destination: line.billing_destination } : {}),
          billing_schedule_entry_id: line.billing_schedule_entry_id ?? null,
          allow_reserved_override: opts.allowReservedOverride === true,
        };
      // Each line is atomic on its own. Handed a transaction (tests, composed callers), the line runs
      // in a savepoint of it; handed a knex instance, addMaterial opens the line's own transaction.
      const isTransaction = typeof (db as unknown as { commit?: unknown }).commit === 'function';
      const material = isTransaction
        ? await (db as unknown as Knex.Transaction).transaction((sp) =>
            addMaterial(sp as unknown as Knex, tenant, materialInput, performedBy, { fromStagingLineId: id }))
        : await addMaterial(db, tenant, materialInput, performedBy, { fromStagingLineId: id });
      results.push({ staging_line_id: id, ok: true, project_material_id: (material as { project_material_id: string }).project_material_id });
    } catch (error) {
      const conflict = stockConflictResultFrom(error);
      if (conflict) {
        results.push({ staging_line_id: id, ok: false, message: conflict.stockConflict.message, stockConflict: conflict.stockConflict });
      } else if (error instanceof StagingError || error instanceof MaterialValidationError || error instanceof InsufficientStockError) {
        results.push({ staging_line_id: id, ok: false, message: error.message });
      } else {
        throw error;
      }
    }
  }
  return results;
}

/**
 * Undo an install (D8), in one transaction: reverse the consumption through the materials layer
 * (refused if billed), then re-claim the restored stock as a hard hold (staged) at the original
 * location / unit. If that stock is no longer free the whole undo is refused and the material stays.
 */
export async function undoInstall(
  db: Knex,
  tenant: string,
  lineId: string,
  performedBy: string | null,
  opts: { projectId?: string } = {},
): Promise<IProjectStagingLine> {
  return runInTransaction(db, async (trx) => {
    const line = await lockLine(trx, tenant, lineId);
    if (opts.projectId && line.project_id !== opts.projectId) throw new StagingError('Staging line not found', 'not_found');
    if (line.status !== 'installed') throw new StagingError('Only an installed line can be undone', 'invalid_state');

    if (line.kind === 'stock') {
      if (!line.project_material_id) throw new StagingError('The installed material no longer exists', 'invalid_state');
      const materialId = line.project_material_id;
      const removed = await removeMaterialInTransaction(trx, tenant, 'project', materialId, performedBy);
      if (!removed) throw new StagingError('The installed material no longer exists', 'invalid_state');
      // The line stops pointing at the material (and stops being installed) before the material
      // row goes (FK). A refused re-claim below rolls all of this back.
      await trx('project_staging_lines')
        .where({ tenant, staging_line_id: lineId })
        .update({ status: 'staged', project_material_id: null, installed_at: null, installed_by: null, updated_at: trx.fn.now() });
      await admitOperationalWrite(trx, tenant, 'project_materials', 'unstage-project-material');
      await trx('project_materials').where({ tenant, project_material_id: materialId }).delete();

      const meta = await loadProductMeta(trx, tenant, line.service_id!);
      const name = meta?.service_name ?? 'product';
      if (line.unit_id) {
        const claimed = await claimSpecificUnit(trx, tenant, {
          unitId: line.unit_id,
          serviceId: line.service_id!,
          claimant: { kind: 'staging_line', id: lineId },
        });
        if (isUnitClaimRefused(claimed)) throw new StagingError(unitRefusalMessage(claimed.reason, name), 'unit_unavailable');
      } else if (line.reserved_location_id && meta?.track_stock) {
        const claim = await claimCounter(trx, tenant, {
          serviceId: line.service_id!,
          locationId: line.reserved_location_id,
          column: 'held_quantity',
          requested: line.quantity,
          mode: 'all_or_nothing',
        });
        if (claim.claimed !== line.quantity) {
          throw shortfallError(name, evaluateConsumption(claim.level, line.quantity, false).detail, 'restage');
        }
      }
    }

    const [updated] = await trx('project_staging_lines')
      .where({ tenant, staging_line_id: lineId })
      .update({ status: 'staged', installed_at: null, installed_by: null, updated_at: trx.fn.now() })
      .returning('*');
    return normalizeStagingLine(updated) as IProjectStagingLine;
  });
}

// ---------------------------------------------------------------------------------------------
// Client-provided items (D9, C4 not merged: plain links, custody is a follow-up)

export type ClientStagingItem =
  | { kind: 'client_asset'; asset_id: string; description?: string | null }
  | { kind: 'client_item'; description: string; quantity?: number };

/**
 * Add client-provided items to a project's staging as `received` lines. A client asset must belong
 * to the project's client and may be on only one open staging line. No stock, movement, level,
 * cost or material is ever written for these lines.
 */
export async function addClientLines(
  db: Knex,
  tenant: string,
  input: { project_id: string; task_id?: string | null; items: ClientStagingItem[] },
  performedBy: string | null,
): Promise<IProjectStagingLine[]> {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new StagingError('Add at least one item', 'invalid_input');
  }
  return runInTransaction(db, async (trx) => {
    const project = await loadProject(trx, tenant, input.project_id);
    await assertTaskInProject(trx, tenant, input.project_id, input.task_id);
    const created: IProjectStagingLine[] = [];
    for (const item of input.items) {
      const base = {
        tenant,
        project_id: input.project_id,
        task_id: input.task_id ?? null,
        status: 'received' as ProjectStagingLineStatus,
        rate: 0,
        created_by: performedBy,
      };
      if (item.kind === 'client_asset') {
        const asset = await trx('assets').where({ tenant, asset_id: item.asset_id }).forUpdate().first('asset_id', 'client_id');
        if (!asset) throw new StagingError('Asset not found', 'not_found');
        if (asset.client_id !== project.client_id) {
          throw new StagingError("The asset does not belong to this project's client", 'wrong_client');
        }
        const open = await trx('project_staging_lines')
          .where({ tenant, asset_id: item.asset_id, kind: 'client_asset' })
          .whereIn('status', ACTIVE_CLIENT_STATUSES)
          .first('staging_line_id');
        if (open) throw new StagingError('This asset is already in staging', 'already_staged_elsewhere');
        const [line] = await trx('project_staging_lines')
          .insert({ ...base, kind: 'client_asset', asset_id: item.asset_id, quantity: 1, description: item.description?.trim() || null })
          .returning('*');
        created.push(normalizeStagingLine(line) as IProjectStagingLine);
      } else if (item.kind === 'client_item') {
        const description = typeof item.description === 'string' ? item.description.trim() : '';
        if (!description) throw new StagingError('Describe the client item', 'invalid_input');
        if (description.length > 500) throw new StagingError('The description is too long', 'invalid_input');
        const quantity = item.quantity == null ? 1 : Math.floor(Number(item.quantity));
        if (!Number.isFinite(quantity) || quantity < 1) throw new StagingError('quantity must be greater than 0', 'invalid_input');
        const [line] = await trx('project_staging_lines')
          .insert({ ...base, kind: 'client_item', description, quantity })
          .returning('*');
        created.push(normalizeStagingLine(line) as IProjectStagingLine);
      } else {
        throw new StagingError('Unknown item kind', 'invalid_input');
      }
    }
    return created;
  });
}

// ---------------------------------------------------------------------------------------------
// Read

export interface StagingLineView extends IProjectStagingLine {
  service_name: string | null;
  sku: string | null;
  is_serialized: boolean;
  track_stock: boolean;
  serial_number: string | null;
  unit_status: string | null;
  location_name: string | null;
  asset_tag: string | null;
  asset_name: string | null;
  asset_serial_number: string | null;
  task_name: string | null;
  /** Quantity packed across boxes. */
  packed_quantity: number;
  container_ids: string[];
  /**
   * Non-serialized active claims only: how far the location's on-hand falls short of all claims
   * there (reserved + held - on_hand), e.g. after an explicit override consumed reserved stock.
   * 0 when the claims are fully backed.
   */
  stock_shortfall: number;
}

/** Every staging line of a project, newest last, with display and shortfall data. Read-only. */
export async function listStaging(db: Knex | Knex.Transaction, tenant: string, projectId: string): Promise<StagingLineView[]> {
  const rows = (await db('project_staging_lines as l')
    .leftJoin('service_catalog as sc', function () {
      this.on('sc.service_id', '=', 'l.service_id').andOn('sc.tenant', '=', 'l.tenant');
    })
    .leftJoin('product_inventory_settings as pis', function () {
      this.on('pis.service_id', '=', 'l.service_id').andOn('pis.tenant', '=', 'l.tenant');
    })
    .leftJoin('stock_units as u', function () {
      this.on('u.unit_id', '=', 'l.unit_id').andOn('u.tenant', '=', 'l.tenant');
    })
    .leftJoin('stock_locations as loc', function () {
      this.on('loc.location_id', '=', db.raw('COALESCE(l.reserved_location_id, u.location_id)')).andOn('loc.tenant', '=', 'l.tenant');
    })
    .leftJoin('assets as a', function () {
      this.on('a.asset_id', '=', 'l.asset_id').andOn('a.tenant', '=', 'l.tenant');
    })
    .leftJoin('project_tasks as t', function () {
      this.on('t.task_id', '=', 'l.task_id').andOn('t.tenant', '=', 'l.tenant');
    })
    .leftJoin('stock_levels as lvl', function () {
      this.on('lvl.service_id', '=', 'l.service_id')
        .andOn('lvl.location_id', '=', 'l.reserved_location_id')
        .andOn('lvl.tenant', '=', 'l.tenant');
    })
    .where({ 'l.tenant': tenant, 'l.project_id': projectId })
    .select(
      'l.*',
      'sc.service_name',
      'sc.sku',
      'pis.track_stock',
      'pis.is_serialized',
      'u.serial_number',
      'u.status as unit_status',
      'loc.name as location_name',
      'a.asset_tag',
      'a.name as asset_name',
      'a.serial_number as asset_serial_number',
      't.task_name',
      'lvl.quantity_on_hand as level_on_hand',
      'lvl.reserved_quantity as level_reserved',
      'lvl.held_quantity as level_held',
    )
    .orderBy('l.created_at', 'asc')
    .orderBy('l.staging_line_id', 'asc')) as any[];

  const members = rows.length
    ? ((await db('staging_container_members as m')
        .join('staging_containers as c', function () {
          this.on('c.container_id', '=', 'm.container_id').andOn('c.tenant', '=', 'm.tenant');
        })
        .where({ 'm.tenant': tenant, 'c.project_id': projectId })
        .whereNull('c.deleted_at')
        .select('m.staging_line_id', 'm.container_id', 'm.quantity')) as Array<{ staging_line_id: string; container_id: string; quantity: number }>)
    : [];
  const packed = new Map<string, { q: number; boxes: string[] }>();
  for (const m of members) {
    const cur = packed.get(m.staging_line_id) ?? { q: 0, boxes: [] };
    cur.q += Number(m.quantity);
    cur.boxes.push(m.container_id);
    packed.set(m.staging_line_id, cur);
  }

  return rows.map((r) => {
    const { level_on_hand, level_reserved, level_held, ...line } = r;
    const active = holdsCounter(line);
    const shortfall = active
      ? Math.max(0, Number(level_reserved ?? 0) + Number(level_held ?? 0) - Number(level_on_hand ?? 0))
      : 0;
    return {
      ...line,
      quantity: Number(line.quantity),
      rate: Number(line.rate),
      track_stock: Boolean(line.track_stock),
      is_serialized: Boolean(line.track_stock && line.is_serialized),
      packed_quantity: packed.get(line.staging_line_id)?.q ?? 0,
      container_ids: packed.get(line.staging_line_id)?.boxes ?? [],
      stock_shortfall: shortfall,
    } as StagingLineView;
  });
}
