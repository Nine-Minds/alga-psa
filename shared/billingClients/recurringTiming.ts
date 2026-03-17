/**
 * Canonical recurring timing architecture
 *
 * Recurring billing now treats cadence ownership as the source of truth:
 * - cadence owner chooses the service-period boundaries
 * - service periods are the recurring obligation that runtime logic settles
 * - invoice windows group due service periods, but do not redefine them
 * - invoice detail rows persist the canonical service-period metadata used at runtime
 *
 * Rollout default:
 * - existing rows continue to resolve to `client` cadence unless they explicitly opt into a later mode
 * - client billing schedule previews are therefore invoice-window previews for client-cadence lines, not universal recurring truth
 */
import { Temporal } from '@js-temporal/polyfill';
import type {
  CadenceOwner,
  DuePosition,
  ICadenceBoundaryGenerator,
  IRecurringInvoiceCandidateGroup,
  IRecurringActivityWindow,
  IRecurringCoverage,
  IRecurringDateRange,
  IRecurringDuePeriodSelection,
  IRecurringInvoiceDetailTiming,
  IRecurringInvoiceWindow,
  IResolvedRecurringSettlement,
  RecurringInvoiceSplitReason,
  IRecurringScopedDuePeriodSelection,
  IRecurringScopedInvoiceCandidateGroup,
  IRecurringServicePeriod,
} from '@alga-psa/types';
import { RECURRING_RANGE_SEMANTICS } from '@alga-psa/types';

export const DEFAULT_CADENCE_OWNER: CadenceOwner = 'client';

const toPlainDate = (value: string) => Temporal.PlainDate.from(value.slice(0, 10));

export function assertHalfOpenDateRange(range: Pick<IRecurringDateRange, 'start' | 'end'>): void {
  if (Temporal.PlainDate.compare(toPlainDate(range.end), toPlainDate(range.start)) <= 0) {
    throw new Error('Recurring timing ranges must use [start, end) semantics with end after start.');
  }
}

export function resolveCadenceOwner(owner?: CadenceOwner | null): CadenceOwner {
  return owner ?? DEFAULT_CADENCE_OWNER;
}

export function selectCadenceBoundaryGenerator(
  generators: Record<CadenceOwner, ICadenceBoundaryGenerator>,
  owner?: CadenceOwner | null
): ICadenceBoundaryGenerator {
  return generators[resolveCadenceOwner(owner)];
}

export function intersectActivityWindow(
  servicePeriod: IRecurringServicePeriod,
  activityWindow: IRecurringActivityWindow
): IRecurringServicePeriod | null {
  assertHalfOpenDateRange(servicePeriod);

  const nextStart = activityWindow.start && activityWindow.start > servicePeriod.start ? activityWindow.start : servicePeriod.start;
  const nextEnd = activityWindow.end && activityWindow.end < servicePeriod.end ? activityWindow.end : servicePeriod.end;

  if (Temporal.PlainDate.compare(toPlainDate(nextEnd), toPlainDate(nextStart)) <= 0) {
    return null;
  }

  return {
    ...servicePeriod,
    start: nextStart,
    end: nextEnd,
  };
}

export function calculateServicePeriodCoverage(
  servicePeriod: IRecurringServicePeriod,
  coveredPeriod: Pick<IRecurringDateRange, 'start' | 'end'>
): IRecurringCoverage {
  assertHalfOpenDateRange(servicePeriod);
  assertHalfOpenDateRange(coveredPeriod);

  const totalDays = toPlainDate(servicePeriod.end).since(toPlainDate(servicePeriod.start)).days;
  const coveredDays = toPlainDate(coveredPeriod.end).since(toPlainDate(coveredPeriod.start)).days;

  if (coveredDays > totalDays) {
    throw new Error('Covered period cannot exceed its parent service period.');
  }

  return {
    coveredPeriod: {
      start: coveredPeriod.start,
      end: coveredPeriod.end,
      semantics: RECURRING_RANGE_SEMANTICS,
    },
    coveredDays,
    totalDays,
    coverageRatio: coveredDays / totalDays,
  };
}

export function mapServicePeriodToInvoiceWindow(
  servicePeriod: IRecurringServicePeriod,
  options: {
    duePosition: DuePosition;
    currentInvoiceWindow: IRecurringInvoiceWindow;
    nextInvoiceWindow?: IRecurringInvoiceWindow;
  }
): { servicePeriod: IRecurringServicePeriod; invoiceWindow: IRecurringInvoiceWindow } {
  return {
    servicePeriod,
    invoiceWindow: options.duePosition === 'arrears'
      ? (options.nextInvoiceWindow ?? options.currentInvoiceWindow)
      : options.currentInvoiceWindow,
  };
}

function rangesOverlap(
  left: Pick<IRecurringDateRange, 'start' | 'end'>,
  right: Pick<IRecurringDateRange, 'start' | 'end'>,
): boolean {
  return (
    Temporal.PlainDate.compare(toPlainDate(left.start), toPlainDate(right.end)) < 0 &&
    Temporal.PlainDate.compare(toPlainDate(right.start), toPlainDate(left.end)) < 0
  );
}

export function selectDueServicePeriodsForInvoiceWindow(
  servicePeriods: IRecurringServicePeriod[],
  options: {
    duePosition: DuePosition;
    invoiceWindow: IRecurringInvoiceWindow;
  },
): IRecurringDuePeriodSelection[] {
  return servicePeriods
    .filter((servicePeriod) => servicePeriod.duePosition === options.duePosition)
    .filter((servicePeriod) => {
      if (options.duePosition === 'advance') {
        return rangesOverlap(servicePeriod, options.invoiceWindow);
      }

      return Temporal.PlainDate.compare(
        toPlainDate(servicePeriod.end),
        toPlainDate(options.invoiceWindow.start),
      ) === 0;
    })
    .map((servicePeriod) => ({
      servicePeriod,
      invoiceWindow: options.invoiceWindow,
    }));
}

export function resolveRecurringSettlementsForInvoiceWindow(input: {
  servicePeriods: IRecurringServicePeriod[];
  invoiceWindow: IRecurringInvoiceWindow;
  activityWindow: IRecurringActivityWindow;
  duePosition: DuePosition;
}): IResolvedRecurringSettlement[] {
  return selectDueServicePeriodsForInvoiceWindow(input.servicePeriods, {
    duePosition: input.duePosition,
    invoiceWindow: input.invoiceWindow,
  }).flatMap(({ servicePeriod, invoiceWindow }) => {
    const coveredServicePeriod = intersectActivityWindow(servicePeriod, input.activityWindow);
    if (!coveredServicePeriod) {
      return [];
    }

    const coverage = calculateServicePeriodCoverage(servicePeriod, coveredServicePeriod);
    if (coverage.coveredDays <= 0) {
      return [];
    }

    return [
      {
        servicePeriod,
        coveredServicePeriod,
        invoiceWindow,
        coverage,
      },
    ];
  });
}

export function groupDueServicePeriodsByInvoiceWindow(
  dueSelections: IRecurringDuePeriodSelection[],
): IRecurringInvoiceCandidateGroup[] {
  const grouped = new Map<string, IRecurringInvoiceCandidateGroup>();

  for (const selection of dueSelections) {
    const key = `${selection.invoiceWindow.start}:${selection.invoiceWindow.end}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.dueSelections.push(selection);
      if (!existing.cadenceOwners.includes(selection.servicePeriod.cadenceOwner)) {
        existing.cadenceOwners.push(selection.servicePeriod.cadenceOwner);
        existing.cadenceOwners.sort();
      }
      continue;
    }

    grouped.set(key, {
      groupKey: key,
      windowStart: selection.invoiceWindow.start,
      windowEnd: selection.invoiceWindow.end,
      semantics: selection.invoiceWindow.semantics,
      cadenceOwners: [selection.servicePeriod.cadenceOwner],
      dueSelections: [selection],
    });
  }

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      dueSelections: group.dueSelections.sort((left, right) => {
        if (left.servicePeriod.start !== right.servicePeriod.start) {
          return left.servicePeriod.start.localeCompare(right.servicePeriod.start);
        }

        return left.servicePeriod.sourceObligation.obligationId.localeCompare(
          right.servicePeriod.sourceObligation.obligationId,
        );
      }),
    }))
    .sort((left, right) => {
      if (left.windowStart !== right.windowStart) {
        return left.windowStart.localeCompare(right.windowStart);
      }

      return left.windowEnd.localeCompare(right.windowEnd);
    });
}

export function groupDueServicePeriodsByInvoiceWindowAndContract(
  dueSelections: IRecurringScopedDuePeriodSelection[],
): IRecurringScopedInvoiceCandidateGroup[] {
  return groupDueServicePeriodsForInvoiceCandidates(dueSelections);
}

export function groupDueServicePeriodsForInvoiceCandidates(
  dueSelections: IRecurringScopedDuePeriodSelection[],
): IRecurringScopedInvoiceCandidateGroup[] {
  const grouped = new Map<string, IRecurringScopedInvoiceCandidateGroup>();
  const windowScopeSummary = new Map<
    string,
    {
      contractIds: Set<string>;
      purchaseOrderScopeKeys: Set<string>;
      financialScopeKeys: Set<string>;
    }
  >();

  for (const selection of dueSelections) {
    const contractScope = selection.clientContractId ?? '__no_contract_scope__';
    const purchaseOrderScope = selection.purchaseOrderScopeKey ?? '__no_po_scope__';
    const financialScope = [
      selection.currencyCode ?? '__no_currency__',
      selection.taxSource ?? '__no_tax_source__',
      selection.exportShapeKey ?? '__no_export_shape__',
    ].join(':');
    const windowKey = `${selection.invoiceWindow.start}:${selection.invoiceWindow.end}`;
    const key = `${windowKey}:${contractScope}:${purchaseOrderScope}:${financialScope}`;
    const existing = grouped.get(key);
    const windowSummary = windowScopeSummary.get(windowKey) ?? {
      contractIds: new Set<string>(),
      purchaseOrderScopeKeys: new Set<string>(),
      financialScopeKeys: new Set<string>(),
    };
    windowSummary.contractIds.add(contractScope);
    windowSummary.purchaseOrderScopeKeys.add(purchaseOrderScope);
    windowSummary.financialScopeKeys.add(financialScope);
    windowScopeSummary.set(windowKey, windowSummary);

    if (existing) {
      existing.dueSelections.push(selection);
      if (!existing.cadenceOwners.includes(selection.servicePeriod.cadenceOwner)) {
        existing.cadenceOwners.push(selection.servicePeriod.cadenceOwner);
        existing.cadenceOwners.sort();
      }
      continue;
    }

    grouped.set(key, {
      groupKey: key,
      windowStart: selection.invoiceWindow.start,
      windowEnd: selection.invoiceWindow.end,
      semantics: selection.invoiceWindow.semantics,
      cadenceOwners: [selection.servicePeriod.cadenceOwner],
      clientContractId: selection.clientContractId ?? null,
      purchaseOrderScopeKey: selection.purchaseOrderScopeKey ?? null,
      currencyCode: selection.currencyCode ?? null,
      taxSource: selection.taxSource ?? null,
      exportShapeKey: selection.exportShapeKey ?? null,
      splitReasons: [],
      dueSelections: [selection],
    });
  }

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      dueSelections: group.dueSelections.sort((left, right) => {
        if (left.servicePeriod.start !== right.servicePeriod.start) {
          return left.servicePeriod.start.localeCompare(right.servicePeriod.start);
        }

        return left.servicePeriod.sourceObligation.obligationId.localeCompare(
          right.servicePeriod.sourceObligation.obligationId,
        );
      }),
      splitReasons: (() => {
        const windowSummary = windowScopeSummary.get(
          `${group.windowStart}:${group.windowEnd}`,
        );
        const splitReasons: RecurringInvoiceSplitReason[] = [];

        if ((windowSummary?.contractIds.size ?? 0) > 1) {
          splitReasons.push('single_contract');
        }
        if ((windowSummary?.purchaseOrderScopeKeys.size ?? 0) > 1) {
          splitReasons.push('purchase_order_scope');
        }
        if ((windowSummary?.financialScopeKeys.size ?? 0) > 1) {
          splitReasons.push('financial_constraint');
        }

        return splitReasons;
      })(),
    }))
    .sort((left, right) => {
      if (left.windowStart !== right.windowStart) {
        return left.windowStart.localeCompare(right.windowStart);
      }
      if ((left.clientContractId ?? '') !== (right.clientContractId ?? '')) {
        return (left.clientContractId ?? '').localeCompare(right.clientContractId ?? '');
      }
      if ((left.purchaseOrderScopeKey ?? '') !== (right.purchaseOrderScopeKey ?? '')) {
        return (left.purchaseOrderScopeKey ?? '').localeCompare(right.purchaseOrderScopeKey ?? '');
      }
      return left.windowEnd.localeCompare(right.windowEnd);
    });
}

export function buildRecurringInvoiceDetailTiming(input: {
  servicePeriod: IRecurringServicePeriod;
  invoiceWindow: IRecurringInvoiceWindow;
}): IRecurringInvoiceDetailTiming {
  return {
    cadenceOwner: input.servicePeriod.cadenceOwner,
    duePosition: input.servicePeriod.duePosition,
    sourceObligation: input.servicePeriod.sourceObligation,
    servicePeriodStart: input.servicePeriod.start,
    servicePeriodEnd: input.servicePeriod.end,
    invoiceWindowStart: input.invoiceWindow.start,
    invoiceWindowEnd: input.invoiceWindow.end,
  };
}
