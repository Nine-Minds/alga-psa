import { writeOffReport } from '@alga-psa/inventory/actions';
import type { WriteOffReportData } from '@alga-psa/inventory/actions';
import { WriteOffsReport } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.inventory.writeOffs.title', { defaultValue: 'Write-offs' }),
  };
}

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
