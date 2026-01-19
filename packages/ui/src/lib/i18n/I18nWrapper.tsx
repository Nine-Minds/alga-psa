'use client';

import { I18nProvider } from '@alga-psa/ui/lib/i18n/client';
import { SupportedLocale, LOCALE_CONFIG } from '@alga-psa/ui/lib/i18n/config';
import { ReactNode, useEffect, useState } from 'react';
import { getHierarchicalLocaleAction } from '@alga-psa/tenancy/actions';

interface I18nWrapperProps {
  children: ReactNode;
  initialLocale?: SupportedLocale;
  portal?: 'msp' | 'client';
}

export function I18nWrapper({
  children,
  initialLocale,
  portal = 'msp'
}: I18nWrapperProps) {
  const [locale, setLocale] = useState<SupportedLocale>(
    initialLocale || (LOCALE_CONFIG.defaultLocale as SupportedLocale)
  );
  const [isLoading, setIsLoading] = useState(!initialLocale);

  useEffect(() => {
    if (!initialLocale) {
      // Fetch the proper locale from the server based on the hierarchy
      getHierarchicalLocaleAction()
        .then((serverLocale) => {
          setLocale(serverLocale);
          setIsLoading(false);
        })
        .catch((error) => {
          console.error('Failed to fetch locale:', error);
          setIsLoading(false);
        });
    }
  }, [initialLocale]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading language preferences...</div>
      </div>
    );
  }

  return (
    <I18nProvider initialLocale={locale} portal={portal}>
      {children}
    </I18nProvider>
  );
}
