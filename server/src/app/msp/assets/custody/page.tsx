import { MspCustodyQueue } from '@alga-psa/msp-composition/assets';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.assets.custody.title', { defaultValue: 'Equipment in custody' }),
  };
}

export default async function AssetCustodyQueuePage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/assets/custody', scope: 'msp' });
  if (boundary) return boundary;
  const session = await getSession();
  if (!session?.user) redirect('/auth/msp/signin');
  return <MspCustodyQueue />;
}

export const dynamic = 'force-dynamic';
