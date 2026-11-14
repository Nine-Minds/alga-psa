'use client';

import Link from 'next/link';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

/** What Customer Tickets shows once the release boundary resolves to unavailable. */
export default function CustomerTicketsUnavailable() {
  const { t } = useTranslation('msp/licensing');
  return (
    <div id="customer-tickets-unavailable" className="p-6">
      <h1 className="text-2xl font-bold text-gray-900">{t('coManaged.customerTickets.title', 'Customer Tickets')}</h1>
      <p className="mt-2 text-[rgb(var(--color-text-600))]">
        {t('coManaged.customerTickets.unavailable', 'This view is not available for your account yet.')}{' '}
        <Link href="/msp/tickets" className="text-primary underline">{t('coManaged.customerTickets.allTickets', 'All Tickets')}</Link>
      </p>
    </div>
  );
}
