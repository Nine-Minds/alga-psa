'use client';

import React, { useState, useEffect } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Button } from '@alga-psa/ui/components/Button';
import { IContract } from 'server/src/interfaces/contract.interfaces';
import { getContracts } from '@alga-psa/billing/actions/contractActions';
import { getClientContracts, getDetailedClientContract, getAllClients } from '@alga-psa/clients/actions';
import { IClient } from 'server/src/interfaces';
import Spinner from '@alga-psa/ui/components/Spinner';

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
        getAllClients(false) // false to get only active clients
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
      setError('Failed to load initial data');
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
        const clientContractAssignments = await getClientContracts(client.client_id);
        const matchingContract = clientContractAssignments.find(cc => cc.contract_id === contractId);
        
        if (matchingContract && matchingContract.client_contract_id) {
          const detailedContract = await getDetailedClientContract(matchingContract.client_contract_id);
          
          if (detailedContract) {
            clientContracts.push({
              client_id: client.client_id,
              client_name: client.client_name || 'Unknown Client',
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
      setError('Failed to load contract usage data');
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

  const contractUsageColumns: ColumnDefinition<ContractUsageRecord>[] = [
    {
      title: 'Client',
      dataIndex: 'client_name',
    },
    {
      title: 'Start Date',
      dataIndex: 'start_date',
      render: (value) => new Date(value).toLocaleDateString(),
    },
    {
      title: 'End Date',
      dataIndex: 'end_date',
      render: (value) => value ? new Date(value).toLocaleDateString() : 'Ongoing',
    },
    {
      title: 'Contract Lines',
      dataIndex: 'contract_line_count',
    },
    {
      title: 'Total Billed',
      dataIndex: 'total_billed',
      render: (value) => `$${(value / 100).toFixed(2)}`,
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      render: (value) => value ? 'Active' : 'Inactive',
    },
  ];

  return (
    <Card size="2">
      <Box p="4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Contract Usage Report</h2>
          <div className="flex space-x-4">
            <div className="w-64">
              <CustomSelect
                options={contracts.map(contract => ({
                  value: contract.contract_id,
                  label: contract.contract_name
                }))}
                onValueChange={handleContractChange}
                value={selectedContract || ''}
                placeholder="Select contract..."
              />
            </div>
            <Button
              id="refresh-contract-usage-btn"
              onClick={handleRefresh}
              disabled={!selectedContract}
            >
              Refresh
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
            <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
              <Spinner size="sm" />
            </div>
          )}
          
          {contractUsage.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {selectedContract ? 'No clients are using this contract' : 'Select a contract to view usage data'}
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
            <h3 className="text-lg font-medium mb-2">Summary</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-blue-50 p-4 rounded-md">
                <div className="text-sm text-blue-600">Total Clients</div>
                <div className="text-2xl font-bold">{contractUsage.length}</div>
              </div>
              <div className="bg-green-50 p-4 rounded-md">
                <div className="text-sm text-green-600">Active Assignments</div>
                <div className="text-2xl font-bold">
                  {contractUsage.filter(entry => entry.is_active).length}
                </div>
              </div>
              <div className="bg-purple-50 p-4 rounded-md">
                <div className="text-sm text-purple-600">Total Billed</div>
                <div className="text-2xl font-bold">
                  ${(contractUsage.reduce((sum, entry) => sum + entry.total_billed, 0) / 100).toFixed(2)}
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
