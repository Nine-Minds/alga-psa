'use client';

import React, { useId } from 'react';
import { formatPhoneForDisplay } from '@alga-psa/validation';

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
  const formatted = formatPhoneForDisplay(value, extension, defaultCountry);
  if (!formatted.number) return <>{fallback}</>;
  const text = `${formatted.number}${formatted.extension ? ` ext. ${formatted.extension}` : ''}`;
  const href = formatted.e164
    ? `tel:${formatted.e164}${formatted.extension ? `;ext=${formatted.extension}` : ''}`
    : undefined;
  if (!link || !href) return <span className={className}>{text}</span>;
  return <a id={`phone-text-${generatedId}`} className={className} href={href}>{text}</a>;
}
