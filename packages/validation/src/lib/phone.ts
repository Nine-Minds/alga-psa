/**
 * Phone normalization.
 *
 * Structural validity is delegated to libphonenumber-js instead of hand-rolled digit
 * heuristics. The rule is deliberately `isPossible()` and not `isValid()`: possibility
 * is a length/prefix fact, validity is a claim about which ranges a carrier has been
 * allocated, and that claim goes stale.
 */

import { parsePhoneNumberWithError, type CountryCode } from 'libphonenumber-js';

export type PhoneNormalizationError = 'invalid' | 'extensionInvalid';

export interface NormalizedPhone {
  /** What should be stored: E.164 when a region was resolvable, else the trimmed input. */
  value: string;
  /** E.164 form (`+15552345678`), or '' when no region context was available. */
  e164: string;
  /** Digits only, or '' when the input carried no extension. */
  extension: string;
  /** Set only when the input could not be parsed at all. Blocks the save. */
  error: PhoneNormalizationError | null;
}

/** Extension suffixes historically packed into the number column by PhoneInput. */
const PACKED_EXTENSION_PATTERNS = [
  /[\s,;]*\bext(?:ension)?\.?\s*[:#]?\s*(\d{1,10})\s*$/i,
  /[\s,;]+x\.?\s*[:#]?\s*(\d{1,10})\s*$/i,
  /[\s,;]+e\.?\s*[:#]?\s*(\d{1,10})\s*$/i,
];

export const PHONE_EXTENSION_MAX_LENGTH = 10;

/** ITU-T E.164 allows at most 15 digits; 4 is the shortest short-code worth storing. */
const MIN_NATIONAL_DIGITS = 4;
const MAX_NATIONAL_DIGITS = 15;

/**
 * Split a legacy packed value (`+1 555 234 5678 ext. 42`) into its two parts.
 * Numbers without a packed extension come back untouched.
 */
export function splitPackedExtension(raw: string | null | undefined): {
  number: string;
  extension: string;
} {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return { number: '', extension: '' };
  }

  for (const pattern of PACKED_EXTENSION_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match) {
      return {
        number: trimmed.replace(pattern, '').trim(),
        extension: match[1] ?? '',
      };
    }
  }

  return { number: trimmed, extension: '' };
}

/** True when the value is nothing but a dial prefix, e.g. `+1` or `+44 `. */
export function isDialPrefixOnly(raw: string | null | undefined): boolean {
  const trimmed = (raw ?? '').trim();
  return trimmed.length > 0 && /^\+\d{0,4}[\s\-().]*$/.test(trimmed);
}

export interface NormalizePhoneOptions {
  /** ISO-3166 alpha-2 used when the input carries no `+` prefix. */
  defaultCountry?: string | null;
  /** Extension supplied out-of-band (its own field/column). Wins over a packed one. */
  extension?: string | null;
}

const EMPTY: NormalizedPhone = { value: '', e164: '', extension: '', error: null };

/**
 * Parse free-text phone input into E.164 plus a separate extension.
 *
 * Blank input is not an error — phone is optional everywhere it is collected.
 * A bare national number written without any region context (headless writers such
 * as CSV import or the REST API) is length-checked and kept verbatim rather than
 * guessed into a country it may not belong to.
 */
export function normalizePhone(
  input: string | null | undefined,
  options: NormalizePhoneOptions = {}
): NormalizedPhone {
  const raw = (input ?? '').trim();
  const explicitExtension = (options.extension ?? '').trim();

  const packed = splitPackedExtension(raw);
  const extensionSource = explicitExtension || packed.extension;
  const extensionDigits = extensionSource.replace(/\D/g, '');

  if (extensionSource && (!extensionDigits || extensionDigits.length > PHONE_EXTENSION_MAX_LENGTH)) {
    return { ...EMPTY, error: 'extensionInvalid' };
  }

  if (!packed.number || isDialPrefixOnly(packed.number)) {
    return { ...EMPTY, extension: extensionDigits };
  }

  const defaultCountry = options.defaultCountry?.trim().toUpperCase() || undefined;
  const isInternational = packed.number.startsWith('+');

  if (isInternational || defaultCountry) {
    try {
      const parsed = parsePhoneNumberWithError(
        packed.number,
        isInternational ? undefined : (defaultCountry as CountryCode)
      );

      if (!parsed.isPossible()) {
        return { ...EMPTY, extension: extensionDigits, error: 'invalid' };
      }

      return {
        value: parsed.number,
        e164: parsed.number,
        extension: parsed.ext || extensionDigits,
        error: null,
      };
    } catch {
      return { ...EMPTY, extension: extensionDigits, error: 'invalid' };
    }
  }

  // No region context (headless writers). Accept only phone-shaped input of a
  // possible length; anything else is a parse failure, not a judgement call.
  if (!/^[\d\s\-().]+$/.test(packed.number)) {
    return { ...EMPTY, extension: extensionDigits, error: 'invalid' };
  }

  const digits = packed.number.replace(/\D/g, '');
  if (digits.length < MIN_NATIONAL_DIGITS || digits.length > MAX_NATIONAL_DIGITS) {
    return { ...EMPTY, extension: extensionDigits, error: 'invalid' };
  }

  return { value: packed.number, e164: '', extension: extensionDigits, error: null };
}

/** Convenience for callers that only need to know whether a value is storable. */
export function isStructurallyValidPhone(
  input: string | null | undefined,
  options: NormalizePhoneOptions = {}
): boolean {
  return normalizePhone(input, options).error === null;
}
