import { writeOffReport } from '@alga-psa/inventory/actions';
import type { WriteOffReportData } from '@alga-psa/inventory/actions';
import { WriteOffsReport } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Write-offs',
};

export default async function WriteOffsPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/inventory/write-offs', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let initialData: WriteOffReportData | null = null;
  try {
    const result = await writeOffReport({});
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      console.error('Failed to load write-off report:', getErrorMessage(result));
    } else {
      initialData = result;
    }
  } catch (error) {
    console.error('Failed to load write-off report:', error);
  }

  return <WriteOffsReport initialData={initialData} />;
}

export const dynamic = 'force-dynamic';
