import AssetDashboardClient from './AssetDashboardClient';
import type { AssetListResponse } from '@alga-psa/types';

interface AssetDashboardProps {
  initialAssets: AssetListResponse;
}

export default function AssetDashboard({ initialAssets }: AssetDashboardProps) {
  return <AssetDashboardClient initialAssets={initialAssets} />;
}
