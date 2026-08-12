/**
 * Period-fee resolution for bucket periods.
 *
 * Primary source (per the settled design decision): the fee actually billed
 * for the bucket line's service period on a finalized invoice —
 * `invoice_charges` joined through `invoice_charge_details.config_id` to the
 * line's `contract_line_service_configuration` (configuration_type = 'Fixed').
 * Fallback when the period has not been billed yet: the configured base fee
 * for the line (custom rate → fixed-config base rate × qty → catalog default
 * rate × qty), marked notYetBilled in the detail row.
 */

import type { FeeSource } from './types';

export interface BilledFeeCandidate {
  contractLineId: string;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  feeCents: number;
}

export interface ConfiguredFee {
  contractLineId: string;
  serviceId: string;
  feeCents: number | null;
}

export interface ResolvedFee {
  feeCents: number;
  feeSource: FeeSource;
}

function dayNumber(dateString: string): number {
  return Math.round(Date.parse(`${dateString.slice(0, 10)}T00:00:00.000Z`) / 86_400_000);
}

/** Inclusive-overlap length in days between two inclusive date ranges. */
function overlapDays(
  periodStart: string,
  periodEnd: string,
  candidateStart: string,
  candidateEnd: string,
): number {
  const overlapStart = Math.max(dayNumber(periodStart), dayNumber(candidateStart));
  const overlapEnd = Math.min(dayNumber(periodEnd), dayNumber(candidateEnd));
  return Math.max(0, overlapEnd - overlapStart + 1);
}

/**
 * Resolve the period fee for one bucket period, preferring the billed fee.
 *
 * The billing engine prorates first/last service periods (e.g. a Jul 8–31
 * invoice window for a Jul 1–31 bucket allowance), so the billed detail is
 * matched by period overlap rather than exact equality: the candidate with the
 * longest inclusive overlap wins, and the reported fee is what was actually
 * billed (prorated amounts included). No overlap at all falls back to the
 * configured fee.
 */
export function resolvePeriodFee(
  periodStart: string,
  periodEnd: string,
  contractLineId: string,
  billedCandidates: BilledFeeCandidate[],
  configuredFee: number | null,
): ResolvedFee {
  let best: BilledFeeCandidate | null = null;
  let bestOverlap = 0;

  for (const candidate of billedCandidates) {
    if (candidate.contractLineId !== contractLineId) continue;
    const overlap = overlapDays(periodStart, periodEnd, candidate.servicePeriodStart, candidate.servicePeriodEnd);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = candidate;
    }
  }

  if (best && bestOverlap > 0 && best.feeCents > 0) {
    return { feeCents: best.feeCents, feeSource: 'billed' };
  }

  if (configuredFee !== null && configuredFee > 0) {
    return { feeCents: configuredFee, feeSource: 'configured' };
  }

  return { feeCents: 0, feeSource: 'configured' };
}
