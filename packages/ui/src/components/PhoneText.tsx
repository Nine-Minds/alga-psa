'use client';

import React, { useId } from 'react';
import { formatPhoneForDisplay, formatPhoneLabel } from '@alga-psa/validation';
import { useTranslation } from '../lib/i18n/client';

export interface PhoneTextProps {
  value: string | null | undefined;
  extension?: string | null;
  defaultCountry?: string | null;
  link?: boolean;
  className?: string;
  fallback?: React.ReactNode;
}

export function PhoneText({ value, extension, defaultCountry, link = true, className, fallback = '' }: PhoneTextProps) {
  const generatedId = useId();
  const { t } = useTranslation('common');
  const formatted = formatPhoneForDisplay(value, extension, defaultCountry);
  if (!formatted.number) return <>{fallback}</>;
  const text = formatPhoneLabel(formatted, t('phone.extension', { defaultValue: 'ext.' }));
  const href = formatted.e164
    ? `tel:${formatted.e164}${formatted.extension ? `;ext=${formatted.extension}` : ''}`
    : undefined;
  if (!link || !href) return <span className={className}>{text}</span>;
  return <a id={`phone-text-${generatedId}`} className={className} href={href}>{text}</a>;
}
