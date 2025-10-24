import { describe, it, expect, vi } from 'vitest';
import { BillingEngine } from 'server/src/lib/billing/billingEngine';

vi.mock('server/src/lib/actions/billingAndTax', () => ({
  getNextBillingDate: vi.fn(async (_clientId: string, currentEndDate: string) => currentEndDate)
}));

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
});
