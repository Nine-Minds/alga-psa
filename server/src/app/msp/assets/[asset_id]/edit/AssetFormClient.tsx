'use client';

import dynamic from 'next/dynamic';
import AssetFormSkeleton from '@alga-psa/ui/components/skeletons/AssetFormSkeleton';

// Dynamic import for AssetForm with ssr: false
const AssetForm = dynamic(() => import('@alga-psa/assets/components/AssetForm'), {
  loading: () => <AssetFormSkeleton title="Edit Asset" isEdit={true} />,
  ssr: false
});

interface AssetFormClientProps {
  assetId: string;
}

export default function AssetFormClient({ assetId }: AssetFormClientProps) {
  return <AssetForm assetId={assetId} />;
}
