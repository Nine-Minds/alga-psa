'use client';

import { I18nProvider } from '@/lib/i18n/client';
import { SupportedLocale } from '@/lib/i18n/config';
import { ReactNode } from 'react';

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
  return (
    <I18nProvider initialLocale={initialLocale} portal={portal}>
      {children}
    </I18nProvider>
  );
}