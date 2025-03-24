'use client';

import React, { useState, useEffect } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Button } from 'server/src/components/ui/Button';
import { IPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { getPlanBundles } from 'server/src/lib/actions/planBundleActions';
import { getCompanyBundles, getDetailedCompanyBundle } from 'server/src/lib/actions/companyPlanBundleActions';
import { getAllCompanies } from 'server/src/lib/actions/companyActions';
import { ICompany } from 'server/src/interfaces';

interface BundleUsage {
  company_id: string;
  company_name: string;
  bundle_id: string;
  bundle_name: string;
  start_date: string;
  end_date: string | null;
  plan_count: number;
  total_billed: number;
  is_active: boolean;
}

const BundleUsageReport: React.FC = () => {
  const [bundles, setBundles] = useState<IPlanBundle[]>([]);
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [bundleUsage, setBundleUsage] = useState<BundleUsage[]>([]);
  const [selectedBundle, setSelectedBundle] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Get all bundles and companies
      const [fetchedBundles, fetchedCompanies] = await Promise.all([
        getPlanBundles(),
        getAllCompanies(false) // false to get only active companies
      ]);
      
      setBundles(fetchedBundles);
      setCompanies(fetchedCompanies);
      
      // Set default selected bundle if available
      if (fetchedBundles.length > 0) {
        setSelectedBundle(fetchedBundles[0].bundle_id);
        await fetchBundleUsage(fetchedBundles[0].bundle_id);
      }
    } catch (error) {
      console.error('Error fetching initial data:', error);
      setError('Failed to load initial data');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchBundleUsage = async (bundleId: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Get all companies that have this bundle assigned
      const companyBundles = [];
      
      for (const company of companies) {
        const companyBundleAssignments = await getCompanyBundles(company.company_id);
        const matchingBundle = companyBundleAssignments.find(cb => cb.bundle_id === bundleId);
        
        if (matchingBundle && matchingBundle.company_bundle_id) {
          const detailedBundle = await getDetailedCompanyBundle(matchingBundle.company_bundle_id);
          
          if (detailedBundle) {
            companyBundles.push({
              company_id: company.company_id,
              company_name: company.company_name || 'Unknown Company',
              bundle_id: bundleId,
              bundle_name: detailedBundle.bundle_name,
              start_date: matchingBundle.start_date,
              end_date: matchingBundle.end_date,
              plan_count: detailedBundle.plans ? detailedBundle.plans.length : 0,
              total_billed: detailedBundle.total_billed || 0,
              is_active: matchingBundle.is_active
            });
          }
        }
      }
      
      setBundleUsage(companyBundles);
    } catch (error) {
      console.error('Error fetching bundle usage:', error);
      setError('Failed to load bundle usage data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBundleChange = async (bundleId: string) => {
    setSelectedBundle(bundleId);
    await fetchBundleUsage(bundleId);
  };

  const handleRefresh = async () => {
    if (selectedBundle) {
      await fetchBundleUsage(selectedBundle);
    }
  };

  const bundleUsageColumns: ColumnDefinition<BundleUsage>[] = [
    {
      title: 'Company',
      dataIndex: 'company_name',
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
      title: 'Plans',
      dataIndex: 'plan_count',
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
          <h2 className="text-xl font-bold">Bundle Usage Report</h2>
          <div className="flex space-x-4">
            <div className="w-64">
              <CustomSelect
                options={bundles.map(b => ({
                  value: b.bundle_id,
                  label: b.bundle_name
                }))}
                onValueChange={handleBundleChange}
                value={selectedBundle || ''}
                placeholder="Select bundle..."
              />
            </div>
            <Button
              id="refresh-bundle-usage-btn"
              onClick={handleRefresh}
              disabled={!selectedBundle}
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
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
          )}
          
          {bundleUsage.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {selectedBundle ? 'No companies are using this bundle' : 'Select a bundle to view usage data'}
            </div>
          ) : (
            <DataTable
              data={bundleUsage}
              columns={bundleUsageColumns}
              pagination={true}
            />
          )}
        </div>
        
        {bundleUsage.length > 0 && (
          <div className="mt-6">
            <h3 className="text-lg font-medium mb-2">Summary</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-blue-50 p-4 rounded-md">
                <div className="text-sm text-blue-600">Total Companies</div>
                <div className="text-2xl font-bold">{bundleUsage.length}</div>
              </div>
              <div className="bg-green-50 p-4 rounded-md">
                <div className="text-sm text-green-600">Active Assignments</div>
                <div className="text-2xl font-bold">
                  {bundleUsage.filter(bu => bu.is_active).length}
                </div>
              </div>
              <div className="bg-purple-50 p-4 rounded-md">
                <div className="text-sm text-purple-600">Total Billed</div>
                <div className="text-2xl font-bold">
                  ${(bundleUsage.reduce((sum, bu) => sum + bu.total_billed, 0) / 100).toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        )}
      </Box>
    </Card>
  );
};

export default BundleUsageReport;