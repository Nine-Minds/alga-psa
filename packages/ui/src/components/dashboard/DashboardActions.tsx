'use client';

import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function DashboardActions() {
  const { t } = useTranslation('client-portal');

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Button 
        id="create-ticket-button" 
        className="w-full font-medium"
        asChild
      >
        <a href="/client-portal/tickets/new">{t('dashboard.quickActions.createSupportTicket')}</a>
      </Button>
      <Button 
        id="view-invoice-button" 
        className="w-full font-medium"
        variant="soft" 
        asChild
      >
        <a href="/client-portal/billing/invoices">{t('dashboard.quickActions.viewLatestInvoice')}</a>
      </Button>
    </div>
  );
}
