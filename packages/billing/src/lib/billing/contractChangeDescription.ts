export interface ContractChangeDescriptionSource {
  adjustment_period_start?: unknown;
  adjustment_period_end?: unknown;
  mid_period_effective_date?: unknown;
  quantity_delta?: unknown;
  unit_rate_cents?: unknown;
  covered_days?: unknown;
  full_period_days?: unknown;
  amount_cents?: unknown;
}

const dateOnly = (value: unknown): string | null => {
  let raw = value;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    raw = value.toISOString().slice(0, 10);
  }
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return raw;
};

const canonicalNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Customer explanation based only on canonical companion revision values. */
export function describeContractChange(
  serviceName: string,
  source: ContractChangeDescriptionSource,
  currencyCode: unknown,
): string {
  const periodStart = dateOnly(source.adjustment_period_start);
  const start = dateOnly(source.mid_period_effective_date);
  const end = dateOnly(source.adjustment_period_end);
  const delta = canonicalNumber(source.quantity_delta);
  const rateCents = canonicalNumber(source.unit_rate_cents);
  const covered = canonicalNumber(source.covered_days);
  const full = canonicalNumber(source.full_period_days);
  const amount = canonicalNumber(source.amount_cents);
  const validNumbers = [delta, rateCents, covered, full, amount].every((value) => value !== null);
  let validCurrency = false;
  if (typeof currencyCode === 'string' && /^[A-Z]{3}$/.test(currencyCode)) {
    try {
      validCurrency = (Intl as typeof Intl & { supportedValuesOf?: (key: 'currency') => string[] })
        .supportedValuesOf?.('currency').includes(currencyCode) ?? false;
    } catch {
      validCurrency = false;
    }
  }
  const hasCanonicalCalculation = Boolean(start && end && periodStart && periodStart <= start && start < end && validNumbers && validCurrency &&
    delta !== null && rateCents !== null && covered !== null && full !== null && amount !== null &&
    delta !== 0 && rateCents >= 0 && Number.isInteger(covered) &&
    Number.isInteger(full) && covered > 0 && full >= covered &&
    (delta > 0 ? amount > 0 : amount < 0));
  if (!hasCanonicalCalculation) return `Mid-period quantity change: ${serviceName}`;

  const direction = amount! < 0 ? 'credit' : 'increase';
  const signedDelta = `${delta! > 0 ? '+' : ''}${delta}`;
  const fullRate = new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: currencyCode as string, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2,
  }).format(rateCents! / 100);
  return `${serviceName}: ${direction} (${signedDelta} units); ${start} through ${end} (end date exclusive); full-period rate ${currencyCode} ${fullRate}; prorated ${covered}/${full} days`;
}
