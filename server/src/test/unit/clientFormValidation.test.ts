import { describe, it, expect } from 'vitest';
import {
  validateClientName,
  validateWebsiteUrl,
  validateEmailAddress,
  validatePhoneNumber,
  validatePostalCode,
  validateCityName,
  validateAddress,
  validateContactName,
  validateClientForm
} from '../../lib/utils/clientFormValidation';

describe('Client Form Validation', () => {
  describe('validateClientName', () => {
    it('should accept valid client names', () => {
      expect(validateClientName('Acme Corp')).toBeNull();
      expect(validateClientName('Microsoft Corporation')).toBeNull();
      expect(validateClientName('ABC-123 Industries')).toBeNull();
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