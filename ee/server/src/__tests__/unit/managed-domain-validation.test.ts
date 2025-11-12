/**
 * Unit tests for managed email domain validation
 *
 * This test verifies that domain validation correctly accepts valid domains
 * and rejects invalid ones according to RFC standards.
 */

import { describe, expect, it } from 'vitest';
import { isValidDomain } from '@/lib/email-domains/domainValidation';

describe('Managed Email Domain Validation Tests', () => {
  describe('Valid domains that should be accepted', () => {
    const validDomains = [
      'example.com',
      'mail.example.com',
      'my-company.example.com',
      'mail.corp.example.com',
      '123.example.com', // numeric subdomain is valid
    ];

    validDomains.forEach((domain) => {
      it(`should accept valid domain: ${domain}`, () => {
        expect(isValidDomain(domain)).toBe(true);
      });
    });
  });

  describe('Invalid domains that must be rejected', () => {
    it('should reject single-label domains (no TLD)', () => {
      expect(isValidDomain('localhost')).toBe(false);
    });

    it('should reject domains with consecutive hyphens', () => {
      expect(isValidDomain('ex--ample.com')).toBe(false);
    });

    it('should reject numeric-only TLDs', () => {
      expect(isValidDomain('example.123')).toBe(false);
    });
  });

  describe('Invalid domains that ARE correctly rejected', () => {
    const invalidDomains = [
      '',
      ' ',
      'example..com',
      '.example.com',
      'example.com.',
      '-example.com',
      'example-.com',
      'my domain.com',
      'exa!mple.com',
      'user@example.com',
      'https://example.com',
      'example.com/path',
      'example.com:8080',
      'café.com', // IDN not in punycode
    ];

    invalidDomains.forEach((domain) => {
      it(`should reject invalid domain: "${domain}"`, () => {
        expect(isValidDomain(domain)).toBe(false);
      });
    });
  });

  describe('Edge cases and length validation', () => {
    it('should reject domains longer than 253 characters', () => {
      const longDomain = 'a'.repeat(242) + '.example.com'; // 242 + 12 = 254 chars
      expect(longDomain.length).toBeGreaterThan(253);
      expect(isValidDomain(longDomain)).toBe(false);
    });

    it('should reject domains with labels longer than 63 characters', () => {
      const longLabel = 'a'.repeat(64);
      const domain = `${longLabel}.example.com`;
      expect(isValidDomain(domain)).toBe(false);
    });

    it('should reject IP addresses', () => {
      expect(isValidDomain('192.168.1.1')).toBe(false);
    });

    it('should reject domains with underscores', () => {
      expect(isValidDomain('my_domain.com')).toBe(false);
    });
  });
});
