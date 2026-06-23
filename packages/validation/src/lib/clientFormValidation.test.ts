import { describe, it, expect } from 'vitest';
import {
  validateClientName,
  validateWebsiteUrl,
  validateEmailAddress,
  validatePhoneNumber,
  validatePostalCode,
  validateCityName,
  validateAddress,
  validateStateProvince,
  validateIndustry,
  validateRole,
  validateNotes,
  validateCompanySize,
  validateAnnualRevenue,
  validateContactName,
  validateClientForm
} from './clientFormValidation';

describe('Client Form Validation', () => {
  describe('validateClientName', () => {
    it('should accept valid client names', () => {
      expect(validateClientName('Acme Corp')).toBeNull();
      expect(validateClientName('Microsoft Corporation')).toBeNull();
      expect(validateClientName('ABC-123 Industries')).toBeNull();
    });

    it('accepts names containing a comma', () => {
      // Comma has always been allowed; this guards against regressions.
      expect(validateClientName('Smith, Jones & Co')).toBeNull();
      expect(validateClientName('Acme, Inc')).toBeNull();
    });

    it('accepts business-appropriate symbols (regression for + and friends)', () => {
      expect(validateClientName('C++ Solutions')).toBeNull();
      expect(validateClientName('AT&T + Co')).toBeNull();
      expect(validateClientName('Smith, Jones + Co')).toBeNull();
      expect(validateClientName('Yahoo!')).toBeNull();
      expect(validateClientName('#1 Plumbing')).toBeNull();
      expect(validateClientName('Owner/Operator Services')).toBeNull();
      expect(validateClientName('Mail@Home')).toBeNull();
    });

    it('still rejects genuinely unsupported characters', () => {
      expect(validateClientName('Bad$Name')).toBe('Client name contains invalid characters');
      expect(validateClientName('Name~With^Tilde')).toBe('Client name contains invalid characters');
    });

    it('should reject invalid client names', () => {
      expect(validateClientName('')).toBe('Client name is required');
      expect(validateClientName('1')).toBe('Client name must be at least 2 characters long');
      // Numeric-only names are allowed (e.g. "123" could be a brand); symbol-only names are not
      expect(validateClientName('123')).toBeNull();
      expect(validateClientName('!!!')).toBe('Client name must contain at least one letter or number');
      expect(validateClientName('A')).toBe('Client name must be at least 2 characters long');
    });
  });

  describe('validateWebsiteUrl', () => {
    it('should accept valid URLs', () => {
      expect(validateWebsiteUrl('https://acme-corp.com')).toBeNull();
      expect(validateWebsiteUrl('http://test.org')).toBeNull();
      expect(validateWebsiteUrl('acme-corp.com')).toBeNull(); // Should add protocol
      expect(validateWebsiteUrl('')).toBeNull(); // Optional field
    });

    it('should reject invalid URLs', () => {
      // 'https://1' normalizes to the IP host 0.0.0.1, which is rejected
      expect(validateWebsiteUrl('1')).toBe('Please enter a domain name, not an IP address');
      expect(validateWebsiteUrl('invalid')).toBe('Please enter a valid website URL with a domain extension');
      // Well-known fake/test domains are blocked
      expect(validateWebsiteUrl('https://example.com')).toBe('Please enter a real business website URL');
    });
  });

  describe('validateEmailAddress', () => {
    it('should accept valid email addresses', () => {
      expect(validateEmailAddress('user@acme-corp.com')).toBeNull();
      expect(validateEmailAddress('test.email@client.org')).toBeNull();
    });

    it('should reject invalid email addresses', () => {
      expect(validateEmailAddress('')).toBe('Email address is required');
      expect(validateEmailAddress('😀@test.com')).toBe('Email address cannot contain emojis');
      expect(validateEmailAddress('invalid-email')).toBe('Please enter a valid email address');
      expect(validateEmailAddress('1@1.1')).toBe('Please enter a valid email address');
      // Fake/test domains are blocked for business emails
      expect(validateEmailAddress('user@example.com')).toBe('Please enter a valid business email address');
    });
  });

  describe('validatePhoneNumber', () => {
    it('should accept valid phone numbers', () => {
      expect(validatePhoneNumber('+1-555-123-4567')).toBeNull();
      expect(validatePhoneNumber('(555) 123-4567')).toBeNull();
      expect(validatePhoneNumber('')).toBeNull(); // Optional field
    });

    it('should reject invalid phone numbers', () => {
      expect(validatePhoneNumber('😀123456')).toBe('Phone number cannot contain emojis');
      // Inputs shorter than 4 digits are not flagged yet (user may still be typing)
      expect(validatePhoneNumber('123')).toBeNull();
      expect(validatePhoneNumber('12345')).toBe('Please enter a complete phone number');
      expect(validatePhoneNumber('1111111111')).toBe('Please enter a valid phone number');
    });
  });

  describe('validatePostalCode', () => {
    it('should accept valid US ZIP codes', () => {
      expect(validatePostalCode('12345', 'US')).toBeNull();
      expect(validatePostalCode('12345-6789', 'US')).toBeNull();
      expect(validatePostalCode('')).toBeNull(); // Optional field
    });

    it('should reject invalid US ZIP codes', () => {
      expect(validatePostalCode('😀12345', 'US')).toBe('Postal code cannot contain emojis');
      expect(validatePostalCode('1234', 'US')).toBe('Please enter a valid ZIP code (e.g., 12345 or 12345-6789)');
    });

    it('should validate Canadian postal codes', () => {
      expect(validatePostalCode('K1A 0A9', 'CA')).toBeNull();
      expect(validatePostalCode('12345', 'CA')).toBe('Please enter a valid Canadian postal code (e.g., K1A 0A6)');
    });
  });

  describe('validateCityName', () => {
    it('should accept valid city names', () => {
      expect(validateCityName('New York')).toBeNull();
      expect(validateCityName("O'Connor")).toBeNull();
      expect(validateCityName('San Francisco')).toBeNull();
      expect(validateCityName('')).toBeNull(); // Optional field
    });

    it('should reject invalid city names', () => {
      expect(validateCityName('😀')).toBe('City name cannot contain emojis');
      expect(validateCityName('1')).toBe('City name must contain letters');
      expect(validateCityName('123')).toBe('City name must contain letters');
    });
  });

  describe('validateAddress', () => {
    it('should accept valid addresses', () => {
      expect(validateAddress('123 Main St')).toBeNull();
      expect(validateAddress('456 Oak Avenue')).toBeNull();
      // International addresses do not need to include a number
      expect(validateAddress('Main Street')).toBeNull();
      expect(validateAddress('')).toBeNull(); // Optional field
    });

    it('should reject invalid addresses', () => {
      expect(validateAddress('😀123')).toBe('Address cannot contain emojis');
      expect(validateAddress('123')).toBe('Address must contain letters');
      expect(validateAddress('!!!')).toBe('Address must contain letters');
    });
  });

  describe('validateContactName', () => {
    it('should accept valid contact names', () => {
      expect(validateContactName('John Doe')).toBeNull();
      expect(validateContactName("Mary O'Connor")).toBeNull();
      expect(validateContactName('Smoke Contact 2026-05-06-001')).toBeNull();
      expect(validateContactName('')).toBeNull(); // Optional field
    });

    it('should reject invalid contact names', () => {
      expect(validateContactName('😀')).toBe('Contact name must contain meaningful characters');
      expect(validateContactName('1')).toBe('Contact name must contain letters');
      expect(validateContactName('123')).toBe('Contact name must contain letters');
    });
  });

  describe('validateClientForm', () => {
    it('should validate a complete form successfully', () => {
      const result = validateClientForm({
        clientName: 'Acme Corp',
        websiteUrl: 'https://acme.com',
        email: 'info@acme.com',
        phone: '+1-555-123-4567',
        address: '123 Main St',
        city: 'New York',
        postalCode: '10001',
        countryCode: 'US',
        contactName: 'John Doe',
        contactEmail: 'john@acme.com',
        contactPhone: '+1-555-987-6543'
      });

      expect(result.isValid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });

    it('should return errors for invalid form data', () => {
      const result = validateClientForm({
        clientName: '1', // Invalid
        websiteUrl: '1', // Invalid (parses as IP host)
        email: '😀@test.com', // Invalid
        phone: '1111111111', // Invalid (repeated digits)
        address: '123', // Invalid (no letters)
        city: '😀', // Invalid
        postalCode: '😀', // Invalid
        countryCode: 'US',
        contactName: '😀', // Invalid
        contactEmail: 'invalid', // Invalid
        contactPhone: '2222222222' // Invalid (repeated digits)
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.client_name).toContain('2 characters');
      expect(result.errors.url).toContain('domain name, not an IP address');
      expect(result.errors.location_email).toContain('emojis');
      expect(result.errors.location_phone).toContain('valid phone number');
      expect(result.errors.address_line1).toContain('letters');
      expect(result.errors.city).toContain('emojis');
      expect(result.errors.postal_code).toContain('emojis');
      expect(result.errors.contact_name).toContain('meaningful characters');
      expect(result.errors.contact_email).toContain('valid email');
      expect(result.errors.contact_phone).toContain('valid phone number');
    });

    it('should allow empty optional fields', () => {
      const result = validateClientForm({
        clientName: 'Acme Corp',
        websiteUrl: '',
        email: '',
        phone: '',
        address: '',
        city: '',
        postalCode: '',
        countryCode: 'US',
        contactName: '',
        contactEmail: '',
        contactPhone: ''
      });

      expect(result.isValid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Comprehensive per-validator coverage (bug hunt)
// ---------------------------------------------------------------------------

describe('validatePostalCode - international formats', () => {
  // Real, verifiable postal codes for every supported country.
  const VALID: Array<[string, string]> = [
    ['US', '12345'],
    ['US', '90210'],
    ['US', '02134'],
    ['US', '12345-6789'],
    ['CA', 'K1A 0A6'],
    ['CA', 'K1A0A6'],
    ['CA', 'M5V 3L9'],
    ['GB', 'M1 1AE'],       // A9  + inward
    ['GB', 'B33 8TH'],      // A99
    ['GB', 'W1A 0AX'],      // A9A
    ['GB', 'CR2 6XH'],      // AA9
    ['GB', 'DN55 1PT'],     // AA99
    ['GB', 'SW1A 2AA'],     // AA9A  <-- regression: was rejected
    ['GB', 'SW1A 1AA'],     // AA9A  (the validator's own example!)
    ['GB', 'EC1A 1BB'],     // AA9A
    ['GB', 'GIR 0AA'],      // special case
    ['UK', 'SW1A 2AA'],     // UK alias of GB
    ['DE', '10115'],
    ['FR', '75008'],
    ['JP', '100-0001'],
    ['AU', '2000'],
    ['NL', '1012 AB'],
    ['NL', '1012AB'],
    ['CH', '8001'],
    ['IT', '00184'],
    ['ES', '28013'],
    ['BR', '01310-100'],
    ['IN', '110001'],
    ['MX', '01000'],        // unsupported country -> generic fallback
  ];

  it.each(VALID)('accepts %s postal code "%s"', (country, code) => {
    expect(validatePostalCode(code, country)).toBeNull();
  });

  const INVALID: Array<[string, string]> = [
    ['US', '1234'],
    ['US', '123456'],
    ['US', 'ABCDE'],
    ['CA', '12345'],
    ['GB', 'GIBBERISH'],
    ['GB', '12345'],
    ['DE', '1234'],
    ['DE', 'ABCDE'],
    ['AU', '20000'],
    ['IN', '11000'],
  ];

  it.each(INVALID)('rejects invalid %s postal code "%s"', (country, code) => {
    expect(validatePostalCode(code, country)).not.toBeNull();
  });

  it('treats the postal code as optional', () => {
    expect(validatePostalCode('', 'GB')).toBeNull();
    expect(validatePostalCode('   ', 'GB')).toBeNull();
  });

  it('rejects emojis regardless of country', () => {
    expect(validatePostalCode('😀12345', 'US')).toBe('Postal code cannot contain emojis');
  });

  // Each country's user-facing error message advertises an example postal code.
  // That advertised example MUST itself pass validation.
  const ERROR_EXAMPLES: Array<[string, string]> = [
    ['US', '12345'],
    ['US', '12345-6789'],
    ['CA', 'K1A 0A6'],
    ['GB', 'SW1A 1AA'],
    ['DE', '10115'],
    ['FR', '75001'],
    ['JP', '123-4567'],
    ['AU', '2000'],
    ['NL', '1234AB'],
    ['CH', '8001'],
    ['IT', '00118'],
    ['ES', '28001'],
    ['BR', '01234-567'],
    ['IN', '110001'],
  ];

  it.each(ERROR_EXAMPLES)('the %s error-message example "%s" is itself valid', (country, code) => {
    expect(validatePostalCode(code, country)).toBeNull();
  });
});

describe('validateStateProvince', () => {
  it('accepts valid states/provinces', () => {
    expect(validateStateProvince('California')).toBeNull();
    expect(validateStateProvince('Île-de-France')).toBeNull();
    expect(validateStateProvince('NSW')).toBeNull();
    expect(validateStateProvince('')).toBeNull(); // optional
  });

  it('rejects invalid states/provinces', () => {
    expect(validateStateProvince('😀')).toBe('State/Province cannot contain emojis');
    expect(validateStateProvince('12345')).toBe('State/Province must contain letters');
    expect(validateStateProvince('a'.repeat(101))).toBe('State/Province must be 100 characters or less');
  });
});

describe('validateIndustry', () => {
  it('accepts valid industries', () => {
    expect(validateIndustry('Information Technology')).toBeNull();
    expect(validateIndustry('Oil & Gas')).toBeNull();
    expect(validateIndustry('Retail/Wholesale')).toBeNull();
    expect(validateIndustry('')).toBeNull(); // optional
  });

  it('rejects invalid industries', () => {
    expect(validateIndustry('A')).toBe('Industry must be at least 2 characters long');
    expect(validateIndustry('12345')).toBe('Industry must contain letters');
    expect(validateIndustry('a'.repeat(101))).toBe('Industry must be 100 characters or less');
  });
});

describe('validateRole', () => {
  it('accepts valid roles', () => {
    expect(validateRole('Manager')).toBeNull();
    expect(validateRole('CEO')).toBeNull();
    expect(validateRole('Level 2 Technician')).toBeNull();
    expect(validateRole('')).toBeNull(); // optional
  });

  it('rejects invalid roles', () => {
    expect(validateRole('   ')).toBeNull(); // only-spaces collapses to optional/empty
    expect(validateRole('!!!')).toBe('Role must contain letters or numbers');
    expect(validateRole('a'.repeat(101))).toBe('Role must be 100 characters or less');
  });
});

describe('validateNotes', () => {
  it('accepts notes including emojis', () => {
    expect(validateNotes('Met at the conference 🎉, follow up next week.')).toBeNull();
    expect(validateNotes('')).toBeNull(); // optional
  });

  it('rejects overly long notes', () => {
    expect(validateNotes('a'.repeat(2001))).toBe('Notes must be 2000 characters or less');
  });
});

describe('validateCompanySize', () => {
  it('accepts the formats advertised in its own error message', () => {
    expect(validateCompanySize('50')).toBeNull();
    expect(validateCompanySize('10-50')).toBeNull();
    expect(validateCompanySize('five hundred')).toBeNull();
    expect(validateCompanySize('2.5M')).toBeNull();
    expect(validateCompanySize('small')).toBeNull();
    expect(validateCompanySize('enterprise')).toBeNull();
    expect(validateCompanySize('')).toBeNull(); // optional
  });

  it('rejects gibberish and emojis', () => {
    expect(validateCompanySize('asdfghjkl')).not.toBeNull();
    expect(validateCompanySize('🚀')).toBe('Company size cannot contain emojis');
  });
});

describe('validateAnnualRevenue', () => {
  it('accepts the formats advertised in its own error message', () => {
    expect(validateAnnualRevenue('$1,000,000')).toBeNull();
    expect(validateAnnualRevenue('five million')).toBeNull();
    expect(validateAnnualRevenue('2.5M')).toBeNull();
    expect(validateAnnualRevenue('10M-50M')).toBeNull();
    expect(validateAnnualRevenue('not disclosed')).toBeNull();
    expect(validateAnnualRevenue('')).toBeNull(); // optional
  });

  it('accepts the predefined SaaS revenue bands', () => {
    expect(validateAnnualRevenue('1M-10M')).toBeNull();
    expect(validateAnnualRevenue('10M-100M')).toBeNull();
    expect(validateAnnualRevenue('100M-1B')).toBeNull();
  });

  it('rejects gibberish and emojis', () => {
    expect(validateAnnualRevenue('lots of money')).not.toBeNull();
    expect(validateAnnualRevenue('🤑')).toBe('Annual revenue cannot contain emojis');
  });
});
