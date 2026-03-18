import { describe, expect, it } from 'vitest';
import type {
  CadenceOwner,
  ICadenceBoundaryGenerator,
  IRecurringObligationRef,
} from '@alga-psa/types';
import {
  buildRecurringInvoiceDetailTiming,
  calculateServicePeriodCoverage,
  groupDueServicePeriodsForInvoiceCandidates,
  groupDueServicePeriodsByInvoiceWindowAndContract,
  groupDueServicePeriodsByInvoiceWindow,
  intersectActivityWindow,
  mapServicePeriodToInvoiceWindow,
  resolveRecurringSettlementsForInvoiceWindow,
  selectDueServicePeriodsForInvoiceWindow,
} from '@alga-psa/shared/billingClients/recurringTiming';
import {
  DEFAULT_CADENCE_OWNER as billingDefaultCadenceOwner,
  resolveCadenceOwner,
  selectCadenceBoundaryGenerator,
} from '@alga-psa/billing/lib/billing/recurringTiming';
import { DEFAULT_CADENCE_OWNER as sharedDefaultCadenceOwner } from '@alga-psa/shared/billingClients/recurringTiming';
import { RECURRING_RANGE_SEMANTICS } from '@alga-psa/types';
import {
  buildClientBillingCycleExecutionWindow as buildClientExecutionWindow,
  buildContractCadenceExecutionWindow as buildContractExecutionWindow,
  listRecurringRunExecutionWindowKinds as listExecutionWindowKinds,
} from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import {
  buildMonthlyRecurringFixture,
  buildMonthlyServicePeriods,
  buildRecurringInvoiceWindow as buildInvoiceWindow,
  buildRecurringObligationRef,
  buildRecurringServicePeriod as buildServicePeriod,
} from '../../test-utils/recurringTimingFixtures';

const sourceObligation: IRecurringObligationRef = buildRecurringObligationRef();

describe('recurring timing shared domain', () => {
  it('T011: canonical service-period types preserve cadence owner, source obligation, and explicit boundaries', () => {
    const period = buildServicePeriod({
      cadenceOwner: 'contract',
      duePosition: 'arrears',
      timingMetadata: { reason: 'test' },
    });

    expect(period.kind).toBe('service_period');
    expect(period.cadenceOwner).toBe('contract');
    expect(period.sourceObligation.obligationId).toBe('line-1');
    expect(period.start).toBe('2025-01-01');
    expect(period.end).toBe('2025-01-11');
  });

  it('T012: canonical invoice windows remain distinct from service periods', () => {
    const period = buildServicePeriod();
    const window = buildInvoiceWindow();

    expect(period.kind).toBe('service_period');
    expect(window.kind).toBe('invoice_window');
    expect(window.windowId).toBe('window-1');
    expect('windowId' in period).toBe(false);
  });

  it('T013: cadence-owner defaults stay explicit and serializable across shared and billing surfaces', () => {
    const serialized = JSON.stringify({
      fromShared: sharedDefaultCadenceOwner,
      fromBilling: billingDefaultCadenceOwner,
      resolved: resolveCadenceOwner(undefined),
    });

    expect(sharedDefaultCadenceOwner).toBe('client');
    expect(billingDefaultCadenceOwner).toBe('client');
    expect(serialized).toContain('"fromShared":"client"');
    expect(serialized).toContain('"fromBilling":"client"');
    expect(serialized).toContain('"resolved":"client"');
  });

  it('T014: cadence-boundary generator selection supports pluggable client and contract strategies with the same output contract', () => {
    const makeGenerator = (owner: CadenceOwner): ICadenceBoundaryGenerator => ({
      owner,
      generate: ({ rangeStart, rangeEnd, sourceObligation, duePosition }) => [
        buildServicePeriod({
          cadenceOwner: owner,
          duePosition,
          sourceObligation,
          start: rangeStart,
          end: rangeEnd,
        }),
      ],
    });

    const clientGenerator = makeGenerator('client');
    const contractGenerator = makeGenerator('contract');

    const clientResult = selectCadenceBoundaryGenerator(
      { client: clientGenerator, contract: contractGenerator },
      'client',
    ).generate({
      cadenceOwner: 'client',
      duePosition: 'advance',
      rangeStart: '2025-01-01',
      rangeEnd: '2025-02-01',
      sourceObligation,
    });

    const contractResult = selectCadenceBoundaryGenerator(
      { client: clientGenerator, contract: contractGenerator },
      'contract',
    ).generate({
      cadenceOwner: 'contract',
      duePosition: 'advance',
      rangeStart: '2025-02-01',
      rangeEnd: '2025-03-01',
      sourceObligation,
    });

    expect(clientResult[0].kind).toBe('service_period');
    expect(contractResult[0].kind).toBe('service_period');
    expect(clientResult[0].cadenceOwner).toBe('client');
    expect(contractResult[0].cadenceOwner).toBe('contract');
  });

  it('T107: fixture builders create valid client-cadence and contract-cadence recurring scenarios with stable defaults', () => {
    const clientFixture = buildMonthlyRecurringFixture();
    const contractFixture = buildMonthlyRecurringFixture({
      cadenceOwner: 'contract',
      duePosition: 'arrears',
      chargeFamily: 'license',
    });

    expect(clientFixture.currentInvoiceWindow).toMatchObject({
      cadenceOwner: 'client',
      duePosition: 'advance',
      start: '2025-01-01',
      end: '2025-02-01',
    });
    expect(clientFixture.servicePeriods).toHaveLength(3);

    expect(contractFixture.sourceObligation.chargeFamily).toBe('license');
    expect(contractFixture.currentInvoiceWindow).toMatchObject({
      cadenceOwner: 'contract',
      duePosition: 'arrears',
      start: '2025-02-01',
      end: '2025-03-01',
    });
    expect(
      contractFixture.servicePeriods.every(
        (period) =>
          period.cadenceOwner === 'contract' &&
          period.duePosition === 'arrears' &&
          period.sourceObligation.chargeFamily === 'license',
      ),
    ).toBe(true);
  });

  it('T181: recurring run execution identity supports client-cadence scheduling without relying only on a raw billingCycleId string', () => {
    const window = buildClientExecutionWindow({
      billingCycleId: 'cycle-2025-01',
      clientId: 'client-1',
      windowStart: '2025-01-01',
      windowEnd: '2025-02-01',
    });

    expect(window).toEqual({
      kind: 'billing_cycle_window',
      identityKey: 'billing_cycle_window:client:client-1:cycle-2025-01:2025-01-01:2025-02-01',
      cadenceOwner: 'client',
      billingCycleId: 'cycle-2025-01',
      clientId: 'client-1',
      windowStart: '2025-01-01',
      windowEnd: '2025-02-01',
    });
    expect(listExecutionWindowKinds([window])).toEqual(['billing_cycle_window']);
  });

  it('T182: recurring run execution identity supports contract-cadence windows as a first-class scheduling shape', () => {
    const contractWindow = buildContractExecutionWindow({
      clientId: 'client-1',
      contractId: 'contract-1',
      contractLineId: 'line-1',
      windowStart: '2025-02-08',
      windowEnd: '2025-03-08',
    });
    const clientWindow = buildClientExecutionWindow({
      billingCycleId: 'cycle-2025-02',
      clientId: 'client-1',
      windowStart: '2025-02-01',
      windowEnd: '2025-03-01',
    });

    expect(contractWindow).toEqual({
      kind: 'contract_cadence_window',
      identityKey: 'contract_cadence_window:contract:client-1:contract-1:line-1:2025-02-08:2025-03-08',
      cadenceOwner: 'contract',
      clientId: 'client-1',
      contractId: 'contract-1',
      contractLineId: 'line-1',
      windowStart: '2025-02-08',
      windowEnd: '2025-03-08',
    });
    expect(listExecutionWindowKinds([clientWindow, contractWindow, contractWindow])).toEqual([
      'billing_cycle_window',
      'contract_cadence_window',
    ]);
  });

  it('T188: due service periods split into separate invoice candidates when grouping would violate the single-contract invoice invariant', () => {
    const sameWindow = buildInvoiceWindow({
      start: '2025-02-01',
      end: '2025-03-01',
      duePosition: 'advance',
      windowId: 'feb-2025',
    });

    const grouped = groupDueServicePeriodsByInvoiceWindowAndContract([
      {
        clientContractId: 'contract-a',
        servicePeriod: buildServicePeriod({
          start: '2025-02-01',
          end: '2025-03-01',
          sourceObligation: buildRecurringObligationRef({ obligationId: 'line-a' }),
        }),
        invoiceWindow: sameWindow,
      },
      {
        clientContractId: 'contract-b',
        servicePeriod: buildServicePeriod({
          start: '2025-02-01',
          end: '2025-03-01',
          sourceObligation: buildRecurringObligationRef({ obligationId: 'line-b' }),
        }),
        invoiceWindow: sameWindow,
      },
    ]);

    expect(grouped.map((group) => ({
      groupKey: group.groupKey,
      clientContractId: group.clientContractId,
      splitReasons: group.splitReasons,
      obligationIds: group.dueSelections.map((selection) => selection.servicePeriod.sourceObligation.obligationId),
    }))).toEqual([
      {
        groupKey: '2025-02-01:2025-03-01:contract-a:__no_po_scope__:__no_currency__:__no_tax_source__:__no_export_shape__',
        clientContractId: 'contract-a',
        splitReasons: ['single_contract'],
        obligationIds: ['line-a'],
      },
      {
        groupKey: '2025-02-01:2025-03-01:contract-b:__no_po_scope__:__no_currency__:__no_tax_source__:__no_export_shape__',
        clientContractId: 'contract-b',
        splitReasons: ['single_contract'],
        obligationIds: ['line-b'],
      },
    ]);
  });

  it('T261: mixed cadence due work still respects the documented single-contract invoice invariant during grouping', () => {
    const sameWindow = buildInvoiceWindow({
      start: '2025-02-01',
      end: '2025-03-01',
      duePosition: 'advance',
      windowId: 'feb-2025',
    });

    const grouped = groupDueServicePeriodsForInvoiceCandidates([
      {
        clientContractId: 'contract-a',
        servicePeriod: buildServicePeriod({
          cadenceOwner: 'client',
          start: '2025-02-01',
          end: '2025-03-01',
          sourceObligation: buildRecurringObligationRef({ obligationId: 'client-line' }),
        }),
        invoiceWindow: {
          ...sameWindow,
          cadenceOwner: 'client',
        },
      },
      {
        clientContractId: 'contract-b',
        servicePeriod: buildServicePeriod({
          cadenceOwner: 'contract',
          start: '2025-02-01',
          end: '2025-03-01',
          sourceObligation: buildRecurringObligationRef({ obligationId: 'contract-line' }),
        }),
        invoiceWindow: {
          ...sameWindow,
          cadenceOwner: 'contract',
        },
      },
    ]);

    expect(grouped.map((group) => ({
      groupKey: group.groupKey,
      clientContractId: group.clientContractId,
      cadenceOwners: group.cadenceOwners,
      splitReasons: group.splitReasons,
      obligationIds: group.dueSelections.map((selection) => selection.servicePeriod.sourceObligation.obligationId),
    }))).toEqual([
      {
        groupKey: '2025-02-01:2025-03-01:contract-a:__no_po_scope__:__no_currency__:__no_tax_source__:__no_export_shape__',
        clientContractId: 'contract-a',
        cadenceOwners: ['client'],
        splitReasons: ['single_contract'],
        obligationIds: ['client-line'],
      },
      {
        groupKey: '2025-02-01:2025-03-01:contract-b:__no_po_scope__:__no_currency__:__no_tax_source__:__no_export_shape__',
        clientContractId: 'contract-b',
        cadenceOwners: ['contract'],
        splitReasons: ['single_contract'],
        obligationIds: ['contract-line'],
      },
    ]);
  });

  it('T189: due service periods split into separate invoices when purchase-order scope differs inside the same due window', () => {
    const sameWindow = buildInvoiceWindow({
      start: '2025-02-01',
      end: '2025-03-01',
      duePosition: 'advance',
      windowId: 'feb-2025',
    });

    const grouped = groupDueServicePeriodsForInvoiceCandidates([
      {
        clientContractId: 'contract-a',
        purchaseOrderScopeKey: 'po-100',
        servicePeriod: buildServicePeriod({
          start: '2025-02-01',
          end: '2025-03-01',
          sourceObligation: buildRecurringObligationRef({ obligationId: 'line-a' }),
        }),
        invoiceWindow: sameWindow,
      },
      {
        clientContractId: 'contract-a',
        purchaseOrderScopeKey: 'po-200',
        servicePeriod: buildServicePeriod({
          start: '2025-02-01',
          end: '2025-03-01',
          sourceObligation: buildRecurringObligationRef({ obligationId: 'line-b' }),
        }),
        invoiceWindow: sameWindow,
      },
    ]);

    expect(grouped.map((group) => ({
      purchaseOrderScopeKey: group.purchaseOrderScopeKey,
      splitReasons: group.splitReasons,
      obligationIds: group.dueSelections.map((selection) => selection.servicePeriod.sourceObligation.obligationId),
    }))).toEqual([
      {
        purchaseOrderScopeKey: 'po-100',
        splitReasons: ['purchase_order_scope'],
        obligationIds: ['line-a'],
      },
      {
        purchaseOrderScopeKey: 'po-200',
        splitReasons: ['purchase_order_scope'],
        obligationIds: ['line-b'],
      },
    ]);
  });

  it('T190: due service periods split with explainable metadata when tax, currency, or export constraints differ inside one due window', () => {
    const sameWindow = buildInvoiceWindow({
      start: '2025-02-01',
      end: '2025-03-01',
      duePosition: 'advance',
      windowId: 'feb-2025',
    });

    const grouped = groupDueServicePeriodsForInvoiceCandidates([
      {
        clientContractId: 'contract-a',
        currencyCode: 'USD',
        taxSource: 'internal',
        exportShapeKey: 'qbo',
        servicePeriod: buildServicePeriod({
          start: '2025-02-01',
          end: '2025-03-01',
          sourceObligation: buildRecurringObligationRef({ obligationId: 'line-a' }),
        }),
        invoiceWindow: sameWindow,
      },
      {
        clientContractId: 'contract-a',
        currencyCode: 'EUR',
        taxSource: 'external',
        exportShapeKey: 'xero',
        servicePeriod: buildServicePeriod({
          start: '2025-02-01',
          end: '2025-03-01',
          sourceObligation: buildRecurringObligationRef({ obligationId: 'line-b' }),
        }),
        invoiceWindow: sameWindow,
      },
    ]);

    expect(grouped.map((group) => ({
      currencyCode: group.currencyCode,
      taxSource: group.taxSource,
      exportShapeKey: group.exportShapeKey,
      splitReasons: group.splitReasons,
    }))).toEqual([
      {
        currencyCode: 'USD',
        taxSource: 'internal',
        exportShapeKey: 'qbo',
        splitReasons: ['financial_constraint'],
      },
      {
        currencyCode: 'EUR',
        taxSource: 'external',
        exportShapeKey: 'xero',
        splitReasons: ['financial_constraint'],
      },
    ]);
  });

  it('T262: PO-required and non-PO recurring charges still split according to policy even when their due service periods coincide', () => {
    const sameWindow = buildInvoiceWindow({
      start: '2025-02-01',
      end: '2025-03-01',
      duePosition: 'advance',
      windowId: 'feb-2025',
    });

    const grouped = groupDueServicePeriodsForInvoiceCandidates([
      {
        clientContractId: 'contract-a',
        purchaseOrderScopeKey: 'po-required',
        servicePeriod: buildServicePeriod({
          start: '2025-02-01',
          end: '2025-03-01',
          sourceObligation: buildRecurringObligationRef({ obligationId: 'po-line' }),
        }),
        invoiceWindow: sameWindow,
      },
      {
        clientContractId: 'contract-a',
        servicePeriod: buildServicePeriod({
          start: '2025-02-01',
          end: '2025-03-01',
          sourceObligation: buildRecurringObligationRef({ obligationId: 'no-po-line' }),
        }),
        invoiceWindow: sameWindow,
      },
    ]);

    expect(grouped.map((group) => ({
      groupKey: group.groupKey,
      purchaseOrderScopeKey: group.purchaseOrderScopeKey,
      splitReasons: group.splitReasons,
      obligationIds: group.dueSelections.map((selection) => selection.servicePeriod.sourceObligation.obligationId),
    }))).toEqual([
      {
        groupKey: '2025-02-01:2025-03-01:contract-a:__no_po_scope__:__no_currency__:__no_tax_source__:__no_export_shape__',
        purchaseOrderScopeKey: null,
        splitReasons: ['purchase_order_scope'],
        obligationIds: ['no-po-line'],
      },
      {
        groupKey: '2025-02-01:2025-03-01:contract-a:po-required:__no_currency__:__no_tax_source__:__no_export_shape__',
        purchaseOrderScopeKey: 'po-required',
        splitReasons: ['purchase_order_scope'],
        obligationIds: ['po-line'],
      },
    ]);
  });

  it('T263: currency or tax-source grouping constraints force invoice splits according to policy when due work would otherwise combine', () => {
    const sameWindow = buildInvoiceWindow({
      start: '2025-02-01',
      end: '2025-03-01',
      duePosition: 'advance',
      windowId: 'feb-2025',
    });

    const grouped = groupDueServicePeriodsForInvoiceCandidates([
      {
        clientContractId: 'contract-a',
        currencyCode: 'USD',
        taxSource: 'internal',
        exportShapeKey: 'qbo',
        servicePeriod: buildServicePeriod({
          start: '2025-02-01',
          end: '2025-03-01',
          sourceObligation: buildRecurringObligationRef({ obligationId: 'usd-internal-line' }),
        }),
        invoiceWindow: sameWindow,
      },
      {
        clientContractId: 'contract-a',
        currencyCode: 'EUR',
        taxSource: 'internal',
        exportShapeKey: 'qbo',
        servicePeriod: buildServicePeriod({
          start: '2025-02-01',
          end: '2025-03-01',
          sourceObligation: buildRecurringObligationRef({ obligationId: 'eur-internal-line' }),
        }),
        invoiceWindow: sameWindow,
      },
      {
        clientContractId: 'contract-a',
        currencyCode: 'USD',
        taxSource: 'external',
        exportShapeKey: 'qbo',
        servicePeriod: buildServicePeriod({
          start: '2025-02-01',
          end: '2025-03-01',
          sourceObligation: buildRecurringObligationRef({ obligationId: 'usd-external-line' }),
        }),
        invoiceWindow: sameWindow,
      },
    ]);

    expect(grouped.map((group) => ({
      groupKey: group.groupKey,
      currencyCode: group.currencyCode,
      taxSource: group.taxSource,
      exportShapeKey: group.exportShapeKey,
      splitReasons: group.splitReasons,
      obligationIds: group.dueSelections.map((selection) => selection.servicePeriod.sourceObligation.obligationId),
    }))).toEqual([
      {
        groupKey: '2025-02-01:2025-03-01:contract-a:__no_po_scope__:USD:internal:qbo',
        currencyCode: 'USD',
        taxSource: 'internal',
        exportShapeKey: 'qbo',
        splitReasons: ['financial_constraint'],
        obligationIds: ['usd-internal-line'],
      },
      {
        groupKey: '2025-02-01:2025-03-01:contract-a:__no_po_scope__:EUR:internal:qbo',
        currencyCode: 'EUR',
        taxSource: 'internal',
        exportShapeKey: 'qbo',
        splitReasons: ['financial_constraint'],
        obligationIds: ['eur-internal-line'],
      },
      {
        groupKey: '2025-02-01:2025-03-01:contract-a:__no_po_scope__:USD:external:qbo',
        currencyCode: 'USD',
        taxSource: 'external',
        exportShapeKey: 'qbo',
        splitReasons: ['financial_constraint'],
        obligationIds: ['usd-external-line'],
      },
    ]);
  });

  it('T015: activity-window intersection trims start boundaries under half-open semantics', () => {
    const intersected = intersectActivityWindow(
      buildServicePeriod(),
      { start: '2025-01-03', end: '2025-01-11', semantics: RECURRING_RANGE_SEMANTICS },
    );

    expect(intersected?.start).toBe('2025-01-03');
    expect(intersected?.end).toBe('2025-01-11');
  });

  it('T016: activity-window intersection trims end boundaries under half-open semantics', () => {
    const intersected = intersectActivityWindow(
      buildServicePeriod(),
      { start: '2025-01-01', end: '2025-01-06', semantics: RECURRING_RANGE_SEMANTICS },
    );

    expect(intersected?.start).toBe('2025-01-01');
    expect(intersected?.end).toBe('2025-01-06');
  });

  it('T017: partial-period settlement produces stable coverage factors without a separate proration subsystem', () => {
    const coverage = calculateServicePeriodCoverage(buildServicePeriod(), {
      start: '2025-01-03',
      end: '2025-01-11',
    });

    expect(coverage.totalDays).toBe(10);
    expect(coverage.coveredDays).toBe(8);
    expect(coverage.coverageRatio).toBe(0.8);
  });

  it('T018: advance and arrears due mapping operate on the same service period object', () => {
    const servicePeriod = buildServicePeriod();
    const currentWindow = buildInvoiceWindow({ duePosition: 'advance', windowId: 'current' });
    const nextWindow = buildInvoiceWindow({
      duePosition: 'arrears',
      start: '2025-01-11',
      end: '2025-01-21',
      windowId: 'next',
    });

    const advance = mapServicePeriodToInvoiceWindow(servicePeriod, {
      duePosition: 'advance',
      currentInvoiceWindow: currentWindow,
      nextInvoiceWindow: nextWindow,
    });
    const arrears = mapServicePeriodToInvoiceWindow(servicePeriod, {
      duePosition: 'arrears',
      currentInvoiceWindow: currentWindow,
      nextInvoiceWindow: nextWindow,
    });

    expect(advance.servicePeriod).toBe(servicePeriod);
    expect(arrears.servicePeriod).toBe(servicePeriod);
    expect(advance.invoiceWindow.windowId).toBe('current');
    expect(arrears.invoiceWindow.windowId).toBe('next');
  });

  it('T019: half-open semantics remain consistent for touching boundaries', () => {
    const noOverlap = intersectActivityWindow(
      buildServicePeriod(),
      { start: '2025-01-11', end: '2025-01-12', semantics: RECURRING_RANGE_SEMANTICS },
    );

    expect(noOverlap).toBeNull();
  });

  it('T020: recurring invoice detail timing can be asserted without building an invoice document', () => {
    const detailTiming = buildRecurringInvoiceDetailTiming({
      servicePeriod: buildServicePeriod({
        cadenceOwner: 'contract',
        duePosition: 'arrears',
      }),
      invoiceWindow: buildInvoiceWindow({
        start: '2025-01-11',
        end: '2025-01-21',
        duePosition: 'arrears',
      }),
    });

    expect(detailTiming).toEqual({
      cadenceOwner: 'contract',
      duePosition: 'arrears',
      sourceObligation,
      servicePeriodStart: '2025-01-01',
      servicePeriodEnd: '2025-01-11',
      invoiceWindowStart: '2025-01-11',
      invoiceWindowEnd: '2025-01-21',
    });
  });

  it('T031: advance timing maps the current service period onto the current invoice window for client cadence', () => {
    const invoiceWindow = buildInvoiceWindow({
      start: '2025-01-01',
      end: '2025-02-01',
      duePosition: 'advance',
      windowId: 'jan-2025',
    });

    const selected = selectDueServicePeriodsForInvoiceWindow(buildMonthlyServicePeriods(), {
      duePosition: 'advance',
      invoiceWindow,
    });

    expect(selected).toHaveLength(1);
    expect(selected[0]?.servicePeriod.start).toBe('2025-01-01');
    expect(selected[0]?.servicePeriod.end).toBe('2025-02-01');
    expect(selected[0]?.invoiceWindow.windowId).toBe('jan-2025');
  });

  it('T032: arrears timing maps the previous service period onto the current invoice window for client cadence', () => {
    const invoiceWindow = buildInvoiceWindow({
      start: '2025-01-01',
      end: '2025-02-01',
      duePosition: 'arrears',
      windowId: 'jan-2025',
    });

    const selected = selectDueServicePeriodsForInvoiceWindow(
      buildMonthlyServicePeriods({ duePosition: 'arrears' }),
      {
        duePosition: 'arrears',
        invoiceWindow,
      },
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]?.servicePeriod.start).toBe('2024-12-01');
    expect(selected[0]?.servicePeriod.end).toBe('2025-01-01');
    expect(selected[0]?.invoiceWindow.windowId).toBe('jan-2025');
  });

  it('T033: mid-period start produces a partial first service period through activity-window intersection', () => {
    const settlements = resolveRecurringSettlementsForInvoiceWindow({
      servicePeriods: buildMonthlyServicePeriods(),
      invoiceWindow: buildInvoiceWindow({
        start: '2025-01-01',
        end: '2025-02-01',
        duePosition: 'advance',
      }),
      activityWindow: {
        start: '2025-01-10',
        end: '2025-03-01',
        semantics: RECURRING_RANGE_SEMANTICS,
      },
      duePosition: 'advance',
    });

    expect(settlements).toHaveLength(1);
    expect(settlements[0]?.servicePeriod.start).toBe('2025-01-01');
    expect(settlements[0]?.coveredServicePeriod.start).toBe('2025-01-10');
    expect(settlements[0]?.coveredServicePeriod.end).toBe('2025-02-01');
    expect(settlements[0]?.coverage.coverageRatio).toBeCloseTo(22 / 31, 6);
  });

  it('T034: mid-period end produces a partial final service period through activity-window intersection', () => {
    const settlements = resolveRecurringSettlementsForInvoiceWindow({
      servicePeriods: buildMonthlyServicePeriods(),
      invoiceWindow: buildInvoiceWindow({
        start: '2025-01-01',
        end: '2025-02-01',
        duePosition: 'advance',
      }),
      activityWindow: {
        start: '2024-12-01',
        end: '2025-01-21',
        semantics: RECURRING_RANGE_SEMANTICS,
      },
      duePosition: 'advance',
    });

    expect(settlements).toHaveLength(1);
    expect(settlements[0]?.coveredServicePeriod.start).toBe('2025-01-01');
    expect(settlements[0]?.coveredServicePeriod.end).toBe('2025-01-21');
    expect(settlements[0]?.coverage.coverageRatio).toBeCloseTo(20 / 31, 6);
  });

  it('T035: fixed, product, and license recurring lines use the same partial-period settlement rules', () => {
    const chargeFamilies: Array<'fixed' | 'product' | 'license'> = ['fixed', 'product', 'license'];

    const settlements = chargeFamilies.map((chargeFamily) =>
      resolveRecurringSettlementsForInvoiceWindow({
        servicePeriods: buildMonthlyServicePeriods({ chargeFamily }),
        invoiceWindow: buildInvoiceWindow({
          start: '2025-01-01',
          end: '2025-02-01',
          duePosition: 'advance',
        }),
        activityWindow: {
          start: '2025-01-10',
          end: '2025-01-21',
          semantics: RECURRING_RANGE_SEMANTICS,
        },
        duePosition: 'advance',
      })[0],
    );

    expect(settlements).toHaveLength(3);
    expect(new Set(settlements.map((entry) => entry?.coverage.coveredDays))).toEqual(new Set([11]));
    expect(new Set(settlements.map((entry) => entry?.coverage.totalDays))).toEqual(new Set([31]));
    expect(new Set(settlements.map((entry) => entry?.coverage.coverageRatio.toFixed(6)))).toEqual(
      new Set([(11 / 31).toFixed(6)]),
    );
  });

  it('T036: newly activated recurring lines have explicit first-period behavior under advance timing', () => {
    const settlements = resolveRecurringSettlementsForInvoiceWindow({
      servicePeriods: buildMonthlyServicePeriods({ duePosition: 'advance' }),
      invoiceWindow: buildInvoiceWindow({
        start: '2025-01-01',
        end: '2025-02-01',
        duePosition: 'advance',
      }),
      activityWindow: {
        start: '2025-01-10',
        end: '2025-03-01',
        semantics: RECURRING_RANGE_SEMANTICS,
      },
      duePosition: 'advance',
    });

    expect(settlements).toHaveLength(1);
    expect(settlements[0]?.servicePeriod.start).toBe('2025-01-01');
    expect(settlements[0]?.coveredServicePeriod.start).toBe('2025-01-10');
  });

  it('T037: newly activated recurring lines have explicit first-period behavior under arrears timing', () => {
    const settlements = resolveRecurringSettlementsForInvoiceWindow({
      servicePeriods: buildMonthlyServicePeriods({ duePosition: 'arrears' }),
      invoiceWindow: buildInvoiceWindow({
        start: '2025-02-01',
        end: '2025-03-01',
        duePosition: 'arrears',
      }),
      activityWindow: {
        start: '2025-01-10',
        end: '2025-03-01',
        semantics: RECURRING_RANGE_SEMANTICS,
      },
      duePosition: 'arrears',
    });

    expect(settlements).toHaveLength(1);
    expect(settlements[0]?.servicePeriod.start).toBe('2025-01-01');
    expect(settlements[0]?.coveredServicePeriod.start).toBe('2025-01-10');
    expect(settlements[0]?.invoiceWindow.start).toBe('2025-02-01');
  });

  it('T038: terminated recurring lines have explicit final-period behavior under advance timing', () => {
    const settlements = resolveRecurringSettlementsForInvoiceWindow({
      servicePeriods: buildMonthlyServicePeriods({ duePosition: 'advance' }),
      invoiceWindow: buildInvoiceWindow({
        start: '2025-01-01',
        end: '2025-02-01',
        duePosition: 'advance',
      }),
      activityWindow: {
        start: '2024-12-01',
        end: '2025-01-21',
        semantics: RECURRING_RANGE_SEMANTICS,
      },
      duePosition: 'advance',
    });

    expect(settlements).toHaveLength(1);
    expect(settlements[0]?.coveredServicePeriod.end).toBe('2025-01-21');
    expect(settlements[0]?.coverage.coveredDays).toBe(20);
  });

  it('T039: terminated recurring lines have explicit final-period behavior under arrears timing', () => {
    const settlements = resolveRecurringSettlementsForInvoiceWindow({
      servicePeriods: buildMonthlyServicePeriods({ duePosition: 'arrears' }),
      invoiceWindow: buildInvoiceWindow({
        start: '2025-02-01',
        end: '2025-03-01',
        duePosition: 'arrears',
      }),
      activityWindow: {
        start: '2024-12-01',
        end: '2025-01-21',
        semantics: RECURRING_RANGE_SEMANTICS,
      },
      duePosition: 'arrears',
    });

    expect(settlements).toHaveLength(1);
    expect(settlements[0]?.servicePeriod.start).toBe('2025-01-01');
    expect(settlements[0]?.coveredServicePeriod.end).toBe('2025-01-21');
    expect(settlements[0]?.invoiceWindow.start).toBe('2025-02-01');
  });

  it('T040: zero-coverage or empty service periods never emit recurring settlements', () => {
    const settlements = resolveRecurringSettlementsForInvoiceWindow({
      servicePeriods: buildMonthlyServicePeriods({ duePosition: 'advance' }),
      invoiceWindow: buildInvoiceWindow({
        start: '2025-01-01',
        end: '2025-02-01',
        duePosition: 'advance',
      }),
      activityWindow: {
        start: '2025-02-01',
        end: '2025-03-01',
        semantics: RECURRING_RANGE_SEMANTICS,
      },
      duePosition: 'advance',
    });

    expect(settlements).toEqual([]);
  });

  it('T141: mixed cadence-owner due work in the same invoice window groups into one invoice candidate while retaining cadence-owner explainability', () => {
    const sharedWindow = buildInvoiceWindow({
      start: '2025-02-01',
      end: '2025-03-01',
      duePosition: 'advance',
    });

    const groups = groupDueServicePeriodsByInvoiceWindow([
      {
        servicePeriod: buildServicePeriod({
          cadenceOwner: 'client',
          duePosition: 'advance',
          sourceObligation: buildRecurringObligationRef({ obligationId: 'client-line' }),
          start: '2025-02-01',
          end: '2025-03-01',
        }),
        invoiceWindow: {
          ...sharedWindow,
          cadenceOwner: 'client',
        },
      },
      {
        servicePeriod: buildServicePeriod({
          cadenceOwner: 'contract',
          duePosition: 'advance',
          sourceObligation: buildRecurringObligationRef({ obligationId: 'contract-line' }),
          start: '2025-02-01',
          end: '2025-03-01',
        }),
        invoiceWindow: {
          ...sharedWindow,
          cadenceOwner: 'contract',
        },
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      windowStart: '2025-02-01',
      windowEnd: '2025-03-01',
      cadenceOwners: ['client', 'contract'],
    });
    expect(groups[0]?.dueSelections.map((selection) => selection.servicePeriod.sourceObligation.obligationId)).toEqual([
      'client-line',
      'contract-line',
    ]);
  });

  it('T142: mixed cadence-owner due work in different invoice windows stays split into separate invoice candidates', () => {
    const groups = groupDueServicePeriodsByInvoiceWindow([
      {
        servicePeriod: buildServicePeriod({
          cadenceOwner: 'client',
          duePosition: 'advance',
          sourceObligation: buildRecurringObligationRef({ obligationId: 'client-line' }),
          start: '2025-02-01',
          end: '2025-03-01',
        }),
        invoiceWindow: buildInvoiceWindow({
          cadenceOwner: 'client',
          start: '2025-02-01',
          end: '2025-03-01',
          duePosition: 'advance',
        }),
      },
      {
        servicePeriod: buildServicePeriod({
          cadenceOwner: 'contract',
          duePosition: 'advance',
          sourceObligation: buildRecurringObligationRef({ obligationId: 'contract-line' }),
          start: '2025-02-08',
          end: '2025-03-08',
        }),
        invoiceWindow: buildInvoiceWindow({
          cadenceOwner: 'contract',
          start: '2025-02-08',
          end: '2025-03-08',
          duePosition: 'advance',
        }),
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => ({
      windowStart: group.windowStart,
      windowEnd: group.windowEnd,
      cadenceOwners: group.cadenceOwners,
      obligations: group.dueSelections.map((selection) => selection.servicePeriod.sourceObligation.obligationId),
    }))).toEqual([
      {
        windowStart: '2025-02-01',
        windowEnd: '2025-03-01',
        cadenceOwners: ['client'],
        obligations: ['client-line'],
      },
      {
        windowStart: '2025-02-08',
        windowEnd: '2025-03-08',
        cadenceOwners: ['contract'],
        obligations: ['contract-line'],
      },
    ]);
  });
});
