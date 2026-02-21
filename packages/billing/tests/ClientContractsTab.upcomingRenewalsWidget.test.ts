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
    expect(source).toContain('0-30: {upcomingRenewalBuckets.days0to30}');
    expect(source).toContain('31-60: {upcomingRenewalBuckets.days31to60}');
    expect(source).toContain('61-90: {upcomingRenewalBuckets.days61to90}');
    expect(source).toContain('data-testid="upcoming-renewals-bucket-0-30"');
    expect(source).toContain('data-testid="upcoming-renewals-bucket-31-60"');
    expect(source).toContain('data-testid="upcoming-renewals-bucket-61-90"');
  });

  it('loads renewal queue summary data for the widget', () => {
    expect(source).toContain("import { listRenewalQueueRows } from '@alga-psa/billing/actions/renewalsQueueActions';");
    expect(source).toContain('const [upcomingRenewalBuckets, setUpcomingRenewalBuckets] = useState<UpcomingRenewalBucketCounts>({');
    expect(source).toContain('const renewalRows = await listRenewalQueueRows();');
    expect(source).toContain('setUpcomingRenewalBuckets({');
    expect(source).toContain('days0to30: renewalRows.filter((row) => (row.days_until_due ?? Number.MAX_SAFE_INTEGER) <= 30).length');
  });

  it('navigates to renewals tab while preserving bucket filter context', () => {
    expect(source).toContain("const navigateToRenewals = (bucket: 'all' | '0-30' | '31-60' | '61-90') => {");
    expect(source).toContain("params.set('tab', 'renewals');");
    expect(source).toContain("if (bucket !== 'all') {");
    expect(source).toContain("params.set('bucket', bucket);");
    expect(source).toContain('router.push(`/msp/billing?${params.toString()}`);');
  });
});
