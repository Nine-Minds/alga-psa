/**
 * E.164 normalization shared by the matcher and every provider adapter.
 *
 * Deliberately dependency-free: full libphonenumber metadata is ~500 kB and we
 * only need "make two strings comparable". Anything this cannot confidently
 * normalize returns null and lands in the unmatched queue rather than matching
 * the wrong client.
 */

const DEFAULT_REGION_CALLING_CODE = '1';

/** Longest national number E.164 allows (country code excluded is 15 total). */
const MAX_E164_DIGITS = 15;
const MIN_E164_DIGITS = 7;

export interface NormalizePhoneNumberOptions {
  /** Calling code applied to national-format numbers (digits only, no '+'). */
  defaultCallingCode?: string;
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

  const hadPlus = value.trimStart().startsWith('+');
  const digits = value.replace(/\D+/g, '');
  if (!digits) {
    return null;
  }

  // "00" is the international access prefix in most of the world: 004930… is +4930…
  let national = digits;
  if (!hadPlus && national.startsWith('00')) {
    national = national.slice(2);
    return finalize(national);
  }

  if (hadPlus) {
    return finalize(national);
  }

  const callingCode = (options.defaultCallingCode ?? DEFAULT_REGION_CALLING_CODE).replace(/\D+/g, '');
  // A leading zero is a national trunk prefix ("020 7946 0958"): drop it and
  // prepend the tenant's calling code.
  if (callingCode && national.startsWith('0')) {
    return finalize(`${callingCode}${national.replace(/^0+/, '')}`);
  }
  // A bare national number (10 digits in NANP) gets the default calling code;
  // anything already long enough to carry one is taken at face value.
  if (callingCode && national.length === 10) {
    return finalize(`${callingCode}${national}`);
  }
  if (callingCode && national.length === 11 && national.startsWith(callingCode)) {
    return finalize(national);
  }

  return finalize(national);
}

function finalize(digits: string): string | null {
  if (digits.length < MIN_E164_DIGITS || digits.length > MAX_E164_DIGITS) {
    return null;
  }
  if (digits.startsWith('0')) {
    // A leading zero is a trunk prefix, never a country code.
    return null;
  }
  return `+${digits}`;
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
  e164: string | null | undefined,
  options: NormalizePhoneNumberOptions = {},
): string[] {
  const digits = toDigits(e164);
  if (!digits) {
    return [];
  }

  const candidates = new Set<string>([digits]);
  const callingCode = (options.defaultCallingCode ?? DEFAULT_REGION_CALLING_CODE).replace(/\D+/g, '');
  if (callingCode && digits.startsWith(callingCode) && digits.length > callingCode.length + 6) {
    candidates.add(digits.slice(callingCode.length));
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
