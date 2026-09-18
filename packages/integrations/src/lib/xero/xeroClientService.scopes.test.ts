import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: vi.fn(async () => null),
    getAppSecret: vi.fn(async () => null)
  })
}));

const loggerWarnMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: loggerWarnMock,
    error: vi.fn(),
    debug: vi.fn()
  }
}));

import {
  computeMissingXeroScopes,
  getXeroOAuthScopeConfig,
  getXeroOAuthScopes,
  getXeroOAuthScopesString,
  XERO_PAYMENT_READ_SCOPE
} from './xeroClientService';

const REDUCED_DEFAULTS = [
  'offline_access',
  'accounting.settings.read',
  'accounting.invoices',
  'accounting.payments.read',
  'accounting.contacts'
];

describe('Xero OAuth scope configuration', () => {
  const originalOverride = process.env.XERO_OAUTH_SCOPES;

  beforeEach(() => {
    delete process.env.XERO_OAUTH_SCOPES;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env.XERO_OAUTH_SCOPES;
    } else {
      process.env.XERO_OAUTH_SCOPES = originalOverride;
    }
  });

  it('defaults new authorizations to the reduced read-only scope set including payments read', () => {
    const config = getXeroOAuthScopeConfig();

    expect(config.scopes).toEqual(REDUCED_DEFAULTS);
    expect(config.source).toBe('default');
    expect(config.invalidOverrideScopes).toBeUndefined();
    expect(getXeroOAuthScopes()).toEqual(REDUCED_DEFAULTS);
    expect(getXeroOAuthScopesString()).toBe(REDUCED_DEFAULTS.join(' '));
    expect(config.scopes).toContain(XERO_PAYMENT_READ_SCOPE);
  });

  it('does not request manage-level settings, bank transactions, or payment-write scopes by default', () => {
    const scopes = getXeroOAuthScopes();

    expect(scopes).not.toContain('accounting.settings');
    expect(scopes).not.toContain('accounting.banktransactions');
    // Read-only payments polling must not enable outbound payment writes.
    expect(scopes).not.toContain('accounting.payments');
  });

  it('honours a well-formed XERO_OAUTH_SCOPES deployment override and reports the override source', () => {
    process.env.XERO_OAUTH_SCOPES =
      'offline_access accounting.settings.read accounting.invoices accounting.contacts accounting.attachments.read';

    const config = getXeroOAuthScopeConfig();

    expect(config.source).toBe('override');
    expect(config.scopes).toEqual([
      'offline_access',
      'accounting.settings.read',
      'accounting.invoices',
      'accounting.contacts',
      'accounting.attachments.read'
    ]);
    expect(getXeroOAuthScopesString()).toContain('accounting.attachments.read');
  });

  it('deduplicates repeated override tokens', () => {
    process.env.XERO_OAUTH_SCOPES = 'offline_access offline_access accounting.invoices';

    expect(getXeroOAuthScopes()).toEqual(['offline_access', 'accounting.invoices']);
  });

  it('ignores a malformed override, falls back to defaults, and surfaces the rejected tokens', () => {
    process.env.XERO_OAUTH_SCOPES = 'offline_access Accounting.Settings not a$scope';

    const config = getXeroOAuthScopeConfig();

    expect(config.source).toBe('default');
    expect(config.scopes).toEqual(REDUCED_DEFAULTS);
    expect(config.invalidOverrideScopes).toEqual(['Accounting.Settings', 'a$scope']);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining('ignoring malformed XERO_OAUTH_SCOPES override'),
      { invalidScopes: ['Accounting.Settings', 'a$scope'] }
    );
  });

  describe('computeMissingXeroScopes', () => {
    const required = ['accounting.settings.read', 'accounting.invoices', XERO_PAYMENT_READ_SCOPE, 'accounting.contacts'];

    it('reports the payment read scope missing from the reduced authorization set', () => {
      expect(
        computeMissingXeroScopes(
          'offline_access accounting.settings.read accounting.invoices accounting.contacts',
          [XERO_PAYMENT_READ_SCOPE]
        )
      ).toEqual([XERO_PAYMENT_READ_SCOPE]);
    });

    it('treats legacy broad scopes as satisfying their granular replacements', () => {
      expect(
        computeMissingXeroScopes(
          'offline_access accounting.settings accounting.transactions accounting.contacts',
          required
        )
      ).toEqual([]);
      expect(
        computeMissingXeroScopes('accounting.transactions.read', [XERO_PAYMENT_READ_SCOPE])
      ).toEqual([]);
      // The write payment scope implies read.
      expect(computeMissingXeroScopes('accounting.payments', [XERO_PAYMENT_READ_SCOPE])).toEqual([]);
    });

    it('does not let a read-only legacy grant satisfy the invoice write scope', () => {
      // accounting.transactions.read can poll Payments but cannot POST
      // /Invoices; only the read+write broad scope covers invoice export.
      expect(
        computeMissingXeroScopes(
          'offline_access accounting.settings.read accounting.transactions.read accounting.contacts'
        )
      ).toContain('accounting.invoices');
      expect(
        computeMissingXeroScopes('accounting.transactions.read', ['accounting.invoices'])
      ).toEqual(['accounting.invoices']);
      expect(
        computeMissingXeroScopes('accounting.transactions', ['accounting.invoices'])
      ).toEqual([]);
      expect(
        computeMissingXeroScopes('accounting.invoices', ['accounting.invoices'])
      ).toEqual([]);
    });

    it('does not flag an unknown or absent stored grant', () => {
      expect(computeMissingXeroScopes(undefined, required)).toEqual([]);
      expect(computeMissingXeroScopes('', required)).toEqual([]);
      expect(computeMissingXeroScopes(null, required)).toEqual([]);
    });

    it('reports every unsatisfied required scope for a partial grant', () => {
      expect(
        computeMissingXeroScopes('offline_access accounting.invoices', required)
      ).toEqual(['accounting.settings.read', XERO_PAYMENT_READ_SCOPE, 'accounting.contacts']);
    });
  });
});
