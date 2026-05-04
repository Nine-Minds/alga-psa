import type { Metadata } from 'next';
import QuoteDocumentTemplatesPage from '@alga-psa/billing/components/billing-dashboard/quotes/QuoteDocumentTemplatesPage';

export const metadata: Metadata = {
  title: 'Quote Layouts',
};

export default function QuoteDocumentTemplatesRoute() {
  return <QuoteDocumentTemplatesPage />;
}

export const dynamic = 'force-dynamic';
