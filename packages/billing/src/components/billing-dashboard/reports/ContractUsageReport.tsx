'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { Card, Box } from '@radix-ui/themes';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import ClientNameCell from '@alga-psa/ui/components/ClientNameCell';
import { ColumnDefinition } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Button } from '@alga-psa/ui/components/Button';
import { IContract } from '@alga-psa/types';
import { getContracts } from '@alga-psa/billing/actions/contractActions';
import { getContractAssignmentsForReport } from '@alga-psa/billing/actions/billingClientsActions';
import Spinner from '@alga-psa/ui/components/Spinner';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

interface ContractUsageRecord {
  client_id: string;
  client_name: string;
  logoUrl: string | null;
  contract_id: string;
  contract_name: string;
  start_date: string;
  end_date: string | null;
  contract_line_count: number;
  total_billed: number;
  is_active: boolean;
}

const ContractUsageReport: React.FC = () => {
  const { t } = useTranslation('msp/reports');
  const { formatCurrency, formatDate } = useFormatters();
  const { currencyCode: tenantCurrency } = useCurrencyFormat();
  const [contracts, setContracts] = useState<IContract[]>([]);
  // Latest usage request; a slower response for a previously selected contract is dropped.
  const usageRequestRef = useRef(0);
  const [contractUsage, setContractUsage] = useState<ContractUsageRecord[]>([]);
  const [selectedContract, setSelectedContract] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const fetchedContracts = await getContracts();
      if (isReturnedActionError(fetchedContracts)) {
        setError(getErrorMessage(fetchedContracts));
        setContracts([]);
        return;
      }

      setContracts(fetchedContracts);

      // Set default selected contract if available
      if (fetchedContracts.length > 0) {
        setSelectedContract(fetchedContracts[0].contract_id);
        await fetchContractUsage(fetchedContracts[0].contract_id);
      }
    } catch (error) {
      console.error('Error fetching initial data:', error);
      setError(t('contractUsage.errors.loadInitialData', { defaultValue: 'Failed to load initial data' }));
    } finally {
      setIsLoading(false);
    }
  };

  const fetchContractUsage = async (contractId: string) => {
    const requestId = ++usageRequestRef.current;
    setIsLoading(true);
    setError(null);

    try {
      // One query for the clients that have this contract assigned (no per-client loop).
      const assignments = await getContractAssignmentsForReport(contractId);
      if (requestId !== usageRequestRef.current) return;
      if (isReturnedActionError(assignments)) {
        setError(getErrorMessage(assignments));
        return;
      }

      setContractUsage(assignments.map((assignment) => ({
        client_id: assignment.client_id,
        client_name: assignment.client_name || t('contractUsage.statusValues.unknownClient', { defaultValue: 'Unknown Client' }),
        logoUrl: assignment.client_logo_url ?? null,
        contract_id: contractId,
        contract_name: assignment.contract_name,
        start_date: assignment.start_date,
        end_date: assignment.end_date,
        contract_line_count: assignment.contract_line_count,
        // The detailed contract never reported a billed total, so this has always been 0.
        total_billed: 0,
        is_active: assignment.is_active,
      })));
    } catch (error) {
      if (requestId !== usageRequestRef.current) return;
      console.error('Error fetching contract usage:', error);
      setError(t('contractUsage.errors.loadUsageData', { defaultValue: 'Failed to load contract usage data' }));
    } finally {
      if (requestId === usageRequestRef.current) setIsLoading(false);
    }
  };

  const handleContractChange = async (contractId: string) => {
    setSelectedContract(contractId);
    await fetchContractUsage(contractId);
  };

  const handleRefresh = async () => {
    if (selectedContract) {
      await fetchContractUsage(selectedContract);
    }
  };

  const formatCents = (value: number) => formatCurrency(value / 100, tenantCurrency);

  const contractUsageColumns: ColumnDefinition<ContractUsageRecord>[] = [
    {
      title: t('contractUsage.table.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name',
      render: (value, record) => <ClientNameCell clientName={value as string | null | undefined} clientId={record.client_id} logoUrl={record.logoUrl ?? null} />,
    },
    {
      title: t('contractUsage.table.startDate', { defaultValue: 'Start Date' }),
      dataIndex: 'start_date',
      render: (value) => formatDate(value),
    },
    {
      title: t('contractUsage.table.endDate', { defaultValue: 'End Date' }),
      dataIndex: 'end_date',
      render: (value) => value
        ? formatDate(value)
        : t('contractUsage.statusValues.ongoing', { defaultValue: 'Ongoing' }),
    },
    {
      title: t('contractUsage.table.contractLines', { defaultValue: 'Contract Lines' }),
      dataIndex: 'contract_line_count',
    },
    {
      title: t('contractUsage.table.totalBilled', { defaultValue: 'Total Billed' }),
      dataIndex: 'total_billed',
      render: (value) => formatCents(value),
    },
    {
      title: t('contractUsage.table.status', { defaultValue: 'Status' }),
      dataIndex: 'is_active',
      render: (value) => value
        ? t('contractUsage.statusValues.active', { defaultValue: 'Active' })
        : t('contractUsage.statusValues.inactive', { defaultValue: 'Inactive' }),
    },
  ];

  return (
    <Card size="2">
      <Box p="4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">
            {t('contractUsage.title', { defaultValue: 'Contract Usage Report' })}
          </h2>
          <div className="flex space-x-4">
            <div className="w-64">
              <CustomSelect
                options={contracts.map(contract => ({
                  value: contract.contract_id,
                  label: contract.contract_name
                }))}
                onValueChange={handleContractChange}
                value={selectedContract || ''}
                placeholder={t('placeholders.selectContract', { defaultValue: 'Select contract...' })}
              />
            </div>
            <Button
              id="refresh-contract-usage-btn"
              onClick={handleRefresh}
              disabled={!selectedContract}
            >
              {t('actions.refresh', { defaultValue: 'Refresh' })}
            </Button>
          </div>
        </div>
        
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        <div className="relative">
          {isLoading && (
            <div className="absolute inset-0 bg-card/50 flex items-center justify-center z-10">
              <Spinner size="sm" />
            </div>
          )}
          
          {contractUsage.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {selectedContract
                ? t('contractUsage.empty.noClientsUsingContract', {
                    defaultValue: 'No clients are using this contract',
                  })
                : t('contractUsage.empty.selectContract', {
                    defaultValue: 'Select a contract to view usage data',
                  })}
            </div>
          ) : (
            <DataTable
              id="contract-usage-report-table"
              data={contractUsage}
              columns={contractUsageColumns}
              pagination={true}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              pageSize={pageSize}
              onItemsPerPageChange={handlePageSizeChange}
            />
          )}
        </div>
        
        {contractUsage.length > 0 && (
          <div className="mt-6">
            <h3 className="text-lg font-medium mb-2">
              {t('contractUsage.summary.title', { defaultValue: 'Summary' })}
            </h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-primary/10 p-4 rounded-md">
                <div className="text-sm text-primary">
                  {t('contractUsage.summary.totalClients', { defaultValue: 'Total Clients' })}
                </div>
                <div className="text-2xl font-bold">{contractUsage.length}</div>
              </div>
              <div className="bg-success/10 p-4 rounded-md">
                <div className="text-sm text-success">
                  {t('contractUsage.summary.activeAssignments', { defaultValue: 'Active Assignments' })}
                </div>
                <div className="text-2xl font-bold">
                  {contractUsage.filter(entry => entry.is_active).length}
                </div>
              </div>
              <div className="bg-accent/10 p-4 rounded-md">
                <div className="text-sm text-accent">
                  {t('contractUsage.summary.totalBilled', { defaultValue: 'Total Billed' })}
                </div>
                <div className="text-2xl font-bold">
                  {formatCents(contractUsage.reduce((sum, entry) => sum + entry.total_billed, 0))}
                </div>
              </div>
            </div>
          </div>
        )}
      </Box>
    </Card>
  );
};

export default ContractUsageReport;
