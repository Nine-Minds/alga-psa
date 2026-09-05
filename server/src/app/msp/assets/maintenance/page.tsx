import { MspMaintenanceCommandCenter } from '@alga-psa/msp-composition/assets';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.assets.maintenance.title', { defaultValue: 'Asset Maintenance' }),
  };
}

export default async function AssetMaintenancePage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/assets/maintenance', scope: 'msp' });
  if (boundary) return boundary;
  const session = await getSession();
  if (!session?.user) redirect('/auth/msp/signin');
  return <MspMaintenanceCommandCenter />;
}

export const dynamic = 'force-dynamic';
