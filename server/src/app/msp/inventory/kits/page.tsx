import { listKitComponentCandidates, listKitServiceTypes, listKitSummaries } from '@alga-psa/inventory/actions';
import { KitManager } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
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
    const [kitsResult, serviceTypesResult, candidatesResult] = await Promise.all([
      listKitSummaries(),
      listKitServiceTypes(),
      listKitComponentCandidates(),
    ]);
    for (const result of [kitsResult, serviceTypesResult, candidatesResult]) {
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        console.error('Failed to load kits:', getErrorMessage(result));
      }
    }
    if (!isActionMessageError(kitsResult) && !isActionPermissionError(kitsResult)) {
      initialKits = kitsResult;
    }
    if (!isActionMessageError(serviceTypesResult) && !isActionPermissionError(serviceTypesResult)) {
      serviceTypes = serviceTypesResult;
    }
    if (!isActionMessageError(candidatesResult) && !isActionPermissionError(candidatesResult)) {
      componentCandidates = candidatesResult;
    }
  } catch (error) {
    console.error('Failed to load kits:', error);
  }

  return <KitManager initialKits={initialKits} serviceTypes={serviceTypes} componentCandidates={componentCandidates} />;
}

export const dynamic = 'force-dynamic';
