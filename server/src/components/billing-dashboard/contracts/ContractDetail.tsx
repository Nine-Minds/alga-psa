'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'server/src/components/ui/Tabs';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import BackNav from 'server/src/components/ui/BackNav';
import { AlertCircle } from 'lucide-react';
import { IContract } from 'server/src/interfaces/contract.interfaces';
import { getContractById, getContractSummary, IContractSummary } from 'server/src/lib/actions/contractActions';
import { useTenant } from 'server/src/components/TenantProvider';
import ContractHeader from './ContractHeader';
import ContractForm from './ContractForm';
import ContractLines from './ContractLines';

const ContractDetail: React.FC = () => {
  const searchParams = useSearchParams();
  const contractId = searchParams?.get('contractId') as string;
  const tenant = useTenant();

  const [contract, setContract] = useState<IContract | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('details');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [summary, setSummary] = useState<IContractSummary | null>(null);

  useEffect(() => {
    if (contractId) {
      fetchContract();
      fetchSummary();
    }
  }, [contractId]);

  const fetchContract = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const contractData = await getContractById(contractId);

      if (contractData) {
        setContract(contractData);
      } else {
        setError('Contract not found');
      }
    } catch (error) {
      console.error('Error fetching contract:', error);
      setError('Failed to load contract');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSummary = async () => {
    if (!contractId) {
      return;
    }

    try {
      const summaryData = await getContractSummary(contractId);
      setSummary(summaryData);
    } catch (error) {
      console.error('Error fetching contract summary:', error);
      setSummary(null);
    }
  };

  const handleContractUpdated = () => {
    fetchContract();
    fetchSummary();
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleContractLinesChanged = () => {
    fetchSummary();
  };


  if (isLoading) {
    return <div className="p-4">Loading contract details...</div>;
  }

  if (error || !contract) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error || 'Contract not found'}
          </AlertDescription>
        </Alert>
        <BackNav href="/msp/billing?tab=contracts">
          Back to Contracts
        </BackNav>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <BackNav href="/msp/billing?tab=contracts">Back to Contracts</BackNav>
        <ContractHeader contract={contract} summary={summary} />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="details">Contract Details</TabsTrigger>
          <TabsTrigger value="lines">Contract Lines</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <ContractForm contract={contract} onContractUpdated={handleContractUpdated} />
          {saveSuccess && (
            <div className="mt-2 text-green-600 text-sm">
              Contract details saved successfully!
            </div>
          )}
        </TabsContent>

        <TabsContent value="lines">
          <ContractLines contract={contract} onContractLinesChanged={handleContractLinesChanged} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ContractDetail;
