import { QuoteDetailPage } from '@alga-psa/client-portal/components';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('clientPortal.billing.quotes.detail.title', { defaultValue: 'Quote Details' }),
  };
}

interface QuotePageProps {
  params: Promise<{
    quoteId: string;
  }>;
}

export default async function QuotePage({ params }: QuotePageProps) {
  const { quoteId } = await params;
  return <QuoteDetailPage quoteId={quoteId} />;
}
