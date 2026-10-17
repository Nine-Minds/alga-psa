/**
 * Shared digit normalization for contact search.
 *
 * Phone numbers are stored formatted ('+61 433 521 762'), so a user typing
 * '521 762' or a trailing '762' only matches once both sides are reduced to
 * digits. The server leg in listSearchSql.ts and the client-side list filters
 * use the same rules so instant results agree with indexed results.
 */

/** Below this many digits the match is noise (every number contains '1'). */
export const MIN_PHONE_SEARCH_DIGITS = 3;

export function toSearchDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D+/g, '');
}

/** Digits to search phones with, or null when the query is not phone-ish. */
export function phoneSearchDigits(rawSearch: string | null | undefined): string | null {
  const digits = toSearchDigits(rawSearch);
  return digits.length >= MIN_PHONE_SEARCH_DIGITS ? digits : null;
}

export function phoneDigitsMatch(value: string | null | undefined, digits: string): boolean {
  if (!digits) {
    return false;
  }
  return toSearchDigits(value).includes(digits);
}

export interface ContactPhoneSearchFields {
  phone_numbers?: Array<{ phone_number?: string | null } | null> | null;
  default_phone_number?: string | null;
}

export function contactMatchesPhoneDigits(contact: ContactPhoneSearchFields, digits: string): boolean {
  if (!digits) {
    return false;
  }
  if (phoneDigitsMatch(contact.default_phone_number, digits)) {
    return true;
  }
  return (contact.phone_numbers ?? []).some((phone) => phoneDigitsMatch(phone?.phone_number, digits));
}
