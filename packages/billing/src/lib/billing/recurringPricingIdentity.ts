import type {
  IBillingCharge,
  IExpectedRecurringPricingSource,
  IRecurringPricingSource,
} from '@alga-psa/types';

export type { IExpectedRecurringPricingSource } from '@alga-psa/types';

export function recurringPricingSourceKey(params: {
  clientContractLineId?: string | null;
  configId?: string | null;
  serviceId?: string | null;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
}): string {
  return [
    params.clientContractLineId ?? '',
    params.configId ?? '',
    params.serviceId ?? '',
    (params.servicePeriodStart ?? '').slice(0, 10),
    (params.servicePeriodEnd ?? '').slice(0, 10),
  ].join('|');
}

/**
 * Bind the recurring pricing provenance emitted by the billing engine onto the
 * obligation key the caller reviews. Only charges priced by a scheduled
 * revision carry provenance; untouched/legacy charges contribute nothing.
 */
export function bindRecurringPricingSources(
  charges: IBillingCharge[],
): IExpectedRecurringPricingSource[] {
  const bound: IExpectedRecurringPricingSource[] = [];
  for (const charge of charges) {
    const source = charge.recurringPricingSource;
    if (!source || !charge.serviceId) continue;
    bound.push({
      ...source,
      clientContractLineId: charge.client_contract_line_id ?? null,
      configId: charge.config_id ?? null,
      serviceId: charge.serviceId,
      servicePeriodStart: charge.servicePeriodStart ?? null,
      servicePeriodEnd: charge.servicePeriodEnd ?? null,
      quantity: Number(charge.quantity ?? 0),
    });
  }
  return bound;
}

export interface RecurringPricingStaleDetail {
  serviceId: string;
  reason: string;
}

function sameSource(
  expected: IRecurringPricingSource,
  current: IRecurringPricingSource,
): boolean {
  return (
    expected.revisionId === current.revisionId &&
    Number(expected.version) === Number(current.version) &&
    expected.pricePolicy === current.pricePolicy &&
    (expected.unitRateCents ?? null) === (current.unitRateCents ?? null) &&
    (expected.catalogPriceId ?? null) === (current.catalogPriceId ?? null) &&
    (expected.catalogEffectiveDate ?? null) === (current.catalogEffectiveDate ?? null)
  );
}

/**
 * Compare the reviewed recurring pricing sources with the freshly recomputed
 * charges. Returns the stale details (empty when generation may proceed).
 *
 * A source that disappeared (no longer billed), changed revision/version,
 * switched policy, or whose catalog price identity moved is stale. A new
 * recurring-priced charge that the operator never reviewed is also stale.
 */
export function findStaleRecurringPricingSources(params: {
  expected: IExpectedRecurringPricingSource[];
  current: IExpectedRecurringPricingSource[];
}): RecurringPricingStaleDetail[] {
  const { expected, current } = params;
  const currentByKey = new Map(
    current.map((source) => [recurringPricingSourceKey(source), source]),
  );
  const expectedByKey = new Map(
    expected.map((source) => [recurringPricingSourceKey(source), source]),
  );
  const stale: RecurringPricingStaleDetail[] = [];

  for (const reviewed of expected) {
    const key = recurringPricingSourceKey(reviewed);
    const live = currentByKey.get(key);
    if (!live) {
      stale.push({
        serviceId: reviewed.serviceId,
        reason: `the scheduled pricing for service ${reviewed.serviceId} (${reviewed.servicePeriodStart ?? '?'} to ${reviewed.servicePeriodEnd ?? '?'}) is no longer billed`,
      });
      continue;
    }
    if (!sameSource(reviewed, live)) {
      stale.push({
        serviceId: reviewed.serviceId,
        reason: `the scheduled revision or catalog price for service ${reviewed.serviceId} changed since preview`,
      });
      continue;
    }
    if (Number(reviewed.quantity) !== Number(live.quantity)) {
      stale.push({
        serviceId: reviewed.serviceId,
        reason: `the scheduled quantity for service ${reviewed.serviceId} changed since preview`,
      });
    }
  }

  for (const live of current) {
    if (expectedByKey.has(recurringPricingSourceKey(live))) continue;
    stale.push({
      serviceId: live.serviceId,
      reason: `a scheduled pricing change for service ${live.serviceId} (${live.servicePeriodStart ?? '?'} to ${live.servicePeriodEnd ?? '?'}) was not in the reviewed preview`,
    });
  }

  return stale;
}
