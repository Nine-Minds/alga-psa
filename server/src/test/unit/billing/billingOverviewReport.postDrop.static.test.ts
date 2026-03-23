import { describe, expect, it } from 'vitest';

import { billingOverviewReport } from '../../../lib/reports/definitions/billing/overview';

describe('billing overview report post-drop definition', () => {
  it('derives active billing clients from surviving client-owned contract structures', () => {
    const activeClientsMetric = billingOverviewReport.metrics.find((metric) => metric.id === 'active_clients_count');

    expect(activeClientsMetric).toBeTruthy();
    expect(activeClientsMetric?.query.joins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'client_contracts' }),
        expect.objectContaining({ table: 'contracts' }),
        expect.objectContaining({ table: 'contract_lines' }),
      ]),
    );
    expect(JSON.stringify(activeClientsMetric)).not.toContain('client_contract_lines');
  });
});
