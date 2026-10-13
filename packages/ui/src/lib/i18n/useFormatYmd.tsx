'use client';

import { useCallback } from 'react';
import { parse } from 'date-fns';
import { useFormatters } from './client';

/**
 * Returns a formatter for `YYYY-MM-DD` calendar dates. The string is parsed as
 * a *local* date (never as UTC midnight, which shifts the day in negative-offset
 * timezones) and then formatted in the user's locale and country date format.
 * An unparseable string is returned unchanged.
 */
export function useFormatYmd(): (ymd: string) => string {
  const { formatDate } = useFormatters();
  return useCallback(
    (ymd: string) => {
      const local = parse(ymd, 'yyyy-MM-dd', new Date());
      return isNaN(local.getTime()) ? ymd : formatDate(local);
    },
    [formatDate],
  );
}
