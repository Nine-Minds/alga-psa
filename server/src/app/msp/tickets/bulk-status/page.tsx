import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import BulkChangeStatusRouteClient from '../_components/BulkChangeStatusRouteClient';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.tickets.bulkStatus.title', { defaultValue: 'Set Status' }),
  };
}

export default function BulkChangeStatusPage() {
  return <BulkChangeStatusRouteClient closeMode="replace" />;
}
