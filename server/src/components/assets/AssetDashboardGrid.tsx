import React from 'react';
import { SimpleGrid, Stack } from '@mantine/core';
import { RmmVitalsPanel } from './panels/RmmVitalsPanel';
import { HardwareSpecsPanel } from './panels/HardwareSpecsPanel';
import { SecurityPatchingPanel } from './panels/SecurityPatchingPanel';
import { AssetInfoPanel } from './panels/AssetInfoPanel';
import { AssetNotesPanel } from './panels/AssetNotesPanel';
import { Asset, RmmCachedData, AssetSummaryMetrics } from '../../interfaces/asset.interfaces';

interface AssetDashboardGridProps {
  asset: Asset;
  rmmData: RmmCachedData | null | undefined;
  metrics: AssetSummaryMetrics | undefined;
  isLoading: boolean;
  onRefreshRmm: () => void;
  isRefreshingRmm: boolean;
}

export const AssetDashboardGrid: React.FC<AssetDashboardGridProps> = ({
  asset,
  rmmData,
  metrics,
  isLoading,
  onRefreshRmm,
  isRefreshingRmm
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
      {/* Left Column (2/3 width on large screens) */}
      <div className="lg:col-span-2 space-y-6">
        <RmmVitalsPanel 
          data={rmmData} 
          isLoading={isLoading} 
          onRefresh={onRefreshRmm}
          isRefreshing={isRefreshingRmm}
        />
        <HardwareSpecsPanel 
          data={rmmData} 
          asset={asset}
          isLoading={isLoading} 
        />
        <SecurityPatchingPanel 
          metrics={metrics} 
          asset={asset}
          isLoading={isLoading} 
        />
      </div>

      {/* Right Column (1/3 width on large screens) */}
      <div className="space-y-6">
        <AssetInfoPanel 
          asset={asset} 
          isLoading={isLoading} 
        />
        <AssetNotesPanel 
          assetId={asset.asset_id} 
        />
      </div>
    </div>
  );
};
