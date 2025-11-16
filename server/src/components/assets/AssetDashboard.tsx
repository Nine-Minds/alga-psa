import AssetDashboardClient from './AssetDashboardClient';
import type { AssetListResponse } from 'server/src/interfaces/asset.interfaces';

interface AssetDashboardProps {
  initialAssets: AssetListResponse;
}

export default function AssetDashboard({ initialAssets }: AssetDashboardProps) {
  return <AssetDashboardClient initialAssets={initialAssets} />;
}
