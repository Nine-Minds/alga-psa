'use client';

import { ReactNode } from 'react';
import { I18nWrapper } from './I18nWrapper';

interface I18nServerWrapperProps {
  children: ReactNode;
  portal?: 'msp' | 'client';
}

/**
 * Client component wrapper that provides i18n context
 * The actual locale detection happens in the I18nWrapper
 * based on cookies and will respect the hierarchy
 */
export default function I18nServerWrapper({
  children,
  portal = 'client'
}: I18nServerWrapperProps) {
  return (
    <I18nWrapper portal={portal}>
      {children}
    </I18nWrapper>
  );
}
