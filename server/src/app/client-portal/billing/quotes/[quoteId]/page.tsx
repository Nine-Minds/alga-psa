import { QuoteDetailPage } from '@alga-psa/client-portal/components';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Quote Details',
};

interface QuotePageProps {
  params: Promise<{
    quoteId: string;
  }>;
}

export default async function QuotePage({ params }: QuotePageProps) {
  const { quoteId } = await params;
  return <QuoteDetailPage quoteId={quoteId} />;
}
