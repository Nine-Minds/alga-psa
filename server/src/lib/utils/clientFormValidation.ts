import { validateEmail } from '../api/schemas/common';

// Enhanced validation utilities for client forms
export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

// Comprehensive emoji regex pattern - professional SaaS grade (Microsoft/Salesforce standard)
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA70}-\u{1FAFF}]|[\u{1F004}]|[\u{1F0CF}]|[\u{1F170}-\u{1F251}]/gu;

// Helper function to check if content has meaningful characters (Microsoft/Salesforce approach)
const hasNonEmojiContent = (text: string): boolean => {
  const withoutEmojis = text.replace(EMOJI_REGEX, '').trim();
  return withoutEmojis.length > 0 && /[\p{L}\p{N}]/u.test(withoutEmojis);
};

// Professional validation lists - what real SaaS/CRM platforms use
const VALID_TLDS = [
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'int', 'co', 'io', 'ai', 'app', 'dev',
  'us', 'uk', 'ca', 'au', 'de', 'fr', 'jp', 'cn', 'in', 'br', 'ru', 'mx', 'it', 'es', 'nl', 'se', 'no', 'dk', 'fi',
  'biz', 'info', 'name', 'pro', 'aero', 'coop', 'museum', 'travel', 'mobi', 'tel', 'asia', 'jobs', 'cat',
  'tech', 'online', 'store', 'site', 'website', 'space', 'club', 'xyz', 'top', 'win', 'bid'
];

// Disposable/temporary email domains - commonly blocked by professional platforms
const DISPOSABLE_EMAIL_DOMAINS = [
  '10minutemail.com', '20minutemail.com', 'mailinator.com', 'guerrillamail.com', 'tempmail.org',
  'temp-mail.org', 'yopmail.com', 'throwaway.email', 'getnada.com', 'maildrop.cc',
  'sharklasers.com', 'spam4.me', 'fakemailgenerator.com', 'dispostable.com', 'trashmail.com',
  'mailcatch.com', 'mytrashmail.com', '10minemail.com', 'emailondeck.com', 'tempail.com'
];

// Test/fake domains commonly blocked
const FAKE_DOMAINS = [
  'test.com', 'example.com', 'sample.com', 'demo.com', 'fake.com', 'invalid.com',
  'test.test', 'example.org', 'sample.org', 'localhost', 'test.local'
];

// Company name validation - enterprise-level rules
export function validateCompanyName(name: string): string | null {
  if (!name || !name.trim()) {
    return 'Company name is required';
  }
  
  const trimmedName = name.trim();
  
  // Enterprise rule: 2-256 characters
  if (trimmedName.length < 2) {
    return 'Company name must be at least 2 characters long';
  }
  
  if (trimmedName.length > 256) {
    return 'Company name must be 256 characters or less';
  }
  
  // Allow emojis if followed by actual meaningful name content
  const nameWithoutEmojis = trimmedName.replace(EMOJI_REGEX, '').trim();
  
  // Cannot be made up of only special characters, spaces, or tabs
  if (nameWithoutEmojis.length === 0) {
    return 'Company name must contain meaningful characters';
  }
  
  // Single-character names are disallowed
  if (nameWithoutEmojis.length === 1) {
    return 'Company name must be at least 2 meaningful characters';
  }
  
  // Block standalone abbreviations
  const standaloneAbbreviations = ['LLC', 'INC', 'CORP', 'LTD', 'CO', 'COMPANY', 'CORPORATION'];
  if (standaloneAbbreviations.includes(nameWithoutEmojis.toUpperCase())) {
    return 'Company name cannot be just a business abbreviation';
  }
  
  // Professional SaaS approach: Allow repeated characters (Mississippi Steel, PayPal, etc. are valid)
  
  // Block domain extensions
  if (/\.(com|org|net|edu|gov|biz|info)$/i.test(nameWithoutEmojis)) {
    return 'Company name cannot end with a domain extension';
  }
  
  // Must contain at least one letter or number (Unicode supported)
  if (!/[\p{L}\p{N}]/u.test(nameWithoutEmojis)) {
    return 'Company name must contain at least one letter or number';
  }
  
  // Allow Unicode letters, numbers, spaces, and business-appropriate punctuation
  if (!/^[\p{L}\p{N}\s\-,.&'()]+$/u.test(nameWithoutEmojis)) {
    return 'Company name contains invalid characters';
  }
  
  return null;
}

// Website URL validation - enterprise-level rules
export function validateWebsiteUrl(url: string): string | null {
  if (!url || !url.trim()) {
    return null; // URL is optional
  }
  
  const trimmedUrl = url.trim();
  
  // Enterprise rule: Max length 256 characters
  if (trimmedUrl.length > 256) {
    return 'Website URL must be 256 characters or less';
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
      return 'Please enter a domain name, not an IP address';
    }
    
    // Block localhost and internal domains
    if (hostname === 'localhost' || 
        hostname.endsWith('.local') || 
        hostname.endsWith('.internal') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.')) {
      return 'Please enter a public business website URL';
    }
    
    // Block common fake/test domains
    if (FAKE_DOMAINS.includes(hostname)) {
      return 'Please enter a real business website URL';
    }
    
    // Basic domain validation
    if (!hostname || hostname.length < 4) {
      return 'Please enter a valid website URL';
    }
    
    // Must have a domain extension
    if (!hostname.includes('.')) {
      return 'Please enter a valid website URL with a domain extension';
    }
    
    // Validate TLD against known valid TLDs
    const parts = hostname.split('.');
    const tld = parts[parts.length - 1];
    
    if (!VALID_TLDS.includes(tld)) {
      return 'Please enter a website with a valid domain extension';
    }
    
    return null;
  } catch {
    return 'Please enter a valid website URL (e.g., apple.com)';
  }
}

// Email validation - professional SaaS/CRM grade with disposable domain blocking
export function validateEmailAddress(email: string): string | null {
  if (!email || !email.trim()) {
    return null; // Email is optional in some contexts
  }
  
  // Check for spaces-only input
  if (email && email.trim() === '') {
    return 'Email address cannot contain only spaces';
  }
  
  const trimmedEmail = email.trim().toLowerCase();
  
  // No emojis
  if (EMOJI_REGEX.test(trimmedEmail)) {
    return 'Email address cannot contain emojis';
  }
  
  // Basic format validation
  if (!validateEmail(trimmedEmail)) {
    return 'Please enter a valid email address';
  }
  
  // Extract domain part
  const parts = trimmedEmail.split('@');
  if (parts.length !== 2) {
    return 'Please enter a valid email address';
  }
  
  const [localPart, domain] = parts;
  
  // Allow single-letter usernames (j@doe.com is fine)
  if (localPart.length < 1) {
    return 'Please enter a valid email address';
  }
  
  // Block disposable/temporary email domains (like professional platforms do)
  if (DISPOSABLE_EMAIL_DOMAINS.includes(domain)) {
    return 'Please use a permanent business email address';
  }
  
  // Block fake/test domains
  if (FAKE_DOMAINS.includes(domain)) {
    return 'Please enter a valid business email address';
  }
  
  // Block obviously fake patterns
  if (/^[0-9.]+$/.test(domain) || // All numbers like 1.1
      domain === '1.com' ||
      domain === '1.1' ||
      domain.length < 4) {
    return 'Please enter a valid business email address';
  }
  
  // Domain must have proper structure
  if (!domain.includes('.') || domain.split('.').length < 2) {
    return 'Please enter a valid email domain';
  }
  
  // Validate TLD against known valid TLDs (like professional platforms)
  const domainParts = domain.split('.');
  const tld = domainParts[domainParts.length - 1];
  
  if (!VALID_TLDS.includes(tld)) {
    return 'Please enter an email with a valid domain extension';
  }
  
  // Additional check for common fake patterns
  if (tld.length === 1 || /^[0-9]+$/.test(tld)) {
    return 'Please enter a valid email domain';
  }
  
  return null;
}

// Phone validation - professional SaaS/CRM grade with sequential detection
export function validatePhoneNumber(phone: string): string | null {
  if (!phone || !phone.trim()) {
    return null; // Phone is optional
  }
  
  const trimmedPhone = phone.trim();
  
  // Don't validate if it's just a country code or very short (avoid premature errors)
  if (trimmedPhone.length < 4) {
    return null; // Don't show error until user types more
  }
  
  // Extract Unicode digits (supports international number systems)
  const unicodeDigits = trimmedPhone.replace(/[\s\-()\\+.\p{P}\p{S}]/gu, '').match(/\p{N}/gu) || [];
  const digitCount = unicodeDigits.length;

  // If only 1-3 digits (like just country code), don't show error yet
  if (digitCount < 4) {
    return null; // Wait for more input
  }

  // No emojis
  if (EMOJI_REGEX.test(trimmedPhone)) {
    return 'Phone number cannot contain emojis';
  }

  // Allow Unicode digits with international formatting
  if (!/^[+\p{N}\s\-.()]+$/u.test(trimmedPhone)) {
    return 'Phone number can only contain numbers and formatting characters';
  }

  // Must be 7-15 digits (ITU-T E.164 international standard)
  if (digitCount >= 4 && digitCount < 7) {
    return 'Please enter a complete phone number';
  }

  if (digitCount > 15) {
    return 'Phone number is too long';
  }

  // Only validate patterns if we have a reasonable length
  if (digitCount >= 7) {
    const unicodeDigitString = unicodeDigits.join('');

    // Reject obvious fakes - same digits repeated
    if (/^(.)\1+$/u.test(unicodeDigitString)) {
      return 'Please enter a valid phone number';
    }

    // Reject sequential patterns (supports Unicode digits)
    const isSequential = (str: string): boolean => {
      for (let i = 0; i < str.length - 2; i++) {
        const current = parseInt(str[i]);
        const next1 = parseInt(str[i + 1]);
        const next2 = parseInt(str[i + 2]);

        // Check for ascending sequence (123, 234, etc.)
        if (!isNaN(current) && !isNaN(next1) && !isNaN(next2)) {
          if (next1 === current + 1 && next2 === current + 2) {
            return true;
          }

          // Check for descending sequence (321, 210, etc.)
          if (next1 === current - 1 && next2 === current - 2) {
            return true;
          }
        }
      }
      return false;
    };

    if (isSequential(unicodeDigitString)) {
      return 'Please enter a valid phone number';
    }

    // Block common test numbers (convert to regular digits for comparison)
    const testNumbers = ['1234567890', '0123456789', '1111111111', '0000000000', '5555555555'];
    if (testNumbers.includes(unicodeDigitString)) {
      return 'Please enter a valid phone number';
    }
  }
  
  return null;
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
      if (!/^(GIR\s?0AA|[A-PR-UWYZ]([0-9]{1,2}|([A-HK-Y][0-9]|[A-HK-Y][0-9][0-9])|[0-9][A-HJKMNP-Y])\s?[0-9][ABD-HJLNP-UW-Z]{2})$/i.test(trimmedCode)) {
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
  if (!/^[\p{L}\s\-'.]+$/u.test(trimmedCity)) {
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
  if (!/^[\p{L}\p{N}\s\-,.#/'"()]+$/u.test(trimmedAddress)) {
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
  if (!/^[\p{L}\s\-.]+$/u.test(trimmedState)) {
    return 'State/Province contains invalid characters';
  }
  
  return null;
}

// Industry validation - professional SaaS international support (Microsoft/Salesforce standard)
export function validateIndustry(industry: string): string | null {
  if (!industry || !industry.trim()) {
    return null; // Industry is optional
  }

  const trimmedIndustry = industry.trim();

  // Enterprise rule: Max length 100 characters
  if (trimmedIndustry.length > 100) {
    return 'Industry must be 100 characters or less';
  }

  if (trimmedIndustry.length < 2) {
    return 'Industry must be at least 2 characters long';
  }

  // Professional SaaS approach: Allow emojis but require meaningful content
  if (!hasNonEmojiContent(trimmedIndustry)) {
    return 'Industry must contain meaningful text (letters or numbers)';
  }

  // Allow Unicode letters, numbers, spaces, common punctuation, and emojis
  // Remove emojis temporarily to check base characters
  const withoutEmojis = trimmedIndustry.replace(EMOJI_REGEX, '');
  if (!/^[\p{L}\p{N}\s\-&/,.()%#]*$/u.test(withoutEmojis)) {
    return 'Industry contains unsupported characters';
  }

  return null;
}

// Contact name validation - enterprise-level rules  
export function validateContactName(name: string): string | null {
  if (!name || !name.trim()) {
    return null; // Contact name is optional
  }
  
  const trimmedName = name.trim();
  
  // Enterprise rule: Max length 40 characters
  if (trimmedName.length > 40) {
    return 'Contact name must be 40 characters or less';
  }
  
  // Allow emojis if followed by actual meaningful name content
  const nameWithoutEmojis = trimmedName.replace(EMOJI_REGEX, '').trim();
  
  if (nameWithoutEmojis.length === 0) {
    return 'Contact name must contain meaningful characters';
  }
  
  // Block placeholder or testing names
  const placeholderNames = ['test', 'testing', 'nobody', 'unknown', 'placeholder', 'temp', 'temporary', 
                           'admin', 'user', 'sample', 'example', 'demo', 'fake', 'dummy', 'null', 'n/a'];
  if (placeholderNames.includes(nameWithoutEmojis.toLowerCase())) {
    return 'Please enter a real contact name';
  }
  
  // Must contain at least one letter (Unicode supported)
  if (!/[\p{L}]/u.test(nameWithoutEmojis)) {
    return 'Contact name must contain letters';
  }
  
  // Allow Unicode letters, spaces, hyphens, apostrophes, periods
  if (!/^[\p{L}\s\-'.]+$/u.test(nameWithoutEmojis)) {
    return 'Contact name contains invalid characters';
  }
  
  return null;
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
    /^(1-10|11-50|51-200|201-500|501-1000|1001-5000|5001\+)$/
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

  // Professional SaaS approach: Accept both numeric and plain English with currency symbols
  const lowerRevenue = trimmedRevenue.toLowerCase().replace(/[\s$,£€¥]/g, '');

  // Common professional revenue formats (Microsoft/Salesforce patterns)
  const validFormats = [
    // Exact numbers with optional currency symbols and commas
    /^\d+(,\d{3})*(\.\d{2})?$/,
    // Ranges
    /^\d+-\d+$/,
    /^\d+to\d+$/,
    // Abbreviations (K, M, B)
    /^\d+(\.\d+)?[kmb]$/,
    // Plain English numbers
    /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)(\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion))*$/,
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

  const isValid = validFormats.some(pattern => pattern.test(lowerRevenue));

  if (!isValid) {
    return 'Please enter valid annual revenue (e.g., "$1,000,000", "five million", "2.5M", "10M-50M", "not disclosed")';
  }

  return null;
}

// Tax ID validation - professional SaaS/CRM grade with international support
export function validateTaxId(taxId: string): string | null {
  if (!taxId || !taxId.trim()) {
    return null; // Tax ID is optional
  }

  const trimmedTaxId = taxId.trim();

  // Enterprise rule: Max length 50 characters
  if (trimmedTaxId.length > 50) {
    return 'Tax ID must be 50 characters or less';
  }

  // Minimum 2 characters for meaningful tax ID
  if (trimmedTaxId.length < 2) {
    return 'Tax ID must be at least 2 characters long';
  }

  // No emojis
  if (EMOJI_REGEX.test(trimmedTaxId)) {
    return 'Tax ID cannot contain emojis';
  }

  // Professional SaaS approach: Support international tax ID formats
  // Allow letters, numbers, hyphens, spaces, and common tax ID punctuation
  if (!/^[\p{L}\p{N}\s\-./]+$/u.test(trimmedTaxId)) {
    return 'Tax ID contains invalid characters';
  }

  // Must contain at least one letter or number (Unicode supported)
  if (!/[\p{L}\p{N}]/u.test(trimmedTaxId)) {
    return 'Tax ID must contain letters or numbers';
  }

  // Block obvious placeholder values
  const placeholderValues = ['none', 'n/a', 'na', 'null', 'unknown', 'tbd', 'pending', 'temp', 'test', 'example'];
  if (placeholderValues.includes(trimmedTaxId.toLowerCase())) {
    return 'Please enter a valid tax ID';
  }

  return null;
}

// Parent company validation - professional SaaS/CRM grade with international support
export function validateParentCompany(parentCompany: string): string | null {
  if (!parentCompany || !parentCompany.trim()) {
    return null; // Parent company is optional
  }

  const trimmedParentCompany = parentCompany.trim();

  // Enterprise rule: Max length 256 characters (same as company name)
  if (trimmedParentCompany.length > 256) {
    return 'Parent company name must be 256 characters or less';
  }

  // Minimum 2 characters for meaningful company name
  if (trimmedParentCompany.length < 2) {
    return 'Parent company name must be at least 2 characters long';
  }

  // Professional SaaS approach: Allow emojis but require meaningful content
  if (!hasNonEmojiContent(trimmedParentCompany)) {
    return 'Parent company name must contain meaningful characters';
  }

  const nameWithoutEmojis = trimmedParentCompany.replace(EMOJI_REGEX, '').trim();

  // Block standalone abbreviations
  const standaloneAbbreviations = ['LLC', 'INC', 'CORP', 'LTD', 'CO', 'COMPANY', 'CORPORATION'];
  if (standaloneAbbreviations.includes(nameWithoutEmojis.toUpperCase())) {
    return 'Parent company name cannot be just a business abbreviation';
  }

  // Block domain extensions
  if (/\.(com|org|net|edu|gov|biz|info)$/i.test(nameWithoutEmojis)) {
    return 'Parent company name cannot end with a domain extension';
  }

  // Must contain at least one letter or number (Unicode supported)
  if (!/[\p{L}\p{N}]/u.test(nameWithoutEmojis)) {
    return 'Parent company name must contain at least one letter or number';
  }

  // Allow Unicode letters, numbers, spaces, and business-appropriate punctuation
  if (!/^[\p{L}\p{N}\s\-,.&'()]+$/u.test(nameWithoutEmojis)) {
    return 'Parent company name contains invalid characters';
  }

  // Block obvious placeholder values
  const placeholderValues = ['none', 'n/a', 'na', 'null', 'unknown', 'tbd', 'pending', 'temp', 'test', 'example', 'same', 'self'];
  if (placeholderValues.includes(nameWithoutEmojis.toLowerCase())) {
    return 'Please enter a valid parent company name';
  }

  return null;
}

// Last contact date validation - professional SaaS/CRM grade
export function validateLastContactDate(lastContactDate: string): string | null {
  if (!lastContactDate || !lastContactDate.trim()) {
    return null; // Last contact date is optional
  }

  const trimmedDate = lastContactDate.trim();

  // No emojis
  if (EMOJI_REGEX.test(trimmedDate)) {
    return 'Last contact date cannot contain emojis';
  }

  // Professional SaaS approach: Accept various date formats
  const dateFormats = [
    // ISO format: YYYY-MM-DD
    /^\d{4}-\d{2}-\d{2}$/,
    // US format: MM/DD/YYYY
    /^\d{1,2}\/\d{1,2}\/\d{4}$/,
    // European format: DD/MM/YYYY
    /^\d{1,2}\/\d{1,2}\/\d{4}$/,
    // Dot format: DD.MM.YYYY
    /^\d{1,2}\.\d{1,2}\.\d{4}$/,
    // Hyphen format: DD-MM-YYYY
    /^\d{1,2}-\d{1,2}-\d{4}$/,
    // Short year: MM/DD/YY
    /^\d{1,2}\/\d{1,2}\/\d{2}$/,
    // Month name formats: "Jan 15, 2024", "January 15, 2024"
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}$/i,
    // Simple formats: "2024", "Q1 2024", "Jan 2024"
    /^\d{4}$/,
    /^Q[1-4]\s+\d{4}$/i,
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i
  ];

  const isValidFormat = dateFormats.some(pattern => pattern.test(trimmedDate));

  if (!isValidFormat) {
    return 'Please enter a valid date (e.g., "2024-01-15", "01/15/2024", "Jan 15, 2024")';
  }

  // Additional validation: Check if the date is reasonable (not too far in the future)
  try {
    let dateToCheck: Date | null = null;

    // Try to parse common formats
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      dateToCheck = new Date(trimmedDate);
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmedDate)) {
      dateToCheck = new Date(trimmedDate);
    } else if (/^\d{4}$/.test(trimmedDate)) {
      dateToCheck = new Date(parseInt(trimmedDate), 0, 1); // January 1st of that year
    }

    if (dateToCheck && !isNaN(dateToCheck.getTime())) {
      const now = new Date();
      const oneYearFromNow = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());

      // Check if date is too far in the future (professional SaaS rule)
      if (dateToCheck > oneYearFromNow) {
        return 'Last contact date cannot be more than a year in the future';
      }

      // Check if date is too far in the past (reasonable business rule)
      const fiftyYearsAgo = new Date(now.getFullYear() - 50, now.getMonth(), now.getDate());
      if (dateToCheck < fiftyYearsAgo) {
        return 'Last contact date cannot be more than 50 years ago';
      }
    }
  } catch {
    // If date parsing fails, rely on format validation
  }

  return null;
}

// Payment terms validation - professional SaaS/CRM grade
export function validatePaymentTerms(paymentTerms: string): string | null {
  if (!paymentTerms || !paymentTerms.trim()) {
    return null; // Payment terms are optional
  }

  const trimmedTerms = paymentTerms.trim();

  // Enterprise rule: Max length 100 characters
  if (trimmedTerms.length > 100) {
    return 'Payment terms must be 100 characters or less';
  }

  // Minimum 2 characters for meaningful terms
  if (trimmedTerms.length < 2) {
    return 'Payment terms must be at least 2 characters long';
  }

  // No emojis
  if (EMOJI_REGEX.test(trimmedTerms)) {
    return 'Payment terms cannot contain emojis';
  }

  // Professional SaaS approach: Support common payment terms formats
  const lowerTerms = trimmedTerms.toLowerCase();

  // Common professional payment terms patterns
  const validPatterns = [
    // Net terms: "Net 30", "NET 30", "net30"
    /^net\s*\d+(\s+days?)?$/,
    // Due terms: "Due on receipt", "Due upon delivery"
    /^due\s+(on\s+)?(receipt|delivery|invoice|completion)$/,
    // Days terms: "30 days", "60 days net"
    /^\d+\s+days?(\s+net)?$/,
    // Percentage terms: "2/10 net 30", "1% 10 days"
    /^\d+(\.\d+)?[%\/]\d+(\s+(net\s+)?\d+)?$/,
    // Advance terms: "50% advance", "Payment in advance"
    /^(\d+%?\s+)?(advance|upfront|prepaid|prepayment)$/,
    /^payment\s+in\s+advance$/,
    // COD terms
    /^(cod|cash\s+on\s+delivery)$/,
    // Immediate terms
    /^(immediate|upon\s+receipt|on\s+delivery)$/,
    // Monthly terms
    /^(monthly|quarterly|annually|weekly)$/,
    // Credit terms
    /^(credit\s+)?(\d+\s+days?\s+)?credit$/,
    // Custom professional terms
    /^[\p{L}\p{N}\s\-,.%\/()]+$/u
  ];

  const isValidPattern = validPatterns.some(pattern => pattern.test(lowerTerms));

  if (!isValidPattern) {
    return 'Payment terms contain invalid characters';
  }

  // Must contain at least one letter or number (Unicode supported)
  if (!/[\p{L}\p{N}]/u.test(trimmedTerms)) {
    return 'Payment terms must contain letters or numbers';
  }

  // Block obvious placeholder values
  const placeholderValues = ['none', 'n/a', 'na', 'null', 'unknown', 'tbd', 'pending', 'temp', 'test', 'example'];
  if (placeholderValues.includes(lowerTerms)) {
    return 'Please enter valid payment terms';
  }

  return null;
}

// Comprehensive form validation function
export function validateClientForm(formData: {
  companyName: string;
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
  taxId?: string;
  parentCompany?: string;
  lastContactDate?: string;
  paymentTerms?: string;
}): ValidationResult {
  const errors: Record<string, string> = {};
  
  // Required field validation
  const companyNameError = validateCompanyName(formData.companyName);
  if (companyNameError) {
    errors.company_name = companyNameError;
  }
  
  // Optional field validation
  if (formData.websiteUrl) {
    const websiteError = validateWebsiteUrl(formData.websiteUrl);
    if (websiteError) {
      errors.url = websiteError;
    }
  }
  
  if (formData.industry) {
    const industryError = validateIndustry(formData.industry);
    if (industryError) {
      errors.industry = industryError;
    }
  }
  
  if (formData.email) {
    const emailError = validateEmailAddress(formData.email);
    if (emailError) {
      errors.location_email = emailError;
    }
  }
  
  if (formData.phone) {
    const phoneError = validatePhoneNumber(formData.phone);
    if (phoneError) {
      errors.location_phone = phoneError;
    }
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
    const contactNameError = validateContactName(formData.contactName);
    if (contactNameError) {
      errors.contact_name = contactNameError;
    }
  }
  
  if (formData.contactEmail) {
    const contactEmailError = validateEmailAddress(formData.contactEmail);
    if (contactEmailError) {
      errors.contact_email = contactEmailError;
    }
  }
  
  if (formData.contactPhone) {
    const contactPhoneError = validatePhoneNumber(formData.contactPhone);
    if (contactPhoneError) {
      errors.contact_phone = contactPhoneError;
    }
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

  if (formData.taxId) {
    const taxIdError = validateTaxId(formData.taxId);
    if (taxIdError) {
      errors.tax_id = taxIdError;
    }
  }

  if (formData.parentCompany) {
    const parentCompanyError = validateParentCompany(formData.parentCompany);
    if (parentCompanyError) {
      errors.parent_company_name = parentCompanyError;
    }
  }

  if (formData.lastContactDate) {
    const lastContactDateError = validateLastContactDate(formData.lastContactDate);
    if (lastContactDateError) {
      errors.last_contact_date = lastContactDateError;
    }
  }

  if (formData.paymentTerms) {
    const paymentTermsError = validatePaymentTerms(formData.paymentTerms);
    if (paymentTermsError) {
      errors.payment_terms = paymentTermsError;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

