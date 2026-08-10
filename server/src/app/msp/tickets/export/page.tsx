import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import TicketExportDialogRouteClient from '../_components/TicketExportDialogRouteClient';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.tickets.export.title', { defaultValue: 'Export Tickets' }),
  };
}

export default function TicketExportPage() {
  return <TicketExportDialogRouteClient closeMode="replace" />;
}
