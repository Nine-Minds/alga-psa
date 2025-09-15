'use client';

import dynamic from 'next/dynamic';
import AssetFormSkeleton from 'server/src/components/ui/skeletons/AssetFormSkeleton';

// Dynamic import for AssetForm with ssr: false
const AssetForm = dynamic(() => import('server/src/components/assets/AssetForm'), {
  loading: () => <AssetFormSkeleton title="Edit Asset" isEdit={true} />,
  ssr: false
});

interface AssetFormClientProps {
  assetId: string;
}

export default function AssetFormClient({ assetId }: AssetFormClientProps) {
  return <AssetForm assetId={assetId} />;
}