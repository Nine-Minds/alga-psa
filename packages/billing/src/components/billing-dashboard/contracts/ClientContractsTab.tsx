'use client';

import React, { useEffect, useState } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { MoreVertical, Wand2, Search, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { ColumnDefinition } from '@alga-psa/types';
import { IContractWithClient } from '@alga-psa/types';
import {
  checkClientHasActiveContract,
  deleteContract,
  getContractsWithClients,
  updateContract,
} from '@alga-psa/billing/actions/contractActions';
import {
  getDraftContractForResume,
  type DraftContractWizardData,
} from '@alga-psa/billing/actions/contractWizardActions';
import {
  listRenewalQueueRows,
  markRenewalQueueItemNonRenewing,
  markRenewalQueueItemRenewing,
  type RenewalQueueAction,
  type RenewalQueueRow,
} from '@alga-psa/billing/actions/renewalsQueueActions';
import { ContractWizard } from './ContractWizard';
import { ContractDialog } from './ContractDialog';

interface ClientContractsTabProps {
  onRefreshNeeded?: () => void;
  refreshTrigger?: number;
}

type UpcomingRenewalBucketCounts = {
  days0to30: number;
  days31to60: number;
  days61to90: number;
};
type UpcomingRenewalBucket = '0-30' | '31-60' | '61-90';
type PendingUpcomingRenewalAction = Extract<RenewalQueueAction, 'mark_renewing' | 'mark_non_renewing'>;

const getAvailableActionsForStatus = (status: RenewalQueueRow['status']): RenewalQueueAction[] => {
  if (status === 'pending') {
    return ['mark_renewing', 'mark_non_renewing', 'create_renewal_draft', 'snooze', 'assign_owner'];
  }
  if (status === 'renewing') {
    return ['mark_non_renewing', 'create_renewal_draft', 'snooze', 'assign_owner'];
  }
  if (status === 'non_renewing') {
    return ['mark_renewing', 'assign_owner'];
  }
  if (status === 'snoozed') {
    return ['mark_renewing', 'mark_non_renewing', 'create_renewal_draft', 'assign_owner'];
  }
  return ['assign_owner'];
};

const toWidgetRenewalRows = (rows: RenewalQueueRow[]): RenewalQueueRow[] =>
  rows.filter((row) => row.contract_type === 'fixed-term' || row.contract_type === 'evergreen');

const toUpcomingRenewalBucketCounts = (rows: RenewalQueueRow[]): UpcomingRenewalBucketCounts => ({
  days0to30: rows.filter((row) => (row.days_until_due ?? Number.MAX_SAFE_INTEGER) <= 30).length,
  days31to60: rows.filter(
    (row) => (row.days_until_due ?? Number.MAX_SAFE_INTEGER) >= 31 && (row.days_until_due ?? 0) <= 60
  ).length,
  days61to90: rows.filter(
    (row) => (row.days_until_due ?? Number.MAX_SAFE_INTEGER) >= 61 && (row.days_until_due ?? 0) <= 90
  ).length,
});

const ClientContractsTab: React.FC<ClientContractsTabProps> = ({ onRefreshNeeded, refreshTrigger }) => {
  const router = useRouter();
  const [clientContracts, setClientContracts] = useState<IContractWithClient[]>([]);
  const [renewalRows, setRenewalRows] = useState<RenewalQueueRow[]>([]);
  const [showClientWizard, setShowClientWizard] = useState(false);
  const [draftToResume, setDraftToResume] = useState<DraftContractWizardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [renewalsSearchTerm, setRenewalsSearchTerm] = useState('');
  const [renewalsBucket, setRenewalsBucket] = useState<UpcomingRenewalBucket>('0-30');
  const [contractsViewTab, setContractsViewTab] = useState('contracts');
  const [pendingUpcomingRenewalActions, setPendingUpcomingRenewalActions] = useState<Record<string, PendingUpcomingRenewalAction | undefined>>({});
  const [upcomingRenewalBuckets, setUpcomingRenewalBuckets] = useState<UpcomingRenewalBucketCounts>({
    days0to30: 0,
    days31to60: 0,
    days61to90: 0,
  });

  useEffect(() => {
    void fetchClientContracts();
  }, [refreshTrigger]);

  const syncRenewalRows = (rows: RenewalQueueRow[]) => {
    const rowsForWidget = toWidgetRenewalRows(rows);
    setRenewalRows(rowsForWidget);
    setUpcomingRenewalBuckets(toUpcomingRenewalBucketCounts(rowsForWidget));
  };

  const refreshRenewalRows = async () => {
    const rows = await listRenewalQueueRows();
    syncRenewalRows(rows);
  };

  const fetchClientContracts = async () => {
    try {
      setIsLoading(true);
      const fetchedAssignments = await getContractsWithClients();
      const renewalRows = await listRenewalQueueRows();
      syncRenewalRows(renewalRows);
      setClientContracts(fetchedAssignments.filter((assignment) => Boolean(assignment.client_id)));
      setError(null);
    } catch (err) {
      console.error('Error fetching client contracts:', err);
      setError('Failed to fetch client contracts');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteContract = async (contractId: string) => {
    try {
      await deleteContract(contractId);
      await fetchClientContracts();
      onRefreshNeeded?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete contract';
      alert(message);
    }
  };

  const handleTerminateContract = async (contractId: string) => {
    try {
      await updateContract(contractId, { status: 'terminated' });
      await fetchClientContracts();
      onRefreshNeeded?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to terminate contract';
      alert(message);
    }
  };

  const handleRestoreContract = async (contractId: string, clientId?: string) => {
    try {
      if (clientId) {
        const hasActiveContract = await checkClientHasActiveContract(clientId, contractId);
        if (hasActiveContract) {
          alert('Cannot restore this contract to active status because the client already has an active contract. Please terminate their current active contract first, or restore this contract as a draft.');
          return;
        }
      }
      await updateContract(contractId, { status: 'active' });
      await fetchClientContracts();
      onRefreshNeeded?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restore contract';
      alert(message);
    }
  };

  const handleSetToActive = async (contractId: string, clientId?: string) => {
    try {
      if (clientId) {
        const hasActiveContract = await checkClientHasActiveContract(clientId, contractId);
        if (hasActiveContract) {
          alert('Cannot set this contract to active because the client already has an active contract. Please terminate their current active contract first.');
          return;
        }
      }
      await updateContract(contractId, { status: 'active' });
      await fetchClientContracts();
      onRefreshNeeded?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to activate contract';
      alert(message);
    }
  };

  const handleResumeDraft = async (contractId: string) => {
    try {
      setIsLoading(true);
      const draftData = await getDraftContractForResume(contractId);
      setDraftToResume(draftData);
      setShowClientWizard(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resume draft';
      alert(message);
    } finally {
      setIsLoading(false);
    }
  };

  const navigateToContract = (contractId?: string, clientContractId?: string) => {
    if (contractId) {
      const params = new URLSearchParams();
      if (clientContractId) {
        // Client contract - use client-contracts tab
        params.set('tab', 'client-contracts');
        params.set('contractId', contractId);
        params.set('clientContractId', clientContractId);
      } else {
        // Template contract - use contract-templates tab
        params.set('tab', 'contract-templates');
        params.set('contractId', contractId);
      }
      router.push(`/msp/billing?${params.toString()}`);
    }
  };

  const renderStatusBadge = (status: string) => {
    const normalized = (status || 'draft').toLowerCase();
    const statusConfig: Record<string, { variant: 'success' | 'default-muted' | 'warning' | 'error' | 'info'; label: string }> = {
      active: { variant: 'success', label: 'Active' },
      draft: { variant: 'default-muted', label: 'Draft' },
      terminated: { variant: 'warning', label: 'Terminated' },
      expired: { variant: 'error', label: 'Expired' },
      published: { variant: 'success', label: 'Published' },
      archived: { variant: 'default-muted', label: 'Archived' },
    };
    const config = statusConfig[normalized] ?? statusConfig.draft;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const formatDateValue = (value: unknown): string => {
    if (!value) return '—';
    if (!(typeof value === 'string' || typeof value === 'number' || value instanceof Date)) {
      return '—';
    }

    const date = new Date(value);
    return isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
  };

  const clientContractColumns: ColumnDefinition<IContractWithClient>[] = [
    {
      title: 'Client',
      dataIndex: 'client_name',
      render: (value: string | null) =>
        typeof value === 'string' && value.trim().length > 0 ? value : '—',
    },
    {
      title: 'Contract Template',
      dataIndex: 'template_contract_name',
      render: (value: string | null) =>
        value && value.trim().length > 0 ? value : '—',
    },
    {
      title: 'Contract Name',
      dataIndex: 'contract_name',
      render: (value: string | null) =>
        typeof value === 'string' && value.trim().length > 0 ? value : '—',
    },
    {
      title: 'Start Date',
      dataIndex: 'start_date',
      render: (value: unknown) => formatDateValue(value),
    },
    {
      title: 'End Date',
      dataIndex: 'end_date',
      render: (value: unknown) => formatDateValue(value),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: renderStatusBadge,
    },
    {
      title: 'Actions',
      dataIndex: 'contract_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="contract-actions-menu"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={record.status === 'draft' ? 'resume-contract-menu-item' : 'edit-contract-menu-item'}
              onClick={(event) => {
                event.stopPropagation();
                if (!record.contract_id) return;
                if (record.status === 'draft') {
                  void handleResumeDraft(record.contract_id);
                  return;
                }
                navigateToContract(record.contract_id, record.client_contract_id);
              }}
            >
              {record.status === 'draft' ? 'Resume' : 'Edit'}
            </DropdownMenuItem>
            {record.status === 'active' && (
              <DropdownMenuItem
                id="terminate-contract-menu-item"
                className="text-orange-600 focus:text-orange-600"
                onClick={(event) => {
                  event.stopPropagation();
                  if (record.contract_id) {
                    void handleTerminateContract(record.contract_id);
                  }
                }}
              >
                Terminate
              </DropdownMenuItem>
            )}
            {record.status === 'terminated' && (
              <DropdownMenuItem
                id="restore-contract-menu-item"
                className="text-green-600 focus:text-green-600"
                onClick={(event) => {
                  event.stopPropagation();
                  if (record.contract_id) {
                    void handleRestoreContract(record.contract_id, record.client_id);
                  }
                }}
              >
                Restore
              </DropdownMenuItem>
            )}
            {record.status === 'draft' && (
              <DropdownMenuItem
                id="set-to-active-menu-item"
                className="text-green-600 focus:text-green-600"
                onClick={(event) => {
                  event.stopPropagation();
                  if (record.contract_id) {
                    void handleSetToActive(record.contract_id, record.client_id);
                  }
                }}
              >
                Set to Active
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              id="delete-contract-menu-item"
              className="text-red-600 focus:text-red-600"
              onClick={(event) => {
                event.stopPropagation();
                if (record.contract_id) {
                  void handleDeleteContract(record.contract_id);
                }
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const filteredClientContracts = clientContracts.filter((contract) => {
    if (!clientSearchTerm) {
      return true;
    }
    const search = clientSearchTerm.toLowerCase();
    return (
      contract.contract_name?.toLowerCase().includes(search) ||
      contract.template_contract_name?.toLowerCase().includes(search) ||
      contract.client_name?.toLowerCase().includes(search)
    );
  });
  const renderRenewalStatusBadge = (status: RenewalQueueRow['status']) => {
    if (status === 'renewing') return <Badge variant="success">Renewing</Badge>;
    if (status === 'non_renewing') return <Badge variant="warning">Non-renewing</Badge>;
    if (status === 'snoozed') return <Badge variant="info">Snoozed</Badge>;
    if (status === 'completed') return <Badge variant="default-muted">Completed</Badge>;
    return <Badge variant="default">Pending</Badge>;
  };

  const handleMarkRenewalRowRenewing = async (row: RenewalQueueRow) => {
    const rowId = row.client_contract_id;
    setPendingUpcomingRenewalActions((current) => ({ ...current, [rowId]: 'mark_renewing' }));
    setRenewalRows((current) =>
      current.map((candidate) =>
        candidate.client_contract_id === rowId
          ? {
              ...candidate,
              status: 'renewing',
              available_actions: getAvailableActionsForStatus('renewing'),
            }
          : candidate
      )
    );

    try {
      await markRenewalQueueItemRenewing(rowId);
      await refreshRenewalRows();
      onRefreshNeeded?.();
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : 'Failed to mark renewal as renewing';
      alert(message);
      await refreshRenewalRows();
    } finally {
      setPendingUpcomingRenewalActions((current) => ({ ...current, [rowId]: undefined }));
    }
  };

  const handleMarkRenewalRowNonRenewing = async (row: RenewalQueueRow) => {
    const rowId = row.client_contract_id;
    setPendingUpcomingRenewalActions((current) => ({ ...current, [rowId]: 'mark_non_renewing' }));
    setRenewalRows((current) =>
      current.map((candidate) =>
        candidate.client_contract_id === rowId
          ? {
              ...candidate,
              status: 'non_renewing',
              available_actions: getAvailableActionsForStatus('non_renewing'),
            }
          : candidate
      )
    );

    try {
      await markRenewalQueueItemNonRenewing(rowId);
      await refreshRenewalRows();
      onRefreshNeeded?.();
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : 'Failed to mark renewal as non-renewing';
      alert(message);
      await refreshRenewalRows();
    } finally {
      setPendingUpcomingRenewalActions((current) => ({ ...current, [rowId]: undefined }));
    }
  };

  const upcomingRenewalColumns: ColumnDefinition<RenewalQueueRow>[] = [
    {
      title: 'Client',
      dataIndex: 'client_name',
      render: (value: string | null, record) =>
        typeof value === 'string' && value.trim().length > 0 ? value : record.client_id,
    },
    {
      title: 'Contract',
      dataIndex: 'contract_name',
      render: (value: string | null, record) =>
        typeof value === 'string' && value.trim().length > 0 ? value : record.contract_id,
    },
    {
      title: 'Type',
      dataIndex: 'contract_type',
      render: (value: RenewalQueueRow['contract_type']) => (
        <Badge variant={value === 'evergreen' ? 'info' : 'default'}>
          {value === 'evergreen' ? 'Evergreen' : 'Fixed-term'}
        </Badge>
      ),
    },
    {
      title: 'Decision Due',
      dataIndex: 'decision_due_date',
      render: (value: string | undefined) => value ?? '—',
    },
    {
      title: 'Days Until Due',
      dataIndex: 'days_until_due',
      render: (value: number | undefined) => (typeof value === 'number' ? String(value) : '—'),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: RenewalQueueRow['status']) => renderRenewalStatusBadge(value),
    },
    {
      title: 'Actions',
      dataIndex: 'client_contract_id',
      render: (_value: string, row: RenewalQueueRow) => {
        const hasMarkRenewing = row.available_actions.includes('mark_renewing');
        const hasMarkNonRenewing = row.available_actions.includes('mark_non_renewing');
        const isPending = Boolean(pendingUpcomingRenewalActions[row.client_contract_id]);

        if (!hasMarkRenewing && !hasMarkNonRenewing) {
          return <span className="text-[rgb(var(--color-text-400))]">—</span>;
        }

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id={`upcoming-renewals-row-actions-${row.client_contract_id}`}
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                data-testid="upcoming-renewals-row-actions-trigger"
                disabled={isPending}
              >
                <span className="sr-only">Open renewal actions</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {hasMarkRenewing && (
                <DropdownMenuItem
                  data-testid="upcoming-renewals-action-mark-renewing"
                  disabled={isPending}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleMarkRenewalRowRenewing(row);
                  }}
                >
                  Mark renewing
                </DropdownMenuItem>
              )}
              {hasMarkNonRenewing && (
                <DropdownMenuItem
                  data-testid="upcoming-renewals-action-mark-non-renewing"
                  disabled={isPending}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleMarkRenewalRowNonRenewing(row);
                  }}
                >
                  Mark non-renewing
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const totalUpcomingRenewals =
    upcomingRenewalBuckets.days0to30 +
    upcomingRenewalBuckets.days31to60 +
    upcomingRenewalBuckets.days61to90;

  const renewalBucketOptions: SelectOption[] = [
    { value: '0-30', label: `0-30 days (${upcomingRenewalBuckets.days0to30})` },
    { value: '31-60', label: `31-60 days (${upcomingRenewalBuckets.days31to60})` },
    { value: '61-90', label: `61-90 days (${upcomingRenewalBuckets.days61to90})` },
  ];

  const filteredUpcomingRenewals = renewalRows.filter((row) => {
    const daysUntilDue = row.days_until_due ?? Number.MAX_SAFE_INTEGER;
    if (renewalsBucket === '0-30' && (daysUntilDue < 0 || daysUntilDue > 30)) {
      return false;
    }
    if (renewalsBucket === '31-60' && (daysUntilDue < 31 || daysUntilDue > 60)) {
      return false;
    }
    if (renewalsBucket === '61-90' && (daysUntilDue < 61 || daysUntilDue > 90)) {
      return false;
    }

    if (!renewalsSearchTerm.trim()) {
      return true;
    }

    const search = renewalsSearchTerm.toLowerCase();
    return (
      row.client_name?.toLowerCase().includes(search) ||
      row.contract_name?.toLowerCase().includes(search) ||
      row.client_id.toLowerCase().includes(search) ||
      row.contract_id.toLowerCase().includes(search) ||
      row.decision_due_date?.toLowerCase().includes(search)
    );
  });

  if (isLoading) {
    return (
      <Card size="2">
        <Box p="4">
          <LoadingIndicator
            className="py-12 text-muted-foreground"
            layout="stacked"
            spinnerProps={{ size: 'md' }}
            text="Loading client contracts..."
            textClassName="text-muted-foreground"
          />
        </Box>
      </Card>
    );
  }

  if (error) {
    return (
      <Card size="2">
        <Box p="4">
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </Box>
      </Card>
    );
  }

  return (
    <>
      <Card size="2">
        <Box p="4">
          <Tabs
            value={contractsViewTab}
            onValueChange={setContractsViewTab}
            data-testid="client-contracts-upcoming-renewals-tabs"
          >
            <TabsList className="mb-4">
              <TabsTrigger value="contracts" data-testid="client-contracts-tab-trigger">
                Contracts
              </TabsTrigger>
              <TabsTrigger value="upcoming-renewals" data-testid="upcoming-renewals-tab-trigger">
                Upcoming Renewals ({totalUpcomingRenewals})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="contracts">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="relative max-w-md w-full">
                  <Search
                    className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    type="text"
                    placeholder="Search by client or contract..."
                    value={clientSearchTerm}
                    onChange={(event) => setClientSearchTerm(event.target.value)}
                    className="pl-10"
                    aria-label="Search client contracts"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <ContractDialog
                    onContractSaved={() => {
                      void fetchClientContracts();
                      onRefreshNeeded?.();
                    }}
                    triggerButton={
                      <Button
                        id="quick-add-contract-button"
                        variant="outline"
                        className="inline-flex items-center gap-2"
                      >
                        <Plus className="h-4 w-4" />
                        Quick Add
                      </Button>
                    }
                  />
                  <Button
                    id="client-wizard-button"
                    onClick={() => {
                      setDraftToResume(null);
                      setShowClientWizard(true);
                    }}
                    className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700"
                  >
                    <Wand2 className="h-4 w-4" />
                    Create Contract
                  </Button>
                </div>
              </div>

              <DataTable
                data={filteredClientContracts}
                columns={clientContractColumns}
                pagination
                onRowClick={(record) => navigateToContract(record.contract_id, record.client_contract_id)}
                rowClassName={() => 'cursor-pointer'}
              />
            </TabsContent>

            <TabsContent value="upcoming-renewals">
              <section
                data-testid="upcoming-renewals-widget"
                className="mb-4 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-bg-100))] p-4"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">Upcoming Renewals</h3>
                    <p className="text-xs text-[rgb(var(--color-text-500))]">
                      Contracts with renewal decisions due in the next 90 days.
                    </p>
                  </div>
                  <div
                    className="w-full md:w-[240px]"
                    data-testid="upcoming-renewals-bucket-filter-dropdown"
                  >
                    <CustomSelect
                      id="upcoming-renewals-bucket-filter-select"
                      options={renewalBucketOptions}
                      value={renewalsBucket}
                      onValueChange={(value) => setRenewalsBucket(value as UpcomingRenewalBucket)}
                      placeholder="Select renewal window"
                    />
                  </div>
                </div>
              </section>

              <div className="mb-4 relative max-w-md w-full">
                <Search
                  className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="text"
                  placeholder="Filter upcoming renewals..."
                  value={renewalsSearchTerm}
                  onChange={(event) => setRenewalsSearchTerm(event.target.value)}
                  className="pl-10"
                  aria-label="Filter upcoming renewals"
                  data-testid="upcoming-renewals-list-filter"
                />
              </div>

              {filteredUpcomingRenewals.length === 0 ? (
                <div
                  className="rounded-md border border-dashed border-[rgb(var(--color-border-200))] p-4 text-sm text-[rgb(var(--color-text-500))]"
                  data-testid="upcoming-renewals-empty-state"
                >
                  No upcoming renewals for the selected window.
                </div>
              ) : (
                <DataTable
                  data={filteredUpcomingRenewals}
                  columns={upcomingRenewalColumns}
                  pagination
                />
              )}
            </TabsContent>
          </Tabs>
        </Box>
      </Card>
      <ContractWizard
        open={showClientWizard}
        onOpenChange={(open) => {
          if (!open) {
            setDraftToResume(null);
          }
          setShowClientWizard(open);
        }}
        onComplete={() => {
          setShowClientWizard(false);
          setDraftToResume(null);
          void fetchClientContracts();
          onRefreshNeeded?.();
        }}
        editingContract={draftToResume}
      />
    </>
  );
};

export default ClientContractsTab;
