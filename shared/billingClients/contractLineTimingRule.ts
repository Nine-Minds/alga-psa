import type { RecurringChargeFamily } from '@alga-psa/types';

import type { RecurringBillingTiming } from './recurringAuthoringPolicy';

/**
 * The one place that knows which contract line types may bill in advance.
 *
 * Hourly and Usage lines bill work after it happens, so their billing timing is
 * always arrears. Authoring paths ask `isAdvanceTimingAllowedForLineType` (and
 * throw `ContractLineTimingNotAllowedError` for an explicit advance choice);
 * the billing engine and schedule materializers ask `resolveEffectiveBillingTiming`
 * so a stale stored value can never produce an advance schedule.
 */
export const ARREARS_ONLY_CONTRACT_LINE_TYPES = ['Hourly', 'Usage'] as const;

export const CONTRACT_LINE_TIMING_NOT_ALLOWED_CODE = 'CONTRACT_LINE_TIMING_NOT_ALLOWED';

export const CONTRACT_LINE_TIMING_NOT_ALLOWED_MESSAGE =
  'Advance billing is only available for fixed contract lines. Hourly and usage lines bill work after it happens, so they always bill in arrears.';

// Lower-cased on purpose: matching is case-insensitive and keeps the 'time' alias
// that resolveRecurringChargeFamily has always accepted for Hourly lines.
const ARREARS_ONLY_LINE_TYPE_KEYS: ReadonlySet<string> = new Set([
  ...ARREARS_ONLY_CONTRACT_LINE_TYPES.map((lineType) => lineType.toLowerCase()),
  'time',
]);

export function isAdvanceTimingAllowedForLineType(lineType: string | null | undefined): boolean {
  if (typeof lineType !== 'string') {
    return true;
  }
  return !ARREARS_ONLY_LINE_TYPE_KEYS.has(lineType.trim().toLowerCase());
}

/**
 * The timing a line actually bills on, whatever is stored. A missing stored value
 * is arrears, the same default every other layer uses.
 */
export function resolveEffectiveBillingTiming(
  lineType: string | null | undefined,
  storedTiming: string | null | undefined,
): RecurringBillingTiming {
  if (!isAdvanceTimingAllowedForLineType(lineType)) {
    return 'arrears';
  }
  return storedTiming === 'advance' ? 'advance' : 'arrears';
}

export class ContractLineTimingNotAllowedError extends Error {
  readonly code = CONTRACT_LINE_TIMING_NOT_ALLOWED_CODE;
  readonly statusCode = 400;

  constructor(message: string = CONTRACT_LINE_TIMING_NOT_ALLOWED_MESSAGE) {
    super(message);
    this.name = 'ContractLineTimingNotAllowedError';
  }
}

/**
 * Cross-bundle safe check: error classes can be duplicated across module graphs
 * (server actions vs. packages), so also accept the code marker.
 */
export function isContractLineTimingNotAllowedError(
  error: unknown,
): error is ContractLineTimingNotAllowedError {
  return (
    error instanceof ContractLineTimingNotAllowedError
    || (
      typeof error === 'object'
      && error !== null
      && (error as { code?: unknown }).code === CONTRACT_LINE_TIMING_NOT_ALLOWED_CODE
    )
  );
}

/**
 * Maps a stored contract line type to the recurring charge family used by the
 * schedule materializers, the coverage audit and the engine.
 */
export function resolveRecurringChargeFamily(
  contractLineType: string | null | undefined,
): RecurringChargeFamily {
  switch ((contractLineType ?? 'fixed').toLowerCase()) {
    case 'fixed':
      return 'fixed';
    case 'time':
    case 'hourly':
      return 'hourly';
    case 'usage':
      return 'usage';
    case 'bucket':
      return 'bucket';
    case 'product':
      return 'product';
    case 'license':
      return 'license';
    default:
      return 'fixed';
  }
}
