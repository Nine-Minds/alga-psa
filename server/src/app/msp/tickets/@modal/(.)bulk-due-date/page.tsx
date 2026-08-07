import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import BulkSetDueDateRouteClient from '../../_components/BulkSetDueDateRouteClient';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.tickets.bulkDueDate.title', { defaultValue: 'Set Due Date' }),
  };
}

export default function BulkSetDueDateModalPage() {
  return <BulkSetDueDateRouteClient closeMode="back" />;
}
