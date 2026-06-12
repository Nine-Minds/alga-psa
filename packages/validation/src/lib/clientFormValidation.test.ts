import { describe, expect, it } from 'vitest';

import { validateClientName } from './clientFormValidation';

describe('validateClientName', () => {
  it('accepts ordinary business names', () => {
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

  it('still enforces basic required/length rules', () => {
    expect(validateClientName('')).toBe('Client name is required');
    expect(validateClientName('A')).toBe('Client name must be at least 2 characters long');
  });
});
