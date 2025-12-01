'use client';

import React from 'react';
import { AssetDetailHeader } from './AssetDetailHeader';
import { AssetMetricsBanner } from './AssetMetricsBanner';
import { AssetDashboardGrid } from './AssetDashboardGrid';
import { AssetDetailTabs } from './AssetDetailTabs';
import { useAssetDetail } from '../../hooks/useAssetDetail';
import { LoadingIndicator } from '../../ui/LoadingIndicator';
import { Alert, Container } from '@mantine/core';
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
      <Container size="xl" py="xl">
        <Alert icon={<AlertCircle size={16} />} title="Error" color="red">
          Asset not found or you do not have permission to view it.
        </Alert>
      </Container>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AssetDetailHeader 
        asset={asset} 
        onRefresh={refreshRmmData}
        isRefreshing={isRefreshing}
      />
      
      <Container size="xl" py="xl">
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
      </Container>
    </div>
  );
};