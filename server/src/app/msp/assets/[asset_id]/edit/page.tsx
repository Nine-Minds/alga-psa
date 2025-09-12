import { Metadata } from 'next';
import { Suspense } from 'react';
import AssetFormSkeleton from 'server/src/components/ui/skeletons/AssetFormSkeleton';
import AssetFormClient from './AssetFormClient';

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
        <AssetFormClient assetId={resolvedParams.asset_id} />
      </Suspense>
    </div>
  );
}
