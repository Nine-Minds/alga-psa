import { cache } from 'react';
import { getAssetDetailBundle } from '@alga-psa/assets/actions/assetActions';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { MspAssetDetailClient } from '@alga-psa/msp-composition/assets';
import { getSession } from '@alga-psa/auth';
import { AIChatContextBoundary } from '@product/chat/context';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { Metadata } from 'next';

const getCachedAssetBundle = cache((id: string) => getAssetDetailBundle(id));

interface Props {
  params: Promise<{
    asset_id: string;
  }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const { asset_id } = await params;
    const bundle = await getCachedAssetBundle(asset_id);
    if (bundle.asset?.name) {
      return { title: bundle.asset.name };
    }
  } catch (error) {
    console.error('[generateMetadata] Failed to fetch asset title:', error);
  }
  return { title: 'Asset Details' };
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
    const bundle = await getCachedAssetBundle(resolvedParams.asset_id);
    if (!bundle.asset) {
      const { t } = await getServerTranslation(undefined, 'msp/assets');
      return <div>{t('assetListErrors.assetNotFound')}</div>;
    }

    return (
      <AIChatContextBoundary
        value={{
          pathname: `/msp/assets/${resolvedParams.asset_id}`,
          screen: {
            key: 'assets.detail',
            label: 'Asset Details',
          },
          record: {
            type: 'asset',
            id: resolvedParams.asset_id,
          },
        }}
      >
        <MspAssetDetailClient assetId={resolvedParams.asset_id} />
      </AIChatContextBoundary>
    );
  } catch (error) {
    console.error('Error fetching user or asset:', error);
    const { t } = await getServerTranslation(undefined, 'msp/assets');
    return <div>{t('assetListErrors.genericError')}</div>;
  }
}

export const dynamic = "force-dynamic";
