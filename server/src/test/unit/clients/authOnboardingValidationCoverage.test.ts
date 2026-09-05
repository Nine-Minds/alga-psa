/**
 * Auth and onboarding are where a false rejection is most expensive: the user cannot
 * get into the product to work around it. These cases pin the behaviour of the
 * validators those flows call, before enforcement reaches them.
 *
 * Covers RegisterForm, ClientPortalSignIn / useRegister, ClientInfoStep, and
 * UserManagement's invite form.
 */

import { describe, expect, it } from 'vitest';
import {
  isValidEmail,
  isValidTenantSlug,
  validateEmailAddress,
  validateEmailAddressField,
} from '@alga-psa/validation';

describe('registration and onboarding email validation', () => {
  const ACCEPTED = [
    'ada@acme.com',
    'ada.lovelace+psa@acme.co.uk',
    'j@doe.com',
    "o'brien@acme.ie",
    'ada@xn--80akhbyknj4f.com',
    'ada@sub.domain.acme.travel',
    // Registered domains that merely look like placeholders.
    'ops@sample.com',
    'ops@demo.com',
    'ops@fake.com',
    'ops@invalid.com',
    // Reserved and disposable domains: an opinion, never a lockout.
    'ada@example.com',
    'ada@mailinator.com',
    'ada@box.local',
  ];

  const REJECTED = ['', '   ', 'not-an-email', 'ada@', '@acme.com', 'ada@acme', 'ada acme@x.com'];

  for (const email of ACCEPTED) {
    it(`lets ${email} through registration`, () => {
      expect(validateEmailAddress(email)).toBeNull();
    });
  }

  for (const email of REJECTED) {
    it(`blocks ${JSON.stringify(email)} at registration`, () => {
      expect(validateEmailAddress(email)).not.toBeNull();
    });
  }

  it('surfaces the reserved/disposable opinion as a warning, not an error', () => {
    const reserved = validateEmailAddressField('ada@example.com');
    expect(reserved.error).toBeNull();
    expect(reserved.warnings.length).toBeGreaterThan(0);

    const disposable = validateEmailAddressField('ada@mailinator.com');
    expect(disposable.error).toBeNull();
    expect(disposable.warnings.length).toBeGreaterThan(0);
  });

  it('normalizes the address the flow will store and look up', () => {
    expect(validateEmailAddressField('  Ada@ACME.com ').value).toBe('ada@acme.com');
  });

  it('keeps isValidEmail — used by useRegister and ManagedEmailSettings — in step', () => {
    for (const email of ACCEPTED) {
      expect(isValidEmail(email)).toBe(true);
    }
    for (const email of REJECTED) {
      expect(isValidEmail(email)).toBe(false);
    }
  });
});

describe('client-portal sign-in tenant slug', () => {
  // ClientPortalSignIn and auth.tsx gate on this; it is untouched by the schema
  // change and must stay that way.
  it('still accepts and rejects the same slugs', () => {
    expect(isValidTenantSlug('a1b2c3d4e5f6')).toBe(true);
    expect(isValidTenantSlug('A1B2C3D4E5F6')).toBe(true);
    expect(isValidTenantSlug('')).toBe(false);
    expect(isValidTenantSlug('acme-corp')).toBe(false);
  });
});
