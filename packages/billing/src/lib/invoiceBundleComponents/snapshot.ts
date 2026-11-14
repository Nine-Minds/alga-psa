import {
  INVOICE_BUNDLE_PRESENTATION_VERSION,
  type InvoiceBundleComponentSnapshot,
  type InvoiceBundlePresentation,
} from '@alga-psa/types';

/**
 * Pure snapshot construction for one consolidated Fixed bundle. No I/O: the
 * persistence layer feeds it the bundle's detail rows and the previous
 * billed period (see `previousPeriod.ts`), so the rules are unit-testable.
 */

export interface BundleSnapshotDetailInput {
  detailItemId: string;
  serviceId: string;
  serviceName: string;
  /** Raw configured/revision quantity (before the `|| 1` clamp); null when unset. */
  rawQuantity: number | null;
  pricingBasis: 'unit' | 'bundle';
  /** `contract_line_service_configuration.created_at`, for deterministic ordering. */
  configCreatedAt: string | Date | null;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
}

/** Quantities billed in the same line's latest prior period, summed per service. */
export interface BundlePreviousPeriod {
  quantitiesByServiceId: Map<string, number | null>;
  serviceNames: Map<string, string>;
}

const toMs = (value: string | Date | null | undefined): number => {
  if (!value) return Number.POSITIVE_INFINITY;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
};

const periodKey = (start: string | null, end: string | null) => `${start ?? ''}|${end ?? ''}`;

const sumNullable = (values: Array<number | null>): number | null =>
  values.some((value) => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);

export function buildBundleSnapshot(input: {
  subtitle: string | null;
  details: BundleSnapshotDetailInput[];
  /** null when the line has no prior billed period. */
  previousPeriod: BundlePreviousPeriod | null;
}): InvoiceBundlePresentation {
  const { details, previousPeriod } = input;

  // Deterministic service order: configuration creation, then name, then id.
  const serviceOrder = new Map<string, number>();
  [...details]
    .sort((a, b) =>
      toMs(a.configCreatedAt) - toMs(b.configCreatedAt)
      || a.serviceName.localeCompare(b.serviceName)
      || a.serviceId.localeCompare(b.serviceId))
    .forEach((detail) => {
      if (!serviceOrder.has(detail.serviceId)) serviceOrder.set(detail.serviceId, serviceOrder.size);
    });

  // One component per service per covered period (details of the same service
  // in the same period, e.g. a service listed twice, merge).
  const periods: Array<{ key: string; start: string | null; end: string | null }> = [];
  for (const detail of details) {
    const key = periodKey(detail.servicePeriodStart, detail.servicePeriodEnd);
    if (!periods.some((period) => period.key === key)) {
      periods.push({ key, start: detail.servicePeriodStart, end: detail.servicePeriodEnd });
    }
  }
  periods.sort((a, b) => toMs(a.start) - toMs(b.start) || toMs(a.end) - toMs(b.end));

  type Group = { serviceId: string; name: string; basis: 'unit' | 'bundle'; periodIndex: number; ids: string[]; quantities: Array<number | null> };
  const groups = new Map<string, Group>();
  for (const detail of details) {
    const periodIndex = periods.findIndex((period) => period.key === periodKey(detail.servicePeriodStart, detail.servicePeriodEnd));
    const key = `${periodIndex}|${detail.serviceId}`;
    const group = groups.get(key) ?? {
      serviceId: detail.serviceId,
      name: detail.serviceName,
      basis: detail.pricingBasis,
      periodIndex,
      ids: [],
      quantities: [],
    };
    group.ids.push(detail.detailItemId);
    group.quantities.push(detail.rawQuantity);
    groups.set(key, group);
  }

  const currentQuantity = (periodIndex: number, serviceId: string): number | null | undefined => {
    const group = groups.get(`${periodIndex}|${serviceId}`);
    return group ? sumNullable(group.quantities) : undefined;
  };

  const components: InvoiceBundleComponentSnapshot[] = [];
  for (const group of groups.values()) {
    let previousQuantity: number | null = null;
    let comparison: InvoiceBundleComponentSnapshot['comparison'] = 'no_prior_period';
    if (group.periodIndex > 0) {
      // Catch-up billing: compare with the immediately preceding covered period.
      const earlier = currentQuantity(group.periodIndex - 1, group.serviceId);
      previousQuantity = earlier === undefined ? 0 : earlier;
      comparison = 'compared';
    } else if (previousPeriod) {
      comparison = 'compared';
      previousQuantity = previousPeriod.quantitiesByServiceId.has(group.serviceId)
        ? previousPeriod.quantitiesByServiceId.get(group.serviceId) ?? null
        : 0;
    }
    const period = periods[group.periodIndex];
    components.push({
      serviceId: group.serviceId,
      name: group.name,
      quantity: sumNullable(group.quantities),
      pricingBasis: group.basis,
      order: serviceOrder.get(group.serviceId) ?? 0,
      servicePeriodStart: period?.start ?? null,
      servicePeriodEnd: period?.end ?? null,
      detailItemIds: group.ids,
      previousQuantity,
      comparison,
    });
  }

  // Services billed in the prior period but absent now: quantity 0 with their negative change.
  if (previousPeriod) {
    const currentServiceIds = new Set(details.map((detail) => detail.serviceId));
    const removed = [...previousPeriod.quantitiesByServiceId.entries()]
      .filter(([serviceId]) => !currentServiceIds.has(serviceId))
      .map(([serviceId, quantity]) => ({ serviceId, quantity, name: previousPeriod.serviceNames.get(serviceId) ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.serviceId.localeCompare(b.serviceId));
    removed.forEach((entry, index) => {
      components.push({
        serviceId: entry.serviceId,
        name: entry.name,
        quantity: 0,
        pricingBasis: 'bundle',
        order: serviceOrder.size + index,
        servicePeriodStart: periods[0]?.start ?? null,
        servicePeriodEnd: periods[0]?.end ?? null,
        detailItemIds: [],
        previousQuantity: entry.quantity,
        comparison: 'compared',
      });
    });
  }

  components.sort((a, b) => a.order - b.order || toMs(a.servicePeriodStart) - toMs(b.servicePeriodStart));

  return {
    version: INVOICE_BUNDLE_PRESENTATION_VERSION,
    subtitle: input.subtitle && input.subtitle.trim() ? input.subtitle.trim() : null,
    components,
  };
}
