import { loanersOutReport } from '@alga-psa/inventory/actions';
import { LoanersManager } from '@alga-psa/inventory/components';
import { getAllClients } from '@alga-psa/clients/actions';
import { getSession } from '@alga-psa/auth';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { redirect } from 'next/navigation';
import type { LoanerOutRow } from '@alga-psa/inventory/actions';
import type { IClient } from '@alga-psa/types';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.inventory.loaners.title', { defaultValue: 'Loaners' }),
  };
}

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
  try {
    const result = await loanersOutReport();
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      console.error('Failed to load loaners:', getErrorMessage(result));
    } else {
      initialLoaners = result;
    }
  } catch (error) {
    console.error('Failed to load loaners:', error);
  }

  // Loan-out needs the client picker; the page loads clients the same way sales orders does.
  let clients: IClient[] = [];
  try {
    clients = await getAllClients();
  } catch (error) {
    console.error('Failed to load clients:', error);
  }

  return <LoanersManager initialLoaners={initialLoaners} clients={clients} />;
}

export const dynamic = 'force-dynamic';
