import { listAssets } from 'server/src/lib/actions/asset-actions/assetActions';
import { getServerSession } from "next-auth/next";
import User from 'server/src/lib/models/user';
import { redirect } from 'next/navigation';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { AssetListResponse } from 'server/src/interfaces/asset.interfaces';
import AssetDashboard from 'server/src/components/assets/AssetDashboard';

export default async function AssetsPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect('/auth/signin');
  }

  const userEmail = await getCurrentUser();
  const userId = userEmail?.user_id;
  
  if (!userId) {
    console.error('User ID is missing from the session');
    redirect('/auth/signin');
  }

  try {
    const user = await User.get(userId);
    if (!user) {
      console.error(`User not found for ID: ${userId}`);
      redirect('/auth/signin');
    }

    const assets: AssetListResponse = await listAssets({});
    return <AssetDashboard initialAssets={assets} />;
  } catch (error) {
    console.error('Error fetching user or assets:', error);
    return <div>An error occurred. Please try again later.</div>;
  }
}
