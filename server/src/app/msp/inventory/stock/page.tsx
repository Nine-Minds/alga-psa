// Stock screen: lists inventory-tracked products with summed availability and
// per-location reorder status. See StockOverview for the grid/dialogs.
import { listInventoryProducts } from '@alga-psa/inventory/actions';
import { StockOverview } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Stock',
};

export default async function StockOverviewPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/inventory/stock', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let initialProducts: any[] = [];
  try {
    initialProducts = await listInventoryProducts();
  } catch (error) {
    console.error('Failed to load inventory products:', error);
  }

  return <StockOverview initialProducts={initialProducts} />;
}

export const dynamic = 'force-dynamic';
