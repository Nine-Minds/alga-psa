/** Shared pure cap and minor-unit arithmetic; the service keeps its public exports. */
const PERCENTAGE_SCALE = 10_000;
export const FULL_PERCENTAGE_SCALED = 100 * PERCENTAGE_SCALE;


export interface CapWriteDownResult {
  billable: number;
  writtenDown: number;
}

export function assertNonNegativeCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer number of cents`);
  }
}

export function percentageAsScaledInteger(percentage: number): number {
  if (!Number.isFinite(percentage) || percentage < 0) {
    throw new RangeError('percentage must be a non-negative finite number');
  }

  return Math.round(percentage * PERCENTAGE_SCALE);
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

/** First persisted hard-cap overage; used to dedupe workflow and user notifications. */
export function isFirstProjectCapOverage(
  writtenDownBefore: number,
  writtenDownAfter: number,
): boolean {
  assertNonNegativeCents(writtenDownBefore, 'writtenDownBefore');
  assertNonNegativeCents(writtenDownAfter, 'writtenDownAfter');
  return writtenDownBefore === 0 && writtenDownAfter > 0;
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
