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
    expect(source).toContain("defaultValue: 'Upcoming Renewals ({{count}})',");
    expect(source).toContain('count: totalUpcomingRenewals,');
  });

  it('renders an Upcoming Renewals summary widget in the upcoming renewals tab', () => {
    expect(source).toContain("data-testid=\"upcoming-renewals-widget\"");
    expect(source).toContain('Upcoming Renewals');
    expect(source).toContain('Contracts with renewal decisions due within the selected window.');
    expect(source).toContain("import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';");
    expect(source).toContain('const renewalBucketOptions: SelectOption[] = [');
    expect(source).toContain("{ value: '30', label: t('clientContracts.upcoming.window.next30', { defaultValue: 'Next 30 days' }) }");
    expect(source).toContain("{ value: '60', label: t('clientContracts.upcoming.window.next60', { defaultValue: 'Next 60 days' }) }");
    expect(source).toContain("{ value: '90', label: t('clientContracts.upcoming.window.next90', { defaultValue: 'Next 90 days' }) }");
    expect(source).toContain('data-testid="upcoming-renewals-bucket-filter-dropdown"');
    expect(source).toContain('id="upcoming-renewals-bucket-filter-select"');
  });

  it('loads renewal queue summary data for the widget', () => {
    expect(source).toContain("from '@alga-psa/billing/actions/renewalsQueueActions';");
    expect(source).toContain('markRenewalQueueItemRenewing');
    expect(source).toContain('markRenewalQueueItemNonRenewing');
    expect(source).toContain('const [renewalRows, setRenewalRows] = useState<RenewalQueueRow[]>([]);');
    expect(source).toContain('const syncRenewalRows = (rows: RenewalQueueRow[]) => {');
    expect(source).toContain('const refreshRenewalRows = async () => {');
    expect(source).toContain('const renewalRows = await listRenewalQueueRows();');
    expect(source).toContain('syncRenewalRows(renewalRows);');
  });

  it('filters upcoming renewals list by 30, 60, and 90 day windows with list filtering', () => {
    expect(source).toContain("const [renewalsWindow, setRenewalsWindow] = useState<UpcomingRenewalWindow>('30');");
    expect(source).toContain("const [renewalsSearchTerm, setRenewalsSearchTerm] = useState('');");
    expect(source).toContain("type UpcomingRenewalWindow = '30' | '60' | '90' | 'all';");
    expect(source).toContain("if (renewalsWindow !== 'all' && (daysUntilDue < 0 || daysUntilDue > Number(renewalsWindow))) {");
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
