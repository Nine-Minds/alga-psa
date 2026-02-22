import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/ClientContractsTab.tsx', import.meta.url),
  'utf8'
);

describe('ClientContractsTab upcoming renewals widget', () => {
  it('renders standard tabs for Contracts and Upcoming Renewals', () => {
    expect(source).toContain("import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';");
    expect(source).toContain('data-testid="client-contracts-upcoming-renewals-tabs"');
    expect(source).toContain('data-testid="client-contracts-tab-trigger"');
    expect(source).toContain('data-testid="upcoming-renewals-tab-trigger"');
    expect(source).toContain('Upcoming Renewals ({totalUpcomingRenewals})');
  });

  it('renders an Upcoming Renewals summary widget in the upcoming renewals tab', () => {
    expect(source).toContain("data-testid=\"upcoming-renewals-widget\"");
    expect(source).toContain('Upcoming Renewals');
    expect(source).toContain('Contracts with renewal decisions due in the next 90 days.');
    expect(source).toContain("import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';");
    expect(source).toContain('const renewalBucketOptions: SelectOption[] = [');
    expect(source).toContain("{ value: '0-30', label: `0-30 days (${upcomingRenewalBuckets.days0to30})` }");
    expect(source).toContain("{ value: '31-60', label: `31-60 days (${upcomingRenewalBuckets.days31to60})` }");
    expect(source).toContain("{ value: '61-90', label: `61-90 days (${upcomingRenewalBuckets.days61to90})` }");
    expect(source).toContain('data-testid="upcoming-renewals-bucket-filter-dropdown"');
    expect(source).toContain('id="upcoming-renewals-bucket-filter-select"');
  });

  it('loads renewal queue summary data for the widget', () => {
    expect(source).toContain("from '@alga-psa/billing/actions/renewalsQueueActions';");
    expect(source).toContain('markRenewalQueueItemRenewing');
    expect(source).toContain('markRenewalQueueItemNonRenewing');
    expect(source).toContain('const [upcomingRenewalBuckets, setUpcomingRenewalBuckets] = useState<UpcomingRenewalBucketCounts>({');
    expect(source).toContain('const syncRenewalRows = (rows: RenewalQueueRow[]) => {');
    expect(source).toContain('const refreshRenewalRows = async () => {');
    expect(source).toContain('const renewalRows = await listRenewalQueueRows();');
    expect(source).toContain('syncRenewalRows(renewalRows);');
  });

  it('filters upcoming renewals list by 0-30, 31-60, and 61-90 buckets with list filtering', () => {
    expect(source).toContain("const [renewalsBucket, setRenewalsBucket] = useState<UpcomingRenewalBucket>('0-30');");
    expect(source).toContain("const [renewalsSearchTerm, setRenewalsSearchTerm] = useState('');");
    expect(source).toContain("if (renewalsBucket === '0-30' && (daysUntilDue < 0 || daysUntilDue > 30)) {");
    expect(source).toContain("if (renewalsBucket === '31-60' && (daysUntilDue < 31 || daysUntilDue > 60)) {");
    expect(source).toContain("if (renewalsBucket === '61-90' && (daysUntilDue < 61 || daysUntilDue > 90)) {");
    expect(source).toContain('data-testid="upcoming-renewals-list-filter"');
    expect(source).toContain('No upcoming renewals for the selected window.');
  });

  it('supports renewal decision actions directly in upcoming renewals rows', () => {
    expect(source).toContain('data-testid="upcoming-renewals-row-actions-trigger"');
    expect(source).toContain('data-testid="upcoming-renewals-action-mark-renewing"');
    expect(source).toContain('data-testid="upcoming-renewals-action-mark-non-renewing"');
    expect(source).toContain('const handleMarkRenewalRowRenewing = async (row: RenewalQueueRow) => {');
    expect(source).toContain('const handleMarkRenewalRowNonRenewing = async (row: RenewalQueueRow) => {');
    expect(source).toContain('await markRenewalQueueItemRenewing(rowId);');
    expect(source).toContain('await markRenewalQueueItemNonRenewing(rowId);');
  });
});
