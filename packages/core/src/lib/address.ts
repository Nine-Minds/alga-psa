import { displayAddressField, displayCountry } from './formatters';

export interface FormatPostalAddressOptions {
  /** Joiner between kept components. Defaults to ", "; use "\n" for address blocks. */
  separator?: string;
}

/**
 * Join address components, dropping any that are null, undefined, non-string,
 * empty or whitespace-only, and trimming those that are kept.
 * Returns '' when nothing is left (callers wanting null use `|| null`).
 */
export function formatPostalAddress(
  parts: ReadonlyArray<unknown>,
  options: FormatPostalAddressOptions = {},
): string {
  const { separator = ', ' } = options;
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
    .join(separator);
}

export interface PostalAddressLocation {
  address_line1?: unknown;
  address_line2?: unknown;
  address_line3?: unknown;
  city?: unknown;
  state_province?: unknown;
  postal_code?: unknown;
  country_name?: unknown;
  country_code?: unknown;
}

/**
 * One-line address for a client_locations row. Storage placeholders
 * ('N/A' address/city, 'Unknown'/'XX' country) are omitted for display.
 */
export function formatLocationAddress(location: PostalAddressLocation | null | undefined): string {
  if (!location) return '';
  return formatPostalAddress([
    displayAddressField(location.address_line1),
    displayAddressField(location.address_line2),
    displayAddressField(location.address_line3),
    displayAddressField(location.city),
    displayAddressField(location.state_province),
    displayAddressField(location.postal_code),
    displayCountry(location.country_name, location.country_code),
  ]);
}
