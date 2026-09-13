import { Temporal } from "@js-temporal/polyfill";

/**
 * One resolver for the fixed/recurring rate decision.
 *
 * Historically the same decision was implemented five times (the billing engine
 * loader, the deferred-revenue report, the EE simulator, contractMonthlyValue,
 * and the server-side repository fork) and they drifted apart on null-schedule
 * handling, rounding, quantity fallback and config keying. This module is the
 * single pure implementation over already-loaded rows so every caller can agree.
 *
 * The precedence chains preserve the engine's existing semantics exactly. The
 * engine reads a schedule's latest effective row *before* deciding whether its
 * rate is null, so a null-rate latest schedule blocks older schedules rather
 * than falling through to them. We keep that deliberately (see plan §2.3).
 */

export type RateProvenance = "custom" | "inherited" | "unreviewed";

export type RateSource =
  | "pricing_schedule"
  | "line_override"
  | "derived"
  | "unit_revision"
  | "service_override"
  | "config_override"
  | "catalog"
  | "catalog_legacy";

export interface ResolvedRate {
  rateCents: number | null;
  source: RateSource | null;
  sourceId: string | null;
  provenance: RateProvenance;
}

export interface ContractLineRateRow {
  contract_line_id: string;
  custom_rate: number | string | null;
  rate_provenance?: RateProvenance | null;
}

export interface PlanServiceRateRow {
  service_id: string;
  config_id: string;
  quantity?: number | string | null;
  service_quantity?: number | string | null;
  configuration_quantity?: number | string | null;
  /** `contract_line_service_fixed_config.base_rate` (cents). */
  service_base_rate?: number | string | null;
  /** `contract_line_service_fixed_config.rate_provenance`. */
  base_rate_provenance?: RateProvenance | null;
  /** `contract_line_service_configuration.custom_rate` (cents). */
  configuration_custom_rate?: number | string | null;
  /** `service_catalog.default_rate` (cents, currency-untagged legacy). */
  default_rate?: number | string | null;
  pricing_basis?: string | null;
}

export interface PricingScheduleRateRow {
  schedule_id?: string | null;
  contract_line_id?: string | null;
  effective_date: string | Date;
  end_date?: string | Date | null;
  custom_rate: number | string | null;
}

export interface UnitPricingRevisionRateRow {
  revision_id?: string | null;
  service_id: string;
  config_id: string;
  effective_period_start: string | Date;
  unit_rate_cents: number | string;
  created_at?: string | Date | null;
}

export interface ServicePriceRateRow {
  price_id?: string | null;
  service_id: string;
  currency_code: string;
  rate: number | string;
  effective_date?: string | Date | null;
}

export interface ResolveFixedLineRateInput {
  line: ContractLineRateRow;
  planServices: PlanServiceRateRow[];
  schedules: PricingScheduleRateRow[];
  revisions: UnitPricingRevisionRateRow[];
  catalogPrices: ServicePriceRateRow[];
  /** Covered period, `[start, end)`. Dates `YYYY-MM-DD`. */
  period: { start: string; end: string };
  currency: string;
  /** Tenant's default currency; gates the `catalog_legacy` fallback. */
  tenantDefaultCurrency?: string | null;
}

export interface ResolveFixedLineRateResult {
  line: ResolvedRate;
  perService: Map<string, ResolvedRate>;
}

const PROVENANCE_VALUES: readonly RateProvenance[] = [
  "custom",
  "inherited",
  "unreviewed",
];

export function isRateProvenance(value: unknown): value is RateProvenance {
  return (
    typeof value === "string" &&
    (PROVENANCE_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Treat a missing label as the migration's mechanical answer: a stored number
 * with no label is `unreviewed`; a null number is `inherited`. This keeps the
 * resolver correct for rows written before the provenance migration lands.
 */
export function normalizeProvenance(
  value: RateProvenance | null | undefined,
  rateCents: number | null,
): RateProvenance {
  if (isRateProvenance(value)) {
    return value;
  }
  return rateCents === null ? "inherited" : "unreviewed";
}

function toCents(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function toCalendarDate(value: string | Date): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return match ? match[1] : null;
}

function dayBefore(date: string): string {
  return Temporal.PlainDate.from(date).subtract({ days: 1 }).toString();
}

function compareCalendarDates(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function quantityOf(service: PlanServiceRateRow): number {
  const raw =
    service.configuration_quantity ?? service.service_quantity ?? service.quantity;
  const quantity = raw == null ? 1 : Number(raw);
  return Number.isFinite(quantity) ? quantity : 1;
}

/** Member-level chain: first non-null wins. */
export function resolveMemberRate(
  input: Pick<
    ResolveFixedLineRateInput,
    "period" | "currency" | "revisions" | "catalogPrices" | "tenantDefaultCurrency"
  >,
  service: PlanServiceRateRow,
): ResolvedRate {
  const periodStart = input.period.start;

  // 1. Latest admitted unit-pricing revision, keyed on (service_id, config_id).
  const applicableRevisions = input.revisions
    .filter(
      (revision) =>
        revision.service_id === service.service_id &&
        revision.config_id === service.config_id &&
        compareCalendarDates(
          toCalendarDate(revision.effective_period_start),
          periodStart,
        ) <= 0,
    )
    .sort((a, b) => {
      const byDate = compareCalendarDates(
        toCalendarDate(b.effective_period_start),
        toCalendarDate(a.effective_period_start),
      );
      if (byDate !== 0) return byDate;
      return compareCalendarDates(
        toCalendarDate(b.created_at ?? ""),
        toCalendarDate(a.created_at ?? ""),
      );
    });
  if (applicableRevisions.length > 0) {
    const rateCents = toCents(applicableRevisions[0].unit_rate_cents);
    if (rateCents !== null) {
      return {
        rateCents,
        source: "unit_revision",
        sourceId: applicableRevisions[0].revision_id ?? null,
        provenance: "custom",
      };
    }
  }

  // 2. Per-service fixed-config snapshot, when the provenance says it governs.
  const baseRateCents = toCents(service.service_base_rate);
  const baseRateProvenance = normalizeProvenance(
    service.base_rate_provenance,
    baseRateCents,
  );
  if (
    baseRateCents !== null &&
    (baseRateProvenance === "custom" || baseRateProvenance === "unreviewed")
  ) {
    return {
      rateCents: baseRateCents,
      source: "service_override",
      sourceId: service.config_id,
      provenance: baseRateProvenance,
    };
  }

  // 3. Per-configuration custom rate.
  const configRateCents = toCents(service.configuration_custom_rate);
  if (configRateCents !== null) {
    return {
      rateCents: configRateCents,
      source: "config_override",
      sourceId: service.config_id,
      provenance: "custom",
    };
  }

  // 4. Effective catalog price in the contract's currency.
  const catalogPrice = selectEffectiveServicePrice(
    input.catalogPrices,
    service.service_id,
    input.currency,
    periodStart,
  );
  if (catalogPrice && catalogPrice.rateCents !== null) {
    return {
      rateCents: catalogPrice.rateCents,
      source: "catalog",
      sourceId: catalogPrice.price_id,
      provenance: "inherited",
    };
  }

  // 5. Legacy `service_catalog.default_rate`, only for the tenant default
  //    currency and only when no `service_prices` row exists at all.
  const isDefaultCurrency =
    !input.tenantDefaultCurrency ||
    input.tenantDefaultCurrency === input.currency;
  if (isDefaultCurrency && !hasAnyServicePrice(input.catalogPrices, service.service_id, input.currency)) {
    const legacyRateCents = toCents(service.default_rate);
    if (legacyRateCents !== null) {
      return {
        rateCents: legacyRateCents,
        source: "catalog_legacy",
        sourceId: service.service_id,
        provenance: "inherited",
      };
    }
  }

  return { rateCents: null, source: null, sourceId: null, provenance: "inherited" };
}

export interface EffectiveServicePrice {
  price_id: string | null;
  rateCents: number | null;
  effectiveDate: string | null;
}

/**
 * Latest `service_prices` row effective at `asOf` for one service + currency.
 * Shared with the SQL join helper so the resolver and the engine cannot pick
 * different rows once a service carries more than one effective-dated price.
 */
export function selectEffectiveServicePrice(
  prices: ServicePriceRateRow[],
  serviceId: string,
  currency: string,
  asOf: string,
): EffectiveServicePrice | null {
  const admitted = prices
    .filter((price) => {
      if (price.service_id !== serviceId) return false;
      if (price.currency_code !== currency) return false;
      const effectiveDate = toCalendarDate(price.effective_date ?? "1970-01-01");
      return compareCalendarDates(effectiveDate, asOf) <= 0;
    })
    .sort((a, b) =>
      compareCalendarDates(
        toCalendarDate(b.effective_date ?? "1970-01-01"),
        toCalendarDate(a.effective_date ?? "1970-01-01"),
      ),
    );
  if (admitted.length === 0) {
    return null;
  }
  const winner = admitted[0];
  return {
    price_id: winner.price_id ?? null,
    rateCents: toCents(winner.rate),
    effectiveDate: toCalendarDate(winner.effective_date ?? "1970-01-01"),
  };
}

function hasAnyServicePrice(
  prices: ServicePriceRateRow[],
  serviceId: string,
  currency: string,
): boolean {
  return prices.some(
    (price) =>
      price.service_id === serviceId && price.currency_code === currency,
  );
}

export function isActivePricingSchedule(
  schedule: PricingScheduleRateRow,
  period: { start: string; end: string },
): boolean {
  const effectiveDate = toCalendarDate(schedule.effective_date);
  if (effectiveDate === null) return false;
  // [start, end): a schedule starting at/after period end does not apply.
  if (compareCalendarDates(effectiveDate, period.end) >= 0) return false;
  const endDate = toCalendarDate(schedule.end_date ?? "");
  // Matches the engine's exclusive service-period start: an end date equal to
  // the inclusive period start still applies.
  return endDate === null || compareCalendarDates(endDate, dayBefore(period.start)) > 0;
}

/** Pick the active schedule: line-scoped rows preferred, then newest. */
export function selectActivePricingSchedule(
  schedules: PricingScheduleRateRow[],
  lineId: string,
  period: { start: string; end: string },
): PricingScheduleRateRow | null {
  const applicable = schedules
    .filter((schedule) => {
      const scope = schedule.contract_line_id ?? null;
      if (scope !== null && scope !== lineId) return false;
      return isActivePricingSchedule(schedule, period);
    })
    .sort((a, b) => {
      const byScope =
        Number((b.contract_line_id ?? null) !== null) -
        Number((a.contract_line_id ?? null) !== null);
      if (byScope !== 0) return byScope;
      return compareCalendarDates(
        toCalendarDate(b.effective_date),
        toCalendarDate(a.effective_date),
      );
    });
  return applicable[0] ?? null;
}

export function resolveFixedLineRate(
  input: ResolveFixedLineRateInput,
): ResolveFixedLineRateResult {
  const perService = new Map<string, ResolvedRate>();
  for (const service of input.planServices) {
    perService.set(service.config_id, resolveMemberRate(input, service));
  }

  // Line chain, first non-null wins.
  const activeSchedule = selectActivePricingSchedule(
    input.schedules,
    input.line.contract_line_id,
    input.period,
  );
  if (activeSchedule && activeSchedule.custom_rate !== null && activeSchedule.custom_rate !== undefined) {
    const rateCents = toCents(activeSchedule.custom_rate);
    if (rateCents !== null) {
      return {
        line: {
          rateCents,
          source: "pricing_schedule",
          sourceId: activeSchedule.schedule_id ?? null,
          provenance: "custom",
        },
        perService,
      };
    }
  }

  const lineRateCents = toCents(input.line.custom_rate);
  const lineProvenance = normalizeProvenance(
    input.line.rate_provenance,
    lineRateCents,
  );
  if (
    lineRateCents !== null &&
    (lineProvenance === "custom" || lineProvenance === "unreviewed")
  ) {
    return {
      line: {
        rateCents: lineRateCents,
        source: "line_override",
        sourceId: input.line.contract_line_id,
        provenance: lineProvenance,
      },
      perService,
    };
  }

  // inherited: derive the line total from its members.
  let derived = 0;
  let hasMemberRate = false;
  for (const service of input.planServices) {
    const member = perService.get(service.config_id);
    if (!member || member.rateCents === null) continue;
    derived += member.rateCents * quantityOf(service);
    hasMemberRate = true;
  }

  return {
    line: {
      rateCents: hasMemberRate ? Math.round(derived) : null,
      source: hasMemberRate ? "derived" : null,
      sourceId: null,
      provenance: "inherited",
    },
    perService,
  };
}

export interface ResolveClonedRateInput {
  explicitRate?: number | null;
  templateRate?: number | null;
  templateProvenance?: RateProvenance | null;
  templateBaseRate?: number | null;
}

export interface ResolvedClonedRate {
  rateCents: number | null;
  provenance: RateProvenance;
}

/**
 * Clone-time rate decision, expressed once for all three clone sites and the
 * wizard. A template rate is a snapshot *source*; the catalog stays the live
 * authority for `inherited` lines. See the doctrine at
 * `contractLineRepository.ts:315-317`.
 */
export function resolveClonedRate(
  input: ResolveClonedRateInput,
): ResolvedClonedRate {
  const explicit = toCents(input.explicitRate);
  if (explicit !== null) {
    return { rateCents: explicit, provenance: "custom" };
  }

  const templateRate = toCents(input.templateRate);
  const templateBaseRate = toCents(input.templateBaseRate);
  const snapshotRate = templateRate ?? templateBaseRate ?? null;
  const provenance = normalizeProvenance(
    input.templateProvenance,
    snapshotRate,
  );

  if (provenance === "inherited" || snapshotRate === null) {
    return { rateCents: null, provenance: "inherited" };
  }
  return { rateCents: snapshotRate, provenance };
}
