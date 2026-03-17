import { describe, it, expect, vi } from 'vitest';
import { BillingEngine } from '@alga-psa/billing/services';

vi.mock('@alga-psa/billing/actions/billingAndTax', () => ({
  getNextBillingDate: vi.fn(async (_clientId: string, currentEndDate: string) => currentEndDate)
}));

const buildQuery = (firstResult: any, selectResult: any = []) => {
  const builder: any = {};
  builder.where = vi.fn().mockImplementation((condition: any) => {
    if (typeof condition === 'function') {
      condition({
        whereNull: vi.fn().mockReturnThis(),
        orWhere: vi.fn().mockReturnThis(),
      });
    }
    return builder;
  });
  builder.andWhere = vi.fn().mockImplementation(() => builder);
  builder.orderBy = vi.fn().mockImplementation(() => builder);
  builder.join = vi.fn().mockImplementation(() => builder);
  builder.leftJoin = vi.fn().mockImplementation(() => builder);
  builder.whereNot = vi.fn().mockImplementation(() => builder);
  builder.select = vi.fn().mockImplementation(() => builder);
  builder.first = vi.fn().mockResolvedValue(firstResult);
  builder.then = vi.fn((onFulfilled?: any, onRejected?: any) =>
    Promise.resolve(selectResult).then(onFulfilled, onRejected)
  );
  return builder;
};

describe('BillingEngine billing timing', () => {
  it('maps arrears contract lines to the previous billing period', async () => {
    const engine = new BillingEngine();

    const billingPeriod = {
      startDate: '2025-01-01',
      endDate: '2025-02-01'
    };

    const clientContractLine = {
      client_contract_line_id: 'ccd-1',
      client_id: 'client-1',
      contract_line_id: 'contract-line-1',
      start_date: '2024-12-01',
      end_date: null,
      is_active: true
    } as any;

    const result = await (engine as any).resolveServicePeriod(
      'client-1',
      billingPeriod,
      clientContractLine,
      'arrears'
    );

    expect(result).toEqual({
      servicePeriodStart: '2024-12-01',
      servicePeriodEnd: '2024-12-31'
    });
  });

  it('T045: fixed recurring arrears timing resolves partial first periods through shared coverage instead of a special skip branch', () => {
    const engine = new BillingEngine();

    const result = (engine as any).resolveFixedRecurringChargeTiming(
      {
        startDate: '2025-02-01',
        endDate: '2025-03-01',
      },
      {
        client_contract_line_id: 'ccd-1',
        billing_timing: 'arrears',
        start_date: '2025-01-10',
        end_date: null,
      },
      'monthly',
    );

    expect(result).toMatchObject({
      duePosition: 'arrears',
      servicePeriodStart: '2025-01-10',
      servicePeriodEnd: '2025-01-31',
      servicePeriodStartExclusive: '2025-01-10',
      servicePeriodEndExclusive: '2025-02-01',
    });
    expect(result?.coverageRatio).toBeCloseTo(22 / 31, 8);
  });

  it('T041: fixed recurring charge calculation no longer depends on resolveServicePeriod', async () => {
    const engine = new BillingEngine();
    (engine as any).tenant = 'test_tenant';
    vi.spyOn(engine as any, 'getBillingCycle').mockResolvedValue('monthly');

    const resolveServicePeriodSpy = vi
      .spyOn(engine as any, 'resolveServicePeriod')
      .mockRejectedValue(new Error('resolveServicePeriod should not be called'));

    (engine as any).knex = vi.fn().mockImplementation((tableName: string) => {
      if (tableName === 'contract_pricing_schedules') {
        return buildQuery(null);
      }

      if (tableName === 'clients') {
        return buildQuery({
          client_id: 'client-1',
          tenant: 'test_tenant',
          client_name: 'Mock Client',
          is_tax_exempt: false,
        });
      }

      if (tableName === 'contract_lines') {
        return buildQuery({
          contract_line_id: 'contract-line-1',
          tenant: 'test_tenant',
          contract_line_type: 'Fixed',
          custom_rate: 20000,
          enable_proration: false,
          billing_cycle_alignment: 'start',
        });
      }

      if (tableName === 'contract_line_services as cls') {
        return buildQuery(null, [
          {
            service_id: 'service-1',
            service_name: 'Managed Support',
            default_rate: 20000,
            tax_rate_id: null,
            service_quantity: 1,
            configuration_quantity: 1,
            config_id: 'config-1',
            service_base_rate: 20000,
          },
        ]);
      }

      return buildQuery(null);
    });

    const charges = await (engine as any).calculateFixedPriceCharges(
      'client-1',
      {
        startDate: '2025-02-01',
        endDate: '2025-03-01',
      },
      {
        client_contract_line_id: 'ccd-1',
        client_id: 'client-1',
        contract_line_id: 'contract-line-1',
        client_contract_id: 'assignment-1',
        contract_line_name: 'Managed Support',
        contract_name: 'Acme Corp',
        billing_timing: 'arrears',
        start_date: '2025-01-01',
        end_date: null,
        custom_rate: 15000,
      },
    );

    expect(resolveServicePeriodSpy).not.toHaveBeenCalled();
    expect(charges).toEqual([
      expect.objectContaining({
        type: 'fixed',
        rate: 15000,
        total: 15000,
        servicePeriodStart: '2025-01-01',
        servicePeriodEnd: '2025-01-31',
        billingTiming: 'arrears',
      }),
    ]);
  });
});
