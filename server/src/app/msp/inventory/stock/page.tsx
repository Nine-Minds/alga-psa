// Stock screen: lists inventory-tracked products with summed availability and
// per-location reorder status. See StockOverview for the grid/dialogs.
import { getInventoryTenantCurrency, listInventoryProducts } from '@alga-psa/inventory/actions';
import { StockOverview } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.inventory.stock.title', { defaultValue: 'Stock' }),
  };
}

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
  let defaultCurrencyCode = 'USD';
  try {
    const result = await listInventoryProducts();
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      console.error('Failed to load inventory products:', getErrorMessage(result));
    } else {
      initialProducts = result;
    }
  } catch (error) {
    console.error('Failed to load inventory products:', error);
  }
  try {
    defaultCurrencyCode = await getInventoryTenantCurrency();
  } catch (error) {
    console.error('Failed to load inventory default currency:', error);
  }

  return <StockOverview initialProducts={initialProducts} defaultCurrencyCode={defaultCurrencyCode} />;
}

export const dynamic = 'force-dynamic';
