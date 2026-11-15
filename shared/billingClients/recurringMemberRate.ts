/**
 * Pure (no DB, no logger, no I/O) rate rules for recurring product members.
 *
 * This is the single place that says what a recurring product member — and a
 * line made of them — is worth per period. The invoice engine
 * (`computeRecurringQuantityCharges`), the stored-contract valuation
 * (`contractMonthlyValue`) and the contract wizard's review total all call
 * these functions so they cannot disagree.
 *
 * It deliberately has no imports so the client-side wizard can use it.
 */

type NumericLike = number | string | null | undefined;

export type RecurringMemberRateSource =
  | 'configuration override'
  | 'service override'
  | 'currency catalog price';

export interface RecurringMemberRateInput {
  /** `contract_line_service_configuration.custom_rate` (minor units). */
  configuration_custom_rate?: NumericLike;
  /** `contract_line_services.custom_rate` (minor units). */
  service_line_custom_rate?: NumericLike;
  /** Catalog price in the CONTRACT's currency (`service_prices.rate`), never the tenant default. */
  price_rate?: NumericLike;
  /** Legacy currency-untagged `service_catalog.default_rate`. */
  default_rate?: NumericLike;
}

export interface ResolvedRecurringMemberRate {
  rateCents: number;
  source: RecurringMemberRateSource;
}

/**
 * The engine's legacy recurring-member chain:
 * `configuration custom_rate ?? service_line custom_rate ?? currency catalog
 * price ?? default_rate ?? 0`, rounded to whole minor units. `source` carries
 * the provenance label the engine shows in its explanation.
 */
export function resolveRecurringMemberRate(member: RecurringMemberRateInput): ResolvedRecurringMemberRate {
  const rateCandidate =
    member.configuration_custom_rate ??
    member.service_line_custom_rate ??
    member.price_rate ??
    member.default_rate ??
    0;
  return {
    rateCents: Math.round(Number(rateCandidate) || 0),
    source:
      member.configuration_custom_rate != null
        ? 'configuration override'
        : member.service_line_custom_rate != null
          ? 'service override'
          : 'currency catalog price',
  };
}

/** True when the member has any rate source at all (an explicit 0 is a rate). */
export function hasRecurringMemberRate(member: RecurringMemberRateInput): boolean {
  return (
    member.configuration_custom_rate != null ||
    member.service_line_custom_rate != null ||
    member.price_rate != null ||
    member.default_rate != null
  );
}

export interface FixedLineMemberInput extends RecurringMemberRateInput {
  /** `service_catalog.item_kind`. */
  item_kind?: string | null;
  quantity?: NumericLike;
}

export interface FixedLineInput {
  /** `contract_lines.custom_rate` (minor units) — null/absent means no line override. */
  custom_rate?: NumericLike;
  billing_frequency?: string | null;
  members: ReadonlyArray<FixedLineMemberInput>;
}

const isProductMember = (member: FixedLineMemberInput): boolean => member.item_kind === 'product';

/**
 * A zero is not a price. A line `custom_rate` is a real override only when it
 * is non-null AND (non-zero OR the line has no priced product members). The
 * wizard historically wrote `0.00` as a placeholder; a free product is
 * expressed by its catalog price being 0, never by the line rate.
 *
 * Only product members count as "priced" so non-product fixed/bundle lines
 * keep their existing semantics exactly.
 */
export function resolveEffectiveLineRate(
  lineCustomRate: NumericLike,
  members: ReadonlyArray<FixedLineMemberInput>,
): number | null {
  if (lineCustomRate === null || lineCustomRate === undefined || lineCustomRate === '') return null;
  const parsed = typeof lineCustomRate === 'string' ? parseFloat(lineCustomRate) : Number(lineCustomRate);
  if (!Number.isFinite(parsed)) return null;
  if (parsed === 0 && members.some((member) => isProductMember(member) && hasRecurringMemberRate(member))) {
    return null;
  }
  return parsed;
}

/**
 * Σ quantity × resolved rate over the PRODUCT members, in minor units of one
 * billing period. Quantity follows the engine's legacy path
 * (`max(1, round(qty))`, default 1).
 */
export function productMembersRecurringTotalCents(members: ReadonlyArray<FixedLineMemberInput>): number {
  return members.filter(isProductMember).reduce((sum, member) => {
    const quantity = Math.max(1, Math.round(Number(member.quantity ?? 1) || 1));
    return sum + quantity * resolveRecurringMemberRate(member).rateCents;
  }, 0);
}

export type CanonicalRecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually';

/**
 * Canonical cadence name. The one place stored cadence spellings are read:
 * `semi_annually` folds into `semi-annually`, and null and unknown cadences are
 * monthly (the storage default). {@link normalizeToMonthlyCents} and
 * {@link summarizeRecurringAmounts} both key off this.
 */
export function canonicalRecurringFrequency(
  billingFrequency: string | null | undefined,
): CanonicalRecurringFrequency {
  switch (billingFrequency) {
    case 'weekly':
      return 'weekly';
    case 'quarterly':
      return 'quarterly';
    case 'semi-annually':
    case 'semi_annually':
      return 'semi-annually';
    case 'annually':
      return 'annually';
    default:
      return 'monthly';
  }
}

/**
 * Cadence normalization used by every recurring-value read path (monthly
 * cents). Lives here so client and server code share one implementation.
 */
export function normalizeToMonthlyCents(amountCents: number, billingFrequency: string | null | undefined): number {
  switch (canonicalRecurringFrequency(billingFrequency)) {
    case 'weekly':
      return Math.round(amountCents * 4.33);
    case 'quarterly':
      return Math.round(amountCents / 3);
    case 'semi-annually':
      return Math.round(amountCents / 6);
    case 'annually':
      return Math.round(amountCents / 12);
    case 'monthly':
      return Math.round(amountCents);
  }
}

/**
 * Un-normalized recurring amount of ONE billing period of a Fixed line that
 * holds product members: the effective line override when there is a real one,
 * else Σ quantity × resolved member rate. This is what a line header next to
 * its own billing frequency should print.
 *
 * Returns `null` when the line has no product members.
 */
export function resolveFixedLinePeriodTotal(line: FixedLineInput): number | null {
  const products = line.members.filter(isProductMember);
  if (products.length === 0) return null;
  return resolveEffectiveLineRate(line.custom_rate, products) ?? productMembersRecurringTotalCents(products);
}

/**
 * Monthly-normalized recurring value of a Fixed line that holds product
 * members (see {@link resolveFixedLinePeriodTotal}). The line's own
 * `billing_frequency` wins over `frequency` (the contract default).
 *
 * Returns `null` when the line has no product members — fixed, unit and bundle
 * members of non-product lines keep their existing valuation in the caller.
 */
export function resolveFixedLineRecurringTotal(
  line: FixedLineInput,
  frequency?: string | null,
): number | null {
  const amount = resolveFixedLinePeriodTotal(line);
  if (amount === null) return null;
  return normalizeToMonthlyCents(amount, line.billing_frequency ?? frequency);
}

export interface RecurringPeriodAmount {
  /** Amount for one billing period, in minor units. */
  periodCents: number;
  /** The cadence that amount is billed on. */
  frequency: string | null | undefined;
}

export interface RecurringFrequencyGroup {
  /** Canonical cadence as stored ('monthly' | 'annually' | …). */
  frequency: CanonicalRecurringFrequency;
  /** Sum of the group's per-period amounts. */
  periodCents: number;
  /** Σ normalizeToMonthlyCents(entry) over the group's entries (per-entry, not per-group). */
  monthlyCents: number;
}

export interface RecurringSummary {
  /** Largest monthlyCents first; ties keep first-seen order. */
  groups: RecurringFrequencyGroup[];
  /** Σ group.periodCents when every group shares one frequency; else null. */
  singleFrequencyPeriodCents: number | null;
  singleFrequency: CanonicalRecurringFrequency | null;
  /** Σ group.monthlyCents — the comparable figure the stored value keeps using. */
  monthlyCents: number;
}

/**
 * Groups per-period recurring amounts by cadence, keeping the cadence the
 * contract actually bills on. `monthlyCents` is normalized per ENTRY and then
 * summed — exactly the "normalize each line, sum" rule the wizard total, the
 * stored value and the invoice engine already use — so weekly rounding cannot
 * drift between surfaces. A null/unknown cadence counts as monthly.
 */
export function summarizeRecurringAmounts(amounts: ReadonlyArray<RecurringPeriodAmount>): RecurringSummary {
  const byFrequency = new Map<CanonicalRecurringFrequency, RecurringFrequencyGroup>();
  for (const amount of amounts) {
    const frequency = canonicalRecurringFrequency(amount.frequency);
    const group = byFrequency.get(frequency) ?? { frequency, periodCents: 0, monthlyCents: 0 };
    group.periodCents += amount.periodCents;
    group.monthlyCents += normalizeToMonthlyCents(amount.periodCents, frequency);
    byFrequency.set(frequency, group);
  }
  const groups = [...byFrequency.values()]
    .filter((group) => group.periodCents !== 0)
    .sort((a, b) => b.monthlyCents - a.monthlyCents);
  const single = groups.length > 0 && groups.every((group) => group.frequency === groups[0].frequency);
  return {
    groups,
    singleFrequency: single ? groups[0].frequency : null,
    singleFrequencyPeriodCents: single ? groups.reduce((sum, group) => sum + group.periodCents, 0) : null,
    monthlyCents: groups.reduce((sum, group) => sum + group.monthlyCents, 0),
  };
}
