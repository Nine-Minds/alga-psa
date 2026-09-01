'use client';

import { useEffect } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface PaymentRedirectProps {
  url: string;
}

/**
 * Client component to handle external redirects to payment providers.
 * Uses window.location.href for proper handling of external URLs with fragments.
 */
export function PaymentRedirect({ url }: PaymentRedirectProps) {
  const { t } = useTranslation('client-portal');

  useEffect(() => {
    window.location.href = url;
  }, [url]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto mb-4"></div>
        <p className="text-gray-600">{t('billing.payment.redirecting', { defaultValue: 'Redirecting to payment...' })}</p>
      </div>
    </div>
  );
}

