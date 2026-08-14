'use client';

import * as React from 'react';
import { useTranslation } from './i18n/client';

/**
 * Chrome labels for the picker family.
 *
 * The pickers render on screens that have no I18nProvider above them (sign-in,
 * for one), where react-i18next hands back the key itself. Callers pass the
 * English wording as the fallback and get that instead of a raw
 * `datePicker.today` — which is what "Hour", "Minute" and "Today" used to be
 * hardcoded to avoid, at the cost of never being translatable at all.
 */
export function usePickerText() {
  const { t } = useTranslation('common');

  return React.useCallback(
    (key: string, fallback: string): string => {
      const translated = t(key, fallback);
      if (!translated || translated === key || translated === `common:${key}`) return fallback;
      return translated;
    },
    [t]
  );
}
