import { getAsset } from 'server/src/lib/actions/asset-actions/assetActions';
import { getServerSession } from "next-auth/next";
import User from 'server/src/lib/models/user';
import { redirect } from 'next/navigation';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import AssetDetails from 'server/src/components/assets/AssetDetails';
import { getConnection } from 'server/src/lib/db/db';

interface Props {
  params: Promise<{
    asset_id: string;
  }>;
}

export default async function AssetPage({ params }: Props) {
  const resolvedParams = await params;
  const session = await getServerSession();
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

    const asset = await getAsset(resolvedParams.asset_id);
    if (!asset) {
      return <div>Asset not found</div>;
    }

    return <AssetDetails asset={asset} />;
  } catch (error) {
    console.error('Error fetching user or asset:', error);
    return <div>An error occurred. Please try again later.</div>;
  }
}

export const dynamic = "force-dynamic";
