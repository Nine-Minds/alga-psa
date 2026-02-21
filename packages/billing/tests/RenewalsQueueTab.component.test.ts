import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/RenewalsQueueTab.tsx', import.meta.url),
  'utf8'
);

describe('RenewalsQueueTab component', () => {
  it('exists as a standalone billing dashboard component', () => {
    expect(source).toContain('interface RenewalsQueueTabProps {');
    expect(source).toContain('onQueueMutationComplete?: () => void;');
    expect(source).toContain('export default function RenewalsQueueTab({ onQueueMutationComplete }: RenewalsQueueTabProps) {');
    expect(source).toContain('const DEFAULT_HORIZON_DAYS = 90;');
    expect(source).toContain("type RenewalBucket = 'all' | '0-30' | '31-60' | '61-90';");
    expect(source).toContain('data-testid="renewals-queue-page"');
    expect(source).toContain('data-testid="renewals-queue-content"');
    expect(source).toContain('next {DEFAULT_HORIZON_DAYS} days');
  });

  it('loads renewal queue rows from a server action on mount', () => {
    expect(source).toContain("import { useSearchParams } from 'next/navigation';");
    expect(source).toContain('const searchParams = useSearchParams();');
    expect(source).toContain("listRenewalQueueRows,");
    expect(source).toContain('useEffect(() => {');
    expect(source).toContain('const result = await listRenewalQueueRows();');
    expect(source).toContain('setRows(result);');
    expect(source).toContain('onQueueMutationComplete?.();');
    expect(source).toContain('Loading renewal queue...');
    expect(source).toContain('const bucketParam = searchParams?.get(\'bucket\');');
    expect(source).toContain("if (bucketParam === '0-30' || bucketParam === '31-60' || bucketParam === '61-90' || bucketParam === 'all') {");
    expect(source).toContain('setBucket(bucketParam);');
  });

  it('renders quick bucket filters for 0-30, 31-60, and 61-90 day windows', () => {
    expect(source).toContain('data-testid="renewals-bucket-filters"');
    expect(source).toContain("(['all', '0-30', '31-60', '61-90'] as const)");
    expect(source).toContain("if (bucket === '0-30') return row.days_until_due >= 0 && row.days_until_due <= 30;");
    expect(source).toContain("if (bucket === '31-60') return row.days_until_due >= 31 && row.days_until_due <= 60;");
    expect(source).toContain('return row.days_until_due >= 61 && row.days_until_due <= 90;');
  });

  it('renders an owner filter for assigned users', () => {
    expect(source).toContain('const [ownerFilter, setOwnerFilter] = useState<string>(\'all\');');
    expect(source).toContain('data-testid="renewals-owner-filter"');
    expect(source).toContain('const uniqueOwners = Array.from(');
    expect(source).toContain('row.assigned_to ?? \'unassigned\'');
  });

  it('renders a status filter for pending/renewing/non_renewing/snoozed/completed', () => {
    expect(source).toContain("type RenewalStatus = 'all' | 'pending' | 'renewing' | 'non_renewing' | 'snoozed' | 'completed';");
    expect(source).toContain('const [statusFilter, setStatusFilter] = useState<RenewalStatus>(\'all\');');
    expect(source).toContain('data-testid="renewals-status-filter"');
    expect(source).toContain("(['all', 'pending', 'renewing', 'non_renewing', 'snoozed', 'completed'] as const)");
    expect(source).toContain("if (statusFilter !== 'all' && row.status !== statusFilter) {");
  });

  it('renders a renewal mode filter for none/manual/auto', () => {
    expect(source).toContain("type RenewalModeFilter = 'all' | 'none' | 'manual' | 'auto';");
    expect(source).toContain('const [renewalModeFilter, setRenewalModeFilter] = useState<RenewalModeFilter>(\'all\');');
    expect(source).toContain('data-testid="renewals-mode-filter"');
    expect(source).toContain("(['all', 'none', 'manual', 'auto'] as const)");
    expect(source).toContain("if (renewalModeFilter !== 'all' && row.effective_renewal_mode !== renewalModeFilter) {");
  });

  it('renders a contract type filter for fixed-term versus evergreen entries', () => {
    expect(source).toContain("type ContractTypeFilter = 'all' | 'fixed-term' | 'evergreen';");
    expect(source).toContain('const [contractTypeFilter, setContractTypeFilter] = useState<ContractTypeFilter>(\'all\');');
    expect(source).toContain('data-testid="renewals-contract-type-filter"');
    expect(source).toContain("(['all', 'fixed-term', 'evergreen'] as const)");
    expect(source).toContain("if (contractTypeFilter !== 'all' && row.contract_type !== contractTypeFilter) {");
  });

  it('shows days-remaining visual states for due-soon and overdue entries', () => {
    expect(source).toContain('const getDueState = (daysUntilDue: number | undefined): \'overdue\' | \'due-soon\' | \'upcoming\' => {');
    expect(source).toContain("if (daysUntilDue < 0) return 'overdue';");
    expect(source).toContain("if (daysUntilDue <= 7) return 'due-soon';");
    expect(source).toContain('data-testid="renewals-days-badge"');
    expect(source).toContain('Overdue by ${Math.abs(row.days_until_due ?? 0)}d');
  });

  it('exposes row-level available actions based on queue status', () => {
    expect(source).toContain('const [pendingRowActions, setPendingRowActions] = useState<Record<string, PendingRowAction | undefined>>({});');
    expect(source).toContain('const refreshRowsAfterMutation = async () => {');
    expect(source).toContain('const refreshQueueRowFromServer = async (clientContractId: string) => {');
    expect(source).toContain('const refreshedRow = result.find((candidate) => candidate.client_contract_id === clientContractId);');
    expect(source).toContain('await refreshQueueRowFromServer(rowId);');
    expect(source).toContain('const handleMarkRenewing = async (row: RenewalQueueRow) => {');
    expect(source).toContain('const handleMarkNonRenewing = async (row: RenewalQueueRow) => {');
    expect(source).toContain('data-testid="renewals-queue-row-available-actions"');
    expect(source).toContain("Actions: {row.available_actions.join(', ')}");
    expect(source).toContain('data-testid="renewals-queue-row-draft-link"');
    expect(source).toContain('Draft contract: {row.created_draft_contract_id}');
    expect(source).toContain('data-testid="renewals-row-action-mark-renewing"');
    expect(source).toContain('data-testid="renewals-row-action-mark-non-renewing"');
    expect(source).toContain('data-testid="renewals-row-action-pending"');
    expect(source).toContain('Updating action...');
  });
});
