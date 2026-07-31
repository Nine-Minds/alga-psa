'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getInvoiceRoutingState } from '@alga-psa/billing/actions';

interface InvoiceSearchRedirectClientProps {
  invoiceId: string;
}

export default function InvoiceSearchRedirectClient({ invoiceId }: InvoiceSearchRedirectClientProps) {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash || '';
    let cancelled = false;
    // Draft invoices must land on the Drafts subtab — hard-coding 'finalized'
    // misfiles deep links to drafts (e.g. from a sales order's invoices list).
    (async () => {
      let subtab = 'finalized';
      try {
        const state = await getInvoiceRoutingState(invoiceId);
        if (state.exists && state.isDraft) subtab = 'drafts';
      } catch {
        // fall back to finalized (previous behavior)
      }
      if (!cancelled) {
        router.replace(`/msp/billing?tab=invoicing&subtab=${subtab}&invoiceId=${encodeURIComponent(invoiceId)}${hash}`);
      }
    })();
    return () => { cancelled = true; };
  }, [invoiceId, router]);

  return <div id="invoice-search-redirect" />;
}
