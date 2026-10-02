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

/**
 * A cap is a number of minor units in the project's own billing currency, so it
 * can only be compared with charges billed in that same currency. Tenants do
 * drift apart — a project capped in USD under a client that bills ARS — and
 * there is no exchange rate anywhere in the engine, so a cross-currency cap is
 * not applied at all rather than written down against a meaningless number.
 * An unknown currency on either side means "no evidence of a mismatch" and the
 * cap applies as before.
 */
export function capAppliesToInvoiceCurrency(
  capCurrency: string | null | undefined,
  invoiceCurrency: string | null | undefined,
): boolean {
  const cap = capCurrency?.trim().toUpperCase();
  const invoice = invoiceCurrency?.trim().toUpperCase();
  if (!cap || !invoice) return true;
  return cap === invoice;
}

/**
 * The currency an invoice bills in, from the contract lines it carries and the
 * client's own currency. A contract line's rates are denominated in its
 * contract's currency, so a single contract currency on the invoice decides it;
 * with no contract line — every standalone project invoice — the client's own
 * currency does.
 *
 * One rule in one place: a cap is only applied when it is counted in this
 * currency (`capAppliesToInvoiceCurrency`), so the engine, the due-work listing
 * and the project billing tab must all answer this question identically or a
 * cap is written down in a preview and not on the invoice, or named as live on
 * a card while it sleeps.
 */
export function resolveInvoiceCurrency(
  contractLineCurrencies: readonly (string | null | undefined)[],
  clientDefaultCurrency: string | null | undefined,
): string {
  const unique = Array.from(
    new Set(contractLineCurrencies.filter((code): code is string => !!code)),
  );
  if (unique.length === 1) return unique[0];
  return clientDefaultCurrency || 'USD';
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
