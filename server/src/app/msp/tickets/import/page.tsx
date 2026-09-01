import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import TicketImportRouteContent from '../_components/TicketImportRouteContent';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.tickets.import.title', { defaultValue: 'Import Tickets' }),
  };
}

export default function TicketImportPage() {
  return <TicketImportRouteContent closeMode="replace" />;
}
