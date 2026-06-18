import { describe, it, expect } from 'vitest';
import { validatePassword, getPasswordRequirements } from './passwordValidation';

describe('validatePassword', () => {
  it('accepts a strong password', () => {
    expect(validatePassword('Str0ng#Pass')).toBeNull();
  });

  it('enforces each requirement', () => {
    expect(validatePassword('')).toBe('Password is required');
    expect(validatePassword('Ab1!')).toBe('Password must be at least 8 characters long');
    expect(validatePassword('lowercase1!')).toBe('Password must contain at least one uppercase letter');
    expect(validatePassword('UPPERCASE1!')).toBe('Password must contain at least one lowercase letter');
    expect(validatePassword('NoNumber!')).toBe('Password must contain at least one number');
    expect(validatePassword('NoSpecial1')).toBe('Password must contain at least one special character');
  });

  // #1: short incidental sequences (e.g. a "...1234" tail) are now allowed; only a
  // run long enough to dominate the password (>= 6 chars) is rejected.
  it('allows short incidental sequences such as a "1234" tail', () => {
    expect(validatePassword('MyStr0ng!1234')).toBeNull();
    expect(validatePassword('Tr0ub4dour$99')).toBeNull();
    expect(validatePassword('MyDog$Ate123Bones')).toBeNull();
  });

  it('still rejects long dominating sequences', () => {
    expect(validatePassword('Abcdef1!')).toBe('Password cannot contain sequential characters');
    expect(validatePassword('Zxcvbn1!')).toBe('Password cannot contain sequential characters');
    expect(validatePassword('Aa!654321')).toBe('Password cannot contain sequential characters');
  });

  // #2: the common-password blocklist now fires on decorated variants that
  // previously slipped through the complexity checks.
  it('rejects common base words even when decorated with numbers/symbols', () => {
    expect(validatePassword('Welcome1!')).toBe('Password is too common. Please choose a stronger password');
    expect(validatePassword('Password1!')).toBe('Password is too common. Please choose a stronger password');
    expect(validatePassword('Monkey99$')).toBe('Password is too common. Please choose a stronger password');
  });
});

describe('getPasswordRequirements', () => {
  it('reports per-rule status', () => {
    expect(getPasswordRequirements('Str0ng#Pass')).toEqual({
      minLength: true,
      hasUpper: true,
      hasLower: true,
      hasNumber: true,
      hasSpecial: true,
    });
    expect(getPasswordRequirements('abc')).toEqual({
      minLength: false,
      hasUpper: false,
      hasLower: true,
      hasNumber: false,
      hasSpecial: false,
    });
  });
});
