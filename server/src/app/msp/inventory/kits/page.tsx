import { listInventoryProducts } from '@alga-psa/inventory/actions';
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
  try {
    const result = await listInventoryProducts();
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      console.error('Failed to load kits:', getErrorMessage(result));
    } else {
      initialKits = result.filter((p: any) => p.is_kit);
    }
  } catch (error) {
    console.error('Failed to load kits:', error);
  }

  return <KitManager initialKits={initialKits} />;
}

export const dynamic = 'force-dynamic';
