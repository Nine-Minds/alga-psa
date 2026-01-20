import { listAssets } from '@alga-psa/assets/actions/assetActions';
import User from 'server/src/lib/models/user';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@alga-psa/users/actions';
import type { AssetListResponse } from '@alga-psa/types';
import AssetDashboard from '@alga-psa/assets/components/AssetDashboard';
import { getConnection } from 'server/src/lib/db/db';
import { getSession } from 'server/src/lib/auth/getSession';

export default async function AssetsPage() {
  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  const userEmail = await getCurrentUser();
  const userId = userEmail?.user_id;
  
  if (!userId) {
    console.error('User ID is missing from the session');
    redirect('/auth/msp/signin');
  }

  try {
    const knex = await getConnection();
    const user = await User.get(knex, userId);
    if (!user) {
      console.error(`User not found for ID: ${userId}`);
      redirect('/auth/msp/signin');
    }

    const assets: AssetListResponse = await listAssets({});
    return <AssetDashboard initialAssets={assets} />;
  } catch (error) {
    console.error('Error fetching user or assets:', error);
    return <div>An error occurred. Please try again later.</div>;
  }
}

export const dynamic = "force-dynamic";
