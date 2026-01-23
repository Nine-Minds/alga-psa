import useSWR from 'swr';
import { useState, useCallback } from 'react';
import { getAsset, getAssetSummaryMetrics } from '@alga-psa/assets/actions/assetActions';
import { getAssetRmmData, refreshAssetRmmData } from '@ee/lib/actions/asset-actions/rmmActions';
import { toast } from 'react-hot-toast';

export function useAssetDetail(assetId: string) {
  const {
    data: asset,
    error: assetError,
    isLoading: assetLoading,
    mutate: mutateAsset,
  } = useSWR(assetId ? ['asset', assetId] : null, ([_, id]) => getAsset(id));

  const {
    data: metrics,
    error: metricsError,
    isLoading: metricsLoading,
  } = useSWR(assetId ? ['asset', assetId, 'summary'] : null, ([_, id]) => getAssetSummaryMetrics(id));

  const {
    data: rmmData,
    error: rmmError,
    isLoading: rmmLoading,
    mutate: mutateRmmData,
  } = useSWR(assetId ? ['asset', assetId, 'rmm'] : null, ([_, id]) => getAssetRmmData(id));

  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshRmmData = useCallback(
    async () => {
      if (!assetId) return;

      try {
        setIsRefreshing(true);
        const updatedData = await refreshAssetRmmData(assetId);

        await mutateRmmData(updatedData, false);

        toast.success('RMM data refreshed');
      } catch (error) {
        console.error('Error refreshing RMM data:', error);
        toast.error('Failed to refresh RMM data');
      } finally {
        setIsRefreshing(false);
      }
    },
    [assetId, mutateRmmData]
  );

  return {
    asset,
    metrics,
    rmmData,
    isLoading: assetLoading || metricsLoading || rmmLoading,
    isRefreshing,
    refreshRmmData,
    errors: {
      asset: assetError,
      metrics: metricsError,
      rmm: rmmError,
    },
    mutateAsset,
  };
}

