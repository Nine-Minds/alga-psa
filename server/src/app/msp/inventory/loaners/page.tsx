import { getInventoryTenantCurrency, loanersOutReport } from '@alga-psa/inventory/actions';
import { LoanersManager } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import type { LoanerOutRow } from '@alga-psa/inventory/actions';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Loaners',
};

export default async function LoanersPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/inventory/loaners', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let initialLoaners: LoanerOutRow[] = [];
  let defaultCurrencyCode = 'USD';
  try {
    initialLoaners = await loanersOutReport();
  } catch (error) {
    console.error('Failed to load loaners:', error);
  }
  try {
    defaultCurrencyCode = await getInventoryTenantCurrency();
  } catch (error) {
    console.error('Failed to load inventory default currency:', error);
  }

  return <LoanersManager initialLoaners={initialLoaners} defaultCurrencyCode={defaultCurrencyCode} />;
}

export const dynamic = 'force-dynamic';
