import { listAssets } from '@alga-psa/assets/actions/assetActions';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@alga-psa/users/actions';
import type { AssetListResponse } from '@alga-psa/types';
import AssetDashboard from '@alga-psa/assets/components/AssetDashboard';
import { getSession } from 'server/src/lib/auth/getSession';

export default async function AssetsPage() {
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
    const assets: AssetListResponse = await listAssets({});
    return <AssetDashboard initialAssets={assets} />;
  } catch (error) {
    console.error('Error fetching user or assets:', error);
    return <div>An error occurred. Please try again later.</div>;
  }
}

export const dynamic = "force-dynamic";
