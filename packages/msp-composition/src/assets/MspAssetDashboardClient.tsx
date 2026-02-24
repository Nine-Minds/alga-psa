'use client';

import React from 'react';
import AssetDashboard from '@alga-psa/assets/components/AssetDashboard';

export default function MspAssetDashboardClient(props: React.ComponentProps<typeof AssetDashboard>) {
  return <AssetDashboard {...props} />;
}
