import FullAddAssetForm from '@alga-psa/assets/components/FullAddAssetForm';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export default async function NewAssetPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/assets/new', scope: 'msp' });
  if (boundary) return boundary;
  const session = await getSession();
  if (!session?.user) redirect('/auth/msp/signin');
  return <FullAddAssetForm />;
}

export const dynamic = 'force-dynamic';
