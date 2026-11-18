import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), system: vi.fn() },
}));

import { validateEmailConfiguration } from '../../../lib/validation/emailConfigValidation';

const KEYS = [
  'EMAIL_ENABLE', 'EMAIL_PROVIDER_TYPE', 'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_FROM',
  'EMAIL_USERNAME', 'EMAIL_PASSWORD', 'RESEND_API_KEY',
] as const;
const saved: Record<string, string | undefined> = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => { for (const k of KEYS) delete process.env[k]; });
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe('validateEmailConfiguration', () => {
  it('raises no warnings when disabled', () => {
    process.env.EMAIL_ENABLE = 'false';
    process.env.EMAIL_HOST = 'smtp.example.com';
    expect(validateEmailConfiguration()).toEqual({ valid: true, warnings: [] });
  });

  it('raises no warnings when unconfigured (no credentials, no flag)', () => {
    expect(validateEmailConfiguration()).toEqual({ valid: true, warnings: [] });
  });

  it('raises no warnings when the requested provider has no credential', () => {
    process.env.EMAIL_PROVIDER_TYPE = 'resend';
    expect(validateEmailConfiguration().warnings).toEqual([]);
  });

  it('validates provider settings when configured with the flag unset', () => {
    process.env.RESEND_API_KEY = 're_short';
    const { warnings } = validateEmailConfiguration();
    expect(warnings.join('\n')).toContain('Auto-detected provider type: resend');
    expect(warnings.join('\n')).toContain('too short');
    expect(warnings.join('\n')).toContain('EMAIL_FROM');
  });

  it('validates SMTP settings when only EMAIL_HOST is set', () => {
    process.env.EMAIL_HOST = 'smtp.example.com';
    process.env.EMAIL_PORT = '99999';
    const { warnings } = validateEmailConfiguration();
    expect(warnings.join('\n')).toContain('EMAIL_USERNAME');
    expect(warnings.join('\n')).toContain('Invalid EMAIL_PORT');
  });
});
