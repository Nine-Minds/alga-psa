'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface InvoiceSearchRedirectClientProps {
  invoiceId: string;
}

export default function InvoiceSearchRedirectClient({ invoiceId }: InvoiceSearchRedirectClientProps) {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash || '';
    router.replace(`/msp/billing?tab=invoicing&subtab=finalized&invoiceId=${encodeURIComponent(invoiceId)}${hash}`);
  }, [invoiceId, router]);

  return <div id="invoice-search-redirect" />;
}
