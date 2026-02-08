import { getAssetDetailBundle } from '@alga-psa/assets/actions/assetActions';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@alga-psa/users/actions';
import { AssetDetailView } from '@alga-psa/assets/components/AssetDetailView';
import { getSession } from 'server/src/lib/auth/getSession';

interface Props {
  params: Promise<{
    asset_id: string;
  }>;
}

export default async function AssetPage({ params }: Props) {
  const resolvedParams = await params;
  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  const currentUser = await getCurrentUser();
  const userId = currentUser?.user_id;
  
  if (!userId) {
    console.error('User ID is missing from the session');
    redirect('/auth/msp/signin');
  }

  try {
    const bundle = await getAssetDetailBundle(resolvedParams.asset_id);
    if (!bundle.asset) {
      return <div>Asset not found</div>;
    }

    return <AssetDetailView assetId={resolvedParams.asset_id} />;
  } catch (error) {
    console.error('Error fetching user or asset:', error);
    return <div>An error occurred. Please try again later.</div>;
  }
}

export const dynamic = "force-dynamic";
