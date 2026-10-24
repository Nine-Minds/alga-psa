import { tryNormalizeDateOnly } from '@alga-psa/types';
import type { ContractStatus } from '@alga-psa/types';

/**
 * `scheduled` is a derived-only state (never stored in `contracts.status`): the contract is
 * confirmed and its assignment is active, but the assignment starts after today (tenant-local).
 * It is declared here, not in `@alga-psa/types`' ContractStatus, so the DB enum is untouched.
 */
export type ClientAssignmentStatus =
  | Extract<ContractStatus, 'draft' | 'active' | 'terminated' | 'expired'>
  | 'scheduled';

type DeriveClientContractStatusParams = {
  isActive: boolean;
  startDate: string | Date | null | undefined;
  endDate: string | Date | null | undefined;
  contractStatus?: string;
  /** Date-only string (already tenant-local) or an instant (converted using `timeZone`). */
  now?: string | Date;
  /** Tenant IANA timezone used to turn a `Date`/missing `now` into a local calendar date. */
  timeZone?: string | null;
};

/**
 * Calendar date (YYYY-MM-DD) of `instant` in `timeZone`. Falls back to the UTC date when the zone
 * is missing or invalid (documented default for callers without a tenant timezone).
 */
export function toLocalDateInTimeZone(instant: Date, timeZone?: string | null): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(instant);
      const get = (type: string) => parts.find((part) => part.type === type)?.value;
      const year = get('year');
      const month = get('month');
      const day = get('day');
      if (year && month && day) {
        return `${year}-${month}-${day}`;
      }
    } catch {
      // invalid timezone: fall through to UTC
    }
  }
  return instant.toISOString().slice(0, 10);
}


// LEVERAGE: pattern date-only-normalizer — several local normalizeDateOnly copies exist; this one
// delegates to the shared @alga-psa/types helper (local Y/M/D for Date, never toISOString).
const normalizeDateOnly = (value: string | Date | null | undefined): string | null =>
  tryNormalizeDateOnly(value);

const normalizeNowDateOnly = (value?: string | Date, timeZone?: string | null): string => {
  if (value instanceof Date) {
    return toLocalDateInTimeZone(value, timeZone);
  }

  const normalized = normalizeDateOnly(value);
  if (normalized) {
    return normalized;
  }

  return toLocalDateInTimeZone(new Date(), timeZone);
};

export function deriveClientContractStatus(
  params: DeriveClientContractStatusParams
): ClientAssignmentStatus {
  if (params.contractStatus === 'draft') {
    return 'draft';
  }

  const startDate = normalizeDateOnly(params.startDate);
  const endDate = normalizeDateOnly(params.endDate);
  const nowDate = normalizeNowDateOnly(params.now, params.timeZone);

  if (!params.isActive) {
    return 'terminated';
  }

  if (startDate && startDate > nowDate) {
    return 'scheduled';
  }

  if (endDate && endDate < nowDate) {
    return 'expired';
  }

  return 'active';
}

/**
 * Live = the assignment has been confirmed and is (or will be) billing-relevant, i.e. not a draft.
 * `scheduled` counts as live: it is confirmed and bills from its start date. Callers that mean
 * "billing right now" must compare against 'active' explicitly.
 */
export function isLiveClientContractStatus(status: ClientAssignmentStatus): boolean {
  return status === 'active' || status === 'expired' || status === 'terminated' || status === 'scheduled';
}
