import { BillingOverview } from '@alga-psa/client-portal/components';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('clientPortal.billing.title', { defaultValue: 'Billing' }),
  };
}

export default function BillingPage() {
  return <BillingOverview />;
}
