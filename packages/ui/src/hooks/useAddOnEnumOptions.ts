'use client';

import { useTranslation } from '../lib/i18n/client';
import {
  ADD_ON_DESCRIPTIONS,
  type AddOnKey,
} from '@alga-psa/types';

const COMMON_NAMESPACE = 'common';

export function useFormatAddOnDescription(): (value: string) => string {
  const { t } = useTranslation(COMMON_NAMESPACE);
  return (value: string) => {
    const fallback =
      ADD_ON_DESCRIPTIONS[value as AddOnKey] ?? '';
    return t(`enums.addOnDescription.${value}`, { defaultValue: fallback });
  };
}
