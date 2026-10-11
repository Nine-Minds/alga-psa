import { describe, expect, it } from 'vitest';
import type { ContractWizardFixedLine } from '@alga-psa/types';
import {
  diffRecurringShapes,
  recurringShapeFromStoredLines,
  recurringShapeFromWizard,
  type StoredRecurringLine,
} from './contractRecurringShape';

const member = (service_id: string, extra: Record<string, unknown> = {}) => ({
  service_id,
  service_name: service_id,
  item_kind: 'service',
  quantity: 1,
  custom_rate: null,
  pricing_basis: 'bundle',
  ...extra,
});

const storedFixed = (id: string, over: Partial<StoredRecurringLine> = {}): StoredRecurringLine => ({
  contract_line_id: id,
  contract_line_name: id,
  contract_line_type: 'Fixed',
  billing_frequency: 'monthly',
  billing_timing: 'arrears',
  cadence_owner: 'client',
  enable_proration: false,
  custom_rate: null,
  members: [],
  ...over,
});

const wizardLine = (key: string, over: Partial<ContractWizardFixedLine> = {}): ContractWizardFixedLine => ({
  line_key: key,
  contract_line_name: key,
  billing_frequency: 'monthly',
  billing_timing: 'arrears',
  enable_proration: false,
  base_rate: null,
  services: [],
  ...over,
});

const ctx = { contractBillingFrequency: 'monthly' };
const base = { billing_frequency: 'monthly', billing_timing: 'arrears', cadence_owner: 'client' };

const svc = (service_id: string, over: Record<string, unknown> = {}) => ({
  service_id,
  quantity: 1,
  pricing_basis: 'bundle' as const,
  ...over,
});

describe('contractRecurringShape', () => {
  it('two bundle lines at different rates agree', () => {
    const stored = [
      storedFixed('A', { custom_rate: 300000, members: [member('s1'), member('s2')] }),
      storedFixed('B', { custom_rate: 105000, members: [member('s3')] }),
    ];
    const wizard = recurringShapeFromWizard({
      ...base,
      fixed_lines: [
        wizardLine('A', { base_rate: 300000, services: [svc('s1'), svc('s2')] }),
        wizardLine('B', { base_rate: 105000, services: [svc('s3')] }),
      ],
    });
    expect(diffRecurringShapes(recurringShapeFromStoredLines(stored, ctx), wizard)).toEqual([]);
  });

  it('a service-less custom line agrees, and is dropped if the wizard loses it', () => {
    const stored = [storedFixed('Custom', { custom_rate: 70000 })];
    const kept = recurringShapeFromWizard({ ...base, fixed_lines: [wizardLine('Custom', { base_rate: 70000 })] });
    expect(diffRecurringShapes(recurringShapeFromStoredLines(stored, ctx), kept)).toEqual([]);
    const dropped = diffRecurringShapes(recurringShapeFromStoredLines(stored, ctx), recurringShapeFromWizard(base));
    expect(dropped).toHaveLength(1);
    expect(dropped[0].message).toContain('Custom: would be dropped');
  });

  it('mixed unit + bundle line and per-seat lines agree', () => {
    const stored = [
      storedFixed('Mixed', {
        custom_rate: 50000,
        members: [member('seat', { pricing_basis: 'unit', quantity: 5, unit_rate: 15000 }), member('b')],
      }),
      storedFixed('Seats2', { members: [member('seat2', { pricing_basis: 'unit', quantity: 3, unit_rate: 2000 })] }),
    ];
    const wizard = recurringShapeFromWizard({
      ...base,
      fixed_lines: [
        wizardLine('Mixed', {
          base_rate: 50000,
          services: [svc('seat', { pricing_basis: 'unit', quantity: 5, unit_rate: 15000 }), svc('b')],
        }),
        wizardLine('Seats2', { services: [svc('seat2', { pricing_basis: 'unit', quantity: 3, unit_rate: 2000 })] }),
      ],
    });
    expect(diffRecurringShapes(recurringShapeFromStoredLines(stored, ctx), wizard)).toEqual([]);
  });

  it('reports a rate change and a frequency change', () => {
    const stored = recurringShapeFromStoredLines(
      [storedFixed('A', { custom_rate: 300000, members: [member('s1')] })],
      ctx,
    );
    const wizard = recurringShapeFromWizard({
      ...base,
      fixed_lines: [wizardLine('A', { base_rate: 100000, billing_frequency: 'quarterly', services: [svc('s1')] })],
    });
    const messages = diffRecurringShapes(stored, wizard).map((d) => d.message);
    expect(messages).toContain('A: recurring amount would change from 300000 to 100000');
    expect(messages).toContain('A: billing frequency would change from monthly to quarterly');
  });

  it('refuses a fixed line mixing product and service members, naming the line', () => {
    const stored = recurringShapeFromStoredLines(
      [storedFixed('Mix', { custom_rate: 1000, members: [member('s1'), member('p1', { item_kind: 'product' })] })],
      ctx,
    );
    const wizard = recurringShapeFromWizard({
      ...base,
      fixed_lines: [wizardLine('Mix', { base_rate: 1000, services: [svc('s1')] })],
      product_services: [{ service_id: 'p1', service_name: 'p1', quantity: 1 }],
    });
    const diff = diffRecurringShapes(stored, wizard);
    expect(diff).toHaveLength(1);
    expect(diff[0].message).toContain('Mix: services would change');
  });

  it('hourly lines are compared per service: equal lines merge, different frequencies differ', () => {
    const hourlyLine = (id: string, serviceId: string, freq: string): StoredRecurringLine => ({
      contract_line_id: id,
      contract_line_type: 'Hourly',
      billing_frequency: freq,
      billing_timing: 'arrears',
      cadence_owner: 'client',
      members: [{ ...member(serviceId), resolved_rate: 12000 }],
    });
    const wizardHourly = {
      ...base,
      hourly_billing_frequency: 'monthly',
      hourly_services: [
        { service_id: 'h1', hourly_rate: 12000 },
        { service_id: 'h2', hourly_rate: 12000 },
      ],
    };
    const merged = recurringShapeFromStoredLines([hourlyLine('L1', 'h1', 'monthly'), hourlyLine('L2', 'h2', 'monthly')], ctx);
    expect(diffRecurringShapes(merged, recurringShapeFromWizard(wizardHourly))).toEqual([]);
    const split = recurringShapeFromStoredLines([hourlyLine('L1', 'h1', 'monthly'), hourlyLine('L2', 'h2', 'quarterly')], ctx);
    expect(diffRecurringShapes(split, recurringShapeFromWizard(wizardHourly)).length).toBeGreaterThan(0);
  });

  it('a stored location the wizard cannot hold is refused', () => {
    const stored = recurringShapeFromStoredLines(
      [storedFixed('A', { location_id: 'loc-1', custom_rate: 1000, members: [member('s1')] })],
      ctx,
    );
    const wizard = recurringShapeFromWizard({ ...base, fixed_lines: [wizardLine('A', { base_rate: 1000, services: [svc('s1')] })] });
    expect(diffRecurringShapes(stored, wizard).map((d) => d.message)).toContain(
      'A: location would change from loc-1 to none',
    );
  });
});
