import { isValidEmail } from './utils';

/**
 * Message translator. Validators are framework-agnostic, so callers pass their
 * own `t` (react-i18next's signature is compatible). Omitting it yields English,
 * which keeps every existing call site working unchanged.
 */
export type ValidationTranslator = (key: string, defaultValue: string) => string;

const englishFallback: ValidationTranslator = (_key, defaultValue) => defaultValue;

/**
 * Adapts a react-i18next `t` to {@link ValidationTranslator}. Keys are namespaced
 * (`common:…`), so the caller's bound namespace does not matter — but `common`
 * must be loaded, which every portal layout already does.
 */
// Loose parameter type: react-i18next's `TFunction` is heavily overloaded and does
// not structurally match a plain two-arg signature.
export function toValidationTranslator(
  t: (...args: any[]) => unknown
): ValidationTranslator {
  return (key, defaultValue) => {
    const translated = t(key, defaultValue);
    return typeof translated === 'string' && translated ? translated : defaultValue;
  };
}

// Enhanced validation utilities for client forms
export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
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

// Client name validation - enterprise-level rules
export function validateClientName(name: string, t: ValidationTranslator = englishFallback): string | null {
  if (!name || !name.trim()) {
    return t('common:clients.validation.clientName.required', 'Client name is required');
  }
  
  const trimmedName = name.trim();
  
  // Enterprise rule: 2-256 characters
  if (trimmedName.length < 2) {
    return t('common:clients.validation.clientName.tooShort', 'Client name must be at least 2 characters long');
  }
  
  if (trimmedName.length > 256) {
    return t('common:clients.validation.clientName.tooLong', 'Client name must be 256 characters or less');
  }
  
  // Allow emojis if followed by actual meaningful name content
  const nameWithoutEmojis = trimmedName.replace(EMOJI_REGEX, '').trim();
  
  // Cannot be made up of only special characters, spaces, or tabs
  if (nameWithoutEmojis.length === 0) {
    return t('common:clients.validation.clientName.notMeaningful', 'Client name must contain meaningful characters');
  }
  
  // Single-character names are disallowed
  if (nameWithoutEmojis.length === 1) {
    return t('common:clients.validation.clientName.tooShortMeaningful', 'Client name must be at least 2 meaningful characters');
  }
  
  // Block standalone abbreviations
  const standaloneAbbreviations = ['LLC', 'INC', 'CORP', 'LTD', 'COMPANY', 'CORPORATION'];
  if (standaloneAbbreviations.includes(nameWithoutEmojis.toUpperCase())) {
    return t('common:clients.validation.clientName.abbreviationOnly', 'Client name cannot be just a business abbreviation');
  }
  
  // No repeats of the same character 5+ times (allows names like "AAA Auto")
  if (/(.)\1{4,}/.test(nameWithoutEmojis)) {
    return t('common:clients.validation.clientName.repeatedCharacters', 'Client name cannot contain excessively repeated characters');
  }
  
  // A bare domain suffix is legitimate in a company name (Booking.com, Hotels.com,
  // Care.com), so only reject input that is unambiguously a pasted web address.
  if (/^(https?:\/\/|www\.)/i.test(nameWithoutEmojis)) {
    return t('common:clients.validation.clientName.looksLikeUrl', 'Client name cannot be a web address');
  }
  
  // Must contain at least one letter or number (Unicode supported)
  if (!/[\p{L}\p{N}]/u.test(nameWithoutEmojis)) {
    return t('common:clients.validation.clientName.noAlphanumeric', 'Client name must contain at least one letter or number');
  }
  
  // Allow Unicode letters, numbers, spaces, and business-appropriate punctuation
  // (e.g. "C++ Solutions", "AT&T + Co", "Yahoo!", "#1 Plumbing", "Owner/Operator")
  if (!/^[\p{L}\p{N}\s\-,\.&'()+#@!\/]+$/u.test(nameWithoutEmojis)) {
    return t('common:clients.validation.clientName.invalidCharacters', 'Client name contains invalid characters');
  }
  
  return null;
}

// Website URL validation - enterprise-level rules
export function validateWebsiteUrl(url: string, t: ValidationTranslator = englishFallback): string | null {
  if (!url || !url.trim()) {
    return null; // URL is optional
  }
  
  const trimmedUrl = url.trim();
  
  // Enterprise rule: Max length 256 characters
  if (trimmedUrl.length > 256) {
    return t('common:clients.validation.websiteUrl.tooLong', 'Website URL must be 256 characters or less');
  }
  
  // Add protocol if missing
  let fullUrl = trimmedUrl;
  if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
    fullUrl = 'https://' + trimmedUrl;
  }
  
  try {
    const urlObj = new URL(fullUrl);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Block IP addresses (professional platforms don't allow these)
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return t('common:clients.validation.websiteUrl.ipAddress', 'Please enter a domain name, not an IP address');
    }
    
    // Block localhost and internal hostnames. Private IPv4 ranges are already
    // covered by the literal check above; matching them as name prefixes here
    // rejected real domains such as 10.com and 172.com.
    if (isInternalHostname(hostname)) {
      return t('common:clients.validation.websiteUrl.notPublic', 'Please enter a public business website URL');
    }
    
    // Block reserved documentation/testing domains
    if (isReservedDomain(hostname)) {
      return t('common:clients.validation.websiteUrl.testDomain', 'Please enter a real business website URL');
    }
    
    // Basic domain validation
    if (!hostname || hostname.length < 4) {
      return t('common:clients.validation.websiteUrl.invalid', 'Please enter a valid website URL');
    }
    
    // Must have a domain extension
    if (!hostname.includes('.')) {
      return t('common:clients.validation.websiteUrl.missingTld', 'Please enter a valid website URL with a domain extension');
    }

    // Note: We don't validate TLDs because ICANN has 1,500+ valid TLDs
    // and blocking legitimate customers is worse than accepting edge cases.
    // The URL constructor already validates syntactic correctness.

    return null;
  } catch {
    return t('common:clients.validation.websiteUrl.invalidWithExample', 'Please enter a valid website URL (e.g., apple.com)');
  }
}

// Email validation - professional SaaS/CRM grade with disposable domain blocking
export function validateEmailAddress(email: string, t: ValidationTranslator = englishFallback): string | null {
  if (!email || !email.trim()) {
    return t('common:clients.validation.email.required', 'Email address is required');
  }
  
  // Check for spaces-only input
  if (email && email.trim() === '') {
    return t('common:clients.validation.email.onlySpaces', 'Email address cannot contain only spaces');
  }
  
  const trimmedEmail = email.trim().toLowerCase();
  
  // No emojis
  if (EMOJI_REGEX.test(trimmedEmail)) {
    return t('common:clients.validation.email.emoji', 'Email address cannot contain emojis');
  }
  
  // Basic format validation
  if (!isValidEmail(trimmedEmail)) {
    return t('common:clients.validation.email.invalid', 'Please enter a valid email address');
  }
  
  // Extract domain part
  const parts = trimmedEmail.split('@');
  if (parts.length !== 2) {
    return t('common:clients.validation.email.invalid', 'Please enter a valid email address');
  }
  
  const [localPart, domain] = parts;
  
  // Allow single-letter usernames (j@doe.com is fine)
  if (localPart.length < 1) {
    return t('common:clients.validation.email.invalid', 'Please enter a valid email address');
  }
  
  // Block disposable/temporary email domains (like professional platforms do)
  if (DISPOSABLE_EMAIL_DOMAINS.includes(domain)) {
    return t('common:clients.validation.email.disposable', 'Please use a permanent business email address');
  }
  
  // Block reserved documentation/testing domains and internal-only hostnames
  if (isReservedDomain(domain) || isInternalHostname(domain)) {
    return t('common:clients.validation.email.testDomain', 'Please enter a valid business email address');
  }
  
  // Block obviously fake patterns
  if (/^[0-9\.]+$/.test(domain) || // All numbers like 1.1
      domain === '1.com' ||
      domain === '1.1' ||
      domain.length < 4) {
    return t('common:clients.validation.email.testDomain', 'Please enter a valid business email address');
  }
  
  // Domain must have proper structure
  if (!domain.includes('.') || domain.split('.').length < 2) {
    return t('common:clients.validation.email.invalidDomain', 'Please enter a valid email domain');
  }

  // Check for obviously invalid TLDs (single char or all numbers)
  const domainParts = domain.split('.');
  const tld = domainParts[domainParts.length - 1];
  if (tld.length === 1 || /^[0-9]+$/.test(tld)) {
    return t('common:clients.validation.email.invalidDomain', 'Please enter a valid email domain');
  }

  return null;
}

// Phone validation - professional SaaS/CRM grade with sequential detection
export function validatePhoneNumber(phone: string, t: ValidationTranslator = englishFallback): string | null {
  if (!phone || !phone.trim()) {
    return null; // Phone is optional
  }
  
  const trimmedPhone = phone.trim();
  
  // Don't validate if it's just a country code or very short (avoid premature errors)
  if (trimmedPhone.length < 4) {
    return null; // Don't show error until user types more
  }
  
  // Extract Unicode digits (supports international number systems)
  const unicodeDigits = trimmedPhone.replace(/[\s\-\(\)\+\.\p{P}\p{S}]/gu, '').match(/\p{N}/gu) || [];
  const digitCount = unicodeDigits.length;

  // If only 1-3 digits (like just country code), don't show error yet
  if (digitCount < 4) {
    return null; // Wait for more input
  }

  // No emojis
  if (EMOJI_REGEX.test(trimmedPhone)) {
    return t('common:clients.validation.phone.emoji', 'Phone number cannot contain emojis');
  }

  // Allow Unicode digits with international formatting (including extensions with letters)
  if (!/^[\+\p{N}0-9\s\-\(\)\.,#*a-zA-Z]+$/u.test(trimmedPhone)) {
    return t('common:clients.validation.phone.invalidCharacters', 'Phone number can only contain numbers and formatting characters');
  }

  // Must be 7-15 digits (ITU-T E.164 international standard)
  if (digitCount >= 4 && digitCount < 7) {
    return t('common:clients.validation.phone.incomplete', 'Please enter a complete phone number');
  }

  if (digitCount > 15) {
    return t('common:clients.validation.phone.tooLong', 'Phone number is too long');
  }

  // Only validate patterns if we have a reasonable length
  if (digitCount >= 7) {
    const unicodeDigitString = unicodeDigits.join('');

    // Reject obvious fakes - same digits repeated
    if (/^(.)\1+$/u.test(unicodeDigitString)) {
      return t('common:clients.validation.phone.invalid', 'Please enter a valid phone number');
    }

    // Reject only if ENTIRE number is sequential (like 1234567890 or 9876543210)
    const isEntirelySequential = (str: string): boolean => {
      if (str.length < 7) return false;

      let ascendingCount = 0;
      let descendingCount = 0;

      for (let i = 0; i < str.length - 1; i++) {
        const current = parseInt(str[i]);
        const next = parseInt(str[i + 1]);

        if (!isNaN(current) && !isNaN(next)) {
          if (next === current + 1) ascendingCount++;
          else if (next === current - 1) descendingCount++;
        }
      }

      // Only reject if 80%+ of the number is sequential
      const sequentialRatio = Math.max(ascendingCount, descendingCount) / (str.length - 1);
      return sequentialRatio >= 0.8;
    };

    if (isEntirelySequential(unicodeDigitString)) {
      return t('common:clients.validation.phone.invalid', 'Please enter a valid phone number');
    }

    // The old literal list was redundant: 1111111111 / 0000000000 / 5555555555 are
    // already rejected by the repeated-digit rule above, and 1234567890 / 0123456789
    // by isEntirelySequential. What it missed is the NANP range actually reserved for
    // fiction, 555-0100..555-0199, which is what demo data really uses.
    if (/55501\d{2}$/.test(unicodeDigitString)) {
      return t('common:clients.validation.phone.invalid', 'Please enter a valid phone number');
    }
  }
  
  return null;
}

// Postal code validation - professional SaaS/CRM grade with comprehensive country formats
export function validatePostalCode(postalCode: string, countryCode: string = 'US', t: ValidationTranslator = englishFallback): string | null {
  if (!postalCode || !postalCode.trim()) {
    return null; // Postal code is optional
  }
  
  // Check for spaces-only input
  if (postalCode && postalCode.trim() === '') {
    return t('common:clients.validation.postalCode.onlySpaces', 'Postal code cannot contain only spaces');
  }
  
  const trimmedCode = postalCode.trim().toUpperCase();
  
  // No emojis
  if (EMOJI_REGEX.test(trimmedCode)) {
    return t('common:clients.validation.postalCode.emoji', 'Postal code cannot contain emojis');
  }
  
  // Professional-grade country-specific validation (like enterprise CRMs)
  switch (countryCode.toUpperCase()) {
    case 'US':
      // US ZIP codes: 12345 or 12345-6789
      if (!/^\d{5}(-\d{4})?$/.test(trimmedCode)) {
        return t('common:clients.validation.postalCode.us', 'Please enter a valid ZIP code (e.g., 12345 or 12345-6789)');
      }
      // Block obvious fake ZIP codes
      if (trimmedCode === '00000' || trimmedCode === '99999' || trimmedCode.startsWith('00000')) {
        return t('common:clients.validation.postalCode.usShort', 'Please enter a valid ZIP code');
      }
      break;
      
    case 'CA':
      // Canadian postal codes: A1B 2C3 or A1B2C3
      if (!/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/.test(trimmedCode)) {
        return t('common:clients.validation.postalCode.ca', 'Please enter a valid Canadian postal code (e.g., K1A 0A6)');
      }
      break;
      
    case 'GB':
    case 'UK':
      // UK postal codes: comprehensive patterns
      if (!/^(GIR\s?0AA|[A-PR-UWYZ]([0-9]{1,2}|([A-HK-Y][0-9]|[A-HK-Y][0-9][0-9])|[0-9][A-HJKMNP-Y]|[A-HK-Y][0-9][A-HJKMNP-Y])\s?[0-9][ABD-HJLNP-UW-Z]{2})$/i.test(trimmedCode)) {
        return t('common:clients.validation.postalCode.gb', 'Please enter a valid UK postal code (e.g., SW1A 1AA)');
      }
      break;
      
    case 'DE':
      // Germany: 5 digits
      if (!/^\d{5}$/.test(trimmedCode)) {
        return t('common:clients.validation.postalCode.de', 'Please enter a valid German postal code (e.g., 10115)');
      }
      break;
      
    case 'FR':
      // France: 5 digits
      if (!/^\d{5}$/.test(trimmedCode)) {
        return t('common:clients.validation.postalCode.fr', 'Please enter a valid French postal code (e.g., 75001)');
      }
      break;
      
    case 'JP':
      // Japan: 123-4567 format
      if (!/^\d{3}-\d{4}$/.test(trimmedCode)) {
        return t('common:clients.validation.postalCode.jp', 'Please enter a valid Japanese postal code (e.g., 123-4567)');
      }
      break;
      
    case 'AU':
      // Australia: 4 digits
      if (!/^\d{4}$/.test(trimmedCode)) {
        return t('common:clients.validation.postalCode.au', 'Please enter a valid Australian postal code (e.g., 2000)');
      }
      break;
      
    case 'NL':
      // Netherlands: 1234AB format
      if (!/^\d{4}\s?[A-Z]{2}$/.test(trimmedCode)) {
        return t('common:clients.validation.postalCode.nl', 'Please enter a valid Dutch postal code (e.g., 1234AB)');
      }
      break;
      
    case 'CH':
      // Switzerland: 4 digits
      if (!/^\d{4}$/.test(trimmedCode)) {
        return t('common:clients.validation.postalCode.ch', 'Please enter a valid Swiss postal code (e.g., 8001)');
      }
      break;
      
    case 'IT':
      // Italy: 5 digits
      if (!/^\d{5}$/.test(trimmedCode)) {
        return t('common:clients.validation.postalCode.it', 'Please enter a valid Italian postal code (e.g., 00118)');
      }
      break;
      
    case 'ES':
      // Spain: 5 digits
      if (!/^\d{5}$/.test(trimmedCode)) {
        return t('common:clients.validation.postalCode.es', 'Please enter a valid Spanish postal code (e.g., 28001)');
      }
      break;
      
    case 'BR':
      // Brazil: 12345-678 format
      if (!/^\d{5}-\d{3}$/.test(trimmedCode)) {
        return t('common:clients.validation.postalCode.br', 'Please enter a valid Brazilian postal code (e.g., 01234-567)');
      }
      break;
      
    case 'IN':
      // India: 6 digits
      if (!/^\d{6}$/.test(trimmedCode)) {
        return t('common:clients.validation.postalCode.in', 'Please enter a valid Indian postal code (e.g., 110001)');
      }
      break;
      
    default:
      // Generic validation for other countries
      if (!/^[A-Z0-9\s\-]{3,12}$/i.test(trimmedCode)) {
        return t('common:clients.validation.postalCode.generic', 'Please enter a valid postal code');
      }
  }
  
  return null;
}

// City validation - enterprise international support
export function validateCityName(city: string, t: ValidationTranslator = englishFallback): string | null {
  if (!city || !city.trim()) {
    return null; // City is optional
  }
  
  const trimmedCity = city.trim();
  
  // Enterprise rule: Max length 100 characters
  if (trimmedCity.length > 100) {
    return t('common:clients.validation.city.tooLong', 'City name must be 100 characters or less');
  }
  
  // No emojis
  if (EMOJI_REGEX.test(trimmedCity)) {
    return t('common:clients.validation.city.emoji', 'City name cannot contain emojis');
  }
  
  // Minimum 1 character (to support Ö, Å, Y, etc.)
  if (trimmedCity.length < 1) {
    return t('common:clients.validation.city.empty', 'City name cannot be empty');
  }
  
  // Must contain at least one letter or Unicode character
  if (!/[\p{L}]/u.test(trimmedCity)) {
    return t('common:clients.validation.city.noLetters', 'City name must contain letters');
  }
  
  // Allow Unicode letters, spaces, hyphens, apostrophes, periods
  if (!/^[\p{L}\s\-'\.]+$/u.test(trimmedCity)) {
    return t('common:clients.validation.city.invalidCharacters', 'City name contains invalid characters');
  }
  
  return null;
}

// Address validation - enterprise international support
export function validateAddress(address: string, t: ValidationTranslator = englishFallback): string | null {
  if (!address || !address.trim()) {
    return null; // Address is optional
  }
  
  const trimmedAddress = address.trim();
  
  // Enterprise rule: Max length 100 characters  
  if (trimmedAddress.length > 100) {
    return t('common:clients.validation.address.tooLong', 'Address must be 100 characters or less');
  }
  
  // No emojis
  if (EMOJI_REGEX.test(trimmedAddress)) {
    return t('common:clients.validation.address.emoji', 'Address cannot contain emojis');
  }
  
  // Minimum 1 meaningful character (international support)
  if (trimmedAddress.length < 1) {
    return t('common:clients.validation.address.empty', 'Address cannot be empty');
  }
  
  // Must contain at least one letter or Unicode character (international support)
  if (!/[\p{L}]/u.test(trimmedAddress)) {
    return t('common:clients.validation.address.noLetters', 'Address must contain letters');
  }
  
  // Allow Unicode letters, numbers, spaces, and international address punctuation
  // No requirement for both letters and numbers (international addresses vary)
  if (!/^[\p{L}\p{N}\s\-,\.#\/'"()]+$/u.test(trimmedAddress)) {
    return t('common:clients.validation.address.invalidCharacters', 'Address contains invalid characters');
  }
  
  return null;
}

// State/Province validation - enterprise international support
export function validateStateProvince(state: string, t: ValidationTranslator = englishFallback): string | null {
  if (!state || !state.trim()) {
    return null; // State is optional
  }
  
  const trimmedState = state.trim();
  
  // Enterprise rule: Max length 100 characters
  if (trimmedState.length > 100) {
    return t('common:clients.validation.stateProvince.tooLong', 'State/Province must be 100 characters or less');
  }
  
  // No emojis
  if (EMOJI_REGEX.test(trimmedState)) {
    return t('common:clients.validation.stateProvince.emoji', 'State/Province cannot contain emojis');
  }
  
  // Minimum 1 character (international support)
  if (trimmedState.length < 1) {
    return t('common:clients.validation.stateProvince.empty', 'State/Province cannot be empty');
  }
  
  // Must contain at least one letter or Unicode character
  if (!/[\p{L}]/u.test(trimmedState)) {
    return t('common:clients.validation.stateProvince.noLetters', 'State/Province must contain letters');
  }
  
  // Allow Unicode letters, spaces, hyphens, periods
  if (!/^[\p{L}\s\-\.]+$/u.test(trimmedState)) {
    return t('common:clients.validation.stateProvince.invalidCharacters', 'State/Province contains invalid characters');
  }
  
  return null;
}

// Industry validation - enterprise international support
export function validateIndustry(industry: string, t: ValidationTranslator = englishFallback): string | null {
  if (!industry || !industry.trim()) {
    return null; // Industry is optional
  }
  
  const trimmedIndustry = industry.trim();
  
  // Enterprise rule: Max length 100 characters
  if (trimmedIndustry.length > 100) {
    return t('common:clients.validation.industry.tooLong', 'Industry must be 100 characters or less');
  }
  
  // Allow emojis if accompanied by text (like company names)
  const textWithoutEmojis = trimmedIndustry.replace(EMOJI_REGEX, '').trim();
  if (EMOJI_REGEX.test(trimmedIndustry) && textWithoutEmojis.length < 2) {
    return t('common:clients.validation.industry.tooShortText', 'Industry must contain at least 2 text characters');
  }
  
  if (trimmedIndustry.length < 2) {
    return t('common:clients.validation.industry.tooShort', 'Industry must be at least 2 characters long');
  }
  
  // Must contain at least one letter or Unicode character
  if (!/[\p{L}]/u.test(trimmedIndustry)) {
    return t('common:clients.validation.industry.noLetters', 'Industry must contain letters');
  }
  
  // Allow Unicode letters, spaces, hyphens, ampersands, slashes, commas
  if (!/^[\p{L}\s\-&\/,]+$/u.test(trimmedIndustry)) {
    return t('common:clients.validation.industry.invalidCharacters', 'Industry contains invalid characters');
  }
  
  return null;
}

// Role validation - enterprise-level rules (matches QuickAddContact validation)
export function validateRole(role: string, t: ValidationTranslator = englishFallback): string | null {
  if (!role || !role.trim()) {
    return null; // Role is optional
  }

  const trimmedRole = role.trim();

  // Check for spaces-only input
  if (/^\s+$/.test(role)) {
    return t('common:clients.validation.role.onlySpaces', 'Role cannot contain only spaces');
  }

  // Enterprise rule: Max length 100 characters
  if (trimmedRole.length > 100) {
    return t('common:clients.validation.role.tooLong', 'Role must be 100 characters or less');
  }

  // Must contain at least one letter or number (Unicode supported)
  if (!/[\p{L}\p{N}]/u.test(trimmedRole)) {
    return t('common:clients.validation.role.noAlphanumeric', 'Role must contain letters or numbers');
  }

  return null;
}

// Contact name validation - enterprise-level rules
export function validateContactName(name: string, t: ValidationTranslator = englishFallback): string | null {
  if (!name || !name.trim()) {
    return null; // Contact name is optional
  }
  
  const trimmedName = name.trim();
  
  // Enterprise rule: Max length 40 characters
  if (trimmedName.length > 40) {
    return t('common:clients.validation.contactName.tooLong', 'Contact name must be 40 characters or less');
  }
  
  // Allow emojis if followed by actual meaningful name content
  const nameWithoutEmojis = trimmedName.replace(EMOJI_REGEX, '').trim();
  
  if (nameWithoutEmojis.length === 0) {
    return t('common:clients.validation.contactName.notMeaningful', 'Contact name must contain meaningful characters');
  }
  
  // Block placeholder or testing names
  const placeholderNames = ['test', 'testing', 'nobody', 'unknown', 'placeholder', 'temp', 'temporary', 
                           'admin', 'user', 'sample', 'example', 'demo', 'fake', 'dummy', 'null', 'n/a'];
  if (placeholderNames.includes(nameWithoutEmojis.toLowerCase())) {
    return t('common:clients.validation.contactName.placeholder', 'Please enter a real contact name');
  }
  
  // Must contain at least one letter (Unicode supported)
  if (!/[\p{L}]/u.test(nameWithoutEmojis)) {
    return t('common:clients.validation.contactName.noLetters', 'Contact name must contain letters');
  }
  
  // Allow Unicode letters, numbers, spaces, hyphens, apostrophes, periods
  if (!/^[\p{L}\p{N}\s\-'\.]+$/u.test(nameWithoutEmojis)) {
    return t('common:clients.validation.contactName.invalidCharacters', 'Contact name contains invalid characters');
  }
  
  return null;
}

// Notes validation - enterprise-level rules
export function validateNotes(notes: string, t: ValidationTranslator = englishFallback): string | null {
  if (!notes || !notes.trim()) {
    return null; // Notes are optional
  }
  
  const trimmedNotes = notes.trim();
  
  // Enterprise rule: Max length 2000 characters
  if (trimmedNotes.length > 2000) {
    return t('common:clients.validation.notes.tooLong', 'Notes must be 2000 characters or less');
  }
  
  // Allow emojis in notes - no restrictions on content
  return null;
}


// Company size validation - professional SaaS/CRM grade (Microsoft/Salesforce standard)
export function validateCompanySize(companySize: string, t: ValidationTranslator = englishFallback): string | null {
  if (!companySize || !companySize.trim()) {
    return null; // Company size is optional
  }

  const trimmedSize = companySize.trim();

  // Enterprise rule: Max length 50 characters
  if (trimmedSize.length > 50) {
    return t('common:clients.validation.companySize.tooLong', 'Company size must be 50 characters or less');
  }

  // No emojis
  if (EMOJI_REGEX.test(trimmedSize)) {
    return t('common:clients.validation.companySize.emoji', 'Company size cannot contain emojis');
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
    return t('common:clients.validation.companySize.invalid', 'Please enter a valid company size (e.g., "50", "10-50", "five hundred", "2.5M", "small", "enterprise")');
  }

  return null;
}

// Annual revenue validation - professional SaaS/CRM grade (Microsoft/Salesforce standard)
export function validateAnnualRevenue(revenue: string, t: ValidationTranslator = englishFallback): string | null {
  if (!revenue || !revenue.trim()) {
    return null; // Annual revenue is optional
  }

  const trimmedRevenue = revenue.trim();

  // Enterprise rule: Max length 50 characters
  if (trimmedRevenue.length > 50) {
    return t('common:clients.validation.annualRevenue.tooLong', 'Annual revenue must be 50 characters or less');
  }

  // No emojis
  if (EMOJI_REGEX.test(trimmedRevenue)) {
    return t('common:clients.validation.annualRevenue.emoji', 'Annual revenue cannot contain emojis');
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
    return t('common:clients.validation.annualRevenue.invalid', 'Please enter valid annual revenue (e.g., "$1,000,000", "five million", "2.5M", "10M-50M", "not disclosed")');
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
}, t: ValidationTranslator = englishFallback): ValidationResult {
  const errors: Record<string, string> = {};
  
  // Required field validation
  const clientNameError = validateClientName(formData.clientName, t);
  if (clientNameError) {
    errors.client_name = clientNameError;
  }
  
  // Optional field validation
  if (formData.websiteUrl) {
    const websiteError = validateWebsiteUrl(formData.websiteUrl, t);
    if (websiteError) {
      errors.url = websiteError;
    }
  }
  
  if (formData.industry) {
    const industryError = validateIndustry(formData.industry, t);
    if (industryError) {
      errors.industry = industryError;
    }
  }
  
  if (formData.email) {
    const emailError = validateEmailAddress(formData.email, t);
    if (emailError) {
      errors.location_email = emailError;
    }
  }
  
  if (formData.phone) {
    const phoneError = validatePhoneNumber(formData.phone, t);
    if (phoneError) {
      errors.location_phone = phoneError;
    }
  }
  
  if (formData.address) {
    const addressError = validateAddress(formData.address, t);
    if (addressError) {
      errors.address_line1 = addressError;
    }
  }
  
  if (formData.city) {
    const cityError = validateCityName(formData.city, t);
    if (cityError) {
      errors.city = cityError;
    }
  }
  
  if (formData.stateProvince) {
    const stateError = validateStateProvince(formData.stateProvince, t);
    if (stateError) {
      errors.state_province = stateError;
    }
  }
  
  if (formData.postalCode) {
    const postalError = validatePostalCode(formData.postalCode, formData.countryCode, t);
    if (postalError) {
      errors.postal_code = postalError;
    }
  }
  
  if (formData.contactName) {
    const contactNameError = validateContactName(formData.contactName, t);
    if (contactNameError) {
      errors.contact_name = contactNameError;
    }
  }
  
  if (formData.contactEmail) {
    const contactEmailError = validateEmailAddress(formData.contactEmail, t);
    if (contactEmailError) {
      errors.contact_email = contactEmailError;
    }
  }
  
  if (formData.contactPhone) {
    const contactPhoneError = validatePhoneNumber(formData.contactPhone, t);
    if (contactPhoneError) {
      errors.contact_phone = contactPhoneError;
    }
  }
  
  if (formData.notes) {
    const notesError = validateNotes(formData.notes, t);
    if (notesError) {
      errors.notes = notesError;
    }
  }

  if (formData.companySize) {
    const companySizeError = validateCompanySize(formData.companySize, t);
    if (companySizeError) {
      errors.company_size = companySizeError;
    }
  }

  if (formData.annualRevenue) {
    const annualRevenueError = validateAnnualRevenue(formData.annualRevenue, t);
    if (annualRevenueError) {
      errors.annual_revenue = annualRevenueError;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}
