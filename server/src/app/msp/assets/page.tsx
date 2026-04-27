import { listAssets } from '@alga-psa/assets/actions/assetActions';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import type { AssetListResponse } from '@alga-psa/types';
import { MspAssetDashboardClient } from '@alga-psa/msp-composition/assets';
import { getSession } from '@alga-psa/auth';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Assets',
};

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
    return <MspAssetDashboardClient initialAssets={assets} />;
  } catch (error) {
    console.error('Error fetching user or assets:', error);
    const { t } = await getServerTranslation(undefined, 'msp/assets');
    return <div>{t('assetListErrors.genericError')}</div>;
  }
}

export const dynamic = "force-dynamic";
