/**
 * Client/contact form field validation.
 *
 *   input → normalize → validate (structural, blocking) → advise (plausibility, never blocks)
 *
 * The structural layer delegates to the shared Zod schema in
 * ./schemas/clientContact.schema so the form, the server actions and the REST API
 * cannot disagree. Everything that used to guess at whether input was *sincere* —
 * disposable mailboxes, reserved documentation domains, fictional phone ranges,
 * placeholder names — now produces a warning instead of blocking a save.
 */

import {
  buildFieldValidation,
  message,
  type FieldValidation,
  type ValidationMessage,
} from './fieldValidation';
import { normalizePhone } from './phone';
import {
  clientNameSchema,
  contactNameSchema,
  emailFieldSchema,
  parseUrl,
  phoneFieldSchema,
  urlFieldSchema,
} from './schemas/clientContact.schema';

// Enhanced validation utilities for client forms
export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  warnings?: Record<string, string[]>;
}

function firstIssue(result: { success: boolean; error?: { issues: Array<{ message: string }> } }): string | null {
  return result.success ? null : result.error?.issues[0]?.message ?? 'Invalid input';
}

// Common emoji regex pattern used across validation functions
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F900}-\u{1FAFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;

// Disposable/temporary email domains - commonly blocked by professional platforms
// Best-effort and deliberately non-exhaustive: new providers appear constantly and
// this list will always lag. It is a nudge, not a security control. Dead entries
// (20minutemail.com, fakemailgenerator.com, 10minemail.com, mytrashmail.com) have
// been dropped; guerrillamail's alias domains are grouped with it.
const DISPOSABLE_EMAIL_DOMAINS = [
  // guerrillamail and its aliases
  'guerrillamail.com', 'sharklasers.com', 'grr.la', 'spam4.me',
  // long-running providers
  'mailinator.com', 'yopmail.com', 'maildrop.cc', 'trashmail.com', 'mailcatch.com',
  'dispostable.com', 'mailnesia.com', 'fakeinbox.com', 'spambog.com',
  // 10-minute style
  '10minutemail.com', 'temp-mail.org', 'temp-mail.io', 'tempail.com', 'minuteinbox.com',
  'emailondeck.com', 'throwaway.email', 'moakt.com', 'mohmal.com',
  // api-driven, common in automation
  'mail.tm', 'inboxkitten.com', 'discard.email', 'tempr.email'
];

// Hostnames that only ever resolve inside a private network (RFC 6762 mDNS,
// RFC 8375, and common router conventions).
const INTERNAL_TLDS = ['localhost', 'local', 'internal', 'lan', 'home', 'arpa'];

function isInternalHostname(hostname: string): boolean {
  if (hostname === 'localhost') {
    return true;
  }
  // Suffix match only on a dotted name; a bare label like "invalid" is an
  // incomplete hostname, not a reserved-TLD usage.
  if (!hostname.includes('.')) {
    return false;
  }
  return INTERNAL_TLDS.includes(hostname.split('.').pop() ?? '');
}

// Reserved by RFC 2606 / RFC 6761 for documentation and testing, so they can never
// belong to a real customer. Note that sample.com, demo.com, fake.com and
// invalid.com are all registered to real businesses — they are deliberately absent.
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];

// Matched as a suffix, so test.test, foo.example and anything.invalid are covered
// without enumerating them.
const RESERVED_TLDS = ['test', 'example', 'invalid'];

function isReservedDomain(hostname: string): boolean {
  if (RESERVED_DOMAINS.includes(hostname)) {
    return true;
  }
  if (!hostname.includes('.')) {
    return false;
  }
  return RESERVED_TLDS.includes(hostname.split('.').pop() ?? '');
}

// =====================================
// Advise layer — plausibility opinions.
// These never block a save. If nobody acts on one, delete it.
// =====================================

const K = 'clients.validation';

export function adviseClientName(name: string): ValidationMessage[] {
  const trimmedName = (name ?? '').trim();
  if (!trimmedName) {
    return [];
  }

  const warnings: ValidationMessage[] = [];
  const nameWithoutEmojis = trimmedName.replace(EMOJI_REGEX, '').trim();

  if (nameWithoutEmojis.length === 0) {
    warnings.push(message(`${K}.clientName.emojiOnly`, 'This name is made up entirely of emoji.'));
    return warnings;
  }

  if (nameWithoutEmojis.length === 1) {
    warnings.push(message(`${K}.clientName.tooShort`, 'This name is a single character — is that right?'));
  }

  const standaloneAbbreviations = ['LLC', 'INC', 'CORP', 'LTD', 'COMPANY', 'CORPORATION'];
  if (standaloneAbbreviations.includes(nameWithoutEmojis.toUpperCase())) {
    warnings.push(message(`${K}.clientName.abbreviationOnly`, 'This is only a business abbreviation, not a name.'));
  }

  if (/(.)\1{4,}/.test(nameWithoutEmojis)) {
    warnings.push(message(`${K}.clientName.repeatedCharacters`, 'This name repeats the same character several times.'));
  }

  // A bare domain suffix is legitimate in a company name (Booking.com, Hotels.com,
  // Care.com), so only flag input that is unambiguously a pasted web address.
  if (/^(https?:\/\/|www\.)/i.test(nameWithoutEmojis)) {
    warnings.push(message(`${K}.clientName.looksLikeUrl`, 'This looks like a web address rather than a name.'));
  }

  if (!/[\p{L}\p{N}]/u.test(nameWithoutEmojis)) {
    warnings.push(message(`${K}.clientName.noLettersOrNumbers`, 'This name has no letters or numbers in it.'));
  }

  return warnings;
}

export function adviseEmailAddress(email: string): ValidationMessage[] {
  const trimmedEmail = (email ?? '').trim().toLowerCase();
  const domain = trimmedEmail.split('@')[1];
  if (!domain) {
    return [];
  }

  const warnings: ValidationMessage[] = [];

  if (DISPOSABLE_EMAIL_DOMAINS.includes(domain)) {
    warnings.push(
      message(`${K}.email.disposableDomain`, '{{domain}} is a disposable mailbox provider.', { domain })
    );
  }

  if (isReservedDomain(domain)) {
    warnings.push(
      message(`${K}.email.reservedDomain`, '{{domain}} is reserved for documentation and testing.', { domain })
    );
  }

  if (isInternalHostname(domain)) {
    warnings.push(
      message(`${K}.email.internalDomain`, '{{domain}} only resolves inside a private network.', { domain })
    );
  }

  return warnings;
}

export function adviseWebsiteUrl(url: string): ValidationMessage[] {
  const parsed = parseUrl((url ?? '').trim());
  if (!parsed) {
    return [];
  }

  const hostname = parsed.hostname.toLowerCase();
  const warnings: ValidationMessage[] = [];

  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    warnings.push(message(`${K}.url.ipAddress`, 'This is an IP address rather than a domain name.'));
  }

  // Private IPv4 ranges are already covered by the literal check above; matching them
  // as name prefixes rejected real domains such as 10.com and 172.com.
  if (isInternalHostname(hostname)) {
    warnings.push(message(`${K}.url.internalHost`, '{{host}} only resolves inside a private network.', { host: hostname }));
  }

  if (isReservedDomain(hostname)) {
    warnings.push(
      message(`${K}.url.reservedDomain`, '{{host}} is reserved for documentation and testing.', { host: hostname })
    );
  }

  return warnings;
}

export function advisePhoneNumber(phone: string): ValidationMessage[] {
  const normalized = normalizePhone(phone);
  const digits = (normalized.value || (phone ?? '')).replace(/\D/g, '');
  if (digits.length < 7) {
    return [];
  }

  const warnings: ValidationMessage[] = [];

  if (/^(.)\1+$/.test(digits)) {
    warnings.push(message(`${K}.phone.repeatedDigits`, 'This number is the same digit repeated.'));
    return warnings;
  }

  if (isEntirelySequential(digits)) {
    warnings.push(message(`${K}.phone.sequentialDigits`, 'This number runs straight up or down the keypad.'));
  }

  // The NANP range actually reserved for fiction, 555-0100..555-0199 — what demo
  // data really uses.
  if (/55501\d{2}$/.test(digits)) {
    warnings.push(message(`${K}.phone.fictionalRange`, 'This is in the 555-0100 range reserved for fiction.'));
  }

  return warnings;
}

/** True only when 80%+ of the digits step by one, e.g. 1234567890 / 9876543210. */
function isEntirelySequential(str: string): boolean {
  if (str.length < 7) return false;

  let ascendingCount = 0;
  let descendingCount = 0;

  for (let i = 0; i < str.length - 1; i++) {
    const current = parseInt(str[i], 10);
    const next = parseInt(str[i + 1], 10);

    if (!isNaN(current) && !isNaN(next)) {
      if (next === current + 1) ascendingCount++;
      else if (next === current - 1) descendingCount++;
    }
  }

  return Math.max(ascendingCount, descendingCount) / (str.length - 1) >= 0.8;
}

export function adviseContactName(name: string): ValidationMessage[] {
  const nameWithoutEmojis = (name ?? '').trim().replace(EMOJI_REGEX, '').trim();
  if (!nameWithoutEmojis) {
    return [];
  }

  const placeholderNames = ['test', 'testing', 'nobody', 'unknown', 'placeholder', 'temp', 'temporary',
                           'admin', 'user', 'sample', 'example', 'demo', 'fake', 'dummy', 'null', 'n/a'];
  if (placeholderNames.includes(nameWithoutEmojis.toLowerCase())) {
    return [message(`${K}.contactName.placeholder`, 'This looks like a placeholder rather than a person.')];
  }

  return [];
}

// =====================================
// Validate layer — structural, blocking.
// =====================================

export function validateClientNameField(name: string): FieldValidation {
  const parsed = clientNameSchema.safeParse(name ?? '');
  const error = firstIssue(parsed);
  const value = parsed.success ? parsed.data : (name ?? '').trim();
  return buildFieldValidation(
    value,
    error ? message(`${K}.clientName.structural`, error) : null,
    adviseClientName(name)
  );
}

export function validateWebsiteUrlField(url: string): FieldValidation {
  const trimmed = (url ?? '').trim();
  if (!trimmed) {
    return buildFieldValidation('', null);
  }

  const parsed = urlFieldSchema.safeParse(trimmed);
  const error = firstIssue(parsed);
  return buildFieldValidation(
    parsed.success ? parsed.data : trimmed,
    error ? message(`${K}.url.structural`, error) : null,
    adviseWebsiteUrl(trimmed)
  );
}

export function validateEmailAddressField(email: string, options: { required?: boolean } = {}): FieldValidation {
  const trimmed = (email ?? '').trim();
  if (!trimmed) {
    return buildFieldValidation(
      '',
      options.required === false
        ? null
        : message(`${K}.email.required`, 'Email address is required')
    );
  }

  const parsed = emailFieldSchema.safeParse(trimmed);
  const error = firstIssue(parsed);
  return buildFieldValidation(
    parsed.success ? parsed.data : trimmed.toLowerCase(),
    error ? message(`${K}.email.structural`, error) : null,
    adviseEmailAddress(trimmed)
  );
}

export function validatePhoneNumberField(phone: string): FieldValidation {
  const trimmed = (phone ?? '').trim();
  if (!trimmed) {
    return buildFieldValidation('', null);
  }

  const parsed = phoneFieldSchema.safeParse(trimmed);
  const error = firstIssue(parsed);
  return buildFieldValidation(
    parsed.success ? parsed.data : trimmed,
    error ? message(`${K}.phone.structural`, error) : null,
    error ? [] : advisePhoneNumber(trimmed)
  );
}

export function validateContactNameField(name: string): FieldValidation {
  const trimmed = (name ?? '').trim();
  if (!trimmed) {
    return buildFieldValidation('', null);
  }

  const parsed = contactNameSchema.safeParse(trimmed);
  const error = firstIssue(parsed);
  return buildFieldValidation(
    parsed.success ? parsed.data : trimmed,
    error ? message(`${K}.contactName.structural`, error) : null,
    adviseContactName(trimmed)
  );
}

// =====================================
// string | null wrappers.
// Kept so the 21 importers can migrate to FieldValidation incrementally.
// They return the blocking error only — plausibility never reaches them.
// =====================================

export function validateClientName(name: string): string | null {
  return validateClientNameField(name).error;
}

export function validateWebsiteUrl(url: string): string | null {
  return validateWebsiteUrlField(url).error;
}

export function validateEmailAddress(email: string): string | null {
  return validateEmailAddressField(email).error;
}

export function validatePhoneNumber(phone: string): string | null {
  return validatePhoneNumberField(phone).error;
}

// Postal code validation - professional SaaS/CRM grade with comprehensive country formats
export function validatePostalCode(postalCode: string, countryCode: string = 'US'): string | null {
  if (!postalCode || !postalCode.trim()) {
    return null; // Postal code is optional
  }
  
  // Check for spaces-only input
  if (postalCode && postalCode.trim() === '') {
    return 'Postal code cannot contain only spaces';
  }
  
  const trimmedCode = postalCode.trim().toUpperCase();
  
  // No emojis
  if (EMOJI_REGEX.test(trimmedCode)) {
    return 'Postal code cannot contain emojis';
  }
  
  // Professional-grade country-specific validation (like enterprise CRMs)
  switch (countryCode.toUpperCase()) {
    case 'US':
      // US ZIP codes: 12345 or 12345-6789
      if (!/^\d{5}(-\d{4})?$/.test(trimmedCode)) {
        return 'Please enter a valid ZIP code (e.g., 12345 or 12345-6789)';
      }
      // Block obvious fake ZIP codes
      if (trimmedCode === '00000' || trimmedCode === '99999' || trimmedCode.startsWith('00000')) {
        return 'Please enter a valid ZIP code';
      }
      break;
      
    case 'CA':
      // Canadian postal codes: A1B 2C3 or A1B2C3
      if (!/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/.test(trimmedCode)) {
        return 'Please enter a valid Canadian postal code (e.g., K1A 0A6)';
      }
      break;
      
    case 'GB':
    case 'UK':
      // UK postal codes: comprehensive patterns
      if (!/^(GIR\s?0AA|[A-PR-UWYZ]([0-9]{1,2}|([A-HK-Y][0-9]|[A-HK-Y][0-9][0-9])|[0-9][A-HJKMNP-Y]|[A-HK-Y][0-9][A-HJKMNP-Y])\s?[0-9][ABD-HJLNP-UW-Z]{2})$/i.test(trimmedCode)) {
        return 'Please enter a valid UK postal code (e.g., SW1A 1AA)';
      }
      break;
      
    case 'DE':
      // Germany: 5 digits
      if (!/^\d{5}$/.test(trimmedCode)) {
        return 'Please enter a valid German postal code (e.g., 10115)';
      }
      break;
      
    case 'FR':
      // France: 5 digits
      if (!/^\d{5}$/.test(trimmedCode)) {
        return 'Please enter a valid French postal code (e.g., 75001)';
      }
      break;
      
    case 'JP':
      // Japan: 123-4567 format
      if (!/^\d{3}-\d{4}$/.test(trimmedCode)) {
        return 'Please enter a valid Japanese postal code (e.g., 123-4567)';
      }
      break;
      
    case 'AU':
      // Australia: 4 digits
      if (!/^\d{4}$/.test(trimmedCode)) {
        return 'Please enter a valid Australian postal code (e.g., 2000)';
      }
      break;
      
    case 'NL':
      // Netherlands: 1234AB format
      if (!/^\d{4}\s?[A-Z]{2}$/.test(trimmedCode)) {
        return 'Please enter a valid Dutch postal code (e.g., 1234AB)';
      }
      break;
      
    case 'CH':
      // Switzerland: 4 digits
      if (!/^\d{4}$/.test(trimmedCode)) {
        return 'Please enter a valid Swiss postal code (e.g., 8001)';
      }
      break;
      
    case 'IT':
      // Italy: 5 digits
      if (!/^\d{5}$/.test(trimmedCode)) {
        return 'Please enter a valid Italian postal code (e.g., 00118)';
      }
      break;
      
    case 'ES':
      // Spain: 5 digits
      if (!/^\d{5}$/.test(trimmedCode)) {
        return 'Please enter a valid Spanish postal code (e.g., 28001)';
      }
      break;
      
    case 'BR':
      // Brazil: 12345-678 format
      if (!/^\d{5}-\d{3}$/.test(trimmedCode)) {
        return 'Please enter a valid Brazilian postal code (e.g., 01234-567)';
      }
      break;
      
    case 'IN':
      // India: 6 digits
      if (!/^\d{6}$/.test(trimmedCode)) {
        return 'Please enter a valid Indian postal code (e.g., 110001)';
      }
      break;
      
    default:
      // Generic validation for other countries
      if (!/^[A-Z0-9\s\-]{3,12}$/i.test(trimmedCode)) {
        return 'Please enter a valid postal code';
      }
  }
  
  return null;
}

// City validation - enterprise international support
export function validateCityName(city: string): string | null {
  if (!city || !city.trim()) {
    return null; // City is optional
  }
  
  const trimmedCity = city.trim();
  
  // Enterprise rule: Max length 100 characters
  if (trimmedCity.length > 100) {
    return 'City name must be 100 characters or less';
  }
  
  // No emojis
  if (EMOJI_REGEX.test(trimmedCity)) {
    return 'City name cannot contain emojis';
  }
  
  // Minimum 1 character (to support Ö, Å, Y, etc.)
  if (trimmedCity.length < 1) {
    return 'City name cannot be empty';
  }
  
  // Must contain at least one letter or Unicode character
  if (!/[\p{L}]/u.test(trimmedCity)) {
    return 'City name must contain letters';
  }
  
  // Allow Unicode letters, spaces, hyphens, apostrophes, periods
  if (!/^[\p{L}\s\-'\.]+$/u.test(trimmedCity)) {
    return 'City name contains invalid characters';
  }
  
  return null;
}

// Address validation - enterprise international support
export function validateAddress(address: string): string | null {
  if (!address || !address.trim()) {
    return null; // Address is optional
  }
  
  const trimmedAddress = address.trim();
  
  // Enterprise rule: Max length 100 characters  
  if (trimmedAddress.length > 100) {
    return 'Address must be 100 characters or less';
  }
  
  // No emojis
  if (EMOJI_REGEX.test(trimmedAddress)) {
    return 'Address cannot contain emojis';
  }
  
  // Minimum 1 meaningful character (international support)
  if (trimmedAddress.length < 1) {
    return 'Address cannot be empty';
  }
  
  // Must contain at least one letter or Unicode character (international support)
  if (!/[\p{L}]/u.test(trimmedAddress)) {
    return 'Address must contain letters';
  }
  
  // Allow Unicode letters, numbers, spaces, and international address punctuation
  // No requirement for both letters and numbers (international addresses vary)
  if (!/^[\p{L}\p{N}\s\-,\.#\/'"()]+$/u.test(trimmedAddress)) {
    return 'Address contains invalid characters';
  }
  
  return null;
}

// State/Province validation - enterprise international support
export function validateStateProvince(state: string): string | null {
  if (!state || !state.trim()) {
    return null; // State is optional
  }
  
  const trimmedState = state.trim();
  
  // Enterprise rule: Max length 100 characters
  if (trimmedState.length > 100) {
    return 'State/Province must be 100 characters or less';
  }
  
  // No emojis
  if (EMOJI_REGEX.test(trimmedState)) {
    return 'State/Province cannot contain emojis';
  }
  
  // Minimum 1 character (international support)
  if (trimmedState.length < 1) {
    return 'State/Province cannot be empty';
  }
  
  // Must contain at least one letter or Unicode character
  if (!/[\p{L}]/u.test(trimmedState)) {
    return 'State/Province must contain letters';
  }
  
  // Allow Unicode letters, spaces, hyphens, periods
  if (!/^[\p{L}\s\-\.]+$/u.test(trimmedState)) {
    return 'State/Province contains invalid characters';
  }
  
  return null;
}

// Industry validation - enterprise international support
export function validateIndustry(industry: string): string | null {
  if (!industry || !industry.trim()) {
    return null; // Industry is optional
  }
  
  const trimmedIndustry = industry.trim();
  
  // Enterprise rule: Max length 100 characters
  if (trimmedIndustry.length > 100) {
    return 'Industry must be 100 characters or less';
  }
  
  // Allow emojis if accompanied by text (like company names)
  const textWithoutEmojis = trimmedIndustry.replace(EMOJI_REGEX, '').trim();
  if (EMOJI_REGEX.test(trimmedIndustry) && textWithoutEmojis.length < 2) {
    return 'Industry must contain at least 2 text characters';
  }
  
  if (trimmedIndustry.length < 2) {
    return 'Industry must be at least 2 characters long';
  }
  
  // Must contain at least one letter or Unicode character
  if (!/[\p{L}]/u.test(trimmedIndustry)) {
    return 'Industry must contain letters';
  }
  
  // Allow Unicode letters, spaces, hyphens, ampersands, slashes, commas
  if (!/^[\p{L}\s\-&\/,]+$/u.test(trimmedIndustry)) {
    return 'Industry contains invalid characters';
  }
  
  return null;
}

// Role validation - enterprise-level rules (matches QuickAddContact validation)
export function validateRole(role: string): string | null {
  if (!role || !role.trim()) {
    return null; // Role is optional
  }

  const trimmedRole = role.trim();

  // Check for spaces-only input
  if (/^\s+$/.test(role)) {
    return 'Role cannot contain only spaces';
  }

  // Enterprise rule: Max length 100 characters
  if (trimmedRole.length > 100) {
    return 'Role must be 100 characters or less';
  }

  // Must contain at least one letter or number (Unicode supported)
  if (!/[\p{L}\p{N}]/u.test(trimmedRole)) {
    return 'Role must contain letters or numbers';
  }

  return null;
}

export function validateContactName(name: string): string | null {
  return validateContactNameField(name).error;
}

// Notes validation - enterprise-level rules
export function validateNotes(notes: string): string | null {
  if (!notes || !notes.trim()) {
    return null; // Notes are optional
  }
  
  const trimmedNotes = notes.trim();
  
  // Enterprise rule: Max length 2000 characters
  if (trimmedNotes.length > 2000) {
    return 'Notes must be 2000 characters or less';
  }
  
  // Allow emojis in notes - no restrictions on content
  return null;
}


// Company size validation - professional SaaS/CRM grade (Microsoft/Salesforce standard)
export function validateCompanySize(companySize: string): string | null {
  if (!companySize || !companySize.trim()) {
    return null; // Company size is optional
  }

  const trimmedSize = companySize.trim();

  // Enterprise rule: Max length 50 characters
  if (trimmedSize.length > 50) {
    return 'Company size must be 50 characters or less';
  }

  // No emojis
  if (EMOJI_REGEX.test(trimmedSize)) {
    return 'Company size cannot contain emojis';
  }

  // Professional SaaS approach: Accept both numeric and plain English
  const lowerSize = trimmedSize.toLowerCase();

  // Common professional ranges (Microsoft/Salesforce patterns)
  const validRanges = [
    // Exact numbers
    /^\d+$/,
    // Ranges with hyphens or "to"
    /^\d+-\d+$/,
    /^\d+\s*to\s*\d+$/,
    // Plain English numbers
    /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)(\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion))*$/,
    // Mixed formats like "2.5 million", "5K", "10M", "1B"
    /^\d+(\.\d+)?\s*(k|m|b|thousand|million|billion)$/,
    // Professional ranges in plain English
    /^(less than|under|fewer than)\s+\d+$/,
    /^(more than|over|above)\s+\d+$/,
    /^\d+\+$/,
    // Common SaaS categories
    /^(startup|small|medium|large|enterprise)$/,
    /^(1-10|11-50|51-200|201-500|501-1000|1001-5000|5001\+)$/,
    // Professional descriptive words (prevent gibberish while allowing meaningful text)
    /^(big|huge|large|small|tiny|medium|startup|growing|expanding|established|mature|corporate|enterprise|micro|mini|global|international|local|regional|national|mid-sized|boutique|family|private|public)(\s+(company|business|organization|enterprise|firm|corporation|startup))?$/
  ];

  const isValid = validRanges.some(pattern => pattern.test(lowerSize));

  if (!isValid) {
    return 'Please enter a valid company size (e.g., "50", "10-50", "five hundred", "2.5M", "small", "enterprise")';
  }

  return null;
}

// Annual revenue validation - professional SaaS/CRM grade (Microsoft/Salesforce standard)
export function validateAnnualRevenue(revenue: string): string | null {
  if (!revenue || !revenue.trim()) {
    return null; // Annual revenue is optional
  }

  const trimmedRevenue = revenue.trim();

  // Enterprise rule: Max length 50 characters
  if (trimmedRevenue.length > 50) {
    return 'Annual revenue must be 50 characters or less';
  }

  // No emojis
  if (EMOJI_REGEX.test(trimmedRevenue)) {
    return 'Annual revenue cannot contain emojis';
  }

  // Professional SaaS approach: Accept both numeric and plain English with currency symbols.
  // Two normalized forms so each pattern family sees the input it expects:
  //  - compact: currency symbols, commas and ALL whitespace removed (numeric / abbreviation formats)
  //  - spaced:  currency symbols and commas removed but words kept space-separated (plain English)
  const compactRevenue = trimmedRevenue.toLowerCase().replace(/[\s$,£€¥]/g, '');
  const spacedRevenue = trimmedRevenue.toLowerCase().replace(/[$,£€¥]/g, '').replace(/\s+/g, ' ').trim();

  // Numeric / abbreviation formats (evaluated against the compact form)
  const numericFormats = [
    // Exact numbers (commas already stripped) with optional decimals
    /^\d+(\.\d+)?$/,
    // Ranges
    /^\d+-\d+$/,
    /^\d+to\d+$/,
    // Abbreviations (K, M, B)
    /^\d+(\.\d+)?[kmb]$/,
    // Abbreviated ranges, e.g. 10m-50m
    /^\d+(\.\d+)?[kmb]-\d+(\.\d+)?[kmb]$/,
    // Professional ranges in plain English
    /^(lessthan|under|fewerthan)\d+$/,
    /^(morethan|over|above)\d+$/,
    /^\d+\+$/,
    // Common SaaS revenue categories
    /^(startup|earlystage|growth|established)$/,
    /^(under1m|1m-10m|10m-100m|100m-1b|1b\+)$/,
    // "Not disclosed" or similar professional responses
    /^(notdisclosed|private|confidential|n\/a|na)$/
  ];

  // Plain-English numbers (evaluated against the spaced form so multi-word
  // amounts like "five million" match — they must not have their spaces stripped)
  const plainEnglishFormat = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)( (one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion))*$/;

  const isValid =
    numericFormats.some(pattern => pattern.test(compactRevenue)) ||
    plainEnglishFormat.test(spacedRevenue);

  if (!isValid) {
    return 'Please enter valid annual revenue (e.g., "$1,000,000", "five million", "2.5M", "10M-50M", "not disclosed")';
  }

  return null;
}

// Comprehensive form validation function
export function validateClientForm(formData: {
  clientName: string;
  websiteUrl?: string;
  industry?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  stateProvince?: string;
  postalCode?: string;
  countryCode?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
  companySize?: string;
  annualRevenue?: string;
}): ValidationResult {
  const errors: Record<string, string> = {};
  const warnings: Record<string, string[]> = {};

  const collect = (field: string, result: FieldValidation) => {
    if (result.error) {
      errors[field] = result.error;
    }
    if (result.warnings.length > 0) {
      warnings[field] = result.warnings;
    }
  };

  // Required field validation
  collect('client_name', validateClientNameField(formData.clientName));

  // Optional field validation
  if (formData.websiteUrl) {
    collect('url', validateWebsiteUrlField(formData.websiteUrl));
  }

  if (formData.industry) {
    const industryError = validateIndustry(formData.industry);
    if (industryError) {
      errors.industry = industryError;
    }
  }
  
  if (formData.email) {
    collect('location_email', validateEmailAddressField(formData.email));
  }

  if (formData.phone) {
    collect('location_phone', validatePhoneNumberField(formData.phone));
  }

  if (formData.address) {
    const addressError = validateAddress(formData.address);
    if (addressError) {
      errors.address_line1 = addressError;
    }
  }
  
  if (formData.city) {
    const cityError = validateCityName(formData.city);
    if (cityError) {
      errors.city = cityError;
    }
  }
  
  if (formData.stateProvince) {
    const stateError = validateStateProvince(formData.stateProvince);
    if (stateError) {
      errors.state_province = stateError;
    }
  }
  
  if (formData.postalCode) {
    const postalError = validatePostalCode(formData.postalCode, formData.countryCode);
    if (postalError) {
      errors.postal_code = postalError;
    }
  }
  
  if (formData.contactName) {
    collect('contact_name', validateContactNameField(formData.contactName));
  }

  if (formData.contactEmail) {
    collect('contact_email', validateEmailAddressField(formData.contactEmail));
  }

  if (formData.contactPhone) {
    collect('contact_phone', validatePhoneNumberField(formData.contactPhone));
  }

  if (formData.notes) {
    const notesError = validateNotes(formData.notes);
    if (notesError) {
      errors.notes = notesError;
    }
  }

  if (formData.companySize) {
    const companySizeError = validateCompanySize(formData.companySize);
    if (companySizeError) {
      errors.company_size = companySizeError;
    }
  }

  if (formData.annualRevenue) {
    const annualRevenueError = validateAnnualRevenue(formData.annualRevenue);
    if (annualRevenueError) {
      errors.annual_revenue = annualRevenueError;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    warnings
  };
}
