import { Metadata } from 'next';
import AssetForm from 'server/src/components/assets/AssetForm';

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
      <AssetForm assetId={resolvedParams.asset_id} />
    </div>
  );
}
