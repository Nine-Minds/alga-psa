import { describe, it, expect } from 'vitest';
import {
  validateCompanyName,
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
  describe('validateCompanyName', () => {
    it('should accept valid company names', () => {
      expect(validateCompanyName('Acme Corp')).toBeNull();
      expect(validateCompanyName('Microsoft Corporation')).toBeNull();
      expect(validateCompanyName('ABC-123 Industries')).toBeNull();
    });

    it('should reject invalid company names', () => {
      expect(validateCompanyName('')).toBe('Company name is required');
      expect(validateCompanyName('1')).toBe('Company name must be at least 2 characters long');
      expect(validateCompanyName('123')).toBe('Company name must contain letters and be meaningful');
      expect(validateCompanyName('!!!')).toBe('Company name must contain letters and be meaningful');
      expect(validateCompanyName('A')).toBe('Company name must be at least 2 characters long');
    });
  });

  describe('validateWebsiteUrl', () => {
    it('should accept valid URLs', () => {
      expect(validateWebsiteUrl('https://example.com')).toBeNull();
      expect(validateWebsiteUrl('http://test.org')).toBeNull();
      expect(validateWebsiteUrl('example.com')).toBeNull(); // Should add protocol
      expect(validateWebsiteUrl('')).toBeNull(); // Optional field
    });

    it('should reject invalid URLs', () => {
      expect(validateWebsiteUrl('1')).toBe('Please enter a valid website URL (e.g., https://example.com)');
      expect(validateWebsiteUrl('invalid')).toBe('Please enter a valid website URL with a domain extension');
    });
  });

  describe('validateEmailAddress', () => {
    it('should accept valid email addresses', () => {
      expect(validateEmailAddress('user@example.com')).toBeNull();
      expect(validateEmailAddress('test.email@company.org')).toBeNull();
      expect(validateEmailAddress('')).toBeNull(); // Optional field
    });

    it('should reject invalid email addresses', () => {
      expect(validateEmailAddress('😀@test.com')).toBe('Email address cannot contain emojis');
      expect(validateEmailAddress('invalid-email')).toBe('Please enter a valid email address');
      expect(validateEmailAddress('1@1.1')).toBe('Please enter a valid business email address');
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
      expect(validatePhoneNumber('123')).toBe('Please enter a valid phone number');
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
      expect(validatePostalCode('1234', 'US')).toBe('Please enter a valid US ZIP code (e.g., 12345 or 12345-6789)');
    });

    it('should validate Canadian postal codes', () => {
      expect(validatePostalCode('K1A 0A9', 'CA')).toBeNull();
      expect(validatePostalCode('12345', 'CA')).toBe('Please enter a valid Canadian postal code (e.g., A1B 2C3)');
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
      expect(validateCityName('1')).toBe('City name must be at least 2 characters long');
      expect(validateCityName('123')).toBe('City name must contain letters');
    });
  });

  describe('validateAddress', () => {
    it('should accept valid addresses', () => {
      expect(validateAddress('123 Main St')).toBeNull();
      expect(validateAddress('456 Oak Avenue')).toBeNull();
      expect(validateAddress('')).toBeNull(); // Optional field
    });

    it('should reject invalid addresses', () => {
      expect(validateAddress('😀123')).toBe('Address cannot contain emojis');
      expect(validateAddress('123')).toBe('Address must be at least 5 characters long');
      expect(validateAddress('Main Street')).toBe('Please enter a complete street address with number and name');
    });
  });

  describe('validateContactName', () => {
    it('should accept valid contact names', () => {
      expect(validateContactName('John Doe')).toBeNull();
      expect(validateContactName("Mary O'Connor")).toBeNull();
      expect(validateContactName('')).toBeNull(); // Optional field
    });

    it('should reject invalid contact names', () => {
      expect(validateContactName('😀')).toBe('Contact name cannot contain emojis');
      expect(validateContactName('1')).toBe('Contact name must be at least 2 characters long');
      expect(validateContactName('123')).toBe('Contact name must contain letters');
    });
  });

  describe('validateClientForm', () => {
    it('should validate a complete form successfully', () => {
      const result = validateClientForm({
        companyName: 'Acme Corp',
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
        companyName: '1', // Invalid
        websiteUrl: '1', // Invalid
        email: '😀@test.com', // Invalid
        phone: '123', // Invalid
        address: '123', // Invalid
        city: '😀', // Invalid
        postalCode: '😀', // Invalid
        countryCode: 'US',
        contactName: '😀', // Invalid
        contactEmail: 'invalid', // Invalid
        contactPhone: '123' // Invalid
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.companyName).toContain('2 characters');
      expect(result.errors.websiteUrl).toContain('valid website URL');
      expect(result.errors.email).toContain('emojis');
      expect(result.errors.phone).toContain('valid phone number');
      expect(result.errors.address).toContain('5 characters');
      expect(result.errors.city).toContain('emojis');
      expect(result.errors.postalCode).toContain('emojis');
      expect(result.errors.contactName).toContain('emojis');
      expect(result.errors.contactEmail).toContain('valid email');
      expect(result.errors.contactPhone).toContain('valid phone number');
    });

    it('should allow empty optional fields', () => {
      const result = validateClientForm({
        companyName: 'Acme Corp',
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