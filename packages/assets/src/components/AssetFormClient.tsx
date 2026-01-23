'use client';

import dynamic from 'next/dynamic';
import AssetFormSkeleton from '@alga-psa/ui/components/skeletons/AssetFormSkeleton';

const AssetForm = dynamic(() => import('./AssetForm'), {
  loading: () => <AssetFormSkeleton title="Edit Asset" isEdit={true} />,
  ssr: false,
});

interface AssetFormClientProps {
  assetId: string;
}

export default function AssetFormClient({ assetId }: AssetFormClientProps) {
  return <AssetForm assetId={assetId} />;
}

