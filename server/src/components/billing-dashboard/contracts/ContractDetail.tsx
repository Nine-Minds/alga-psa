'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'server/src/components/ui/Tabs';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Button } from 'server/src/components/ui/Button';
import { Badge } from 'server/src/components/ui/Badge';
import { Card } from 'server/src/components/ui/Card';
import BackNav from 'server/src/components/ui/BackNav';
import { AlertCircle, FileText, Calendar, DollarSign, Package } from 'lucide-react';
import { IPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { getPlanBundleById } from 'server/src/lib/actions/planBundleActions';
import ContractHeader from './ContractHeader';
import ContractForm from './ContractForm';
import ContractPlans from './ContractPlans';
import PricingSchedules from './PricingSchedules';

const ContractDetail: React.FC = () => {
  const searchParams = useSearchParams();
  const bundleId = searchParams?.get('contractId') as string;

  const [bundle, setBundle] = useState<IPlanBundle | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
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
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="details">Contract Details</TabsTrigger>
          <TabsTrigger value="plans">Service Lines</TabsTrigger>
          <TabsTrigger value="pricing">Pricing Schedules</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {/* Contract Info Card */}
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="h-5 w-5 text-blue-600" />
                <h4 className="font-semibold">Contract Information</h4>
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-gray-600">Contract Name</p>
                  <p className="font-medium">{bundle.bundle_name}</p>
                </div>
                <div>
                  <p className="text-gray-600">Status</p>
                  <Badge variant="default" className={bundle.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                    {bundle.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                {bundle.bundle_description && (
                  <div>
                    <p className="text-gray-600">Description</p>
                    <p className="font-medium text-xs">{bundle.bundle_description}</p>
                  </div>
                )}
              </div>
            </Card>

            {/* Client Info Card */}
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Package className="h-5 w-5 text-purple-600" />
                <h4 className="font-semibold">Client Information</h4>
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-gray-600">Client Name</p>
                  <p className="font-medium">Mock Client</p>
                  <p className="text-xs text-gray-500">TODO: Fetch from company_plan_bundles</p>
                </div>
                <div>
                  <p className="text-gray-600">Contract Period</p>
                  <p className="font-medium">
                    {new Date().toLocaleDateString()} - Ongoing
                  </p>
                </div>
              </div>
            </Card>

            {/* Revenue Card */}
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="h-5 w-5 text-green-600" />
                <h4 className="font-semibold">Revenue</h4>
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-gray-600">Monthly Recurring</p>
                  <p className="font-medium text-lg">$0.00</p>
                  <p className="text-xs text-gray-500">TODO: Calculate from service lines</p>
                </div>
                <div>
                  <p className="text-gray-600">Total Billed (YTD)</p>
                  <p className="font-medium">$0.00</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Quick Actions */}
          <Card className="p-4">
            <h4 className="font-semibold mb-3">Quick Actions</h4>
            <div className="flex gap-2">
              <Button id="edit-details-btn" variant="outline" onClick={() => setActiveTab('details')}>
                <FileText className="h-4 w-4 mr-2" />
                Edit Details
              </Button>
              <Button id="manage-service-lines-btn" variant="outline" onClick={() => setActiveTab('plans')}>
                <Package className="h-4 w-4 mr-2" />
                Manage Service Lines
              </Button>
              <Button id="view-invoices-btn" variant="outline" onClick={() => setActiveTab('invoices')}>
                <DollarSign className="h-4 w-4 mr-2" />
                View Invoices
              </Button>
              <Button id="renew-contract-btn" variant="outline" onClick={() => alert('Renew functionality coming soon')}>
                <Calendar className="h-4 w-4 mr-2" />
                Renew Contract
              </Button>
            </div>
          </Card>
        </TabsContent>

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

        <TabsContent value="pricing">
          <PricingSchedules bundleId={bundleId} />
        </TabsContent>

        <TabsContent value="invoices">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="h-5 w-5 text-blue-600" />
              <h4 className="font-semibold text-lg">Invoices for this Contract</h4>
            </div>
            <div className="text-center py-12 text-gray-500">
              <FileText className="h-12 w-12 mx-auto mb-3 text-gray-400" />
              <p className="text-sm">No invoices found for this contract</p>
              <p className="text-xs mt-2">TODO: Fetch and display invoices linked to this contract</p>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ContractDetail;
