'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

/**
 * What `/msp/tickets` shows when a URL asks for qualified co-managed scope but
 * the release boundary has resolved to unavailable.
 *
 * The qualified branch replaces the whole page, so without this the route would
 * render blank for anyone following a shared co-managed link without the flag.
 * Dropping the scope parameters returns them to the ordinary native list, which
 * is the honest answer: the tickets they can see are still there, just not the
 * combined view. `replace` keeps the unusable URL out of history.
 */
export default function TicketListQualifiedFallback() {
  const { t } = useTranslation('msp/licensing');
  const router = useRouter();

  useEffect(() => {
    router.replace('/msp/tickets');
  }, [router]);

  return (
    <p id="msp-tickets-qualified-fallback" role="status" className="p-6 text-[rgb(var(--color-text-600))]">
      {t('coManaged.queue.scopeUnavailable', { defaultValue: 'Opening the ticket list…' })}
    </p>
  );
}
