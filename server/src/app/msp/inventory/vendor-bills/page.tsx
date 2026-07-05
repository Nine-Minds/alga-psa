import { listVendorBills } from '@alga-psa/inventory/actions';
import { VendorBillsManager } from '@alga-psa/inventory/components';
// Inventory cannot import billing, so the export actions are injected from the page
// (F047, ghost-usage props idiom); billing permissions are enforced inside the actions.
import { exportVendorBillToAccounting, getVendorBillExportStatuses } from '@alga-psa/billing/actions';
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

  return (
    <VendorBillsManager
      initialBills={initialBills}
      exportBill={exportVendorBillToAccounting}
      getExportStatuses={getVendorBillExportStatuses}
    />
  );
}

export const dynamic = 'force-dynamic';
