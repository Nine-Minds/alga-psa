'use client';

import React, { useState, useEffect } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Button } from 'server/src/components/ui/Button';
import { IPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { getPlanBundles, getBundlePlans } from 'server/src/lib/actions/planBundleActions';
import { getClientBundles } from 'server/src/lib/actions/client-actions/clientPlanBundleActions';
import { getAllClients } from 'server/src/lib/actions/client-actions/clientActions';
import { IClient } from 'server/src/interfaces';
import Spinner from 'server/src/components/ui/Spinner';

interface BundleMetrics {
  bundleId: string;
  bundleName: string;
  totalClients: number;
  activeClients: number;
  totalPlans: number;
  averagePlansPerClient: number;
  totalRevenue: number;
  averageRevenuePerClient: number;
}

const BundlePerformance: React.FC = () => {
  const [bundles, setBundles] = useState<IPlanBundle[]>([]);
  const [bundleMetrics, setBundleMetrics] = useState<BundleMetrics[]>([]);
  const [selectedBundle, setSelectedBundle] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBundles();
  }, []);

  const fetchBundles = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const fetchedBundles = await getPlanBundles();
      setBundles(fetchedBundles);
      
      // Calculate metrics for all bundles
      const metrics = await Promise.all(
        fetchedBundles.map(bundle => calculateBundleMetrics(bundle))
      );
      
      setBundleMetrics(metrics);
      
      // Set default selected bundle if available
      if (fetchedBundles.length > 0) {
        setSelectedBundle(fetchedBundles[0].bundle_id);
      }
    } catch (error) {
      console.error('Error fetching bundles:', error);
      setError('Failed to load bundle data');
    } finally {
      setIsLoading(false);
    }
  };

  const calculateBundleMetrics = async (bundle: IPlanBundle): Promise<BundleMetrics> => {
    try {
      // Get all clients
      const clients = await getAllClients(false);
      
      // Get all clients using this bundle
      const clientsWithBundle: IClient[] = [];
      let totalRevenue = 0;
      
      for (const client of clients) {
        const clientBundles = await getClientBundles(client.client_id);
        const matchingBundle = clientBundles.find(cb => 
          cb.bundle_id === bundle.bundle_id && cb.is_active
        );
        
        if (matchingBundle) {
          clientsWithBundle.push(client);
          // In a real implementation, you would calculate actual revenue
          // For now, we'll use a placeholder value
          totalRevenue += 10000; // $100.00 per client
        }
      }
      
      // Get all plans in the bundle
      const bundlePlans = await getBundlePlans(bundle.bundle_id);
      
      return {
        bundleId: bundle.bundle_id,
        bundleName: bundle.bundle_name,
        totalClients: clientsWithBundle.length,
        activeClients: clientsWithBundle.length,
        totalPlans: bundlePlans.length,
        averagePlansPerClient: clientsWithBundle.length > 0 
          ? bundlePlans.length / clientsWithBundle.length 
          : 0,
        totalRevenue: totalRevenue,
        averageRevenuePerClient: clientsWithBundle.length > 0 
          ? totalRevenue / clientsWithBundle.length 
          : 0
      };
    } catch (error) {
      console.error(`Error calculating metrics for bundle ${bundle.bundle_id}:`, error);
      return {
        bundleId: bundle.bundle_id,
        bundleName: bundle.bundle_name,
        totalClients: 0,
        activeClients: 0,
        totalPlans: 0,
        averagePlansPerClient: 0,
        totalRevenue: 0,
        averageRevenuePerClient: 0
      };
    }
  };

  const handleBundleChange = (bundleId: string) => {
    setSelectedBundle(bundleId);
  };

  const handleRefresh = async () => {
    await fetchBundles();
  };

  // Get metrics for selected bundle
  const selectedMetrics = selectedBundle 
    ? bundleMetrics.find(m => m.bundleId === selectedBundle) 
    : null;

  return (
    <Card size="2">
      <Box p="4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Bundle Performance Metrics</h2>
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
              id="refresh-bundle-metrics-btn"
              onClick={handleRefresh}
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
          
          {selectedMetrics ? (
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-6">
                <div className="bg-blue-50 p-4 rounded-md">
                  <div className="text-sm text-blue-600">Total Clients</div>
                  <div className="text-2xl font-bold">{selectedMetrics.totalClients}</div>
                </div>
                
                <div className="bg-green-50 p-4 rounded-md">
                  <div className="text-sm text-green-600">Active Clients</div>
                  <div className="text-2xl font-bold">{selectedMetrics.activeClients}</div>
                </div>
                
                <div className="bg-purple-50 p-4 rounded-md">
                  <div className="text-sm text-purple-600">Total Plans</div>
                  <div className="text-2xl font-bold">{selectedMetrics.totalPlans}</div>
                </div>
              </div>
              
              <div className="space-y-6">
                <div className="bg-yellow-50 p-4 rounded-md">
                  <div className="text-sm text-yellow-600">Avg. Plans Per Client</div>
                  <div className="text-2xl font-bold">{selectedMetrics.averagePlansPerClient.toFixed(2)}</div>
                </div>
                
                <div className="bg-red-50 p-4 rounded-md">
                  <div className="text-sm text-red-600">Total Revenue</div>
                  <div className="text-2xl font-bold">${(selectedMetrics.totalRevenue / 100).toFixed(2)}</div>
                </div>
                
                <div className="bg-indigo-50 p-4 rounded-md">
                  <div className="text-sm text-indigo-600">Avg. Revenue Per Client</div>
                  <div className="text-2xl font-bold">${(selectedMetrics.averageRevenuePerClient / 100).toFixed(2)}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              {bundles.length > 0 ? 'Select a bundle to view performance metrics' : 'No bundles available'}
            </div>
          )}
        </div>
        
        {bundleMetrics.length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-medium mb-4">Bundle Comparison</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bundle</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Clients</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Plans</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {bundleMetrics.map((metric) => (
                    <tr 
                      key={metric.bundleId}
                      className={selectedBundle === metric.bundleId ? 'bg-blue-50' : ''}
                    >
                      <td className="px-4 py-2 whitespace-nowrap">{metric.bundleName}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{metric.totalClients}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{metric.totalPlans}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">${(metric.totalRevenue / 100).toFixed(2)}</td>
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

export default BundlePerformance;
