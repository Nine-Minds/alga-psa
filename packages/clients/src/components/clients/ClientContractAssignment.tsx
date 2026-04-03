'use client';

import React, { useState, useEffect } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus, MoreVertical, Calendar, AlertCircle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import { IContract } from '@alga-psa/types';
import { IClientContract } from '@alga-psa/types';
import { getContractsAsync } from '../../lib/billingHelpers';
import {
  getClientContracts,
  getDetailedClientContract,
  assignContractToClient,
  updateClientContract,
  deactivateClientContract,
  applyContractToClient
} from '@alga-psa/clients/actions';
import { getClientById } from '@alga-psa/clients/actions';
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
  const [clientContracts, setClientContracts] = useState<DetailedClientContract[]>([]);
  const [availableContracts, setAvailableContracts] = useState<IContract[]>([]);
  const [selectedContractToAdd, setSelectedContractToAdd] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string>('');
  const [editingContract, setEditingContract] = useState<DetailedClientContract | null>(null); // Keep state for editing dialog
  // Remove state for separate details dialog

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

      // Get all contracts and client contracts
      const [contracts, clientContractsData] = await Promise.all([
        getContractsAsync(),
        getClientContracts(clientId)
      ]);

      // Get detailed information for each client contract
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
      setAvailableContracts(contracts.filter(c => c.is_active));

      const activeContracts = contracts.filter((c) => c.is_active);
      if (activeContracts.length > 0) {
        setSelectedContractToAdd(activeContracts[0].contract_id || null);
      } else {
        setSelectedContractToAdd(null);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setError(t('clientContractAssignment.loadError', { defaultValue: 'Failed to load contracts data' }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddContract = async (payload: ClientContractDialogSubmission) => {
    if (!clientId || !selectedContractToAdd) return;
    
    try {
      const createdAssignment = await assignContractToClient(
        clientId,
        selectedContractToAdd,
        payload.startDate,
        payload.endDate,
        payload.endDate
          ? {
              renewal_mode: payload.renewal_mode,
              notice_period_days: payload.notice_period_days,
              renewal_term_months: payload.renewal_term_months,
              use_tenant_renewal_defaults: payload.use_tenant_renewal_defaults,
            }
          : undefined
      );
      
      if (createdAssignment.client_contract_id) {
        await applyContractToClient(createdAssignment.client_contract_id);
      }
      
      await fetchData(); // Refresh data
      await onAssignmentsChanged?.();
    } catch (error: any) {
      console.error('Error adding contract to client:', error);
      // Try to extract backend error message
      let errorMsg = t('clientContractAssignment.addError', { defaultValue: 'Failed to add contract to client' });
      if (error?.message) {
        errorMsg = error.message;
      } else if (typeof error === 'string') {
        errorMsg = error;
      } else if (error?.response?.data?.message) {
        errorMsg = error.response.data.message;
      }
      // Replace clientId with clientName in error message if present
      if (clientName && errorMsg.includes(clientId)) {
        errorMsg = errorMsg.replaceAll(clientId, clientName);
      }
      setError(errorMsg);
    }
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
      dataIndex: 'is_active',
      render: (value) => (
        <Badge variant={value ? 'success' : 'default-muted'}>
          {value
            ? t('common.states.active', { defaultValue: 'Active' })
            : t('common.states.inactive', { defaultValue: 'Inactive' })}
        </Badge>
      ),
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

  const selectableContracts = availableContracts;

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
            
            <div className="flex space-x-2 mt-4">
              <CustomSelect
                options={selectableContracts.map(c => ({
                  value: c.contract_id!,
                  label: c.contract_name
                }))}
                onValueChange={setSelectedContractToAdd}
                value={selectedContractToAdd || ''}
                placeholder={t('clientContractAssignment.selectContract', { defaultValue: 'Select contract...' })}
                className="flex-grow"
              />
              <ClientContractDialog
                onContractAssigned={handleAddContract}
                triggerButton={
                  <Button
                    id="assign-contract-button"
                    disabled={!selectedContractToAdd || selectableContracts.length === 0}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {t('clientContractAssignment.assignContract', { defaultValue: 'Assign Contract' })}
                  </Button>
                }
              />
            </div>
          </>
        )}
      </Box>
      
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
