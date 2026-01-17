import { describe, it, expect } from 'vitest';
import { validateDomainName } from './asmDomainActions';

describe('ASM Domain Actions - validateDomainName', () => {
  describe('valid domain names', () => {
    it('should accept simple domain names', () => {
      expect(validateDomainName('example.com')).toBe(true);
      expect(validateDomainName('test.org')).toBe(true);
      expect(validateDomainName('company.net')).toBe(true);
    });

    it('should accept domain names with subdomains', () => {
      expect(validateDomainName('www.example.com')).toBe(true);
      expect(validateDomainName('sub.domain.example.com')).toBe(true);
      expect(validateDomainName('api.v2.example.io')).toBe(true);
    });

    it('should accept domain names with hyphens', () => {
      expect(validateDomainName('my-company.com')).toBe(true);
      expect(validateDomainName('test-site-123.org')).toBe(true);
      expect(validateDomainName('sub-domain.my-site.com')).toBe(true);
    });

    it('should accept domain names with country TLDs', () => {
      expect(validateDomainName('example.co.uk')).toBe(true);
      expect(validateDomainName('company.com.au')).toBe(true);
      expect(validateDomainName('site.co.jp')).toBe(true);
    });

    it('should accept domain names with new TLDs', () => {
      expect(validateDomainName('company.tech')).toBe(true);
      expect(validateDomainName('startup.io')).toBe(true);
      expect(validateDomainName('business.cloud')).toBe(true);
    });

    it('should accept domain names with numbers', () => {
      expect(validateDomainName('site123.com')).toBe(true);
      expect(validateDomainName('123test.org')).toBe(true);
      expect(validateDomainName('test456site.net')).toBe(true);
    });

    it('should normalize to lowercase', () => {
      // validateDomainName normalizes internally before checking
      expect(validateDomainName('EXAMPLE.COM')).toBe(true);
      expect(validateDomainName('Test.ORG')).toBe(true);
      expect(validateDomainName('MyCompany.NET')).toBe(true);
    });

    it('should handle leading/trailing whitespace', () => {
      expect(validateDomainName('  example.com  ')).toBe(true);
      expect(validateDomainName('\texample.com\t')).toBe(true);
    });
  });

  describe('invalid domain names', () => {
    it('should reject empty or null values', () => {
      expect(validateDomainName('')).toBe(false);
      expect(validateDomainName(null as any)).toBe(false);
      expect(validateDomainName(undefined as any)).toBe(false);
    });

    it('should reject domains that are too short', () => {
      expect(validateDomainName('a.b')).toBe(false);
      expect(validateDomainName('ab.c')).toBe(false);
    });

    it('should reject domains without TLD', () => {
      expect(validateDomainName('localhost')).toBe(false);
      expect(validateDomainName('myserver')).toBe(false);
    });

    it('should reject domains with invalid characters', () => {
      expect(validateDomainName('example_site.com')).toBe(false);
      expect(validateDomainName('site@domain.com')).toBe(false);
      expect(validateDomainName('site!.com')).toBe(false);
      expect(validateDomainName('example..com')).toBe(false);
    });

    it('should reject domains starting or ending with hyphen', () => {
      expect(validateDomainName('-example.com')).toBe(false);
      expect(validateDomainName('example-.com')).toBe(false);
    });

    it('should reject IP addresses', () => {
      expect(validateDomainName('192.168.1.1')).toBe(false);
      expect(validateDomainName('10.0.0.1')).toBe(false);
    });

    it('should reject URLs with protocols', () => {
      expect(validateDomainName('http://example.com')).toBe(false);
      expect(validateDomainName('https://example.com')).toBe(false);
    });

    it('should reject domains with paths', () => {
      expect(validateDomainName('example.com/path')).toBe(false);
      expect(validateDomainName('example.com?query=1')).toBe(false);
    });

    it('should reject domains that are too long', () => {
      const longLabel = 'a'.repeat(64); // Max label length is 63
      expect(validateDomainName(`${longLabel}.com`)).toBe(false);
    });

    it('should reject numeric TLDs', () => {
      expect(validateDomainName('example.123')).toBe(false);
    });

    it('should reject single character TLDs', () => {
      expect(validateDomainName('example.c')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle maximum valid domain length (253 chars)', () => {
      // Build a valid domain close to max length
      const labels: string[] = [];
      for (let i = 0; i < 4; i++) {
        labels.push('a'.repeat(63));
      }
      // This will be way over 253 chars, so it should fail
      expect(validateDomainName(labels.join('.') + '.com')).toBe(false);
    });

    it('should accept single label with valid TLD', () => {
      expect(validateDomainName('test.io')).toBe(true);
      expect(validateDomainName('x.co')).toBe(true);
    });

    it('should handle international TLDs (ASCII)', () => {
      // Note: This regex doesn't support punycode/IDN domains
      expect(validateDomainName('example.de')).toBe(true);
      expect(validateDomainName('example.fr')).toBe(true);
      expect(validateDomainName('example.cn')).toBe(true);
    });
  });
});

describe('ASM Domain Actions - normalization', () => {
  it('should normalize domain names to lowercase', () => {
    // The validation function normalizes internally
    expect(validateDomainName('EXAMPLE.COM')).toBe(true);
    expect(validateDomainName('Example.Com')).toBe(true);
  });

  it('should trim whitespace before validation', () => {
    expect(validateDomainName('   example.com   ')).toBe(true);
    expect(validateDomainName('\nexample.com\r')).toBe(true);
  });
});
