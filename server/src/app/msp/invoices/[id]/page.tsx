import type { Metadata } from 'next';
import InvoiceSearchRedirectClient from './InvoiceSearchRedirectClient';

interface InvoiceSearchRedirectPageProps {
  params: Promise<{
    id: string;
  }>;
}

export const metadata: Metadata = {
  title: 'Invoice',
};

export default async function InvoiceSearchRedirectPage({ params }: InvoiceSearchRedirectPageProps) {
  const { id } = await params;
  return <InvoiceSearchRedirectClient invoiceId={id} />;
}

export const dynamic = 'force-dynamic';
