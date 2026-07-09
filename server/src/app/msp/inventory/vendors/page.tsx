import { listVendors } from '@alga-psa/inventory/actions';
import { VendorsManager } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { redirect } from 'next/navigation';
import type { IVendor } from '@alga-psa/types';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Vendors',
};

export default async function VendorsPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/inventory/vendors', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let initialVendors: IVendor[] = [];
  try {
    const result = await listVendors({});
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      console.error('Failed to load vendors:', getErrorMessage(result));
    } else {
      initialVendors = result;
    }
  } catch (error) {
    console.error('Failed to load vendors:', error);
  }

  return <VendorsManager initialVendors={initialVendors} />;
}

export const dynamic = 'force-dynamic';
