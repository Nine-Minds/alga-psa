import { MarginReport } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Margin Report',
};

export default async function MarginReportPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/inventory/margin', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  return <MarginReport />;
}

export const dynamic = 'force-dynamic';
