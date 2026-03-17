import { describe, expect, it } from 'vitest';
import type {
  CadenceOwner,
  ICadenceBoundaryGenerator,
  IRecurringInvoiceWindow,
  IRecurringObligationRef,
  IRecurringServicePeriod,
} from '@alga-psa/types';
import {
  buildRecurringInvoiceDetailTiming,
  calculateServicePeriodCoverage,
  intersectActivityWindow,
  mapServicePeriodToInvoiceWindow,
} from '@alga-psa/shared/billingClients/recurringTiming';
import {
  DEFAULT_CADENCE_OWNER as billingDefaultCadenceOwner,
  resolveCadenceOwner,
  selectCadenceBoundaryGenerator,
} from '@alga-psa/billing/lib/billing/recurringTiming';
import { DEFAULT_CADENCE_OWNER as sharedDefaultCadenceOwner } from '@alga-psa/shared/billingClients/recurringTiming';
import { RECURRING_RANGE_SEMANTICS } from '@alga-psa/types';

const sourceObligation: IRecurringObligationRef = {
  obligationId: 'line-1',
  obligationType: 'contract_line',
  chargeFamily: 'fixed',
};

const buildServicePeriod = (
  overrides: Partial<IRecurringServicePeriod> = {},
): IRecurringServicePeriod => ({
  kind: 'service_period',
  cadenceOwner: 'client',
  duePosition: 'advance',
  sourceObligation,
  start: '2025-01-01',
  end: '2025-01-11',
  semantics: RECURRING_RANGE_SEMANTICS,
  ...overrides,
});

const buildInvoiceWindow = (
  overrides: Partial<IRecurringInvoiceWindow> = {},
): IRecurringInvoiceWindow => ({
  kind: 'invoice_window',
  cadenceOwner: 'client',
  duePosition: 'advance',
  start: '2025-01-01',
  end: '2025-01-11',
  semantics: RECURRING_RANGE_SEMANTICS,
  windowId: 'window-1',
  ...overrides,
});

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
});
