/**
 * Discount allocation before tax.
 *
 * A seller-funded discount lowers the taxable base of the lines it applies to.
 * This module is the ONLY place that arithmetic exists: invoice generation,
 * billing preview and quotes (and therefore the invoice converted from a quote)
 * all call `allocateDiscountsBeforeTax` so they cannot drift.
 *
 * Pure: no DB access, integer minor units only.
 *
 * Model
 * - An *entity* is a positive, non-discount amount a discount can land on:
 *   an invoice/quote line, or an `invoice_charge_fixed_details` allocation.
 *   Entities that are tax exempt are still part of the allocation population:
 *   they absorb their share of an untargeted discount, so a discount on exempt
 *   labor never lowers tax on taxable hardware.
 * - A *pool* is one discount (a discount line, or a manual negative line).
 *   Its population is chosen by its scope:
 *     - `allocations`  exact per-line amounts resolved by the contract
 *                      discount evaluator (automatic discounts),
 *     - `target`       entities matching an item / service / client contract,
 *     - none           every entity (optionally restricted to one `region`).
 * - Each pool is spread over its population in proportion to entity amount
 *   using largest-remainder in integer minor units, so the shares sum exactly
 *   to the discount. Each entity is capped at what it has left (stacked pools
 *   never push it below 0), the capped excess is redistributed among entities
 *   that still have capacity, and a discount larger than the population simply
 *   floors every base at 0.
 * - Only the reduction that lands on taxable entities changes the taxable base.
 */

export interface DiscountTaxEntity {
  /** Unique id (item_id, item_detail_id, quote item id). */
  id: string;
  /** Line this entity belongs to (the parent item for fixed-detail entities). */
  itemId: string;
  /** Positive amount in minor units. */
  amount: number;
  /** Tax region (scoping only for pools that carry a region). */
  region: string;
  /** False for tax-exempt lines: they absorb discount share but are not taxed. */
  taxable: boolean;
  serviceId?: string | null;
  clientContractId?: string | null;
}

export interface DiscountPoolTarget {
  itemId?: string | null;
  serviceId?: string | null;
  clientContractId?: string | null;
}

export interface DiscountPool {
  /** Stable id used for deterministic ordering. */
  id: string;
  /** Positive discount magnitude in minor units. */
  amount: number;
  /** When set, the population is restricted to entities in this region. */
  region?: string | null;
  /** Narrow the population; absent means every entity. */
  target?: DiscountPoolTarget | null;
  /**
   * Exact per-line amounts (automatic discounts). Takes precedence over
   * `target`; each entry only reduces that line's entities.
   */
  allocations?: Array<{ itemId: string; amount: number }> | null;
}

export interface DiscountAllocationResult {
  /** Amount each entity is taxed on after discounts (>= 0). */
  taxableAmountById: Map<string, number>;
  /** Total reduction applied to each entity. */
  reductionById: Map<string, number>;
  /** Portion of each pool that found no capacity (target missing / over-discount). */
  unappliedByPool: Map<string, number>;
}

export interface WeightedSlot {
  key: string;
  weight: number;
  cap: number;
  /** Optional caller order (e.g. display order); breaks remainder ties first. */
  rank?: number;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Splits `total` over `slots` in proportion to `weight`, in integer minor
 * units, never exceeding any slot's `cap`. Sums exactly to
 * `min(total, sum(cap))`.
 *
 * Largest remainder; ties break by caller `rank`, then larger weight, then by
 * key, so the result depends only on the inputs and never on iteration order.
 */
export function allocateCappedLargestRemainder(
  total: number,
  slots: WeightedSlot[],
): Map<string, number> {
  const result = new Map<string, number>();
  for (const slot of slots) result.set(slot.key, 0);

  let remaining = Math.min(
    Math.max(0, Math.trunc(total)),
    slots.reduce((sum, slot) => sum + Math.max(0, slot.cap), 0),
  );
  let active = slots.filter((slot) => slot.cap > 0 && slot.weight > 0);

  // Each round either clips at least one slot (active shrinks) or allocates
  // everything that is left, so this terminates.
  while (remaining > 0 && active.length > 0) {
    const weightSum = active.reduce((sum, slot) => BigInt(slot.weight) + sum, 0n);
    const remainingBig = BigInt(remaining);

    const ideal = active.map((slot) => {
      const product = remainingBig * BigInt(slot.weight);
      return { slot, floor: Number(product / weightSum), fraction: product % weightSum };
    });
    let assigned = ideal.reduce((sum, entry) => sum + entry.floor, 0);
    const byRemainder = [...ideal].sort((a, b) => {
      if (a.fraction !== b.fraction) return a.fraction > b.fraction ? -1 : 1;
      const rankDiff = (a.slot.rank ?? 0) - (b.slot.rank ?? 0);
      if (rankDiff !== 0) return rankDiff;
      if (a.slot.weight !== b.slot.weight) return b.slot.weight - a.slot.weight;
      return compareStrings(a.slot.key, b.slot.key);
    });
    const shares = new Map<string, number>(ideal.map((entry) => [entry.slot.key, entry.floor]));
    for (let i = 0; assigned < remaining; i = (i + 1) % byRemainder.length) {
      const key = byRemainder[i].slot.key;
      shares.set(key, (shares.get(key) ?? 0) + 1);
      assigned += 1;
    }

    let clipped = false;
    let applied = 0;
    const stillActive: WeightedSlot[] = [];
    for (const slot of active) {
      const room = slot.cap - (result.get(slot.key) ?? 0);
      const share = shares.get(slot.key) ?? 0;
      if (share >= room) {
        if (share > room) clipped = true;
        result.set(slot.key, (result.get(slot.key) ?? 0) + room);
        applied += room;
        // Filled to the cap; nothing more can land here.
      } else {
        result.set(slot.key, (result.get(slot.key) ?? 0) + share);
        applied += share;
        stillActive.push(slot);
      }
    }
    remaining -= applied;
    if (!clipped) break;
    active = stillActive;
  }

  return result;
}

function matchesTarget(entity: DiscountTaxEntity, target: DiscountPoolTarget): boolean {
  if (target.itemId && entity.itemId !== target.itemId) return false;
  if (target.serviceId && entity.serviceId !== target.serviceId) return false;
  if (target.clientContractId && entity.clientContractId !== target.clientContractId) return false;
  return true;
}

function hasTarget(target: DiscountPoolTarget | null | undefined): target is DiscountPoolTarget {
  return Boolean(target && (target.itemId || target.serviceId || target.clientContractId));
}

/**
 * Reduces entity amounts by the discount pools and returns the amounts tax is
 * computed on. Pools are applied in stable id order so stacking is repeatable.
 */
export function allocateDiscountsBeforeTax(input: {
  entities: DiscountTaxEntity[];
  pools: DiscountPool[];
}): DiscountAllocationResult {
  const remainingById = new Map<string, number>();
  const reductionById = new Map<string, number>();
  for (const entity of input.entities) {
    const amount = Math.max(0, Math.trunc(Number(entity.amount) || 0));
    remainingById.set(entity.id, amount);
    reductionById.set(entity.id, 0);
  }
  const originalById = new Map(input.entities.map((entity) => [entity.id, Math.max(0, Math.trunc(Number(entity.amount) || 0))]));
  const unappliedByPool = new Map<string, number>();

  const spread = (poolId: string, amount: number, population: DiscountTaxEntity[]): number => {
    const slots: WeightedSlot[] = population
      .map((entity) => ({
        key: entity.id,
        weight: originalById.get(entity.id) ?? 0,
        cap: remainingById.get(entity.id) ?? 0,
      }))
      .filter((slot) => slot.weight > 0);
    const shares = allocateCappedLargestRemainder(amount, slots);
    let applied = 0;
    for (const [id, share] of shares) {
      if (share <= 0) continue;
      remainingById.set(id, (remainingById.get(id) ?? 0) - share);
      reductionById.set(id, (reductionById.get(id) ?? 0) + share);
      applied += share;
    }
    return applied;
  };

  const pools = [...input.pools]
    .filter((pool) => Number(pool.amount) > 0)
    .sort((a, b) => compareStrings(a.id, b.id));

  for (const pool of pools) {
    const amount = Math.trunc(Number(pool.amount));
    const regionScoped = pool.region
      ? input.entities.filter((entity) => entity.region === pool.region)
      : input.entities;
    let applied = 0;

    if (pool.allocations && pool.allocations.length > 0) {
      const lines = [...pool.allocations].sort((a, b) => compareStrings(a.itemId, b.itemId));
      for (const line of lines) {
        if (!(line.amount > 0)) continue;
        applied += spread(pool.id, Math.trunc(line.amount), regionScoped.filter((entity) => entity.itemId === line.itemId));
      }
    } else if (hasTarget(pool.target)) {
      const target = pool.target;
      applied = spread(pool.id, amount, regionScoped.filter((entity) => matchesTarget(entity, target)));
    } else {
      applied = spread(pool.id, amount, regionScoped);
    }

    unappliedByPool.set(pool.id, Math.max(0, amount - applied));
  }

  const taxableAmountById = new Map<string, number>();
  for (const entity of input.entities) {
    taxableAmountById.set(entity.id, remainingById.get(entity.id) ?? 0);
  }
  return { taxableAmountById, reductionById, unappliedByPool };
}

/**
 * One line (or one component of a consolidated fixed bundle) as the callers
 * know it, before it becomes an allocation entity.
 */
export interface DiscountTaxLineInput {
  id: string;
  /** Line discounts attach to: the parent item for fixed-bundle components. */
  itemId: string;
  /** Minor units; non-positive amounts are not entities. */
  amount: number;
  /** The component's OWN region; empty falls back to `defaultRegion`. */
  region?: string | null;
  /** The component's OWN taxability (never the bundle parent's). */
  taxable: boolean;
  serviceId?: string | null;
  clientContractId?: string | null;
}

/**
 * Turns lines into allocation entities. Billing preview (one line per fixed
 * component charge) and invoice generation (one line per
 * `invoice_charge_fixed_details` row) both build their entities here, so a
 * mixed taxable/exempt fixed bundle is broken up identically: every positive
 * component is an entity, exempt ones included, each with its own taxability
 * and region.
 */
export function buildDiscountTaxEntities(
  lines: DiscountTaxLineInput[],
  defaultRegion: string,
): DiscountTaxEntity[] {
  const entities: DiscountTaxEntity[] = [];
  for (const line of lines) {
    const amount = Number(line.amount);
    if (!(amount > 0)) continue;
    entities.push({
      id: line.id,
      itemId: line.itemId,
      amount,
      region: line.region || defaultRegion,
      taxable: Boolean(line.taxable),
      serviceId: line.serviceId ?? null,
      clientContractId: line.clientContractId ?? null,
    });
  }
  return entities;
}
