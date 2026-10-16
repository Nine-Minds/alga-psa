import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CoManagedTicketQueueLegacyAdapter from '@/components/co-managed/CoManagedTicketQueueLegacyAdapter';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.coManaged.tickets.title', { defaultValue: 'Co-Managed Ticket Queues' }),
  };
}
export default function CoManagedTicketQueuesPage() {
  return <CoManagedFeatureBoundary><CoManagedTicketQueueLegacyAdapter /></CoManagedFeatureBoundary>;
}
