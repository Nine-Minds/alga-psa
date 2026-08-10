import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { ClientDocumentsPage } from '@alga-psa/client-portal/components';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('clientPortal.documents.title', { defaultValue: 'Documents' }),
  };
}

export default function DocumentsPage() {
  return <ClientDocumentsPage />;
}
