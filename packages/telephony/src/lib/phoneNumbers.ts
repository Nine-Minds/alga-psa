import {
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/min';

/**
 * E.164 normalization shared by the matcher and every provider adapter.
 *
 * National numbers are ambiguous without a country. Callers must supply the
 * tenant's ISO-3166 alpha-2 country code; otherwise only explicitly
 * international values (`+` or `00`) are normalized. Failing closed sends an
 * uncertain call to manual attribution instead of matching the wrong client.
 */

export interface NormalizePhoneNumberOptions {
  /** ISO-3166 alpha-2 country used to interpret national-format numbers. */
  defaultCountryCode?: string | null;
}

/** Strip a trailing extension ("x123", "ext. 4", ",,123") before parsing. */
export function stripExtension(input: string): string {
  return input
    .replace(/(?:[;,]+|\b(?:x|ext|extn|extension|poste|anexo)\.?)[\s.:#-]*\d+\s*$/i, '')
    .trim();
}

/**
 * Normalize a dialled/displayed number to E.164 ("+15551234567"), or null when
 * it cannot be trusted (letters, too short, too long, service codes).
 */
export function normalizeToE164(
  input: string | null | undefined,
  options: NormalizePhoneNumberOptions = {},
): string | null {
  if (typeof input !== 'string') {
    return null;
  }

  let value = stripExtension(input.trim());
  if (!value) {
    return null;
  }

  // Teams and other SIP stacks hand us "tel:+15551234567" / "sip:+1555...@x".
  value = value.replace(/^(?:tel|sip|sips):/i, '');
  const atIndex = value.indexOf('@');
  if (atIndex > 0) {
    value = value.slice(0, atIndex);
  }

  if (!/[0-9]/.test(value)) {
    return null;
  }

  // Graph and imported address books commonly use 00 even when the tenant's
  // own country has a different international-dial prefix. Once captured, the
  // intent is unambiguously international, so canonicalize it before parsing.
  if (!value.trimStart().startsWith('+') && /^\s*00/.test(value)) {
    value = value.replace(/^\s*00/, '+');
  }

  const country = normalizeCountryCode(options.defaultCountryCode);
  const isInternational = value.trimStart().startsWith('+');
  if (!isInternational && !country) {
    return null;
  }

  try {
    const parsed = parsePhoneNumberFromString(value, isInternational ? undefined : country);
    return parsed?.isPossible() ? parsed.number : null;
  } catch {
    return null;
  }
}

export function normalizeCountryCode(value: string | null | undefined): CountryCode | undefined {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return normalized && isSupportedCountry(normalized) ? normalized as CountryCode : undefined;
}

/** Digits-only form used to compare against stored normalized columns. */
export function toDigits(value: string | null | undefined): string {
  return typeof value === 'string' ? value.replace(/\D+/g, '') : '';
}

/**
 * Candidate keys for matching against `contact_phone_numbers.normalized_phone_number`,
 * which is a generated digits-only column (no '+', and historically stored
 * without a country code). Ordered most specific first.
 */
export function phoneMatchCandidates(
  value: string | null | undefined,
  options: NormalizePhoneNumberOptions = {},
): string[] {
  const e164 = normalizeToE164(value, options);
  if (!e164) {
    return [];
  }

  const digits = toDigits(e164);
  const candidates = new Set<string>([digits]);
  const parsed = parsePhoneNumberFromString(e164);
  if (parsed?.nationalNumber) {
    candidates.add(parsed.nationalNumber);
  }

  return [...candidates];
}

/** Human-facing rendering used in interaction titles and list rows. */
export function formatCallNumber(e164: string | null | undefined, raw?: string | null): string {
  if (e164) {
    const digits = toDigits(e164);
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return e164;
  }
  return (raw ?? '').trim() || 'Unknown number';
}
