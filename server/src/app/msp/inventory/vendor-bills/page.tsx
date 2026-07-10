import { listVendorBills } from '@alga-psa/inventory/actions';
import { VendorBillsManager } from '@alga-psa/inventory/components';
// Inventory cannot import billing, so the export actions are injected from the page
// (F047, ghost-usage props idiom); billing permissions are enforced inside the actions.
import {
  getVendorBillExportContext,
  getVendorBillExportStatuses,
  retryVendorBillExport
} from '@alga-psa/billing/actions';
import { getSession } from '@alga-psa/auth';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
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
  let loadErrorMessage: string | undefined;
  try {
    const result = await listVendorBills();
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      loadErrorMessage = getErrorMessage(result);
    } else {
      initialBills = result;
    }
  } catch (error) {
    console.error('Failed to load vendor bills:', error);
  }

  const exportContext = await getVendorBillExportContext().catch(() => ({
    integration: null,
    vendorBillsSupported: false,
  }));

  return (
    <VendorBillsManager
      initialBills={initialBills}
      loadErrorMessage={loadErrorMessage}
      retryExportBill={retryVendorBillExport}
      getExportStatuses={getVendorBillExportStatuses}
      exportContext={exportContext}
    />
  );
}

export const dynamic = 'force-dynamic';
