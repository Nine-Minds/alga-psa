'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'server/src/components/ui/Tabs';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Button } from 'server/src/components/ui/Button';
import { AlertCircle, ArrowLeft, Save } from 'lucide-react';
import { IPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { getPlanBundleById, updatePlanBundle } from 'server/src/lib/actions/planBundleActions';
import { useTenant } from 'server/src/components/TenantProvider';
import PlanBundleHeader from './PlanBundleHeader';
import PlanBundleForm from './PlanBundleForm';
import PlanBundlePlans from './PlanBundlePlans';

const PlanBundleDetail: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bundleId = searchParams?.get('bundleId') as string;
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
        setError('Plan bundle not found');
      }
    } catch (error) {
      console.error('Error fetching bundle:', error);
      setError('Failed to load plan bundle');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBundleUpdated = () => {
    fetchBundle();
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleBackClick = () => {
    router.push('/msp/billing?tab=plan-bundles');
  };

  if (isLoading) {
    return <div className="p-4">Loading bundle details...</div>;
  }

  if (error || !bundle) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error || 'Plan bundle not found'}
          </AlertDescription>
        </Alert>
        <Button
          id="back-to-bundles-btn"
          onClick={handleBackClick}
          className="mt-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Bundles
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center">
        <Button
          id="back-btn"
          variant="ghost"
          onClick={handleBackClick}
          className="mr-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <PlanBundleHeader bundle={bundle} />
      </div>
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="details">Bundle Details</TabsTrigger>
          <TabsTrigger value="plans">Billing Plans</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <PlanBundleForm bundle={bundle} onBundleUpdated={handleBundleUpdated} />
          {saveSuccess && (
            <div className="mt-2 text-green-600 text-sm">
              Bundle details saved successfully!
            </div>
          )}
        </TabsContent>

        <TabsContent value="plans">
          <PlanBundlePlans bundle={bundle} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default PlanBundleDetail;