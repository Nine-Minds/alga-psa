import { describe, expect, it } from 'vitest';
import { appendPortalDomain, buildPasswordResetLink } from '@alga-psa/auth/client';

describe('portalDomain URL helpers', () => {
  it('adds an encoded portal domain to paths with and without query parameters', () => {
    expect(appendPortalDomain('/auth/client-portal/signin', 'portal.example.com')).toBe(
      '/auth/client-portal/signin?portalDomain=portal.example.com'
    );
    expect(appendPortalDomain('/auth/check-email?portal=client', 'portal.example.com/path')).toBe(
      '/auth/check-email?portal=client&portalDomain=portal.example.com%2Fpath'
    );
  });

  it('leaves links unchanged when no portal domain is provided', () => {
    expect(appendPortalDomain('/auth/client-portal/signin', undefined)).toBe(
      '/auth/client-portal/signin'
    );
  });

  it('preserves portal context in client password-reset email links', () => {
    expect(buildPasswordResetLink('https://app.example.com', 'reset-token', 'client', 'help.example.com')).toBe(
      'https://app.example.com/auth/password-reset/set-new-password?token=reset-token&portal=client&portalDomain=help.example.com'
    );
  });

  it('keeps MSP and unbranded reset links unchanged', () => {
    expect(buildPasswordResetLink('https://app.example.com', 'reset-token', 'msp')).toBe(
      'https://app.example.com/auth/password-reset/set-new-password?token=reset-token&portal=msp'
    );
  });
});
