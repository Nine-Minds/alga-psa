import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import BulkChangePriorityRouteClient from '../_components/BulkChangePriorityRouteClient';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.tickets.bulkPriority.title', { defaultValue: 'Set Priority' }),
  };
}

export default function BulkChangePriorityPage() {
  return <BulkChangePriorityRouteClient closeMode="replace" />;
}
