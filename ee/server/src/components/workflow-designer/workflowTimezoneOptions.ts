/** IANA timezone ids the browser knows, for timezone pickers. */
export const listIanaTimezones = (): string[] => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
};

/**
 * Options for an optional timezone: an empty value means "use the tenant's timezone". A saved
 * value the browser doesn't list is kept so it still displays.
 */
export const buildOptionalTimezoneOptions = (
  defaultLabel: string,
  currentValue: string | null | undefined,
  timezones: string[] = listIanaTimezones()
): Array<{ value: string; label: string }> => {
  const options = [{ value: '', label: defaultLabel }, ...timezones.map((zone) => ({ value: zone, label: zone.replace(/_/g, ' ') }))];
  if (currentValue && !timezones.includes(currentValue)) {
    options.push({ value: currentValue, label: currentValue });
  }
  return options;
};
