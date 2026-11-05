/**
 * Prepaid hour-block rollforward — pure computation over block ledger facts.
 *
 * Sources: `hour_blocks` rows (issuance, expiration, void),
 * `hour_block_time_allocations` rows (burn attributed to the time entry's
 * `work_date`, so the nightly reconcile's delete/re-create churn cannot move
 * burn between months), and `hour_block_audit` rows (settled-expiry dates for
 * manual/contract-end expirations, and `adjustment` events).
 *
 * Valuation: a block's liability is the cash it was purchased for
 * (`purchase_amount`), recognised proportionally as minutes burn —
 * per-minute value = purchase_amount ÷ total_minutes. Grants and comped
 * blocks (purchase_amount 0) carry no liability regardless of hourly_rate.
 *
 * Movement model (signed like the bucket/credit columns):
 *  - issued      = purchase amount in the month the block was finalized
 *  - applied     = −burn recognised in M × per-minute value (capped at the
 *                  minutes the block actually holds)
 *  - adjustments = in-month remaining-minute adjustments × per-minute value
 *                  (signed, clamped so liability stays within [0, purchase])
 *  - expired     = −unburned value written off by expiration or void inside M
 *  - opening     = outstanding value at the start of M
 *  - closing     = outstanding value at the end of M (0 once extinguished)
 *  Invariant: opening + issued + applied + adjustments + expired = closing.
 *
 * Burn recorded before a pending block's invoice is finalized carries no
 * earlier liability: its recognition date is clamped up to the issuance date,
 * so pre-finalization draws land in the issuance month's `applied` and the
 * movement identity stays balanced. A block whose expiry was settled by a
 * manual or contract-end expiration (audit-dated, since those paths may not
 * set `expiration_date`) is written off on that settled date when it is
 * earlier than `expiration_date`.
 */

import { monthRange } from './month';
import type { HourBlockDetailRow } from './types';

export interface HourBlockAllocationInput {
  /** ISO timestamp or YYYY-MM-DD prefix; attribution uses the calendar date. */
  date: string;
  minutes: number;
}

export interface HourBlockAdjustmentInput {
  /** ISO timestamp or YYYY-MM-DD prefix; recognition date for the delta. */
  date: string;
  /** Signed minutes added to (+) or removed (−) from the block's remaining. */
  minutes: number;
}

export interface HourBlockInput {
  blockId: string;
  clientId: string;
  serviceName: string;
  /** Owning contract's name for contract-issued blocks; null for ad-hoc. */
  contractName: string | null;
  currencyCode: string;
  /** Cents per hour (display only; liability is valued at purchase_amount). */
  hourlyRate: number;
  totalMinutes: number;
  /** Cash billed for the block, minor units — the valuation basis. */
  purchaseAmount: number;
  status: string;
  purchasedAt: string | null;
  expirationDate: string | null;
  voidedAt: string | null;
  /**
   * Earliest settled-expiry audit date (manual or contract-end expiration)
   * for a block whose status is `expired`; null for other blocks. Writes off
   * at min(expirationDate, expiredAt) so early manual expiry lands in the
   * month the block actually stopped being usable.
   */
  expiredAt: string | null;
  /** Remaining-minute adjustments from `hour_block_audit` (type 'adjustment'). */
  adjustments: HourBlockAdjustmentInput[];
  allocations: HourBlockAllocationInput[];
}

export interface HourBlockMovement {
  opening: number;
  issued: number;
  applied: number;
  adjustments: number;
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

/**
 * Liability per burned minute: the purchase amount spread over the block's
 * full allowance. Comped/granted blocks (no cash) value at zero — an hourly
 * rate on a grant is a discount reference, not deferred revenue.
 */
export function blockValuePerMinute(purchaseAmount: number, totalMinutes: number): number {
  const cash = Math.max(0, numberOrZero(purchaseAmount));
  const minutes = Math.max(0, numberOrZero(totalMinutes));
  if (cash === 0 || minutes === 0) return 0;
  return cash / minutes;
}

/** Sum of allocation minutes whose calendar date is strictly before `day`. */
function burnBefore(allocations: HourBlockAllocationInput[], day: string): number {
  return allocations.reduce((sum, a) => (datePart(a.date) < day ? sum + Math.max(0, numberOrZero(a.minutes)) : sum), 0);
}

/** Burn attribution up to and including `day` (allocations are dated events). */
function burnThrough(allocations: HourBlockAllocationInput[], day: string): number {
  return allocations.reduce((sum, a) => (datePart(a.date) <= day ? sum + Math.max(0, numberOrZero(a.minutes)) : sum), 0);
}

/**
 * The date the block's remaining liability is extinguished (expiration or
 * void), or null when it stays outstanding until burned. Only a settled
 * status counts, so a not-yet-processed expiry keeps the balance outstanding
 * until the nightly job (or the manual/contract-end action) marks the block.
 */
function extinguishDate(input: HourBlockInput): string | null {
  if (input.status === 'voided' && input.voidedAt) {
    return datePart(input.voidedAt);
  }
  if (input.status === 'expired') {
    const dates = [input.expirationDate, input.expiredAt]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .map(datePart);
    if (dates.length === 0) return null;
    return dates.reduce((min, date) => (date < min ? date : min));
  }
  return null;
}

type EventKind = 'burn' | 'adjustment';

interface LedgerEvent {
  kind: EventKind;
  /** Recognition date (burn before issuance clamped up to issuance day). */
  date: string;
  minutes: number;
}

/**
 * Movement of one block in one calendar month, plus its detail row. Pending
 * blocks and never-issued blocks contribute nothing.
 */
export function computeHourBlockMovement(month: string, input: HourBlockInput): HourBlockMovement {
  const { start, endExclusive } = monthRange(month);
  const total = Math.max(0, numberOrZero(input.totalMinutes));
  const purchaseAmount = Math.max(0, numberOrZero(input.purchaseAmount));
  const perMinute = blockValuePerMinute(purchaseAmount, total);
  const extinguish = extinguishDate(input);

  const zeroDetail = (minutesBurned: number): HourBlockDetailRow => ({
    blockId: input.blockId,
    clientId: input.clientId,
    serviceName: input.serviceName,
    contractName: input.contractName,
    currencyCode: input.currencyCode,
    totalMinutes: total,
    minutesBurned,
    remainingMinutes: Math.max(0, total - minutesBurned),
    hourlyRate: Math.max(0, numberOrZero(input.hourlyRate)),
    valueRemaining: Math.max(0, total - minutesBurned) * perMinute,
    status: input.status,
    purchasedAt: input.purchasedAt ? datePart(input.purchasedAt) : null,
    expirationDate: input.expirationDate ? datePart(input.expirationDate) : null,
    purchaseAmount,
    movement: { opening: 0, issued: 0, applied: 0, adjustments: 0, expired: 0, closing: 0 },
  });

  const eligible =
    input.status !== 'pending' &&
    input.purchasedAt !== null &&
    datePart(input.purchasedAt) < endExclusive;

  if (!eligible) {
    return { opening: 0, issued: 0, applied: 0, adjustments: 0, expired: 0, closing: 0, detail: zeroDetail(0) };
  }

  const purchasedDate = datePart(input.purchasedAt as string);

  // A block extinguished before the month began carries no liability into it
  // (its write-off landed in an earlier month). Detail shows burn frozen at
  // extinction: the block could not burn after it.
  if (extinguish !== null && extinguish < start) {
    const frozenBurn = Math.min(total, burnThrough(input.allocations, extinguish));
    return {
      opening: 0,
      issued: 0,
      applied: 0,
      adjustments: 0,
      expired: 0,
      closing: 0,
      detail: zeroDetail(frozenBurn),
    };
  }

  const dayAfterMonthEnd = datePart(endExclusive);

  // Burn recognition date is clamped up to the issuance date: pre-issuance
  // draws (recorded while the block was still pending) are recognised in the
  // issuance month, so they appear in `applied` rather than vanishing.
  const events: LedgerEvent[] = [];
  for (const allocation of input.allocations) {
    const minutes = Math.max(0, numberOrZero(allocation.minutes));
    if (minutes === 0) continue;
    const raw = datePart(allocation.date);
    events.push({ kind: 'burn', date: raw < purchasedDate ? purchasedDate : raw, minutes });
  }
  for (const adjustment of input.adjustments ?? []) {
    const minutes = Number(adjustment.minutes);
    if (!Number.isFinite(minutes) || minutes === 0) continue;
    const raw = datePart(adjustment.date);
    events.push({ kind: 'adjustment', date: raw < purchasedDate ? purchasedDate : raw, minutes });
  }
  events.sort((left, right) =>
    left.date === right.date ? 0 : left.date < right.date ? -1 : 1,
  );

  // Replay the block's whole life in day order. Value (cents) and outstanding
  // minutes move together; the balance identity holds by construction because
  // the write-off zeroes the residual value exactly.
  let opening = 0;
  let issued = 0;
  let applied = 0;
  let adjustments = 0;
  let expired = 0;

  let liveMinutes = 0; // outstanding recognised allowance minutes
  let liveValue = 0; // cents
  let openingCaptured = false;

  const captureOpening = (date: string): void => {
    if (!openingCaptured && date >= start) {
      opening = liveValue;
      openingCaptured = true;
    }
  };

  const applyBurn = (event: LedgerEvent, record: boolean): void => {
    const recognised = Math.min(event.minutes, Math.max(0, liveMinutes));
    if (recognised <= 0) return;
    // Rounding up must never push the balance below zero.
    const cents = Math.min(liveValue, Math.round(recognised * perMinute));
    liveMinutes -= recognised;
    liveValue -= cents;
    if (record) applied -= cents;
  };

  const applyAdjustment = (event: LedgerEvent, record: boolean): void => {
    // Liability stays within [0, purchase]: clamp the outstanding minutes to
    // [0, total] (adjustHourBlockRemaining floors at 0; the ceiling keeps the
    // rollforward consistent with the single issuance amount).
    const target = Math.min(Math.max(0, liveMinutes + event.minutes), total);
    const delta = target - liveMinutes;
    if (delta === 0) return;
    const cents = Math.round(delta * perMinute);
    liveMinutes = target;
    liveValue += cents;
    if (record) adjustments += cents;
  };

  // 1. Issuance. The balance always carries the purchase through the replay
  // (the block existed before M when purchased before M); only the `issued`
  // column is month-scoped.
  captureOpening(purchasedDate);
  if (purchasedDate >= start) issued = purchaseAmount;
  liveMinutes = total;
  liveValue = purchaseAmount;

  // 2. Burn/adjustment events, day-ordered; same-day events land after
  // issuance and before a same-day write-off. Events at/after the next month
  // start neither move the balance nor land in the month's columns — the
  // closing is the balance at month end.
  for (const event of events) {
    if (event.date >= endExclusive) break;
    if (extinguish !== null && event.date > extinguish) break; // no activity after write-off
    const inMonth = event.date >= start;
    captureOpening(event.date);
    if (event.kind === 'burn') {
      applyBurn(event, inMonth);
    } else {
      applyAdjustment(event, inMonth);
    }
  }

  // 3. Write-off. Capture the pre-write-off balance as the month's opening
  // when no in-month event did (expired block with no activity in M).
  if (extinguish !== null && extinguish >= start && extinguish < endExclusive) {
    captureOpening(extinguish);
    expired = -Math.max(0, liveValue);
    liveMinutes = 0;
    liveValue = 0;
  }

  const closing = extinguish === null || extinguish >= dayAfterMonthEnd ? liveValue : 0;
  if (!openingCaptured) {
    // No event at/after the month start and no in-month write-off (a block
    // whose activity all predates M and stays outstanding): the replay's
    // residual is both the carried-in opening and the closing.
    opening = liveValue;
  }

  // Detail burn: recognised burn through month end, frozen at extinction and
  // capped at the allowance.
  const rawBurn = extinguish !== null && extinguish < dayAfterMonthEnd
    ? burnThrough(input.allocations, extinguish)
    : burnBefore(input.allocations, dayAfterMonthEnd);
  const burnedThroughMonthEnd = Math.min(total, rawBurn);
  const remaining = Math.max(0, total - burnedThroughMonthEnd);

  const signed = {
    opening: signedZero(opening),
    issued: signedZero(issued),
    applied: signedZero(applied),
    adjustments: signedZero(adjustments),
    expired: signedZero(expired),
    closing: signedZero(closing),
  };

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
      hourlyRate: Math.max(0, numberOrZero(input.hourlyRate)),
      valueRemaining: remaining * perMinute,
      status: input.status,
      purchasedAt: purchasedDate,
      expirationDate: input.expirationDate ? datePart(input.expirationDate) : null,
      purchaseAmount,
      movement: { ...signed },
    },
  };
}

/** Whether a block contributes any nonzero figure to the selected month. */
export function blockContributesToMonth(movement: HourBlockMovement): boolean {
  return (
    movement.opening !== 0 ||
    movement.issued !== 0 ||
    movement.applied !== 0 ||
    movement.adjustments !== 0 ||
    movement.expired !== 0 ||
    movement.closing !== 0
  );
}

export interface HourBlocksRollforward {
  opening: number;
  issued: number;
  applied: number;
  adjustments: number;
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
      adjustments: 0,
      expired: 0,
      closing: 0,
      details: [],
    };
    aggregate.opening += movement.opening;
    aggregate.issued += movement.issued;
    aggregate.applied += movement.applied;
    aggregate.adjustments += movement.adjustments;
    aggregate.expired += movement.expired;
    aggregate.closing += movement.closing;
    aggregate.details.push(movement.detail);
    byClientCurrency.set(key, aggregate);
  }
  return byClientCurrency;
}
