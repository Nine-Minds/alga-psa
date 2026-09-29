import type { InvoiceTimeEntrySnapshot, InvoiceTimeRateKind } from '@alga-psa/types';

/** Validate frozen data without coercion or a lookup of mutable source records. */
export function isValidInvoiceTimeSnapshot(value: unknown): value is InvoiceTimeEntrySnapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  if (s.version !== 1 && s.version !== 2) return false;
  if (!Number.isSafeInteger(s.netAmount) || !Number.isSafeInteger(s.billedMinutes) || Number(s.billedMinutes) < 0) return false;
  if (![null, 'ticket', 'project_task', 'ad_hoc'].includes(s.workItemType as string | null)) return false;
  for (const key of ['workItemId', 'ticketNumber', 'title', 'description', 'entryDate', 'serviceId', 'serviceName']) {
    if (s[key] !== null && typeof s[key] !== 'string') return false;
  }
  if (s.version === 2) {
    if (!['uniform', 'mixed', 'unknown'].includes(String(s.rateKind))) return false;
    if (s.rateKind === 'uniform') {
      if (typeof s.uniformRate !== 'number' || !Number.isFinite(s.uniformRate) || s.uniformRate < 0 || Number(s.billedMinutes) <= 0) return false;
    } else if (s.uniformRate !== null) return false;
  }
  return true;
}

export function snapshotRate(s: InvoiceTimeEntrySnapshot): { rateKind: InvoiceTimeRateKind; rate: number | null } {
  if (s.version !== 2 || s.billedMinutes <= 0) return { rateKind: 'unknown', rate: null };
  // A subsequent adjustment must not turn a base/average rate into an effective rate.
  if (s.rateKind === 'uniform' && s.uniformRate !== null && Math.round(s.billedMinutes / 60 * s.uniformRate) === s.netAmount) {
    return { rateKind: 'uniform', rate: s.uniformRate };
  }
  return { rateKind: s.rateKind === 'mixed' ? 'mixed' : 'unknown', rate: null };
}

export function combineTimeRates(entries: { rateKind: InvoiceTimeRateKind; rate: number | null }[]) {
  const rates = new Set(entries.filter((e) => e.rateKind === 'uniform').map((e) => e.rate));
  const rateKind: InvoiceTimeRateKind = entries.some((e) => e.rateKind === 'mixed') || rates.size > 1
    ? 'mixed' : entries.length === 0 || entries.some((e) => e.rateKind === 'unknown') ? 'unknown' : 'uniform';
  return { rateKind, rate: rateKind === 'uniform' ? entries[0].rate : null };
}
