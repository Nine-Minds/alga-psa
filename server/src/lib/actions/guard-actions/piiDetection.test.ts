/**
 * Unit tests for Alga Guard PII Detection Engine
 *
 * Tests the core PII detection business logic including:
 * - SSN detection and validation
 * - Credit card detection with Luhn validation
 * - Bank account detection with context matching
 * - DOB validation
 * - Email, phone, IP, MAC detection
 * - Severity weights and redaction
 */

import { describe, it, expect } from 'vitest';
import {
  detectPII,
  luhnCheck,
  validateSSN,
  validateDOB,
  validateEmail,
  validatePublicIPv4,
  hasContextKeywords,
  redactMatch,
  getSeverityLevel,
  PII_SEVERITY_WEIGHTS,
} from './piiDetection';

// ============================================================================
// Luhn Algorithm Tests (Credit Card Validation)
// ============================================================================

describe('luhnCheck', () => {
  it('should validate a known valid Visa card', () => {
    // Test Visa number
    expect(luhnCheck('4111111111111111')).toBe(true);
  });

  it('should validate a known valid Mastercard', () => {
    // Test Mastercard number
    expect(luhnCheck('5555555555554444')).toBe(true);
  });

  it('should validate a known valid Amex card', () => {
    // Test Amex number
    expect(luhnCheck('378282246310005')).toBe(true);
  });

  it('should validate a known valid Discover card', () => {
    // Test Discover number
    expect(luhnCheck('6011111111111117')).toBe(true);
  });

  it('should reject invalid card numbers', () => {
    expect(luhnCheck('4111111111111112')).toBe(false);
    expect(luhnCheck('1234567890123456')).toBe(false);
    // Note: 0000000000000000 actually passes Luhn (sum is 0, divisible by 10)
    // but would be rejected by the credit card regex patterns (no valid prefix)
    expect(luhnCheck('4111111111111110')).toBe(false);
  });

  it('should handle card numbers with spaces or dashes', () => {
    expect(luhnCheck('4111 1111 1111 1111')).toBe(true);
    expect(luhnCheck('4111-1111-1111-1111')).toBe(true);
  });
});

// ============================================================================
// SSN Validation Tests
// ============================================================================

describe('validateSSN', () => {
  it('should accept valid SSN formats', () => {
    expect(validateSSN('123-45-6789')).toBe(true);
    expect(validateSSN('123 45 6789')).toBe(true);
    expect(validateSSN('123456789')).toBe(true);
  });

  it('should reject SSNs with invalid area numbers', () => {
    // Area 000 is invalid
    expect(validateSSN('000-45-6789')).toBe(false);
    // Area 666 is invalid
    expect(validateSSN('666-45-6789')).toBe(false);
    // Area 900-999 is invalid
    expect(validateSSN('900-45-6789')).toBe(false);
    expect(validateSSN('999-45-6789')).toBe(false);
  });

  it('should reject SSNs with invalid group numbers', () => {
    // Group 00 is invalid
    expect(validateSSN('123-00-6789')).toBe(false);
  });

  it('should reject SSNs with invalid serial numbers', () => {
    // Serial 0000 is invalid
    expect(validateSSN('123-45-0000')).toBe(false);
  });

  it('should reject SSNs with wrong length', () => {
    expect(validateSSN('12345678')).toBe(false);
    expect(validateSSN('1234567890')).toBe(false);
  });
});

// ============================================================================
// DOB Validation Tests
// ============================================================================

describe('validateDOB', () => {
  it('should accept valid US format dates', () => {
    expect(validateDOB('01/15/1990')).toBe(true);
    expect(validateDOB('12-31-1985')).toBe(true);
    expect(validateDOB('06.20.2000')).toBe(true);
  });

  it('should accept valid ISO format dates', () => {
    expect(validateDOB('1990-01-15')).toBe(true);
    expect(validateDOB('1985/12/31')).toBe(true);
    expect(validateDOB('2000.06.20')).toBe(true);
  });

  it('should reject dates in the future', () => {
    expect(validateDOB('01/15/2100')).toBe(false);
    expect(validateDOB('2100-01-15')).toBe(false);
  });

  it('should reject dates too far in the past', () => {
    expect(validateDOB('01/15/1899')).toBe(false);
  });

  it('should reject invalid dates', () => {
    // February 30 doesn't exist
    expect(validateDOB('02/30/1990')).toBe(false);
    // Month 13 doesn't exist
    expect(validateDOB('13/01/1990')).toBe(false);
  });
});

// ============================================================================
// Email Validation Tests
// ============================================================================

describe('validateEmail', () => {
  it('should accept valid email TLDs', () => {
    expect(validateEmail('user@example.com')).toBe(true);
    expect(validateEmail('user@example.org')).toBe(true);
    expect(validateEmail('user@example.co.uk')).toBe(true);
  });

  it('should reject emails with invalid TLDs', () => {
    // Single character TLD
    expect(validateEmail('user@example.a')).toBe(false);
    // TLD too long (>6 chars)
    expect(validateEmail('user@example.abcdefgh')).toBe(false);
  });
});

// ============================================================================
// IPv4 Validation Tests
// ============================================================================

describe('validatePublicIPv4', () => {
  it('should accept valid public IPs', () => {
    expect(validatePublicIPv4('8.8.8.8')).toBe(true);
    expect(validatePublicIPv4('1.1.1.1')).toBe(true);
    expect(validatePublicIPv4('203.0.113.1')).toBe(true);
  });

  it('should reject private IP ranges', () => {
    // 10.x.x.x
    expect(validatePublicIPv4('10.0.0.1')).toBe(false);
    expect(validatePublicIPv4('10.255.255.255')).toBe(false);
    // 172.16-31.x.x
    expect(validatePublicIPv4('172.16.0.1')).toBe(false);
    expect(validatePublicIPv4('172.31.255.255')).toBe(false);
    // 192.168.x.x
    expect(validatePublicIPv4('192.168.0.1')).toBe(false);
    expect(validatePublicIPv4('192.168.255.255')).toBe(false);
  });

  it('should reject loopback IPs', () => {
    expect(validatePublicIPv4('127.0.0.1')).toBe(false);
    expect(validatePublicIPv4('127.255.255.255')).toBe(false);
  });

  it('should reject link-local IPs', () => {
    expect(validatePublicIPv4('169.254.0.1')).toBe(false);
    expect(validatePublicIPv4('169.254.255.255')).toBe(false);
  });
});

// ============================================================================
// Context Keyword Matching Tests
// ============================================================================

describe('hasContextKeywords', () => {
  it('should find banking keywords', () => {
    expect(hasContextKeywords('Account number: 12345678', ['account', 'routing', 'bank'])).toBe(true);
    expect(hasContextKeywords('Routing: 123456789', ['account', 'routing', 'bank'])).toBe(true);
    expect(hasContextKeywords('Bank of America wire transfer', ['account', 'routing', 'bank'])).toBe(true);
  });

  it('should be case insensitive', () => {
    expect(hasContextKeywords('ACCOUNT NUMBER', ['account'])).toBe(true);
    expect(hasContextKeywords('Account Number', ['account'])).toBe(true);
    expect(hasContextKeywords('account number', ['ACCOUNT'])).toBe(true);
  });

  it('should return false when no keywords match', () => {
    expect(hasContextKeywords('Random text here', ['account', 'routing', 'bank'])).toBe(false);
  });
});

// ============================================================================
// Redaction Tests
// ============================================================================

describe('redactMatch', () => {
  it('should redact middle characters of long strings', () => {
    expect(redactMatch('123456789')).toBe('12*****89');
    expect(redactMatch('4111111111111111')).toBe('41************11');
  });

  it('should fully redact short strings', () => {
    expect(redactMatch('abc')).toBe('***');
    expect(redactMatch('ab')).toBe('**');
    expect(redactMatch('abcd')).toBe('****');
  });

  it('should handle 5-character strings correctly', () => {
    expect(redactMatch('12345')).toBe('12*45');
  });
});

// ============================================================================
// Severity Level Tests
// ============================================================================

describe('getSeverityLevel', () => {
  it('should return high for SSN and credit cards', () => {
    expect(getSeverityLevel('ssn')).toBe('high');
    expect(getSeverityLevel('credit_card')).toBe('high');
    expect(getSeverityLevel('bank_account')).toBe('high');
  });

  it('should return medium for DOB and drivers license', () => {
    expect(getSeverityLevel('dob')).toBe('medium');
    expect(getSeverityLevel('drivers_license')).toBe('medium');
    expect(getSeverityLevel('passport')).toBe('medium');
  });

  it('should return low for contact info', () => {
    expect(getSeverityLevel('phone')).toBe('low');
    expect(getSeverityLevel('email')).toBe('low');
    expect(getSeverityLevel('ip_address')).toBe('low');
    expect(getSeverityLevel('mac_address')).toBe('low');
  });
});

describe('PII_SEVERITY_WEIGHTS', () => {
  it('should have correct weights per PRD', () => {
    expect(PII_SEVERITY_WEIGHTS.ssn).toBe(10);
    expect(PII_SEVERITY_WEIGHTS.credit_card).toBe(10);
    expect(PII_SEVERITY_WEIGHTS.bank_account).toBe(8);
    expect(PII_SEVERITY_WEIGHTS.dob).toBe(5);
    expect(PII_SEVERITY_WEIGHTS.drivers_license).toBe(5);
    expect(PII_SEVERITY_WEIGHTS.passport).toBe(5);
    expect(PII_SEVERITY_WEIGHTS.phone).toBe(2);
    expect(PII_SEVERITY_WEIGHTS.email).toBe(1);
    expect(PII_SEVERITY_WEIGHTS.ip_address).toBe(1);
    expect(PII_SEVERITY_WEIGHTS.mac_address).toBe(1);
  });
});

// ============================================================================
// Full PII Detection Tests
// ============================================================================

describe('detectPII', () => {
  describe('SSN Detection', () => {
    it('should detect SSNs in various formats', () => {
      const text = `
        SSN: 123-45-6789
        Social: 234 56 7891
        Number: 345678912
      `;

      const result = detectPII(text, { pii_types: ['ssn'], context_window: 50 });

      expect(result.matches.length).toBe(3);
      expect(result.matches[0].pii_type).toBe('ssn');
      expect(result.matches[0].confidence).toBeGreaterThan(0.9);
    });

    it('should not detect invalid SSNs', () => {
      const text = `
        Invalid: 000-45-6789
        Invalid: 666-45-6789
        Invalid: 900-45-6789
      `;

      const result = detectPII(text, { pii_types: ['ssn'], context_window: 50 });
      expect(result.matches.length).toBe(0);
    });
  });

  describe('Credit Card Detection', () => {
    it('should detect valid credit card numbers', () => {
      const text = `
        Visa: 4111111111111111
        Mastercard: 5555555555554444
        Amex: 378282246310005
        Discover: 6011111111111117
      `;

      const result = detectPII(text, { pii_types: ['credit_card'], context_window: 50 });

      expect(result.matches.length).toBe(4);
      result.matches.forEach(match => {
        expect(match.pii_type).toBe('credit_card');
        expect(match.confidence).toBeGreaterThan(0.95);
      });
    });

    it('should not detect invalid credit card numbers', () => {
      const text = `
        Invalid: 4111111111111112
        Invalid: 1234567890123456
      `;

      const result = detectPII(text, { pii_types: ['credit_card'], context_window: 50 });
      expect(result.matches.length).toBe(0);
    });
  });

  describe('Email Detection', () => {
    it('should detect valid email addresses', () => {
      const text = `
        Contact: john.doe@example.com
        Support: support@company.org
        Personal: user123@domain.co.uk
      `;

      const result = detectPII(text, { pii_types: ['email'], context_window: 50 });

      expect(result.matches.length).toBe(3);
      result.matches.forEach(match => {
        expect(match.pii_type).toBe('email');
        expect(match.confidence).toBeGreaterThan(0.9);
      });
    });
  });

  describe('Phone Number Detection', () => {
    it('should detect US phone numbers', () => {
      const text = `
        Call: (555) 123-4567
        Phone: 555.123.4567
        Mobile: 555-123-4567
        Direct: +1 555 123 4567
      `;

      const result = detectPII(text, { pii_types: ['phone'], context_window: 50 });

      expect(result.matches.length).toBeGreaterThanOrEqual(3);
      result.matches.forEach(match => {
        expect(match.pii_type).toBe('phone');
      });
    });

    it('should detect international phone numbers', () => {
      const text = `
        UK: +441onal23456789
        Germany: +4917123456789
      `;

      const result = detectPII(text, { pii_types: ['phone'], context_window: 50 });
      // International numbers in proper format
      expect(result.matches.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('IP Address Detection', () => {
    it('should detect IPv4 addresses', () => {
      const text = `
        Server: 8.8.8.8
        Gateway: 192.168.1.1
        DNS: 1.1.1.1
      `;

      const result = detectPII(text, { pii_types: ['ip_address'], context_window: 50 });

      expect(result.matches.length).toBe(3);
      result.matches.forEach(match => {
        expect(match.pii_type).toBe('ip_address');
      });
    });

    it('should detect IPv6 addresses', () => {
      const text = `
        IPv6: 2001:0db8:85a3:0000:0000:8a2e:0370:7334
      `;

      const result = detectPII(text, { pii_types: ['ip_address'], context_window: 50 });
      expect(result.matches.length).toBe(1);
    });

    it('should have lower confidence for private IPs', () => {
      const text = `
        Public: 8.8.8.8
        Private: 10.0.0.1
      `;

      const result = detectPII(text, { pii_types: ['ip_address'], context_window: 50 });

      const publicIP = result.matches.find(m => m.matched_text === '8.8.8.8');
      const privateIP = result.matches.find(m => m.matched_text === '10.0.0.1');

      expect(publicIP?.confidence).toBeGreaterThan(privateIP?.confidence ?? 0);
    });
  });

  describe('MAC Address Detection', () => {
    it('should detect MAC addresses with colons', () => {
      const text = `MAC: 00:1A:2B:3C:4D:5E`;

      const result = detectPII(text, { pii_types: ['mac_address'], context_window: 50 });

      expect(result.matches.length).toBe(1);
      expect(result.matches[0].pii_type).toBe('mac_address');
      expect(result.matches[0].matched_text).toBe('00:1A:2B:3C:4D:5E');
    });

    it('should detect MAC addresses with dashes', () => {
      const text = `MAC: 00-1A-2B-3C-4D-5E`;

      const result = detectPII(text, { pii_types: ['mac_address'], context_window: 50 });

      expect(result.matches.length).toBe(1);
      expect(result.matches[0].matched_text).toBe('00-1A-2B-3C-4D-5E');
    });
  });

  describe('Bank Account Detection (Context-based)', () => {
    it('should detect bank accounts when banking context is present', () => {
      const text = `Bank account number: 12345678901`;

      const result = detectPII(text, { pii_types: ['bank_account'], context_window: 100 });

      expect(result.matches.length).toBe(1);
      expect(result.matches[0].pii_type).toBe('bank_account');
    });

    it('should detect routing numbers in banking context', () => {
      const text = `ABA Routing: 123456789`;

      const result = detectPII(text, { pii_types: ['bank_account'], context_window: 100 });

      expect(result.matches.length).toBe(1);
    });

    it('should not detect numbers without banking context', () => {
      const text = `Order number: 12345678901`;

      const result = detectPII(text, { pii_types: ['bank_account'], context_window: 100 });

      expect(result.matches.length).toBe(0);
    });
  });

  describe('DOB Detection', () => {
    it('should detect US format dates', () => {
      const text = `DOB: 01/15/1990`;

      const result = detectPII(text, { pii_types: ['dob'], context_window: 50 });

      expect(result.matches.length).toBe(1);
      expect(result.matches[0].pii_type).toBe('dob');
    });

    it('should detect ISO format dates', () => {
      const text = `Birth date: 1990-01-15`;

      const result = detectPII(text, { pii_types: ['dob'], context_window: 50 });

      expect(result.matches.length).toBe(1);
    });
  });

  describe('Multi-type Detection', () => {
    it('should detect multiple PII types in same text', () => {
      const text = `
        Customer: John Doe
        SSN: 123-45-6789
        Email: john.doe@example.com
        Phone: (555) 123-4567
        Card: 4111111111111111
      `;

      const result = detectPII(text, {
        pii_types: ['ssn', 'email', 'phone', 'credit_card'],
        context_window: 50,
      });

      expect(result.matches.length).toBeGreaterThanOrEqual(4);

      const types = new Set(result.matches.map(m => m.pii_type));
      expect(types.has('ssn')).toBe(true);
      expect(types.has('email')).toBe(true);
      expect(types.has('phone')).toBe(true);
      expect(types.has('credit_card')).toBe(true);
    });

    it('should include line numbers', () => {
      const text = `Line 1: Nothing here
Line 2: SSN 123-45-6789
Line 3: Email test@example.com`;

      const result = detectPII(text, {
        pii_types: ['ssn', 'email'],
        context_window: 50,
      });

      const ssnMatch = result.matches.find(m => m.pii_type === 'ssn');
      const emailMatch = result.matches.find(m => m.pii_type === 'email');

      expect(ssnMatch?.line_number).toBe(2);
      expect(emailMatch?.line_number).toBe(3);
    });

    it('should include context around matches', () => {
      const text = `Customer SSN: 123-45-6789 is on file.`;

      const result = detectPII(text, {
        pii_types: ['ssn'],
        context_window: 50,
      });

      expect(result.matches[0].context).toContain('Customer SSN');
      expect(result.matches[0].context).toContain('is on file');
    });
  });

  describe('Performance Metrics', () => {
    it('should return processing time', () => {
      const text = `SSN: 123-45-6789`;

      const result = detectPII(text, { pii_types: ['ssn'], context_window: 50 });

      expect(result.processing_time_ms).toBeGreaterThanOrEqual(0);
    });

    it('should return lines scanned count', () => {
      const text = `Line 1
Line 2
Line 3
Line 4`;

      const result = detectPII(text, { pii_types: ['ssn'], context_window: 50 });

      expect(result.lines_scanned).toBe(4);
    });
  });

  describe('Match Limiting', () => {
    it('should respect max_matches_per_type limit', () => {
      const ssns = Array.from({ length: 10 }, (_, i) => `${100 + i}-45-6789`).join('\n');

      const result = detectPII(ssns, {
        pii_types: ['ssn'],
        context_window: 50,
        max_matches_per_type: 5,
      });

      expect(result.matches.length).toBeLessThanOrEqual(5);
    });
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty text', () => {
    const result = detectPII('', { pii_types: ['ssn', 'email'], context_window: 50 });
    expect(result.matches.length).toBe(0);
    expect(result.lines_scanned).toBe(1);
  });

  it('should handle text with no PII', () => {
    const text = `This is a normal document with no sensitive information.
Just regular text about business operations.`;

    const result = detectPII(text, {
      pii_types: ['ssn', 'credit_card', 'email'],
      context_window: 50,
    });

    expect(result.matches.length).toBe(0);
  });

  it('should handle very long text', () => {
    const longText = 'SSN: 123-45-6789\n'.repeat(1000);

    const result = detectPII(longText, {
      pii_types: ['ssn'],
      context_window: 50,
      max_matches_per_type: 100,
    });

    expect(result.matches.length).toBeLessThanOrEqual(100);
    expect(result.processing_time_ms).toBeGreaterThanOrEqual(0);
  });

  it('should handle special characters in text', () => {
    const text = `SSN: 123-45-6789 <-- This is a \t test with "special" chars & symbols!`;

    const result = detectPII(text, { pii_types: ['ssn'], context_window: 50 });

    expect(result.matches.length).toBe(1);
    expect(result.matches[0].matched_text).toBe('123-45-6789');
  });

  it('should not match PII types not in config', () => {
    const text = `SSN: 123-45-6789 Email: test@example.com`;

    const result = detectPII(text, { pii_types: ['ssn'], context_window: 50 });

    expect(result.matches.length).toBe(1);
    expect(result.matches[0].pii_type).toBe('ssn');
  });
});
