'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Box } from '@radix-ui/themes';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { MoreVertical, Wand2, Search, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
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
import { listRenewalQueueRows } from '@alga-psa/billing/actions/renewalsQueueActions';
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

const ClientContractsTab: React.FC<ClientContractsTabProps> = ({ onRefreshNeeded, refreshTrigger }) => {
  const router = useRouter();
  const [clientContracts, setClientContracts] = useState<IContractWithClient[]>([]);
  const [showClientWizard, setShowClientWizard] = useState(false);
  const [draftToResume, setDraftToResume] = useState<DraftContractWizardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [upcomingRenewalBuckets, setUpcomingRenewalBuckets] = useState<UpcomingRenewalBucketCounts>({
    days0to30: 0,
    days31to60: 0,
    days61to90: 0,
  });

  useEffect(() => {
    void fetchClientContracts();
  }, [refreshTrigger]);

  const navigateToRenewals = (bucket: 'all' | '0-30' | '31-60' | '61-90') => {
    const params = new URLSearchParams();
    params.set('tab', 'renewals');
    if (bucket !== 'all') {
      params.set('bucket', bucket);
    }
    router.push(`/msp/billing?${params.toString()}`);
  };

  const fetchClientContracts = async () => {
    try {
      setIsLoading(true);
      const fetchedAssignments = await getContractsWithClients();
      const renewalRows = await listRenewalQueueRows();
      const renewalRowsForWidget = renewalRows.filter(
        (row) => row.contract_type === 'fixed-term' || row.contract_type === 'evergreen'
      );
      setClientContracts(fetchedAssignments.filter((assignment) => Boolean(assignment.client_id)));
      setUpcomingRenewalBuckets({
        days0to30: renewalRowsForWidget.filter((row) => (row.days_until_due ?? Number.MAX_SAFE_INTEGER) <= 30).length,
        days31to60: renewalRowsForWidget.filter(
          (row) => (row.days_until_due ?? Number.MAX_SAFE_INTEGER) >= 31 && (row.days_until_due ?? 0) <= 60
        ).length,
        days61to90: renewalRowsForWidget.filter(
          (row) => (row.days_until_due ?? Number.MAX_SAFE_INTEGER) >= 61 && (row.days_until_due ?? 0) <= 90
        ).length,
      });
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
      render: (value: any) => {
        if (!value) return '—';
        try {
          const date = new Date(value);
          return isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
        } catch {
          return '—';
        }
      },
    },
    {
      title: 'End Date',
      dataIndex: 'end_date',
      render: (value: any) => {
        if (!value) return '—';
        try {
          const date = new Date(value);
          return isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
        } catch {
          return '—';
        }
      },
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
          <section
            data-testid="upcoming-renewals-widget"
            className="mb-4 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-bg-100))] p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Upcoming Renewals</h3>
                <p className="text-xs text-[rgb(var(--color-text-500))]">
                  Contracts with renewal decisions due in the next 90 days.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Button
                  id="upcoming-renewals-nav-0-30"
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateToRenewals('0-30')}
                  data-testid="upcoming-renewals-bucket-0-30"
                >
                  <Badge variant="info">0-30: {upcomingRenewalBuckets.days0to30}</Badge>
                </Button>
                <Button
                  id="upcoming-renewals-nav-31-60"
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateToRenewals('31-60')}
                  data-testid="upcoming-renewals-bucket-31-60"
                >
                  <Badge variant="default">31-60: {upcomingRenewalBuckets.days31to60}</Badge>
                </Button>
                <Button
                  id="upcoming-renewals-nav-61-90"
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateToRenewals('61-90')}
                  data-testid="upcoming-renewals-bucket-61-90"
                >
                  <Badge variant="default-muted">61-90: {upcomingRenewalBuckets.days61to90}</Badge>
                </Button>
              </div>
            </div>
          </section>

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
