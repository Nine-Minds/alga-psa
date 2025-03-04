import { Metadata } from 'next';
import AssetForm from 'server/src/components/assets/AssetForm';

interface AssetEditPageProps {
  params: {
    asset_id: string;
  };
}

export const metadata: Metadata = {
  title: 'Edit Asset',
  description: 'Edit asset details'
};

export default function AssetEditPage({ params }: AssetEditPageProps) {
  return (
    <div className="container mx-auto px-4 py-8">
      <AssetForm assetId={params.asset_id} />
    </div>
  );
}
