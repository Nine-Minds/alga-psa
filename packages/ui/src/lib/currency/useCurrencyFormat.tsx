'use client';

import React from 'react';
import {
  currencyFractionDigits,
  formatCurrencyFromMinorUnits,
} from '@alga-psa/core';
import { useOptionalI18n } from '../i18n/client';
import { LOCALE_CONFIG } from '../i18n/config';

const DEFAULT_CURRENCY = 'USD';

interface CurrencyFormatContextValue {
  currencyCode: string;
  locale?: string;
}

export interface CurrencyFormat {
  money: (minorUnits: number, currencyOverride?: string) => string;
  moneySigned: (minorUnits: number, currencyOverride?: string) => string;
  fractionDigits: (currencyOverride?: string) => number;
}

const CurrencyFormatContext = React.createContext<CurrencyFormatContextValue>({
  currencyCode: DEFAULT_CURRENCY,
});

export function CurrencyFormatProvider({
  currencyCode,
  locale,
  children,
}: {
  currencyCode: string;
  locale?: string;
  children: React.ReactNode;
}) {
  const i18n = useOptionalI18n();
  const value = React.useMemo(
    () => ({
      currencyCode: currencyCode || DEFAULT_CURRENCY,
      locale: locale || i18n?.locale || LOCALE_CONFIG.defaultLocale,
    }),
    [currencyCode, i18n?.locale, locale],
  );

  return <CurrencyFormatContext.Provider value={value}>{children}</CurrencyFormatContext.Provider>;
}

export function useCurrencyFormat(): CurrencyFormat {
  const context = React.useContext(CurrencyFormatContext);
  const i18n = useOptionalI18n();
  const locale = context.locale || i18n?.locale || LOCALE_CONFIG.defaultLocale;
  const currencyCode = context.currencyCode || DEFAULT_CURRENCY;

  return React.useMemo(() => {
    const resolveCurrency = (currencyOverride?: string) => currencyOverride || currencyCode || DEFAULT_CURRENCY;
    const money = (minorUnits: number, currencyOverride?: string) =>
      formatCurrencyFromMinorUnits(Number(minorUnits || 0), locale, resolveCurrency(currencyOverride));

    return {
      money,
      moneySigned: (minorUnits: number, currencyOverride?: string) => {
        const amount = Number(minorUnits || 0);
        const formatted = money(Math.abs(amount), currencyOverride);
        if (amount < 0) return `-${formatted}`;
        if (amount > 0) return `+${formatted}`;
        return formatted;
      },
      fractionDigits: (currencyOverride?: string) =>
        currencyFractionDigits(resolveCurrency(currencyOverride), locale),
    };
  }, [currencyCode, locale]);
}
