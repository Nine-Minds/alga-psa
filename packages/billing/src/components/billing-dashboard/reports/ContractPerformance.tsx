'use client';

import React, { useState, useEffect } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Button } from '@alga-psa/ui/components/Button';
import { IContract } from '@alga-psa/types';
import { getContracts, getContractLinesForContract } from '@alga-psa/billing/actions/contractActions';
import { getClientContractsForBilling, getAllClientsForBilling } from '@alga-psa/billing/actions/billingClientsActions';
import { IClient } from '@alga-psa/types';
import Spinner from '@alga-psa/ui/components/Spinner';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ContractMetrics {
  contractId: string;
  contractName: string;
  totalClients: number;
  activeClients: number;
  totalPlans: number;
  averagePlansPerClient: number;
  totalRevenue: number;
  averageRevenuePerClient: number;
}

const ContractPerformance: React.FC = () => {
  const { t } = useTranslation('msp/reports');
  const { formatCurrency } = useFormatters();
  const [contracts, setContracts] = useState<IContract[]>([]);
  const [contractMetrics, setContractMetrics] = useState<ContractMetrics[]>([]);
  const [selectedContract, setSelectedContract] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchContracts();
  }, []);

  const fetchContracts = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const fetchedContracts = await getContracts();
      setContracts(fetchedContracts);
      
      // Calculate metrics for all contracts
      const metrics = await Promise.all(
        fetchedContracts.map(contract => calculateContractMetrics(contract))
      );
      
      setContractMetrics(metrics);
      
      // Set default selected contract if available
      if (fetchedContracts.length > 0) {
        setSelectedContract(fetchedContracts[0].contract_id);
      }
    } catch (error) {
      console.error('Error fetching contracts:', error);
      setError(t('contractPerformance.errors.loadData', { defaultValue: 'Failed to load contract data' }));
    } finally {
      setIsLoading(false);
    }
  };

  const formatCents = (value: number) => formatCurrency(value / 100, 'USD');

  const calculateContractMetrics = async (contract: IContract): Promise<ContractMetrics> => {
    try {
      // Get all clients
      const clients = await getAllClientsForBilling(false);
      
      // Get all clients using this contract
      const clientsWithContract: IClient[] = [];
      let totalRevenue = 0;
      
      for (const client of clients) {
        const clientContracts = await getClientContractsForBilling(client.client_id);
        const matchingContract = clientContracts.find(cc => 
          cc.contract_id === contract.contract_id && cc.is_active
        );
        
        if (matchingContract) {
          clientsWithContract.push(client);
          // In a real implementation, you would calculate actual revenue
          // For now, we'll use a placeholder value
          totalRevenue += 10000; // $100.00 per client
        }
      }
      
      // Get all contract lines in the contract
      const contractLines = await getContractLinesForContract(contract.contract_id);
      
      return {
        contractId: contract.contract_id,
        contractName: contract.contract_name,
        totalClients: clientsWithContract.length,
        activeClients: clientsWithContract.length,
        totalPlans: contractLines.length,
        averagePlansPerClient: clientsWithContract.length > 0 
          ? contractLines.length / clientsWithContract.length 
          : 0,
        totalRevenue: totalRevenue,
        averageRevenuePerClient: clientsWithContract.length > 0 
          ? totalRevenue / clientsWithContract.length 
          : 0
      };
    } catch (error) {
      console.error(`Error calculating metrics for contract ${contract.contract_id}:`, error);
      return {
        contractId: contract.contract_id,
        contractName: contract.contract_name,
        totalClients: 0,
        activeClients: 0,
        totalPlans: 0,
        averagePlansPerClient: 0,
        totalRevenue: 0,
        averageRevenuePerClient: 0
      };
    }
  };

  const handleContractChange = (contractId: string) => {
    setSelectedContract(contractId);
  };

  const handleRefresh = async () => {
    await fetchContracts();
  };

  // Get metrics for selected contract
  const selectedMetrics = selectedContract 
    ? contractMetrics.find(m => m.contractId === selectedContract) 
    : null;

  return (
    <Card size="2">
      <Box p="4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">
            {t('contractPerformance.title', { defaultValue: 'Contract Performance Metrics' })}
          </h2>
          <div className="flex space-x-4">
            <div className="w-64">
              <CustomSelect
                options={contracts.map(b => ({
                  value: b.contract_id,
                  label: b.contract_name
                }))}
                onValueChange={handleContractChange}
                value={selectedContract || ''}
                placeholder={t('placeholders.selectContract', { defaultValue: 'Select contract...' })}
              />
            </div>
            <Button
              id="refresh-contract-metrics-btn"
              onClick={handleRefresh}
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
          
          {selectedMetrics ? (
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-6">
                <div className="bg-primary/10 p-4 rounded-md">
                  <div className="text-sm text-primary">
                    {t('contractPerformance.metrics.totalClients', { defaultValue: 'Total Clients' })}
                  </div>
                  <div className="text-2xl font-bold">{selectedMetrics.totalClients}</div>
                </div>
                
                <div className="bg-success/10 p-4 rounded-md">
                  <div className="text-sm text-success">
                    {t('contractPerformance.metrics.activeClients', { defaultValue: 'Active Clients' })}
                  </div>
                  <div className="text-2xl font-bold">{selectedMetrics.activeClients}</div>
                </div>
                
                <div className="bg-accent/10 p-4 rounded-md">
                  <div className="text-sm text-accent">
                    {t('contractPerformance.metrics.totalPlans', { defaultValue: 'Total Plans' })}
                  </div>
                  <div className="text-2xl font-bold">{selectedMetrics.totalPlans}</div>
                </div>
              </div>
              
              <div className="space-y-6">
                <div className="bg-warning/10 p-4 rounded-md">
                  <div className="text-sm text-warning">
                    {t('contractPerformance.metrics.averagePlansPerClient', { defaultValue: 'Avg. Plans Per Client' })}
                  </div>
                  <div className="text-2xl font-bold">{selectedMetrics.averagePlansPerClient.toFixed(2)}</div>
                </div>
                
                <div className="bg-destructive/10 p-4 rounded-md">
                  <div className="text-sm text-destructive">
                    {t('contractPerformance.metrics.totalRevenue', { defaultValue: 'Total Revenue' })}
                  </div>
                  <div className="text-2xl font-bold">{formatCents(selectedMetrics.totalRevenue)}</div>
                </div>
                
                <div className="bg-primary/10 p-4 rounded-md">
                  <div className="text-sm text-primary">
                    {t('contractPerformance.metrics.averageRevenuePerClient', { defaultValue: 'Avg. Revenue Per Client' })}
                  </div>
                  <div className="text-2xl font-bold">{formatCents(selectedMetrics.averageRevenuePerClient)}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              {contracts.length > 0
                ? t('contractPerformance.empty.selectContract', {
                    defaultValue: 'Select a contract to view performance metrics',
                  })
                : t('contractPerformance.empty.noContracts', { defaultValue: 'No contracts available' })}
            </div>
          )}
        </div>
        
        {contractMetrics.length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-medium mb-4">
              {t('contractPerformance.comparison.title', { defaultValue: 'Contract Comparison' })}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {t('contractPerformance.comparison.table.contract', { defaultValue: 'Contract' })}
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {t('contractPerformance.comparison.table.clients', { defaultValue: 'Clients' })}
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {t('contractPerformance.comparison.table.plans', { defaultValue: 'Plans' })}
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {t('contractPerformance.comparison.table.revenue', { defaultValue: 'Revenue' })}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-card divide-y divide-[rgb(var(--color-border-200))]">
                  {contractMetrics.map((metric) => (
                    <tr 
                      key={metric.contractId}
                      className={selectedContract === metric.contractId ? 'bg-primary/10' : ''}
                    >
                      <td className="px-4 py-2 whitespace-nowrap">{metric.contractName}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{metric.totalClients}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{metric.totalPlans}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{formatCents(metric.totalRevenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Box>
    </Card>
  );
};

export default ContractPerformance;
