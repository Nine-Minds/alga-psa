import type {
  CadenceOwner,
  IPersistedRecurringObligationRef,
  IRecurringInvoiceWindow,
  IRecurringObligationRef,
  IRecurringServicePeriodRecord,
  IRecurringServicePeriod,
} from '@alga-psa/types';
import { RECURRING_RANGE_SEMANTICS } from '@alga-psa/types';

export const buildRecurringObligationRef = (
  overrides: Partial<IRecurringObligationRef> = {},
): IRecurringObligationRef => ({
  obligationId: 'line-1',
  obligationType: 'contract_line',
  chargeFamily: 'fixed',
  ...overrides,
});

export const buildRecurringServicePeriod = (
  overrides: Partial<IRecurringServicePeriod> = {},
): IRecurringServicePeriod => ({
  kind: 'service_period',
  cadenceOwner: 'client',
  duePosition: 'advance',
  sourceObligation: buildRecurringObligationRef(),
  start: '2025-01-01',
  end: '2025-01-11',
  semantics: RECURRING_RANGE_SEMANTICS,
  ...overrides,
});

export const buildPersistedRecurringObligationRef = (
  overrides: Partial<IPersistedRecurringObligationRef> = {},
): IPersistedRecurringObligationRef => ({
  ...buildRecurringObligationRef(overrides),
  tenant: overrides.tenant ?? 'tenant-1',
});

export const buildRecurringInvoiceWindow = (
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

type BuildMonthlyRecurringFixtureOptions = {
  cadenceOwner?: CadenceOwner;
  duePosition?: 'advance' | 'arrears';
  chargeFamily?: 'fixed' | 'product' | 'license';
  obligationOverrides?: Partial<IRecurringObligationRef>;
};

export const buildMonthlyRecurringFixture = (
  options: BuildMonthlyRecurringFixtureOptions = {},
) => {
  const cadenceOwner = options.cadenceOwner ?? 'client';
  const duePosition = options.duePosition ?? 'advance';
  const sourceObligation = buildRecurringObligationRef({
    chargeFamily: options.chargeFamily ?? 'fixed',
    ...options.obligationOverrides,
  });

  const servicePeriods = [
    buildRecurringServicePeriod({
      cadenceOwner,
      duePosition,
      sourceObligation,
      start: '2024-12-01',
      end: '2025-01-01',
    }),
    buildRecurringServicePeriod({
      cadenceOwner,
      duePosition,
      sourceObligation,
      start: '2025-01-01',
      end: '2025-02-01',
    }),
    buildRecurringServicePeriod({
      cadenceOwner,
      duePosition,
      sourceObligation,
      start: '2025-02-01',
      end: '2025-03-01',
    }),
  ];

  const currentInvoiceWindow = buildRecurringInvoiceWindow({
    cadenceOwner,
    duePosition,
    start: duePosition === 'advance' ? '2025-01-01' : '2025-02-01',
    end: duePosition === 'advance' ? '2025-02-01' : '2025-03-01',
    windowId: duePosition === 'advance' ? 'window-current' : 'window-next',
  });

  return {
    sourceObligation,
    servicePeriods,
    currentInvoiceWindow,
  };
};

export const buildMonthlyServicePeriods = (
  options: BuildMonthlyRecurringFixtureOptions = {},
): IRecurringServicePeriod[] => buildMonthlyRecurringFixture(options).servicePeriods;

export const buildRecurringServicePeriodRecord = (
  overrides: Partial<IRecurringServicePeriodRecord> = {},
): IRecurringServicePeriodRecord => {
  const sourceObligation = overrides.sourceObligation ?? buildPersistedRecurringObligationRef();
  const cadenceOwner = overrides.cadenceOwner ?? 'client';
  const duePosition = overrides.duePosition ?? 'advance';

  return {
    kind: 'persisted_service_period_record',
    recordId: 'rsp_01',
    scheduleKey: `schedule:${sourceObligation.obligationId}:${cadenceOwner}:${duePosition}`,
    periodKey: 'period:2025-01-01:2025-02-01',
    revision: 1,
    sourceObligation,
    cadenceOwner,
    duePosition,
    lifecycleState: 'generated',
    servicePeriod: {
      start: '2025-01-01',
      end: '2025-02-01',
      semantics: RECURRING_RANGE_SEMANTICS,
    },
    invoiceWindow: {
      start: '2025-01-01',
      end: '2025-02-01',
      semantics: RECURRING_RANGE_SEMANTICS,
    },
    activityWindow: {
      start: '2025-01-01',
      end: '2025-02-01',
      semantics: RECURRING_RANGE_SEMANTICS,
    },
    provenance: {
      kind: 'generated',
      sourceRuleVersion: `${sourceObligation.obligationId}:v1`,
      reasonCode: 'initial_materialization',
      sourceRunKey: 'materialize-2026-03-18',
    },
    createdAt: '2026-03-18T10:00:00.000Z',
    updatedAt: '2026-03-18T10:00:00.000Z',
    ...overrides,
  };
};
