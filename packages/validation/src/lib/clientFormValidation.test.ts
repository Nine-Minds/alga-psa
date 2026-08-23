import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { translateFieldValidation, type FieldValidation } from './fieldValidation';
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
  validateClientForm,
  validateClientNameField,
  validateContactNameField,
  validateEmailAddressField,
  validatePhoneNumberField,
  validateWebsiteUrlField,
  validateAddressField,
  validateAnnualRevenueField,
  validateCityNameField,
  validateCompanySizeField,
  validateIndustryField,
  validateNotesField,
  validatePostalCodeField,
  validateRoleField,
  validateStateProvinceField
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

    it('accepts real companies whose name is a domain', () => {
      // Previously rejected outright, which made these clients uncreatable.
      expect(validateClientName('Hotels.com')).toBeNull();
      expect(validateClientName('Booking.com')).toBeNull();
      expect(validateClientName('Care.com')).toBeNull();
      expect(validateClientName('Bath & Body Works.net')).toBeNull();
    });

    it('warns about a pasted web address instead of blocking it', () => {
      for (const name of ['https://acme.com', 'http://acme.com', 'www.acme.com']) {
        expect(validateClientName(name)).toBeNull();
        expect(validateClientNameField(name).warnings).toContain(
          'This looks like a web address rather than a name.'
        );
      }
    });

    it('warns about a bare business abbreviation instead of blocking it', () => {
      expect(validateClientNameField('Co').warnings).toEqual([]);
      for (const name of ['LLC', 'Corporation']) {
        expect(validateClientName(name)).toBeNull();
        expect(validateClientNameField(name).warnings).toContain(
          'This is only a business abbreviation, not a name.'
        );
      }
    });

    it('no longer polices the character set', () => {
      // The allowlist was a false-rejection generator: real names carry $, ~ and ^.
      expect(validateClientName('Bad$Name')).toBeNull();
      expect(validateClientName('Name~With^Tilde')).toBeNull();
      expect(validateClientNameField('Bad$Name').warnings).toEqual([]);
    });

    it('blocks only structurally invalid client names', () => {
      expect(validateClientName('')).toBe('Client name is required');
      expect(validateClientName('   ')).toBe('Client name is required');
      expect(validateClientName('A'.repeat(256))).toBe('Client name must be 255 characters or less');
      expect(validateClientName('A'.repeat(255))).toBeNull();
      // Short and symbol-only names now warn rather than block.
      expect(validateClientName('1')).toBeNull();
      expect(validateClientName('A')).toBeNull();
      expect(validateClientName('123')).toBeNull();
      expect(validateClientName('!!!')).toBeNull();
      expect(validateClientNameField('!!!').warnings).toContain(
        'This name has no letters or numbers in it.'
      );
      expect(validateClientNameField('A').warnings).toContain(
        'This name is a single character — is that right?'
      );
    });

    it('normalizes by trimming', () => {
      expect(validateClientNameField('  Acme Corp  ').value).toBe('Acme Corp');
    });
  });

  describe('validateWebsiteUrl', () => {
    it('should accept valid URLs', () => {
      expect(validateWebsiteUrl('https://acme-corp.com')).toBeNull();
      expect(validateWebsiteUrl('http://test.org')).toBeNull();
      expect(validateWebsiteUrl('acme-corp.com')).toBeNull(); // Should add protocol
      expect(validateWebsiteUrl('')).toBeNull(); // Optional field
    });

    it('blocks only URLs that do not parse', () => {
      expect(validateWebsiteUrl('invalid')).toBe('Please enter a valid website URL (e.g., apple.com)');
      expect(validateWebsiteUrl(`https://acme.com/${'a'.repeat(256)}`)).toBe(
        'Website URL must be 255 characters or less'
      );
      // 'https://1' normalizes to the IP host 0.0.0.1 — an opinion, not a parse failure.
      expect(validateWebsiteUrl('1')).toBeNull();
      expect(validateWebsiteUrlField('1').warnings).toContain(
        'This is an IP address rather than a domain name.'
      );
      expect(validateWebsiteUrl('https://example.com')).toBeNull();
    });

    it('normalizes a bare host to https', () => {
      expect(validateWebsiteUrlField('acme-corp.com').value).toBe('https://acme-corp.com');
      expect(validateWebsiteUrlField('http://acme-corp.com').value).toBe('http://acme-corp.com');
    });

    it('accepts real domains that begin with a private-IP prefix', () => {
      // These were rejected as "internal" because the host was matched by string
      // prefix (10. / 172. / 192.168.) rather than as an IP literal.
      expect(validateWebsiteUrl('https://10.com')).toBeNull();
      expect(validateWebsiteUrl('https://172.com')).toBeNull();
      expect(validateWebsiteUrl('https://10minutes.io')).toBeNull();
    });

    it('accepts registered domains that merely look like placeholders', () => {
      // sample.com, demo.com, fake.com and invalid.com all belong to real businesses.
      for (const host of ['sample.com', 'demo.com', 'fake.com', 'invalid.com']) {
        expect(validateWebsiteUrl(`https://${host}`)).toBeNull();
      }
    });

    it('warns about RFC-reserved documentation domains and TLDs', () => {
      for (const host of ['example.com', 'example.net', 'example.org', 'anything.test', 'foo.invalid']) {
        expect(validateWebsiteUrl(`https://${host}`)).toBeNull();
        expect(validateWebsiteUrlField(`https://${host}`).warnings).toContain(
          `${host} is reserved for documentation and testing.`
        );
      }
    });

    it('warns about internal-only hostnames', () => {
      for (const host of ['printer.local', 'wiki.internal', 'nas.lan']) {
        expect(validateWebsiteUrl(`https://${host}`)).toBeNull();
        expect(validateWebsiteUrlField(`https://${host}`).warnings).toContain(
          `${host} only resolves inside a private network.`
        );
      }
    });
  });

  describe('validateEmailAddress', () => {
    it('should accept valid email addresses', () => {
      expect(validateEmailAddress('user@acme-corp.com')).toBeNull();
      expect(validateEmailAddress('test.email@client.org')).toBeNull();
    });

    it('blocks only email addresses that do not parse', () => {
      expect(validateEmailAddress('')).toBe('Email address is required');
      expect(validateEmailAddress('😀@test.com')).toBe('Please enter a valid email address');
      expect(validateEmailAddress('invalid-email')).toBe('Please enter a valid email address');
      expect(validateEmailAddress('1@1.1')).toBe('Please enter a valid email address');
      // Reserved and disposable domains parse fine — they are opinions, not errors.
      expect(validateEmailAddress('user@example.com')).toBeNull();
      expect(validateEmailAddress('ops@sample.com')).toBeNull();
      expect(validateEmailAddress('ops@demo.com')).toBeNull();
    });

    it('warns about reserved, internal and disposable domains', () => {
      expect(validateEmailAddressField('user@example.com').warnings).toContain(
        'example.com is reserved for documentation and testing.'
      );
      expect(validateEmailAddressField('user@mailinator.com').warnings).toContain(
        'mailinator.com is a disposable mailbox provider.'
      );
      expect(validateEmailAddressField('user@box.local').warnings).toContain(
        'box.local only resolves inside a private network.'
      );
      expect(validateEmailAddressField('ops@sample.com').warnings).toEqual([]);
    });

    it('normalizes to trimmed lowercase', () => {
      expect(validateEmailAddressField('  User@Acme-Corp.COM ').value).toBe('user@acme-corp.com');
    });
  });

  describe('validatePhoneNumber', () => {
    it('accepts ordinary numbers that the old test-number list rejected', () => {
      expect(validatePhoneNumber('+1 555 234 5678')).toBeNull();
    });

    it('warns about the NANP range reserved for fiction (555-01xx) without blocking', () => {
      expect(validatePhoneNumber('+1 212 555 0123')).toBeNull();
      expect(validatePhoneNumberField('+1 212 555 0123').warnings).toContain(
        'This is in the 555-0100 range reserved for fiction.'
      );
    });

    it('should accept valid phone numbers', () => {
      expect(validatePhoneNumber('+1-555-123-4567')).toBeNull();
      expect(validatePhoneNumber('(555) 123-4567')).toBeNull();
      expect(validatePhoneNumber('')).toBeNull(); // Optional field
    });

    it('blocks only numbers libphonenumber cannot parse', () => {
      expect(validatePhoneNumber('😀123456')).toBe('Please enter a valid phone number');
      expect(validatePhoneNumber('+1 555')).toBe('Please enter a valid phone number');
      // Repeated digits parse fine; the opinion is a warning.
      expect(validatePhoneNumber('+1 111 111 1111')).toBeNull();
      expect(validatePhoneNumberField('+1 111 111 1111').warnings).toContain(
        'This number is the same digit repeated.'
      );
    });

    it('does not show plausibility warnings alongside a structural error', () => {
      const result = validatePhoneNumberField('+111111111111111');

      expect(result.error).toBe('Please enter a valid phone number');
      expect(result.warnings).toEqual([]);
    });

    it('normalizes to E.164 and splits a packed extension', () => {
      const result = validatePhoneNumberField('+1 (555) 234-5678 ext. 42');
      expect(result.value).toBe('+15552345678');
      expect(result.error).toBeNull();
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

    it('no longer blocks on name shape', () => {
      expect(validateContactName('😀')).toBeNull();
      expect(validateContactName('1')).toBeNull();
      expect(validateContactName('123')).toBeNull();
      expect(validateContactName('A'.repeat(256))).toBe('Contact name must be 255 characters or less');
    });

    it('warns about placeholder names', () => {
      expect(validateContactName('Test')).toBeNull();
      expect(validateContactNameField('Test').warnings).toContain(
        'This looks like a placeholder rather than a person.'
      );
      expect(validateContactNameField('John Doe').warnings).toEqual([]);
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
        clientName: '', // Invalid — required
        websiteUrl: 'not a url', // Invalid — does not parse
        email: '😀@test.com', // Invalid — does not parse
        phone: '+1 555', // Invalid — not a possible number
        address: '123', // Invalid (no letters)
        city: '😀', // Invalid
        postalCode: '😀', // Invalid
        countryCode: 'US',
        contactName: '😀', // Structurally fine
        contactEmail: 'invalid', // Invalid
        contactPhone: '+44 1' // Invalid — not a possible number
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.client_name).toContain('required');
      expect(result.errors.url).toContain('valid website URL');
      expect(result.errors.location_email).toContain('valid email');
      expect(result.errors.location_phone).toContain('valid phone number');
      expect(result.errors.address_line1).toContain('letters');
      expect(result.errors.city).toContain('emojis');
      expect(result.errors.postal_code).toContain('emojis');
      expect(result.errors.contact_name).toBeUndefined();
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

// The address/city/state/postal/industry/role/notes/size/revenue validators were
// the last ones still returning bare English. Each now carries a key, and every
// key has to exist in all nine shipped locales — a typo here fails silently in
// production, falling back to the English default nobody notices.
describe('carried validation keys', () => {
  const localesDir = path.resolve(__dirname, '../../../../server/public/locales');
  const locales = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'xx', 'yy'];

  const lookup = (locale: string, key: string): unknown =>
    key
      .split('.')
      .reduce<any>(
        (node, part) => (node && typeof node === 'object' ? node[part] : undefined),
        JSON.parse(fs.readFileSync(path.join(localesDir, locale, 'common.json'), 'utf8'))
      );

  const cases: Array<[string, FieldValidation]> = [
    ['address.tooLong', validateAddressField('a'.repeat(101))],
    ['address.emoji', validateAddressField('1 Main St 🚀')],
    ['address.noLetters', validateAddressField('123')],
    ['address.invalidCharacters', validateAddressField('1 Main St ~')],
    ['city.tooLong', validateCityNameField('a'.repeat(101))],
    ['city.emoji', validateCityNameField('Springfield 🚀')],
    ['city.noLetters', validateCityNameField('123')],
    ['city.invalidCharacters', validateCityNameField('Spring1field')],
    ['stateProvince.tooLong', validateStateProvinceField('a'.repeat(101))],
    ['stateProvince.emoji', validateStateProvinceField('Ohio 🚀')],
    ['stateProvince.noLetters', validateStateProvinceField('12')],
    ['stateProvince.invalidCharacters', validateStateProvinceField('Ohio1')],
    ['postalCode.emoji', validatePostalCodeField('12345 🚀')],
    ['postalCode.us', validatePostalCodeField('123', 'US')],
    ['postalCode.usShort', validatePostalCodeField('00000', 'US')],
    ['postalCode.ca', validatePostalCodeField('123', 'CA')],
    ['postalCode.gb', validatePostalCodeField('123', 'GB')],
    ['postalCode.de', validatePostalCodeField('123', 'DE')],
    ['postalCode.fr', validatePostalCodeField('123', 'FR')],
    ['postalCode.jp', validatePostalCodeField('123', 'JP')],
    ['postalCode.au', validatePostalCodeField('123', 'AU')],
    ['postalCode.nl', validatePostalCodeField('123', 'NL')],
    ['postalCode.ch', validatePostalCodeField('123', 'CH')],
    ['postalCode.it', validatePostalCodeField('123', 'IT')],
    ['postalCode.es', validatePostalCodeField('123', 'ES')],
    ['postalCode.br', validatePostalCodeField('123', 'BR')],
    ['postalCode.in', validatePostalCodeField('123', 'IN')],
    ['postalCode.generic', validatePostalCodeField('!!', 'ZZ')],
    ['industry.tooLong', validateIndustryField('a'.repeat(101))],
    ['industry.tooShortText', validateIndustryField('🚀')],
    ['industry.tooShort', validateIndustryField('a')],
    ['industry.noLetters', validateIndustryField('12')],
    ['industry.invalidCharacters', validateIndustryField('Retail1')],
    ['role.tooLong', validateRoleField('a'.repeat(101))],
    ['role.noAlphanumeric', validateRoleField('---')],
    ['notes.tooLong', validateNotesField('a'.repeat(2001))],
    ['companySize.tooLong', validateCompanySizeField('5'.repeat(51))],
    ['companySize.emoji', validateCompanySizeField('🚀')],
    ['companySize.invalid', validateCompanySizeField('asdfghjkl')],
    ['annualRevenue.tooLong', validateAnnualRevenueField('5'.repeat(51))],
    ['annualRevenue.emoji', validateAnnualRevenueField('🤑')],
    ['annualRevenue.invalid', validateAnnualRevenueField('lots of money')],
  ];

  it.each(cases)('%s is produced as a key, not prose', (suffix, result) => {
    expect(result.errorMessage?.key).toBe(`clients.validation.${suffix}`);
  });

  it.each(locales)('%s translates every carried key', (locale) => {
    const missing = cases
      .map(([suffix]) => `clients.validation.${suffix}`)
      .filter((key) => typeof lookup(locale, key) !== 'string');
    expect(missing).toEqual([]);
  });

  it('translates through the injected translator instead of the English default', () => {
    const t = (key: string) => `[${key}]`;
    expect(translateFieldValidation(validateAddressField('1 Main St ~'), t).error).toBe(
      '[clients.validation.address.invalidCharacters]'
    );
    // validateClientForm is the submit path: it must resolve the same messages
    // the blur path does, rather than falling back to English.
    expect(validateClientForm({ clientName: 'Acme Corp', city: '123' }, t).errors.city).toBe(
      '[clients.validation.city.noLetters]'
    );
  });
});
