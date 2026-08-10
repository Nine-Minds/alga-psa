import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import InvoiceSearchRedirectClient from './InvoiceSearchRedirectClient';

interface InvoiceSearchRedirectPageProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.invoices.detail.title', { defaultValue: 'Invoice' }),
  };
}

export default async function InvoiceSearchRedirectPage({ params }: InvoiceSearchRedirectPageProps) {
  const { id } = await params;
  return <InvoiceSearchRedirectClient invoiceId={id} />;
}

export const dynamic = 'force-dynamic';
