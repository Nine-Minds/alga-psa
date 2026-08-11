/**
 * Whether a locale writes clock times on a 12-hour dial.
 *
 * Time-of-day is the half of date formatting that does not travel: most of
 * Europe reads 14:30 where the US reads 2:30 PM, and a picker that hardcodes
 * one of them is wrong everywhere else. `xx` and `yy` are pseudo-locales for
 * translation QA with no clock convention of their own, so they borrow en's.
 */
export function localeUses12HourClock(locale: string): boolean {
  const normalized = locale === 'xx' || locale === 'yy' ? 'en' : locale;
  try {
    return new Intl.DateTimeFormat(normalized, { hour: 'numeric' }).resolvedOptions().hour12 ?? true;
  } catch {
    return true;
  }
}
