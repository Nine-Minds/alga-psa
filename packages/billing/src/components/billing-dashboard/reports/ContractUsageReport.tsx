'use client';

import React, { useState, useEffect } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Button } from '@alga-psa/ui/components/Button';
import { IContract } from '@alga-psa/types';
import { getContracts } from '@alga-psa/billing/actions/contractActions';
import {
  getClientContractsForBilling,
  getDetailedClientContractForBilling,
  getAllClientsForBilling,
} from '@alga-psa/billing/actions/billingClientsActions';
import { IClient } from '@alga-psa/types';
import Spinner from '@alga-psa/ui/components/Spinner';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ContractUsageRecord {
  client_id: string;
  client_name: string;
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
  const [contracts, setContracts] = useState<IContract[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
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
      // Get all contracts and clients
      const [fetchedContracts, fetchedClients] = await Promise.all([
        getContracts(),
        getAllClientsForBilling(false) // false to get only active clients
      ]);
      
      setContracts(fetchedContracts);
      setClients(fetchedClients);
      
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
    setIsLoading(true);
    setError(null);
    
    try {
      // Get all clients that have this contract assigned
      const clientContracts: ContractUsageRecord[] = [];
      
      for (const client of clients) {
        const clientContractAssignments = await getClientContractsForBilling(client.client_id);
        const matchingContract = clientContractAssignments.find(cc => cc.contract_id === contractId);
        
        if (matchingContract && matchingContract.client_contract_id) {
          const detailedContract = await getDetailedClientContractForBilling(matchingContract.client_contract_id);
          
          if (detailedContract) {
            clientContracts.push({
              client_id: client.client_id,
              client_name: client.client_name || t('contractUsage.statusValues.unknownClient', { defaultValue: 'Unknown Client' }),
              contract_id: contractId,
              contract_name: detailedContract.contract_name,
              start_date: matchingContract.start_date,
              end_date: matchingContract.end_date,
              contract_line_count: detailedContract.contract_line_count || 0,
              total_billed: detailedContract.total_billed || 0,
              is_active: matchingContract.is_active
            });
          }
        }
      }
      
      setContractUsage(clientContracts);
    } catch (error) {
      console.error('Error fetching contract usage:', error);
      setError(t('contractUsage.errors.loadUsageData', { defaultValue: 'Failed to load contract usage data' }));
    } finally {
      setIsLoading(false);
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

  const formatCents = (value: number) => formatCurrency(value / 100, 'USD');

  const contractUsageColumns: ColumnDefinition<ContractUsageRecord>[] = [
    {
      title: t('contractUsage.table.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name',
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
