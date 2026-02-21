import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/RenewalsQueueTab.tsx', import.meta.url),
  'utf8'
);

describe('RenewalsQueueTab component', () => {
  it('exists as a standalone billing dashboard component', () => {
    expect(source).toContain('export default function RenewalsQueueTab()');
    expect(source).toContain('const DEFAULT_HORIZON_DAYS = 90;');
    expect(source).toContain("type RenewalBucket = 'all' | '0-30' | '31-60' | '61-90';");
    expect(source).toContain('data-testid="renewals-queue-page"');
    expect(source).toContain('data-testid="renewals-queue-content"');
    expect(source).toContain('next {DEFAULT_HORIZON_DAYS} days');
  });

  it('loads renewal queue rows from a server action on mount', () => {
    expect(source).toContain("listRenewalQueueRows,");
    expect(source).toContain('useEffect(() => {');
    expect(source).toContain('const result = await listRenewalQueueRows();');
    expect(source).toContain('setRows(result);');
    expect(source).toContain('Loading renewal queue...');
  });

  it('renders quick bucket filters for 0-30, 31-60, and 61-90 day windows', () => {
    expect(source).toContain('data-testid="renewals-bucket-filters"');
    expect(source).toContain("(['all', '0-30', '31-60', '61-90'] as const)");
    expect(source).toContain("if (bucket === '0-30') return row.days_until_due >= 0 && row.days_until_due <= 30;");
    expect(source).toContain("if (bucket === '31-60') return row.days_until_due >= 31 && row.days_until_due <= 60;");
    expect(source).toContain('return row.days_until_due >= 61 && row.days_until_due <= 90;');
  });
});
