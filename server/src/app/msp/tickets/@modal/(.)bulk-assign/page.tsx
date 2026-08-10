import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import BulkAssignTicketsRouteContent from '../../_components/BulkAssignTicketsRouteContent';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.tickets.bulkAssign.title', { defaultValue: 'Assign Tickets' }),
  };
}

export default function BulkAssignTicketsModalPage() {
  return <BulkAssignTicketsRouteContent closeMode="back" />;
}
