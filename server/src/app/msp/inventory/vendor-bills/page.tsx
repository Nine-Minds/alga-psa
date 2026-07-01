import { listVendorBills } from '@alga-psa/inventory/actions';
import { VendorBillsManager } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Vendor Bills',
};

export default async function VendorBillsPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/inventory/vendor-bills', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let initialBills: any[] = [];
  try {
    initialBills = await listVendorBills();
  } catch (error) {
    console.error('Failed to load vendor bills:', error);
  }

  return <VendorBillsManager initialBills={initialBills} />;
}

export const dynamic = 'force-dynamic';
