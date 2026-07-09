import { loanersOutReport } from '@alga-psa/inventory/actions';
import { LoanersManager } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
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

  return <LoanersManager initialLoaners={initialLoaners} />;
}

export const dynamic = 'force-dynamic';
