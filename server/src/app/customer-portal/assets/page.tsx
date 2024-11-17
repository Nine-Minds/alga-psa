import { getServerSession } from 'next-auth';
import { options } from '../../api/auth/[...nextauth]/options';
import { listAssets } from '@/lib/actions/asset-actions/assetActions';
import { AssetList } from '@/components/customer-portal/assets/AssetList';

export default async function AssetsPage() {
  const session = await getServerSession(options);
  if (!session?.user?.companyId) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-600">Please log in to view your assets.</p>
      </div>
    );
  }

  // Fetch assets for the client's company
  const assetResponse = await listAssets({
    company_id: session.user.companyId,
    include_extension_data: true,
    include_company_details: true
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Assets</h1>
      </div>
      
      <div className="bg-white shadow rounded-lg">
        <AssetList assets={assetResponse.assets} />
      </div>
    </div>
  );
}
