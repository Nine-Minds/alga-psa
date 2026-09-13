import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedExplicitTicketGrantsPanel from '@/components/co-managed/CoManagedExplicitTicketGrantsPanel';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManagement.ticketAccess.title', { defaultValue: 'Individual Ticket Access' }),
  };
}

export default function CoManagedTicketAccessPage() {
  return <CoManagedFeatureBoundary><CoManagedExplicitTicketGrantsPanel /></CoManagedFeatureBoundary>;
}
