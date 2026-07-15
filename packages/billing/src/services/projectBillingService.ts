import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  IProjectBillingConfig,
  IProjectBillingScheduleEntry,
  ProjectBillingDepositTreatment,
  ProjectBillingScheduleEntryType,
  ProjectBillingScheduleStatus
} from '@alga-psa/types';
import {
  normalizeProjectBillingScheduleEntry,
  resolveProjectBillingDb
} from '../models/projectBillingModelUtils';

const PERCENTAGE_SCALE = 10_000;
const FULL_PERCENTAGE_SCALED = 100 * PERCENTAGE_SCALE;

type AllocationConfig = Pick<IProjectBillingConfig, 'total_price'>;
type AllocationEntry = Pick<
  IProjectBillingScheduleEntry,
  'amount' | 'percentage' | 'status'
>;

export interface AllocationValidationResult {
  ok: boolean;
  delta: number;
  isFinalEntryBlocked: boolean;
}

export interface CapWriteDownResult {
  billable: number;
  writtenDown: number;
}

export interface DepositReconciliationEntry {
  entry_type: ProjectBillingScheduleEntryType;
  status: ProjectBillingScheduleStatus;
  computed_amount: number;
}

function assertNonNegativeCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer number of cents`);
  }
}

function percentageAsScaledInteger(percentage: number): number {
  if (!Number.isFinite(percentage) || percentage < 0) {
    throw new RangeError('percentage must be a non-negative finite number');
  }

  return Math.round(percentage * PERCENTAGE_SCALE);
}

function roundPositiveFraction(numerator: bigint, denominator: bigint): bigint {
  return (numerator + (denominator / 2n)) / denominator;
}

function calculateBaseAmounts(
  totalPrice: number,
  entries: readonly AllocationEntry[]
): { amounts: number[]; exactAllocationNumerator: bigint } {
  assertNonNegativeCents(totalPrice, 'total_price');

  const totalPriceBigInt = BigInt(totalPrice);
  const denominator = BigInt(FULL_PERCENTAGE_SCALED);
  let exactAllocationNumerator = 0n;

  const amounts = entries.map((entry): number => {
    if (entry.amount !== null) {
      assertNonNegativeCents(entry.amount, 'entry amount');
      exactAllocationNumerator += BigInt(entry.amount) * denominator;
      return entry.amount;
    }

    if (entry.percentage === null) {
      throw new Error('Project billing entry must have an amount or percentage');
    }

    const scaledPercentage = percentageAsScaledInteger(entry.percentage);
    const rawNumerator = totalPriceBigInt * BigInt(scaledPercentage);
    exactAllocationNumerator += rawNumerator;
    return Number(roundPositiveFraction(rawNumerator, denominator));
  });

  return { amounts, exactAllocationNumerator };
}

/**
 * Resolves schedule entries to cents in input order.
 *
 * When the non-canceled schedule allocates the exact total before cent rounding,
 * the last non-canceled entry absorbs the cent remainder. Material allocation
 * gaps are intentionally left visible for validateAllocation.
 */
export function computeEntryAmounts(
  config: AllocationConfig,
  entries: readonly AllocationEntry[]
): number[] {
  if (config.total_price === null) {
    return entries.map((entry) => {
      if (entry.amount !== null) {
        assertNonNegativeCents(entry.amount, 'entry amount');
        return entry.amount;
      }
      return 0;
    });
  }

  const activeEntries = entries.filter((entry) => entry.status !== 'canceled');
  const activeResult = calculateBaseAmounts(config.total_price, activeEntries);
  const expectedNumerator = BigInt(config.total_price) * BigInt(FULL_PERCENTAGE_SCALED);

  if (activeEntries.length > 0 && activeResult.exactAllocationNumerator === expectedNumerator) {
    const finalIndex = activeResult.amounts.length - 1;
    const precedingTotal = activeResult.amounts
      .slice(0, finalIndex)
      .reduce((sum, amount) => sum + amount, 0);
    activeResult.amounts[finalIndex] = config.total_price - precedingTotal;
  }

  let activeIndex = 0;
  return entries.map((entry) => {
    if (entry.status === 'canceled') {
      return calculateBaseAmounts(config.total_price as number, [entry]).amounts[0];
    }

    const amount = activeResult.amounts[activeIndex];
    activeIndex += 1;
    return amount;
  });
}

export function validateAllocation(
  config: AllocationConfig,
  entries: readonly AllocationEntry[]
): AllocationValidationResult {
  if (config.total_price === null) {
    return { ok: true, delta: 0, isFinalEntryBlocked: false };
  }

  const computedAmounts = computeEntryAmounts(config, entries);
  const allocated = entries.reduce(
    (sum, entry, index) => entry.status === 'canceled' ? sum : sum + computedAmounts[index],
    0
  );
  const delta = config.total_price - allocated;
  const unapprovedCount = entries.filter(
    (entry) => entry.status !== 'approved'
      && entry.status !== 'invoiced'
      && entry.status !== 'canceled'
  ).length;

  return {
    ok: delta === 0,
    delta,
    isFinalEntryBlocked: delta !== 0 && unapprovedCount === 1
  };
}

/**
 * Transaction-friendly readiness hook for callers that complete a project phase.
 * The project completion action owns post-commit event publication.
 */
export async function evaluatePhaseReadiness(
  phaseId: string,
  trx?: Knex.Transaction
): Promise<IProjectBillingScheduleEntry[]> {
  const { connection, tenant } = await resolveProjectBillingDb(trx);
  const db = tenantDb(connection, tenant);
  const phase = await db.table('project_phases')
    .where({ phase_id: phaseId })
    .first('completed_at');

  if (!phase?.completed_at) {
    return [];
  }

  const readyAt = new Date().toISOString();
  const rows = await db.table('project_billing_schedule_entries')
    .where({
      phase_id: phaseId,
      trigger_type: 'phase',
      status: 'pending'
    })
    .update({
      status: 'ready',
      ready_at: readyAt,
      updated_at: readyAt
    })
    .returning('*');

  return rows
    .map((row) => normalizeProjectBillingScheduleEntry(row as Record<string, unknown>))
    .sort((left, right) => left.display_order - right.display_order
      || String(left.created_at).localeCompare(String(right.created_at))
      || left.schedule_entry_id.localeCompare(right.schedule_entry_id));
}

/** Evaluate date-triggered entries; the daily per-tenant job calls this hook. */
export async function evaluateDateReadiness(
  now: Date | string,
  trx?: Knex.Transaction
): Promise<IProjectBillingScheduleEntry[]> {
  const evaluatedAt = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(evaluatedAt.getTime())) {
    throw new RangeError('now must be a valid date');
  }

  const readyAt = evaluatedAt.toISOString();
  const triggerThrough = readyAt.slice(0, 10);
  const { connection, tenant } = await resolveProjectBillingDb(trx);
  const rows = await tenantDb(connection, tenant).table('project_billing_schedule_entries')
    .where({
      trigger_type: 'date',
      status: 'pending'
    })
    .whereNotNull('trigger_date')
    .where('trigger_date', '<=', triggerThrough)
    .update({
      status: 'ready',
      ready_at: readyAt,
      updated_at: readyAt
    })
    .returning('*');

  return rows
    .map((row) => normalizeProjectBillingScheduleEntry(row as Record<string, unknown>))
    .sort((left, right) => String(left.trigger_date).localeCompare(String(right.trigger_date))
      || left.display_order - right.display_order
      || left.schedule_entry_id.localeCompare(right.schedule_entry_id));
}

export function computeCapWriteDown(
  capAmount: number,
  usedBilled: number,
  chargeAmount: number
): CapWriteDownResult {
  assertNonNegativeCents(capAmount, 'capAmount');
  assertNonNegativeCents(usedBilled, 'usedBilled');
  assertNonNegativeCents(chargeAmount, 'chargeAmount');

  const remaining = Math.max(0, capAmount - usedBilled);
  const billable = Math.min(remaining, chargeAmount);
  return {
    billable,
    writtenDown: chargeAmount - billable
  };
}

export function detectThresholdCrossings(
  capAmount: number,
  prevBilled: number,
  newBilled: number,
  thresholds: readonly number[],
  alreadyNotified: readonly number[]
): number[] {
  assertNonNegativeCents(capAmount, 'capAmount');
  assertNonNegativeCents(prevBilled, 'prevBilled');
  assertNonNegativeCents(newBilled, 'newBilled');

  if (capAmount === 0 || newBilled <= prevBilled) {
    return [];
  }

  const notified = new Set(alreadyNotified);
  const seen = new Set<number>();
  return thresholds.filter((threshold) => {
    if (!Number.isFinite(threshold) || threshold < 0) {
      throw new RangeError('thresholds must contain non-negative finite percentages');
    }
    if (notified.has(threshold) || seen.has(threshold)) {
      return false;
    }
    seen.add(threshold);

    const thresholdScaled = BigInt(percentageAsScaledInteger(threshold));
    const denominator = BigInt(FULL_PERCENTAGE_SCALED);
    const thresholdTarget = BigInt(capAmount) * thresholdScaled;
    return BigInt(prevBilled) * denominator < thresholdTarget
      && BigInt(newBilled) * denominator >= thresholdTarget;
  });
}

export function computeDepositReconciliation(
  entries: readonly DepositReconciliationEntry[],
  treatment: ProjectBillingDepositTreatment
): number {
  if (treatment !== 'deduct_final') {
    return 0;
  }

  const finalMilestoneIndex = entries.findLastIndex(
    (entry) => entry.entry_type === 'milestone' && entry.status !== 'canceled'
  );
  if (finalMilestoneIndex < 0) {
    return 0;
  }

  const finalMilestoneAmount = entries[finalMilestoneIndex].computed_amount;
  assertNonNegativeCents(finalMilestoneAmount, 'final milestone computed_amount');

  const priorDeposits = entries
    .slice(0, finalMilestoneIndex)
    .filter((entry) => entry.entry_type === 'deposit' && entry.status === 'invoiced')
    .reduce((sum, entry) => {
      assertNonNegativeCents(entry.computed_amount, 'deposit computed_amount');
      return sum + entry.computed_amount;
    }, 0);

  return Math.min(finalMilestoneAmount, priorDeposits);
}
