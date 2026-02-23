import type { ReactNode } from 'react';
import AssetDashboardClient from './AssetDashboardClient';
import type { AssetListResponse, IClient } from '@alga-psa/types';

interface AssetDashboardProps {
  initialAssets: AssetListResponse;
  /** Optional injected UI for client quick view. */
  renderClientDetails?: (args: { id: string; client: IClient }) => ReactNode;
}

export default function AssetDashboard({ initialAssets, renderClientDetails }: AssetDashboardProps) {
  return <AssetDashboardClient initialAssets={initialAssets} renderClientDetails={renderClientDetails} />;
}
