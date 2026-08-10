import { Clients } from '@alga-psa/clients';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.clients.title', { defaultValue: 'Clients' }),
  };
}

export default async function ClientsPage() {
  return <Clients />;
}
