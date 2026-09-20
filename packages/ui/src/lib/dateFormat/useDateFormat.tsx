'use client';

import React from 'react';
import {
  countryDateFormat,
  SYSTEM_DATE_FORMAT,
  type CountryDateFormat,
} from '@alga-psa/core/i18n/countryDateFormat';

/**
 * The date shape the tree renders in, resolved once per request from the
 * tenant's (or, in the client portal, the client's) country.
 *
 * Sibling of CurrencyFormatProvider and deliberately shaped the same way: the
 * context default is the fixed system pattern, so a tree rendered without a
 * provider — drawers, print views, auth pages, component tests — stays
 * deterministic instead of following whatever the browser is set to.
 */
const DateFormatContext = React.createContext<CountryDateFormat>(SYSTEM_DATE_FORMAT);

export function DateFormatProvider({
  dateFormat,
  countryCode,
  children,
}: {
  /** Pattern resolved server-side. Takes precedence over countryCode. */
  dateFormat?: CountryDateFormat | null;
  /** ISO 3166-1 alpha-2, for callers that only carry the country. */
  countryCode?: string | null;
  children: React.ReactNode;
}) {
  const value = React.useMemo(
    () => dateFormat ?? countryDateFormat(countryCode),
    [dateFormat, countryCode],
  );

  return <DateFormatContext.Provider value={value}>{children}</DateFormatContext.Provider>;
}

/** The active country date pattern. Never null: falls back to the system default. */
export function useDateFormat(): CountryDateFormat {
  return React.useContext(DateFormatContext);
}

export { SYSTEM_DATE_FORMAT };
export type { CountryDateFormat };
