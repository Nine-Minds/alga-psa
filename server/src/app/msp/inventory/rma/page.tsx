import { listRmaCases, deadUnitsOwedReport } from '@alga-psa/inventory/actions';
import { RmaManager } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import type { IRmaCase } from '@alga-psa/types';
import type { DeadUnitOwedRow } from '@alga-psa/inventory/actions';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'RMA',
};

export default async function RmaPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/inventory/rma', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let initialCases: IRmaCase[] = [];
  let initialDeadOwed: DeadUnitOwedRow[] = [];
  try {
    initialCases = await listRmaCases({});
  } catch (error) {
    console.error('Failed to load RMA cases:', error);
  }
  try {
    initialDeadOwed = await deadUnitsOwedReport();
  } catch (error) {
    console.error('Failed to load dead units owed report:', error);
  }

  return <RmaManager initialCases={initialCases} initialDeadOwed={initialDeadOwed} />;
}

export const dynamic = 'force-dynamic';
