import FullAddAssetForm from '@alga-psa/assets/components/FullAddAssetForm';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'msp/assets');
  return { title: t('fullIntake.title', { defaultValue: 'Add asset' }) };
}

export default async function NewAssetPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/assets/new', scope: 'msp' });
  if (boundary) return boundary;
  const session = await getSession();
  if (!session?.user) redirect('/auth/msp/signin');
  return <FullAddAssetForm />;
}

export const dynamic = 'force-dynamic';
