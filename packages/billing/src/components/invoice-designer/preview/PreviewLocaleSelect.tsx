'use client';

import React, { useMemo } from 'react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { LOCALE_CONFIG, filterPseudoLocales, type SupportedLocale } from '@alga-psa/core/i18n/config';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface PreviewLocaleSelectProps {
  value: SupportedLocale;
  onChange: (locale: SupportedLocale) => void;
  disabled?: boolean;
  id?: string;
}

/**
 * Preview a template in any supported language. Standard templates arrive with
 * translatable labels, so this is how an author sees what each client actually
 * receives without sending a real document to find out.
 */
export function PreviewLocaleSelect({
  value,
  onChange,
  disabled = false,
  id = 'designer-preview-locale-select',
}: PreviewLocaleSelectProps) {
  const { t } = useTranslation('msp/invoicing');
  const options = useMemo(
    () =>
      filterPseudoLocales(LOCALE_CONFIG.supportedLocales).map((locale) => ({
        value: locale,
        label: LOCALE_CONFIG.localeNames[locale],
      })),
    [],
  );

  return (
    <CustomSelect
      id={id}
      options={options}
      value={value}
      onValueChange={(locale) => onChange(locale as SupportedLocale)}
      disabled={disabled}
      className="min-w-[160px]"
      placeholder={t('designer.workspace.preview.language', { defaultValue: 'Preview language' })}
    />
  );
}

export default PreviewLocaleSelect;
