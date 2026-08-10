import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import QuoteDocumentTemplatesPage from '@alga-psa/billing/components/billing-dashboard/quotes/QuoteDocumentTemplatesPage';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.quoteDocumentTemplates.title', { defaultValue: 'Quote Layouts' }),
  };
}

export default function QuoteDocumentTemplatesRoute() {
  return <QuoteDocumentTemplatesPage />;
}

export const dynamic = 'force-dynamic';
