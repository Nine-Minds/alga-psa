/**
 * Assisted reclassification for legacy `unreviewed` rates (plan §1.4).
 *
 * A legacy line stores a number that may or may not be the catalog price. The
 * only answerable question is "is this line priced exactly at the catalog price
 * today?" — so we re-run the resolver with the stored line rate treated as NULL
 * and compare:
 *
 *   - exact match  -> propose `inherited` (provably a no-op on the next invoice)
 *   - differs      -> propose `custom`    (pure relabel; the rate is untouched)
 *   - cannot tell  -> skip with a reason, leaving the row `unreviewed`
 *
 * This module is pure so preview, apply and the UI share one answer.
 */

import {
  resolveFixedLineRate,
  type ResolveFixedLineRateInput,
  type ResolvedRate,
} from "./resolveFixedLineRate";

export type LineRateClassification = "inherited" | "custom" | "skip";

export type LineRateSkipReason =
  | "no_catalog_price"
  | "no_member_catalog_rate"
  | "contract_inactive"
  | "already_inherited"
  | "already_custom";

export interface LineRateClassificationResult {
  classification: LineRateClassification;
  skipReason: LineRateSkipReason | null;
  reason: string | null;
  storedRateCents: number | null;
  /** What the resolver returns when the stored line rate is treated as NULL. */
  resolvedRateCents: number | null;
  provenance: ResolvedRate["provenance"];
  source: ResolvedRate["source"];
}

export interface ClassifyLineRateInput {
  resolver: ResolveFixedLineRateInput;
  /** Stored `contract_lines.custom_rate` in minor units. */
  storedRateCents: number | null;
  /** Current label, so apply can refuse a row that moved on. */
  currentProvenance: string | null;
  /** Contract + client-contract lifecycle state. */
  contractIsActive: boolean;
  contractHasEnded: boolean;
  /** Services on the line; used for the currency skip rule. */
  serviceIds: string[];
}

function toCents(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

export function classifyLineRateProvenance(
  input: ClassifyLineRateInput,
): LineRateClassificationResult {
  const storedRateCents = input.storedRateCents;
  const base = {
    storedRateCents,
    resolvedRateCents: null as number | null,
    provenance: "inherited" as ResolvedRate["provenance"],
    source: null as ResolvedRate["source"],
  };

  if (input.currentProvenance === "inherited") {
    return {
      ...base,
      classification: "skip",
      skipReason: "already_inherited",
      reason: "Line already follows the catalog.",
    };
  }
  if (input.currentProvenance === "custom") {
    return {
      ...base,
      classification: "skip",
      skipReason: "already_custom",
      reason: "Line is already marked custom.",
    };
  }

  if (!input.contractIsActive || input.contractHasEnded) {
    return {
      ...base,
      classification: "skip",
      skipReason: "contract_inactive",
      reason: "Contract is inactive or has ended.",
    };
  }

  const currency = input.resolver.currency;
  const hasCurrencyPrice = input.resolver.catalogPrices.some(
    (price) =>
      price.currency_code === currency &&
      input.serviceIds.includes(price.service_id),
  );
  if (!hasCurrencyPrice) {
    return {
      ...base,
      classification: "skip",
      skipReason: "no_catalog_price",
      reason: `No catalog price in ${currency} for this service.`,
    };
  }

  // Treat the stored line rate as NULL: does the line still resolve to the same
  // number? `inherited` + a null rate is exactly the state we would write.
  const asInherited = resolveFixedLineRate({
    ...input.resolver,
    line: {
      ...input.resolver.line,
      custom_rate: null,
      rate_provenance: "inherited",
    },
  });

  const resolvedRateCents = asInherited.line.rateCents;
  if (resolvedRateCents === null) {
    return {
      ...base,
      classification: "skip",
      skipReason: "no_member_catalog_rate",
      reason: "The line's services resolve to no catalog rate.",
      provenance: asInherited.line.provenance,
      source: asInherited.line.source,
    };
  }

  if (storedRateCents !== null && resolvedRateCents === storedRateCents) {
    return {
      classification: "inherited",
      skipReason: null,
      reason: "Priced at the catalog rate; safe to follow it.",
      storedRateCents,
      resolvedRateCents,
      provenance: asInherited.line.provenance,
      source: asInherited.line.source,
    };
  }

  return {
    classification: "custom",
    skipReason: null,
    reason: "Differs from the catalog rate; keep it as a negotiated price.",
    storedRateCents,
    resolvedRateCents,
    provenance: "custom",
    source: asInherited.line.source,
  };
}

/**
 * Next calendar-month boundary relative to a reference date, used when the
 * caller does not supply the service period being reviewed.
 */
export function nextBillingPeriodBoundary(referenceDate: Date): {
  start: string;
  end: string;
} {
  const start = new Date(
    Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), 1),
  );
  const end = new Date(
    Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1, 1),
  );
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export { toCents };
