import type {
  CadenceOwner,
  IRecurringInvoiceWindow,
  IRecurringObligationRef,
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
