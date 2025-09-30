type InterpolationValues = Record<string, string | number | null | undefined>;

/**
 * react-i18next returns default strings without interpolation when the i18n
 * instance is not hydrated (MSP portal). This helper manually replaces any
 * {{placeholders}} so the UI still renders readable values.
 */
export function interpolateFallback(
  text: string,
  values: InterpolationValues
): string {
  if (!text || !text.includes('{{')) {
    return text;
  }

  return text.replace(/{{\s*([^{}\s]+)\s*}}/g, (_, key: string) => {
    const value = values[key];
    if (value === null || value === undefined) {
      return '';
    }
    return typeof value === 'number' ? String(value) : value;
  });
}
