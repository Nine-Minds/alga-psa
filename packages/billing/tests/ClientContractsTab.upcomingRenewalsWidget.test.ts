import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/ClientContractsTab.tsx', import.meta.url),
  'utf8'
);

describe('ClientContractsTab upcoming renewals widget', () => {
  it('renders an Upcoming Renewals summary widget in the client contracts tab', () => {
    expect(source).toContain("data-testid=\"upcoming-renewals-widget\"");
    expect(source).toContain('Upcoming Renewals');
    expect(source).toContain('Contracts with renewal decisions due in the next 90 days.');
  });

  it('loads renewal queue summary data for the widget', () => {
    expect(source).toContain("import { listRenewalQueueRows } from '@alga-psa/billing/actions/renewalsQueueActions';");
    expect(source).toContain('const [upcomingRenewalTotal, setUpcomingRenewalTotal] = useState(0);');
    expect(source).toContain('const renewalRows = await listRenewalQueueRows();');
    expect(source).toContain('setUpcomingRenewalTotal(renewalRows.length);');
  });
});
