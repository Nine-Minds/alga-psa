import { getAssetDetailBundle } from '@alga-psa/assets/actions/assetActions';
import User from 'server/src/lib/models/user';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@alga-psa/users/actions';
import { AssetDetailView } from '@alga-psa/assets/components/AssetDetailView';
import { getConnection } from 'server/src/lib/db/db';
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
