'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'server/src/components/ui/Tabs';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Button } from 'server/src/components/ui/Button';
import BackNav from 'server/src/components/ui/BackNav';
import { AlertCircle, ArrowLeft, Save } from 'lucide-react';
import { IPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { getPlanBundleById, updatePlanBundle } from 'server/src/lib/actions/planBundleActions';
import { useTenant } from 'server/src/components/TenantProvider';
import ContractHeader from './ContractHeader';
import ContractForm from './ContractForm';
import ContractPlans from './ContractPlans';

const ContractDetail: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bundleId = searchParams?.get('contractId') as string;
  const tenant = useTenant();
  
  const [bundle, setBundle] = useState<IPlanBundle | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('details');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (bundleId) {
      fetchBundle();
    }
  }, [bundleId]);

  const fetchBundle = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const bundleData = await getPlanBundleById(bundleId);
      
      if (bundleData) {
        setBundle(bundleData);
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

  const handleContractUpdated = () => {
    fetchBundle();
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };


  if (isLoading) {
    return <div className="p-4">Loading contract details...</div>;
  }

  if (error || !bundle) {
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
      <div className="flex items-center">
        <BackNav href="/msp/billing?tab=contracts">
          Back to Contracts
        </BackNav>
        <ContractHeader bundle={bundle} />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="details">Contract Details</TabsTrigger>
          <TabsTrigger value="plans">Service Lines</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <ContractForm bundle={bundle} onBundleUpdated={handleContractUpdated} />
          {saveSuccess && (
            <div className="mt-2 text-green-600 text-sm">
              Contract details saved successfully!
            </div>
          )}
        </TabsContent>

        <TabsContent value="plans">
          <ContractPlans bundle={bundle} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ContractDetail;
