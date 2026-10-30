import type { RmaStatus } from '@alga-psa/types';

export type WarrantyExpiry = 'none' | 'expired' | 'expiring' | 'active';

/** Days before the end date at which the warranty is flagged as expiring. */
export const WARRANTY_EXPIRING_DAYS = 30;

const dayNumber = (ymd: string): number => {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
};

/** Classify a YYYY-MM-DD warranty end against a YYYY-MM-DD "today" (calendar dates, no time zones). */
export function classifyWarrantyEnd(endDate: string | null | undefined, today: string): WarrantyExpiry {
  if (!endDate) return 'none';
  const left = dayNumber(endDate) - dayNumber(today);
  if (left < 0) return 'expired';
  return left <= WARRANTY_EXPIRING_DAYS ? 'expiring' : 'active';
}

/** Whether "Start warranty claim" is offered: permitted, client-owned, not stock-tracked, no open claim. */
export function canStartWarrantyClaim(s: {
  can_create_claim: boolean;
  ownership: 'client' | 'msp';
  stock_tracked: boolean;
  open_claim: unknown | null;
}): boolean {
  return s.can_create_claim && s.ownership === 'client' && !s.stock_tracked && !s.open_claim;
}

/** Fallback label for statuses without a translation. */
export const humanizeRmaStatus = (status: RmaStatus | string): string => String(status).replace(/_/g, ' ');
