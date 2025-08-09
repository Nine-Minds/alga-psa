import { Metadata } from 'next';
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import AssetFormSkeleton from 'server/src/components/ui/skeletons/AssetFormSkeleton';

// Dynamic import for AssetForm
const AssetForm = dynamic(() => import('server/src/components/assets/AssetForm'), {
  loading: () => <AssetFormSkeleton title="Edit Asset" isEdit={true} />,
  ssr: false
});

interface AssetEditPageProps {
  params: Promise<{
    asset_id: string;
  }>;
}

export const metadata: Metadata = {
  title: 'Edit Asset',
  description: 'Edit asset details'
};

export default async function AssetEditPage({ params }: AssetEditPageProps) {
  const resolvedParams = await params;
  return (
    <div className="container mx-auto px-4 py-8">
      <Suspense fallback={<AssetFormSkeleton title="Edit Asset" isEdit={true} />}>
        <AssetForm assetId={resolvedParams.asset_id} />
      </Suspense>
    </div>
  );
}
