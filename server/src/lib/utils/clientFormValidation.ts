import { validateEmail } from '../api/schemas/common';

// Enhanced validation utilities for client forms
export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

// Common emoji regex pattern used across validation functions
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;

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
  
  // No repeats of the same character 3+ times
  if (/(.)\1{2,}/.test(nameWithoutEmojis)) {
    return 'Company name cannot contain repeated characters';
  }
  
  // Block domain extensions
  if (/\.(com|org|net|edu|gov|biz|info)$/i.test(nameWithoutEmojis)) {
    return 'Company name cannot end with a domain extension';
  }
  
  // Must contain at least one letter or number (Unicode supported)
  if (!/[\p{L}\p{N}]/u.test(nameWithoutEmojis)) {
    return 'Company name must contain at least one letter or number';
  }
  
  // Allow Unicode letters, numbers, spaces, and business-appropriate punctuation
  if (!/^[\p{L}\p{N}\s\-,\.&'()]+$/u.test(nameWithoutEmojis)) {
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
  if (/^[0-9\.]+$/.test(domain) || // All numbers like 1.1
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
  
  // Remove formatting to count actual digits
  const digitsOnly = trimmedPhone.replace(/[\s\-\(\)\+\.]/g, '');
  
  // If only 1-3 digits (like just country code), don't show error yet
  if (digitsOnly.length < 4) {
    return null; // Wait for more input
  }
  
  // No emojis or letters
  if (EMOJI_REGEX.test(trimmedPhone)) {
    return 'Phone number cannot contain emojis';
  }
  
  // Allow only digits with formatting (spaces, dashes, parentheses)
  if (!/^\+?[\d\s\-\(\)\.]+$/.test(trimmedPhone)) {
    return 'Phone number can only contain numbers and formatting characters';
  }
  
  // Must be 7-15 digits (international standard) - but only after user has typed enough
  if (digitsOnly.length >= 4 && digitsOnly.length < 7) {
    return 'Please enter a complete phone number';
  }
  
  if (digitsOnly.length > 15) {
    return 'Phone number is too long';
  }
  
  // Only validate patterns if we have a reasonable length
  if (digitsOnly.length >= 7) {
    // Reject obvious fakes - same digits repeated
    if (/^(\d)\1+$/.test(digitsOnly)) {
      return 'Please enter a valid phone number';
    }
    
    // Reject sequential patterns (like professional platforms do)
    const isSequential = (str: string): boolean => {
      for (let i = 0; i < str.length - 2; i++) {
        const current = parseInt(str[i]);
        const next1 = parseInt(str[i + 1]);
        const next2 = parseInt(str[i + 2]);
        
        // Check for ascending sequence (123, 234, etc.)
        if (next1 === current + 1 && next2 === current + 2) {
          return true;
        }
        
        // Check for descending sequence (321, 210, etc.)
        if (next1 === current - 1 && next2 === current - 2) {
          return true;
        }
      }
      return false;
    };
    
    if (isSequential(digitsOnly)) {
      return 'Please enter a valid phone number';
    }
    
    // Block common test numbers
    const testNumbers = ['1234567890', '0123456789', '1111111111', '0000000000', '5555555555'];
    if (testNumbers.includes(digitsOnly)) {
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
        return 'Please enter a valid US ZIP code';
      }
      // Block obvious fake ZIP codes
      if (trimmedCode === '00000' || trimmedCode === '99999' || trimmedCode.startsWith('00000')) {
        return 'Please enter a valid US ZIP code';
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
  
  // No emojis
  if (EMOJI_REGEX.test(trimmedIndustry)) {
    return 'Industry cannot contain emojis';
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
  if (!/^[\p{L}\s\-'\.]+$/u.test(nameWithoutEmojis)) {
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
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

