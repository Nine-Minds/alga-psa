import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import BulkAddTagsRouteClient from '../../_components/BulkAddTagsRouteClient';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.tickets.bulkTags.title', { defaultValue: 'Set Tags' }),
  };
}

export default function BulkAddTagsModalPage() {
  return <BulkAddTagsRouteClient closeMode="back" />;
}
