import { getInventoryTenantCurrency, listStockUnits } from '@alga-psa/inventory/actions';
import { StockUnitsManager } from '@alga-psa/inventory/components';
// Restock-to-sellable + restocking-fee invoicing is a billing composite (billing → inventory
// dependency direction); the action reference is passed down to the client component (plan §W3).
import { restockReturnWithFee } from '@alga-psa/billing/actions';
import { getAllClients } from '@alga-psa/clients/actions';
import { getSession } from '@alga-psa/auth';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { redirect } from 'next/navigation';
import type { IClient, IStockUnit } from '@alga-psa/types';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.inventory.units.title', { defaultValue: 'Stock Units' }),
  };
}

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

  // Restock's fee flow needs the client picker (non-serialized) and a currency for the fee input.
  let clients: IClient[] = [];
  try {
    clients = await getAllClients();
  } catch (error) {
    console.error('Failed to load clients:', error);
  }

  let defaultCurrencyCode = 'USD';
  try {
    defaultCurrencyCode = await getInventoryTenantCurrency();
  } catch (error) {
    console.error('Failed to load inventory default currency:', error);
  }

  return (
    <StockUnitsManager
      initialUnits={initialUnits}
      clients={clients}
      defaultCurrencyCode={defaultCurrencyCode}
      restockReturnWithFee={restockReturnWithFee}
    />
  );
}

export const dynamic = 'force-dynamic';
