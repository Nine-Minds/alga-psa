/**
 * Prepaid hour-block rollforward — pure computation over block ledger facts.
 *
 * Sources: `hour_blocks` rows (issuance, expiration, void, hourly rate) and
 * `hour_block_time_allocations` rows (immutable burn events). Unlike bucket
 * periods, a block's liability is denominated directly in minutes at the
 * block's `hourly_rate`, so opening/closing balances are exact and burn is
 * attributed to the allocation's own date — no spanning-period fallback.
 *
 * Movement model (signed like the bucket/credit columns):
 *  - issued   = allowance value (total minutes × rate) in the month purchased
 *  - applied  = −burned minutes in M × rate (capped at the value still
 *               available at that point, so recognition never exceeds issuance)
 *  - expired  = −unburned value extinguished by expiration or void inside M
 *  - opening  = outstanding value at the start of M
 *  - closing  = outstanding value at the end of M (0 once extinguished)
 *
 * A `pending` block (issuance invoice not finalized) carries no liability and
 * is excluded entirely; the same block appearing after finalization has a
 * purchased_at date and rolls normally. Expiration is recognized when the
 * block is marked `expired` (the nightly job settles status within a day);
 * until then the balance is outstanding.
 */

import { monthRange } from './month';
import type { HourBlockDetailRow } from './types';

export interface HourBlockAllocationInput {
  /** ISO timestamp or YYYY-MM-DD prefix; attribution uses the calendar date. */
  createdAt: string;
  minutes: number;
}

export interface HourBlockInput {
  blockId: string;
  clientId: string;
  serviceName: string;
  /** Owning contract's name for contract-issued blocks; null for ad-hoc. */
  contractName: string | null;
  currencyCode: string;
  /** Cents per hour. */
  hourlyRate: number;
  totalMinutes: number;
  /** Cash billed for the block (detail only; valuation uses hourlyRate). */
  purchaseAmount: number;
  status: string;
  purchasedAt: string | null;
  expirationDate: string | null;
  voidedAt: string | null;
  allocations: HourBlockAllocationInput[];
}

export interface HourBlockMovement {
  opening: number;
  issued: number;
  applied: number;
  expired: number;
  closing: number;
  detail: HourBlockDetailRow;
}

function numberOrZero(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function signedZero(value: number): number {
  return value === 0 ? 0 : value;
}

/** Calendar date ('YYYY-MM-DD') of an ISO timestamp or date value. */
function datePart(value: string): string {
  return value.slice(0, 10);
}

export function perHourRate(hourlyRate: number): number {
  const rate = Math.max(0, numberOrZero(hourlyRate));
  return rate / 60;
}

/** Sum of allocation minutes whose calendar date is strictly before `day`. */
function burnBefore(allocations: HourBlockAllocationInput[], day: string): number {
  return allocations.reduce((sum, a) => (datePart(a.createdAt) < day ? sum + Math.max(0, numberOrZero(a.minutes)) : sum), 0);
}

/** Burn attribution up to and including `day` (allocations are dated events). */
function burnThrough(allocations: HourBlockAllocationInput[], day: string): number {
  return allocations.reduce((sum, a) => (datePart(a.createdAt) <= day ? sum + Math.max(0, numberOrZero(a.minutes)) : sum), 0);
}

/**
 * The date the block's remaining liability is extinguished (expiration or
 * void), or null when it stays outstanding until burned. Only a settled
 * `expired` status counts for expiration, so a not-yet-processed expiry keeps
 * the balance outstanding until the job marks it.
 */
function extinguishDate(input: HourBlockInput): string | null {
  if (input.status === 'voided' && input.voidedAt) {
    return datePart(input.voidedAt);
  }
  if (input.status === 'expired' && input.expirationDate) {
    return datePart(input.expirationDate);
  }
  return null;
}

/**
 * Movement of one block in one calendar month, plus its detail row. Pending
 * blocks and never-issued blocks contribute nothing.
 */
export function computeHourBlockMovement(month: string, input: HourBlockInput): HourBlockMovement {
  const { start, endExclusive } = monthRange(month);
  const rate = perHourRate(input.hourlyRate);
  const total = Math.max(0, numberOrZero(input.totalMinutes));

  const zeroDetail = (burnedThroughMonthEnd: number): HourBlockDetailRow => ({
    blockId: input.blockId,
    clientId: input.clientId,
    serviceName: input.serviceName,
    contractName: input.contractName,
    currencyCode: input.currencyCode,
    totalMinutes: total,
    minutesBurned: burnedThroughMonthEnd,
    remainingMinutes: Math.max(0, total - burnedThroughMonthEnd),
    hourlyRate: rate * 60,
    valueRemaining: Math.max(0, total - burnedThroughMonthEnd) * rate,
    status: input.status,
    purchasedAt: input.purchasedAt ? datePart(input.purchasedAt) : null,
    expirationDate: input.expirationDate ? datePart(input.expirationDate) : null,
    purchaseAmount: numberOrZero(input.purchaseAmount),
    movement: { opening: 0, issued: 0, applied: 0, expired: 0, adjustments: 0, closing: 0 },
  });

  const eligible =
    input.status !== 'pending' &&
    input.purchasedAt !== null &&
    datePart(input.purchasedAt) < endExclusive;

  if (!eligible) {
    return { opening: 0, issued: 0, applied: 0, expired: 0, closing: 0, detail: zeroDetail(0) };
  }

  const purchasedDate = datePart(input.purchasedAt as string);
  const extinguish = extinguishDate(input);
  // A block extinguished before the month began carries no liability into it
  // (its expiration/void movement landed in an earlier month).
  if (extinguish !== null && extinguish < start) {
    // Detail shows the burn frozen at extinction: the block could not burn after it.
    return { opening: 0, issued: 0, applied: 0, expired: 0, closing: 0, detail: zeroDetail(burnThrough(input.allocations, extinguish)) };
  }

  const dayAfterMonthEnd = datePart(endExclusive);
  const inMonthBurn = input.allocations.reduce(
    (sum, a) => {
      const d = datePart(a.createdAt);
      return d >= start && d < endExclusive ? sum + Math.max(0, numberOrZero(a.minutes)) : sum;
    },
    0,
  );
  // Burn outside the month but inside the block's life (before start after
  // purchase, or at/after month end) — needed to reconstruct boundaries.
  const burnBeforeStart = burnBefore(input.allocations, start);
  const burnBeforeEnd = burnBefore(input.allocations, dayAfterMonthEnd);

  // Opening: outstanding balance at the first instant of M. A block purchased
  // on day 1 of M opens empty (its issuance lands in `issued` that same day).
  let opening = 0;
  if (purchasedDate < start) {
    opening = (total - burnBeforeStart) * rate;
  }

  // Issued: the allowance's value in the purchase month.
  const issued = purchasedDate >= start && purchasedDate < endExclusive ? total * rate : 0;

  // Applied: in-month burn, capped so cumulative recognition never exceeds the
  // value the block actually holds (opening + issued).
  const available = Math.max(0, opening + issued);
  const rawApplied = inMonthBurn * rate;
  const applied = -Math.min(rawApplied, available);

  // Expired: unburned value extinguished inside M by expiration or void.
  let expired = 0;
  if (extinguish !== null && extinguish >= start && extinguish < endExclusive) {
    const remainingAtExtinction = Math.max(0, total - burnThrough(input.allocations, extinguish));
    expired = -remainingAtExtinction * rate;
  }

  // Closing: outstanding at the end of M. Zero once extinguished; otherwise
  // the full remaining balance (a future expiry month still holds it).
  let closing = 0;
  if (extinguish === null || extinguish >= dayAfterMonthEnd) {
    closing = Math.max(0, total - burnBeforeEnd) * rate;
  }

  const signed = {
    opening: signedZero(opening),
    issued: signedZero(issued),
    applied: signedZero(applied),
    expired: signedZero(expired),
    closing: signedZero(closing),
  };
  const burnedThroughMonthEnd = burnBeforeEnd;
  const remaining = Math.max(0, total - burnedThroughMonthEnd);

  return {
    ...signed,
    detail: {
      blockId: input.blockId,
      clientId: input.clientId,
      serviceName: input.serviceName,
      contractName: input.contractName,
      currencyCode: input.currencyCode,
      totalMinutes: total,
      minutesBurned: burnedThroughMonthEnd,
      remainingMinutes: remaining,
      hourlyRate: rate * 60,
      valueRemaining: remaining * rate,
      status: input.status,
      purchasedAt: purchasedDate,
      expirationDate: input.expirationDate ? datePart(input.expirationDate) : null,
      purchaseAmount: numberOrZero(input.purchaseAmount),
      movement: { ...signed, adjustments: 0 },
    },
  };
}

/** Whether a block contributes any nonzero figure to the selected month. */
export function blockContributesToMonth(movement: HourBlockMovement): boolean {
  return (
    movement.opening !== 0 ||
    movement.issued !== 0 ||
    movement.applied !== 0 ||
    movement.expired !== 0 ||
    movement.closing !== 0
  );
}

export interface HourBlocksRollforward {
  opening: number;
  issued: number;
  applied: number;
  expired: number;
  closing: number;
  details: HourBlockDetailRow[];
}

/** Aggregate per client×currency rollforward across every block. */
export function computeHourBlocksRollforward(
  month: string,
  blocks: HourBlockInput[],
): Map<string, HourBlocksRollforward> {
  const byClientCurrency = new Map<string, HourBlocksRollforward>();
  for (const block of blocks) {
    const movement = computeHourBlockMovement(month, block);
    if (!blockContributesToMonth(movement)) continue;
    const key = `${block.clientId}\u0000${block.currencyCode || 'USD'}`;
    const aggregate = byClientCurrency.get(key) ?? {
      opening: 0,
      issued: 0,
      applied: 0,
      expired: 0,
      closing: 0,
      details: [],
    };
    aggregate.opening += movement.opening;
    aggregate.issued += movement.issued;
    aggregate.applied += movement.applied;
    aggregate.expired += movement.expired;
    aggregate.closing += movement.closing;
    aggregate.details.push(movement.detail);
    byClientCurrency.set(key, aggregate);
  }
  return byClientCurrency;
}
