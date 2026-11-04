import { Knex } from 'knex';
import { applyAllocationDelta, availableQuantity, ensureStockLevel, recomputeSerializedOnHand } from './levels';

/**
 * The stock-claim engine shared by every document that reserves stock without consuming it:
 * sales-order lines and project staging lines (C6). A claim is NOT a stock movement.
 *
 * - Non-serialized: a per-location counter on `stock_levels` — `reserved_quantity` (soft) or
 *   `held_quantity` (hard). `available = on_hand - reserved - held` drops; on-hand is untouched.
 *   Attribution (how much, where) lives on the claiming row, never here.
 * - Serialized: the unit moves `in_stock -> allocated` and carries its claimant's id
 *   (`allocated_so_line_id` or `allocated_staging_line_id`). On-hand is recomputed from in_stock
 *   counts, so it drops too.
 *
 * Both counters are shared by sales orders and projects (C6 decision D1): every availability
 * reader already respects them, and `computeAllocationsFromTruth` rebuilds them from both claim
 * sources.
 */

export type AllocationClaimantKind = 'so_line' | 'staging_line';

export interface AllocationClaimant {
  kind: AllocationClaimantKind;
  id: string;
}

export type AllocationCounter = 'reserved_quantity' | 'held_quantity';

/** The `stock_units` column that names a serialized unit's claimant. */
export const UNIT_CLAIM_COLUMN: Record<AllocationClaimantKind, 'allocated_so_line_id' | 'allocated_staging_line_id'> = {
  so_line: 'allocated_so_line_id',
  staging_line: 'allocated_staging_line_id',
};

export interface ClaimLevelRow {
  quantity_on_hand: number | string | null;
  reserved_quantity: number | string | null;
  held_quantity: number | string | null;
}

/** Free stock on a level row: on_hand - reserved - held (0 for a missing row). */
export function freeQuantity(level: ClaimLevelRow | null | undefined): number {
  if (!level) return 0;
  return availableQuantity({
    quantity_on_hand: Number(level.quantity_on_hand ?? 0),
    reserved_quantity: Number(level.reserved_quantity ?? 0),
    held_quantity: Number(level.held_quantity ?? 0),
  });
}

/**
 * The single location a claim draws from: the product's default location, else the location with
 * the most available stock, else null (nothing available anywhere).
 */
export async function resolveAllocationLocation(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  defaultLocationId: string | null | undefined,
): Promise<string | null> {
  if (defaultLocationId) return defaultLocationId;
  const rows = await trx('stock_levels').where({ tenant, service_id: serviceId });
  let best: { location_id: string; available: number } | null = null;
  for (const r of rows as any[]) {
    const avail = availableQuantity(r);
    if (avail > 0 && (!best || avail > best.available)) best = { location_id: r.location_id, available: avail };
  }
  return best?.location_id ?? null;
}

/**
 * Lock a (service, location) level row FOR UPDATE so concurrent claims and consumes serialize on
 * the availability read. With `ensure`, a missing row is created first (so the lock always holds);
 * without it a missing row reads as undefined (nothing on hand).
 */
export async function lockStockLevel(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  locationId: string,
  opts: { ensure?: boolean } = {},
): Promise<ClaimLevelRow | undefined> {
  if (opts.ensure) await ensureStockLevel(trx, tenant, serviceId, locationId);
  return trx('stock_levels')
    .where({ tenant, service_id: serviceId, location_id: locationId })
    .forUpdate()
    .first();
}

export interface CounterClaimInput {
  serviceId: string;
  locationId: string;
  column: AllocationCounter;
  requested: number;
  /**
   * `up_to_available`: claim min(requested, free) and let the caller backorder the rest (sales
   * orders). `all_or_nothing`: claim everything or nothing (project staging, D4).
   */
  mode: 'up_to_available' | 'all_or_nothing';
}

export interface CounterClaimResult {
  claimed: number;
  /** Free stock at the location before this claim (under the lock). */
  free: number;
  level: ClaimLevelRow | undefined;
}

/** Claim a non-serialized quantity on one location's counter, capped at availability under a row lock. */
export async function claimCounter(
  trx: Knex.Transaction,
  tenant: string,
  input: CounterClaimInput,
): Promise<CounterClaimResult> {
  const level = await lockStockLevel(trx, tenant, input.serviceId, input.locationId, {
    ensure: input.mode === 'all_or_nothing',
  });
  const free = freeQuantity(level);
  const claim = input.mode === 'all_or_nothing'
    ? (input.requested <= free ? input.requested : 0)
    : Math.max(0, Math.min(free, input.requested));
  if (claim > 0) {
    await applyAllocationDelta(trx, tenant, input.serviceId, input.locationId, input.column, claim);
  }
  return { claimed: claim, free, level };
}

/** Decrement a per-location allocation counter for a service by `amount`, draining from the rows that hold it. */
export async function reverseAllocationCounter(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  column: AllocationCounter,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  let remaining = amount;
  const rows = (await trx('stock_levels')
    .where({ tenant, service_id: serviceId })
    .andWhere(column, '>', 0)
    .orderBy(column, 'desc')) as any[];
  for (const r of rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(r[column]));
    await applyAllocationDelta(trx, tenant, serviceId, r.location_id, column, -take);
    remaining -= take;
  }
}

/**
 * Release a claimed quantity: exactly at the attributed location when known, else drained from
 * whichever rows hold the counter (legacy claims without attribution).
 */
export async function releaseCounter(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  locationId: string | null | undefined,
  column: AllocationCounter,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  if (locationId) {
    await applyAllocationDelta(trx, tenant, serviceId, locationId, column, -amount);
  } else {
    await reverseAllocationCounter(trx, tenant, serviceId, column, amount);
  }
}

/** Move an attributed claim between the soft and hard counters at one location (staging a reservation). */
export async function moveCounterClaim(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  locationId: string,
  from: AllocationCounter,
  to: AllocationCounter,
  amount: number,
): Promise<void> {
  if (amount <= 0 || from === to) return;
  await lockStockLevel(trx, tenant, serviceId, locationId, { ensure: true });
  await applyAllocationDelta(trx, tenant, serviceId, locationId, from, -amount);
  await applyAllocationDelta(trx, tenant, serviceId, locationId, to, amount);
}

export interface ClaimedUnit {
  unit_id: string;
  service_id: string;
  location_id: string | null;
}

async function markUnitsClaimed(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  units: Array<{ unit_id: string; location_id?: string | null }>,
  claimant: AllocationClaimant,
): Promise<ClaimedUnit[]> {
  const column = UNIT_CLAIM_COLUMN[claimant.kind];
  const touched = new Set<string>();
  const claimed: ClaimedUnit[] = [];
  for (const u of units) {
    await trx('stock_units')
      .where({ tenant, unit_id: u.unit_id })
      .update({ status: 'allocated', [column]: claimant.id, updated_at: trx.fn.now() });
    if (u.location_id) touched.add(u.location_id);
    claimed.push({ unit_id: u.unit_id, service_id: serviceId, location_id: u.location_id ?? null });
  }
  for (const loc of touched) await recomputeSerializedOnHand(trx, tenant, serviceId, loc);
  return claimed;
}

/**
 * Claim up to `quantity` in_stock units FIFO (preferring `preferredLocationId`, then received_at).
 * FOR UPDATE SKIP LOCKED: a unit mid-claim by a concurrent transaction is invisible here, so two
 * claimants can never take the same unit. Returns what was claimed (possibly fewer than asked).
 */
export async function claimFifoUnits(
  trx: Knex.Transaction,
  tenant: string,
  input: { serviceId: string; quantity: number; preferredLocationId: string | null; claimant: AllocationClaimant; locationId?: string | null },
): Promise<ClaimedUnit[]> {
  if (input.quantity <= 0) return [];
  const q = trx('stock_units')
    .where({ tenant, service_id: input.serviceId, status: 'in_stock' })
    .forUpdate()
    .skipLocked()
    .limit(input.quantity);
  if (input.locationId) q.where('location_id', input.locationId);
  // LEVERAGE: pattern fifo-unit-order — allocation, fulfillment candidates, and this pick list share FIFO ordering.
  const units = input.preferredLocationId
    ? ((await q.orderByRaw('CASE WHEN location_id = ? THEN 0 ELSE 1 END ASC, received_at ASC NULLS LAST, unit_id ASC', [input.preferredLocationId])) as any[])
    : ((await q.orderByRaw('received_at ASC NULLS LAST, unit_id ASC')) as any[]);
  return markUnitsClaimed(trx, tenant, input.serviceId, units, input.claimant);
}

export type UnitClaimRefusal = 'not_found' | 'wrong_product' | 'not_in_stock';

export type UnitClaimResult = { ok: true; unit: ClaimedUnit } | { ok: false; reason: UnitClaimRefusal };

/**
 * Type guard for a refused claim. Use this instead of `!r.ok`: consumers compiled with
 * strictNullChecks off (ee/server, strict: false) do not narrow boolean-literal discriminants.
 */
export function isUnitClaimRefused(r: UnitClaimResult): r is { ok: false; reason: UnitClaimRefusal } {
  return !r.ok;
}

/**
 * Claim one specific unit the user picked. It is locked FOR UPDATE (waiting for a concurrent claim
 * to finish) and must then be an unclaimed in_stock unit of the product. Returns the refusal
 * reason instead of claiming when it is not.
 */
export async function claimSpecificUnit(
  trx: Knex.Transaction,
  tenant: string,
  input: { unitId: string; serviceId: string; claimant: AllocationClaimant },
): Promise<UnitClaimResult> {
  const unit = await trx('stock_units').where({ tenant, unit_id: input.unitId }).forUpdate().first();
  if (!unit) return { ok: false, reason: 'not_found' };
  if (unit.service_id !== input.serviceId) return { ok: false, reason: 'wrong_product' };
  if (unit.status !== 'in_stock' || unit.allocated_so_line_id || unit.allocated_staging_line_id) {
    return { ok: false, reason: 'not_in_stock' };
  }
  const [claimed] = await markUnitsClaimed(trx, tenant, input.serviceId, [unit], input.claimant);
  return { ok: true, unit: claimed };
}

/**
 * Return every unit still `allocated` to these claimants (not yet delivered) to in_stock and clear
 * the claim. Returns the released units.
 */
export async function releaseClaimedUnits(
  trx: Knex.Transaction,
  tenant: string,
  kind: AllocationClaimantKind,
  claimantIds: readonly string[],
): Promise<ClaimedUnit[]> {
  if (claimantIds.length === 0) return [];
  const column = UNIT_CLAIM_COLUMN[kind];
  const units = (await trx('stock_units')
    .where({ tenant, status: 'allocated' })
    .whereIn(column, claimantIds as string[])
    .forUpdate()) as any[];
  for (const u of units) {
    await trx('stock_units')
      .where({ tenant, unit_id: u.unit_id })
      .update({ status: 'in_stock', [column]: null, updated_at: trx.fn.now() });
  }
  const touched = new Map<string, Set<string>>();
  for (const u of units) {
    if (!u.location_id) continue;
    const set = touched.get(u.service_id) ?? new Set<string>();
    set.add(u.location_id);
    touched.set(u.service_id, set);
  }
  for (const [serviceId, locations] of touched) {
    for (const loc of locations) await recomputeSerializedOnHand(trx, tenant, serviceId, loc);
  }
  return units.map((u) => ({ unit_id: u.unit_id, service_id: u.service_id, location_id: u.location_id ?? null }));
}
