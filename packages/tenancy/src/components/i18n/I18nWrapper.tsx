'use client';

import { detectClientLocale, getBootstrapLoadingText, I18nProvider } from '@alga-psa/ui/lib/i18n/client';
import { SupportedLocale, LOCALE_CONFIG, getNamespacesForRoute } from '@alga-psa/core/i18n/config';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getHierarchicalLocaleAction } from '../../actions';

interface I18nWrapperProps {
  children: ReactNode;
  initialLocale?: SupportedLocale;
  portal?: 'msp' | 'client';
  /** Server-embedded namespace resources for the current route (no HTTP fetch). */
  preloadedResources?: Record<string, Record<string, unknown>>;
}

export function I18nWrapper({
  children,
  initialLocale,
  portal = 'msp',
  preloadedResources,
}: I18nWrapperProps) {
  const [locale, setLocale] = useState<SupportedLocale>(
    initialLocale || (LOCALE_CONFIG.defaultLocale as SupportedLocale)
  );
  const [isLoading, setIsLoading] = useState(!initialLocale);
  const pathname = usePathname();
  const namespaces = useMemo(
    () => getNamespacesForRoute(pathname),
    [pathname]
  );

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
    // Avoid persisted browser preferences here; they can belong to a previous
    // logged-in user. Authenticated layouts should provide initialLocale.
    const loadingLocale = initialLocale || detectClientLocale({ includeStoredPreference: false });

    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">{getBootstrapLoadingText(loadingLocale, 'languagePreferences')}</div>
      </div>
    );
  }

  return (
    <I18nProvider
      initialLocale={locale}
      portal={portal}
      namespaces={namespaces}
      preloadedResources={preloadedResources}
    >
      {children}
    </I18nProvider>
  );
}
