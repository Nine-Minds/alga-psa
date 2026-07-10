import { listStockUnits } from '@alga-psa/inventory/actions';
import { StockUnitsManager } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { redirect } from 'next/navigation';
import type { IStockUnit } from '@alga-psa/types';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Stock Units',
};

export default async function StockUnitsPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/inventory/units', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let initialUnits: IStockUnit[] = [];
  try {
    const result = await listStockUnits({});
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      console.error('Failed to load stock units:', getErrorMessage(result));
    } else {
      initialUnits = result;
    }
  } catch (error) {
    console.error('Failed to load stock units:', error);
  }

  return <StockUnitsManager initialUnits={initialUnits} />;
}

export const dynamic = 'force-dynamic';
