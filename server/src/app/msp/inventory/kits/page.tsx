import { listKitComponentCandidates, listKitServiceTypes, listKitSummaries } from '@alga-psa/inventory/actions';
import { KitManager } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Kits',
};

export default async function KitsPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/inventory/kits', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let initialKits: any[] = [];
  let serviceTypes: any[] = [];
  let componentCandidates: any[] = [];
  try {
    [initialKits, serviceTypes, componentCandidates] = await Promise.all([
      listKitSummaries(),
      listKitServiceTypes(),
      listKitComponentCandidates(),
    ]);
  } catch (error) {
    console.error('Failed to load kits:', error);
  }

  return <KitManager initialKits={initialKits} serviceTypes={serviceTypes} componentCandidates={componentCandidates} />;
}

export const dynamic = 'force-dynamic';
