'use client';

import React from 'react';
import { AssetDetailHeader } from './AssetDetailHeader';
import { AssetMetricsBanner } from './AssetMetricsBanner';
import { AssetDashboardGrid } from './AssetDashboardGrid';
import { AssetDetailTabs } from './AssetDetailTabs';
import { useAssetDetail } from '@alga-psa/assets/hooks/useAssetDetail';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';

interface AssetDetailViewProps {
  assetId: string;
}

export const AssetDetailView: React.FC<AssetDetailViewProps> = ({ assetId }) => {
  const { 
    asset, 
    metrics, 
    rmmData, 
    isLoading, 
    refreshRmmData, 
    isRefreshing 
  } = useAssetDetail(assetId);

  if (isLoading && !asset) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingIndicator text="Loading asset details..." />
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            Asset not found or you do not have permission to view it.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AssetDetailHeader 
        asset={asset} 
        onRefresh={refreshRmmData}
        isRefreshing={isRefreshing}
      />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AssetMetricsBanner 
          metrics={metrics} 
          isLoading={isLoading} 
        />
        
        <AssetDashboardGrid 
          asset={asset}
          rmmData={rmmData}
          metrics={metrics}
          isLoading={isLoading}
          onRefreshRmm={refreshRmmData}
          isRefreshingRmm={isRefreshing}
        />
        
        <AssetDetailTabs asset={asset} />
      </div>
    </div>
  );
};
