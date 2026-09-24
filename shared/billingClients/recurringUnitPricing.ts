/**
 * Shared, dependency-free selection of recurring contract unit pricing.
 *
 * Products (catalog item_kind = 'product') and explicitly unit-priced Fixed
 * services ("recurring seats/units") share one prospective revision contract:
 * a quantity plus an explicit unit-rate override or catalog inheritance,
 * effective at a service-period boundary. Billing, editing and valuation all
 * select the latest revision at/before the covered service-period start with
 * these same rules so they cannot drift apart.
 *
 * No date is compared as a timestamp here: boundaries are calendar dates and
 * are normalized to YYYY-MM-DD before comparison.
 */

export type RecurringPricePolicy = 'override' | 'catalog';

/**
 * The neutral recurring-unit capability: an explicitly unit-priced Fixed
 * service ("recurring seat/unit") or a catalog product billed through the
 * recurring product path. Bundle allocations, measured Usage, Hourly time and
 * one-time project purchases are not recurring units.
 */
export type RecurringUnitKind = 'service' | 'product';

export interface RecurringUnitCapabilityInput {
  configurationType: string | null | undefined;
  pricingBasis?: string | null;
  itemKind?: string | null;
  isLicense?: boolean | null;
}

export function resolveRecurringUnitKind(
  input: RecurringUnitCapabilityInput,
): RecurringUnitKind | null {
  if (input.configurationType !== 'Fixed') return null;
  if (input.pricingBasis === 'unit') return 'service';
  if (input.itemKind === 'product') return 'product';
  return null;
}

export function isRecurringUnitCapable(input: RecurringUnitCapabilityInput): boolean {
  return resolveRecurringUnitKind(input) !== null;
}

export interface RecurringUnitRevisionCandidate {
  revisionId: string;
  quantity: number;
  unitRateCents: number | null;
  pricePolicy: RecurringPricePolicy;
  version: number;
  /** Canonical service-period boundary, YYYY-MM-DD. */
  effectivePeriodStart: string;
  createdAt?: string | Date | null;
}

export interface RecurringUnitBaseline {
  quantity: number;
  /**
   * Explicit baseline rate (minor units) or null when the item has no
   * configured override and follows the catalog. For unit-priced Fixed
   * services this is the fixed-config base_rate / custom_rate chain; for
   * products it is the contract override chain only (never the wizard's
   * placeholder base_rate = 0).
   */
  unitRateCents: number | null;
}

/** A persisted `contract_line_unit_pricing_revisions` row, DB-typed. */
export interface RecurringUnitRevisionRow {
  revision_id: string;
  quantity: number | string;
  unit_rate_cents: number | string | null;
  price_policy?: string | null;
  version?: number | string | null;
  effective_period_start: string | Date;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
}

/**
 * Normalize a stored revision row into the neutral candidate shape. Legacy rows
 * have no `price_policy` and a numeric rate; they stay explicit overrides.
 */
export function toRecurringUnitRevisionCandidate(
  row: RecurringUnitRevisionRow,
): RecurringUnitRevisionCandidate {
  const policy: RecurringPricePolicy =
    row.price_policy === 'catalog' ? 'catalog' : 'override';
  const rate =
    row.unit_rate_cents === null || row.unit_rate_cents === undefined
      ? null
      : Number(row.unit_rate_cents);
  return {
    revisionId: row.revision_id,
    quantity: Number(row.quantity),
    unitRateCents: rate,
    pricePolicy: policy,
    version: Number(row.version ?? 1),
    effectivePeriodStart: normalizeRecurringBoundary(row.effective_period_start),
    createdAt: row.updated_at ?? row.created_at ?? null,
  };
}

export interface EffectiveRecurringUnitPricing {
  quantity: number;
  unitRateCents: number | null;
  pricePolicy: RecurringPricePolicy;
  source: 'baseline' | 'revision';
  revisionId: string | null;
  version: number | null;
  effectivePeriodStart: string | null;
}

/**
 * Legacy baseline precedence for a recurring unit with no applicable revision.
 * Explicit contract overrides win; otherwise the item follows the catalog for
 * the covered period (currency- and effective-date-aware). Never uses the
 * wizard's placeholder fixed base_rate of 0 as a product override. The rate is
 * returned in its original column type so callers can keep exact DB values.
 */
export function resolveRecurringUnitBaseline(input: {
  /** Defaults to `product` so the wizard's placeholder fixed base_rate is never mistaken for a product override. */
  kind?: RecurringUnitKind;
  quantity: number | string | null | undefined;
  /** `contract_line_service_configuration.custom_rate`. */
  configurationCustomRate?: number | string | null;
  /** `contract_line_services.custom_rate` (legacy service-line override). */
  serviceLineCustomRate?: number | string | null;
  /**
   * `contract_line_service_fixed_config.base_rate`. Only consulted for a
   * unit-priced Fixed service; for products it is the wizard placeholder 0 and
   * is deliberately ignored so catalog inheritance survives.
   */
  fixedBaseRate?: number | string | null;
}): RecurringUnitBaseline & { unitRate: number | string | null; hasOverride: boolean } {
  const kind = input.kind ?? 'product';
  const quantity = Number(input.quantity ?? 0);
  const override =
    kind === 'service'
      ? input.fixedBaseRate ??
        input.configurationCustomRate ??
        input.serviceLineCustomRate ??
        null
      : input.configurationCustomRate ?? input.serviceLineCustomRate ?? null;
  return {
    quantity: Number.isFinite(quantity) ? quantity : 0,
    unitRateCents: override === null || override === undefined ? null : Number(override),
    unitRate: override,
    hasOverride: override !== null && override !== undefined,
  };
}

/**
 * Resolve the price policy for one covered period. A product/license with no
 * explicit contract override inherits the currency catalog price for the
 * period; explicit overrides (including a free zero rate) win and are in
 * contract currency.
 */
export function resolveRecurringUnitRate(params: {
  baseline: { unitRate: number | string | null; hasOverride: boolean };
  catalogRate?: number | string | null;
}): { unitRate: number | string | null; pricePolicy: RecurringPricePolicy } {
  if (params.baseline.hasOverride) {
    return { unitRate: params.baseline.unitRate, pricePolicy: 'override' };
  }
  if (params.catalogRate !== null && params.catalogRate !== undefined) {
    return { unitRate: params.catalogRate, pricePolicy: 'catalog' };
  }
  return { unitRate: null, pricePolicy: 'catalog' };
}

export function normalizeRecurringBoundary(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value ?? '');
  return text.length >= 10 ? text.slice(0, 10) : text;
}

/**
 * Latest revision effective at/before `boundary`. Later effective dates win;
 * ties (same boundary) fall back to the higher concurrency version, then the
 * most recently created row. Returns null when no revision applies yet, which
 * means the item keeps its baseline configuration.
 */
export function selectLatestApplicableRevision(
  revisions: readonly RecurringUnitRevisionCandidate[],
  boundary: string,
): RecurringUnitRevisionCandidate | null {
  const asOf = normalizeRecurringBoundary(boundary);
  let best: RecurringUnitRevisionCandidate | null = null;
  for (const revision of revisions) {
    if (normalizeRecurringBoundary(revision.effectivePeriodStart) > asOf) {
      continue;
    }
    if (!best) {
      best = revision;
      continue;
    }
    const candidateStart = normalizeRecurringBoundary(revision.effectivePeriodStart);
    const bestStart = normalizeRecurringBoundary(best.effectivePeriodStart);
    if (candidateStart > bestStart) {
      best = revision;
      continue;
    }
    if (candidateStart < bestStart) {
      continue;
    }
    if (revision.version > best.version) {
      best = revision;
      continue;
    }
    if (revision.version < best.version) {
      continue;
    }
    const candidateCreated = revision.createdAt ? new Date(revision.createdAt).getTime() : 0;
    const bestCreated = best.createdAt ? new Date(best.createdAt).getTime() : 0;
    if (candidateCreated >= bestCreated) {
      best = revision;
    }
  }
  return best;
}

/**
 * Resolve the effective quantity and price policy for a covered period. A
 * matching revision fully replaces the baseline (`source: 'revision'`); with no
 * applicable revision the baseline stands (`source: 'baseline'`), preserving
 * legacy product and service pricing exactly.
 */
export function selectEffectiveRecurringUnitPricing(params: {
  boundary: string;
  baseline: RecurringUnitBaseline;
  revisions: readonly RecurringUnitRevisionCandidate[];
}): EffectiveRecurringUnitPricing {
  const revision = selectLatestApplicableRevision(params.revisions, params.boundary);
  if (!revision) {
    return {
      quantity: params.baseline.quantity,
      unitRateCents: params.baseline.unitRateCents,
      pricePolicy: params.baseline.unitRateCents === null ? 'catalog' : 'override',
      source: 'baseline',
      revisionId: null,
      version: null,
      effectivePeriodStart: null,
    };
  }
  return {
    quantity: revision.quantity,
    unitRateCents: revision.unitRateCents,
    pricePolicy: revision.pricePolicy,
    source: 'revision',
    revisionId: revision.revisionId,
    version: revision.version,
    effectivePeriodStart: normalizeRecurringBoundary(revision.effectivePeriodStart),
  };
}
