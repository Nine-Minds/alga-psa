'use client';

import React, { useState, useEffect } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus, MoreVertical, Calendar, AlertCircle, Wand2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import { IClientContract } from '@alga-psa/types';
import {
  getClientContracts,
  getDetailedClientContract,
  updateClientContract,
  deactivateClientContract,
} from '@alga-psa/clients/actions';
import { getClientById } from '@alga-psa/clients/actions';
import { useClientCrossFeature } from '@alga-psa/clients/context/ClientCrossFeatureContext';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ClientContractDialog, ClientContractDialogSubmission } from './ClientContractDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ClientContractAssignmentProps {
  clientId: string;
  onAssignmentsChanged?: () => Promise<void> | void;
}

interface DetailedClientContract extends IClientContract {
  contract_name: string;
  description?: string;
  contract_line_count: number;
  contract_line_names?: string[];
}

const ClientContractAssignment: React.FC<ClientContractAssignmentProps> = ({ clientId, onAssignmentsChanged }) => {
  const { t } = useTranslation('msp/clients');
  const { renderContractWizard, renderContractQuickAdd } = useClientCrossFeature();
  const [clientContracts, setClientContracts] = useState<DetailedClientContract[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string>('');
  const [editingContract, setEditingContract] = useState<DetailedClientContract | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  useEffect(() => {
    if (clientId) {
      fetchData();
    }
  }, [clientId]);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Fetch client name
      const client = await getClientById(clientId);
      setClientName(client?.client_name || '');

      const clientContractsData = await getClientContracts(clientId);

      const detailedContracts: DetailedClientContract[] = [];
      for (const contract of clientContractsData) {
        if (contract.client_contract_id) {
          const detailedContract = await getDetailedClientContract(contract.client_contract_id);
          if (detailedContract) {
            detailedContracts.push({
              ...contract,
              contract_name: detailedContract.contract_name,
              description: detailedContract.description,
              contract_line_count: detailedContract.contract_line_count || 0,
              contract_line_names: detailedContract.contract_line_names || []
            });
          }
        }
      }

      setClientContracts(detailedContracts);
    } catch (error) {
      console.error('Error fetching data:', error);
      setError(t('clientContractAssignment.loadError', { defaultValue: 'Failed to load contracts data' }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleWizardComplete = async () => {
    setIsWizardOpen(false);
    await fetchData();
    await onAssignmentsChanged?.();
  };

  const handleQuickAddSaved = async () => {
    setIsQuickAddOpen(false);
    await fetchData();
    await onAssignmentsChanged?.();
  };

  const handleDeactivateContract = async (clientContractId: string) => {
    try {
      await deactivateClientContract(clientContractId);
      await fetchData(); // Refresh data
      await onAssignmentsChanged?.();
    } catch (error: any) {
      console.error('Error deactivating client contract:', error);
      let errorMsg = t('clientContractAssignment.deactivateError', { defaultValue: 'Failed to deactivate contract' });
      if (error?.message) {
        errorMsg = error.message;
      } else if (typeof error === 'string') {
        errorMsg = error;
      } else if (error?.response?.data?.message) {
        errorMsg = error.response.data.message;
      }
      if (clientName && errorMsg.includes(clientId)) {
        errorMsg = errorMsg.replaceAll(clientId, clientName);
      }
      setError(errorMsg);
    }
  };

  const handleEditContract = (contract: DetailedClientContract) => {
    setEditingContract(contract);
  };

  const handleContractUpdated = async (
    clientContractId: string,
    payload: ClientContractDialogSubmission
  ) => {
    try {
      await updateClientContract(clientContractId, { 
        start_date: payload.startDate,
        end_date: payload.endDate,
        use_tenant_renewal_defaults: payload.endDate ? payload.use_tenant_renewal_defaults : undefined,
        renewal_mode: payload.endDate ? payload.renewal_mode : 'none',
        notice_period_days: payload.endDate ? payload.notice_period_days : undefined,
        renewal_term_months: payload.endDate ? payload.renewal_term_months : undefined,
      });
      await fetchData(); // Refresh data
      setEditingContract(null);
      await onAssignmentsChanged?.();
    } catch (error: any) {
      console.error('Error updating client contract:', error);
      let errorMsg = t('clientContractAssignment.updateError', { defaultValue: 'Failed to update contract' });
      if (error?.message) {
        errorMsg = error.message;
      } else if (typeof error === 'string') {
        errorMsg = error;
      } else if (error?.response?.data?.message) {
        errorMsg = error.response.data.message;
      }
      if (clientName && errorMsg.includes(clientId)) {
        errorMsg = errorMsg.replaceAll(clientId, clientName);
      }
      setError(errorMsg);
    }
  };

  const formatDate = (dateString: string | null): string => {
    if (!dateString) {
      return t('clientContractAssignment.ongoing', { defaultValue: 'Ongoing' });
    }
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const getRenewalSummary = (contract: DetailedClientContract): string => {
    if (!contract.end_date) {
      return t('clientContractAssignment.ongoing', { defaultValue: 'Ongoing' });
    }

    const renewalMode = contract.effective_renewal_mode ?? contract.renewal_mode ?? 'manual';
    if (renewalMode === 'auto') {
      return t('clientContractAssignment.autoRenew', { defaultValue: 'Auto-renew' });
    }
    if (renewalMode === 'none') {
      return t('clientContractAssignment.nonRenewing', { defaultValue: 'Non-renewing' });
    }
    if (contract.decision_due_date) {
      return t('clientContractAssignment.manualDue', {
        defaultValue: 'Manual (due {{date}})',
        date: formatDate(contract.decision_due_date)
      });
    }
    return t('clientContractAssignment.manualRenewal', { defaultValue: 'Manual renewal' });
  };

  const contractColumns: ColumnDefinition<DetailedClientContract>[] = [
    {
      title: t('clientContractAssignment.contractName', { defaultValue: 'Contract Name' }),
      dataIndex: 'contract_name',
      // Revert to just displaying the value, no button/dialog trigger needed here
      render: (value) => value,
    },
    {
      title: t('clientContractAssignment.description', { defaultValue: 'Description' }),
      dataIndex: 'description',
      render: (value) => value || t('clientContractAssignment.noDescription', { defaultValue: 'No description' }),
    },
    {
      title: t('clientContractAssignment.startDate', { defaultValue: 'Start Date' }),
      dataIndex: 'start_date',
      render: (value) => formatDate(value),
    },
    {
      title: t('clientContractAssignment.endDate', { defaultValue: 'End Date' }),
      dataIndex: 'end_date',
      render: (value) => formatDate(value),
    },
    {
      title: t('clientContractAssignment.renewal', { defaultValue: 'Renewal' }),
      dataIndex: 'effective_renewal_mode',
      render: (_value, record) => getRenewalSummary(record),
    },
    {
      title: t('clientContractAssignment.status', { defaultValue: 'Status' }),
      dataIndex: 'assignment_status',
      render: (_value, record) => {
        const rec = record as any;
        const rawStatus: string = (rec.assignment_status ?? rec.contract_status ?? (record.is_active ? 'active' : 'inactive')).toString().toLowerCase();
        const variantByStatus: Record<string, 'success' | 'warning' | 'default-muted' | 'error' | 'info'> = {
          active: 'success',
          draft: 'default-muted',
          expired: 'error',
          terminated: 'warning',
          archived: 'default-muted',
          published: 'success',
          inactive: 'default-muted',
        };
        const labelByStatus: Record<string, string> = {
          active: t('common.states.active', { defaultValue: 'Active' }),
          draft: t('common.states.draft', { defaultValue: 'Draft' }),
          expired: t('common.states.expired', { defaultValue: 'Expired' }),
          terminated: t('common.states.terminated', { defaultValue: 'Terminated' }),
          archived: t('common.states.archived', { defaultValue: 'Archived' }),
          published: t('common.states.published', { defaultValue: 'Published' }),
          inactive: t('common.states.inactive', { defaultValue: 'Inactive' }),
        };
        return (
          <Badge variant={variantByStatus[rawStatus] ?? 'default-muted'}>
            {labelByStatus[rawStatus] ?? rawStatus}
          </Badge>
        );
      },
    },
    {
      title: t('clientContractAssignment.contractLines', { defaultValue: 'Contract Lines' }),
      dataIndex: 'contract_line_names',
      render: (contractLineNames: string[] | undefined) => {
        if (!contractLineNames || contractLineNames.length === 0) {
          return '0';
        }
        return contractLineNames.join(', ');
      },
    },
    {
      title: t('clientContractAssignment.actions', { defaultValue: 'Actions' }),
      dataIndex: 'client_contract_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="client-contract-actions-menu"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">{t('clientContractAssignment.openMenu', { defaultValue: 'Open menu' })}</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id="edit-client-contract-menu-item"
              onClick={() => handleEditContract(record)}
            >
              <Calendar className="h-4 w-4 mr-2" />
              {t('common.actions.edit', { defaultValue: 'Edit' })}
            </DropdownMenuItem>
            {record.is_active && (
              <DropdownMenuItem
                id="deactivate-client-contract-menu-item"
                className="text-red-600 focus:text-red-600"
                onClick={(e) => {
                  e.stopPropagation(); // Prevent event bubbling to row click
                  handleDeactivateContract(value);
                }}
              >
                {t('clientContractAssignment.unassign', { defaultValue: 'Unassign' })}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <Card size="2">
      <Box p="4">
        <h3 className="text-lg font-medium mb-4">{t('clientContractAssignment.title', { defaultValue: 'Contracts' })}</h3>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="text-center py-4">{t('clientContractAssignment.loading', { defaultValue: 'Loading contracts...' })}</div>
        ) : (
          <>
            <div className="mb-4">
              {clientContracts.length === 0 ? (
                <div className="text-center py-4 text-gray-500">
                  {t('clientContractAssignment.empty', { defaultValue: 'No contracts have been assigned to this client yet.' })}
                </div>
              ) : (
                <DataTable
                  id="client-contract-assignment-table"
                  data={clientContracts}
                  columns={contractColumns}
                  pagination={true}
                  currentPage={currentPage}
                  onPageChange={setCurrentPage}
                  pageSize={pageSize}
                  onItemsPerPageChange={handlePageSizeChange}
                  onRowClick={handleEditContract} // Keep row click handler
                  rowClassName={() => 'cursor-pointer'} // Use function for type compatibility
                />
              )}
            </div>
            
            <div className="flex flex-wrap gap-2 mt-4 justify-end">
              <Button
                id="quick-add-contract-button"
                variant="outline"
                className="inline-flex items-center gap-2"
                onClick={() => setIsQuickAddOpen(true)}
                disabled={!renderContractQuickAdd}
              >
                <Plus className="h-4 w-4" />
                {t('clientContractAssignment.quickAdd', { defaultValue: 'Quick Add' })}
              </Button>
              <Button
                id="create-contract-button"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700"
                onClick={() => setIsWizardOpen(true)}
                disabled={!renderContractWizard}
              >
                <Wand2 className="h-4 w-4" />
                {t('clientContractAssignment.createContract', { defaultValue: 'Create Contract' })}
              </Button>
            </div>
          </>
        )}
      </Box>

      {renderContractWizard?.({
        open: isWizardOpen,
        onOpenChange: setIsWizardOpen,
        onComplete: handleWizardComplete,
        clientId,
      })}

      {renderContractQuickAdd?.({
        open: isQuickAddOpen,
        onOpenChange: setIsQuickAddOpen,
        onSaved: handleQuickAddSaved,
        clientId,
      })}

      {editingContract && (
        <ClientContractDialog
          isOpen={true}
          onClose={() => setEditingContract(null)}
          onContractAssigned={(payload: ClientContractDialogSubmission) =>
            handleContractUpdated(editingContract.client_contract_id, payload)
          }
          initialStartDate={editingContract.start_date}
          initialEndDate={editingContract.end_date}
          initialRenewalMode={editingContract.renewal_mode}
          initialNoticePeriodDays={editingContract.notice_period_days}
          initialRenewalTermMonths={editingContract.renewal_term_months}
          initialUseTenantRenewalDefaults={editingContract.use_tenant_renewal_defaults}
          contractLineNames={editingContract.contract_line_names}
        />
      )}

      {/* Removed the separate details dialog */}
    </Card>
  );
};

export default ClientContractAssignment;
