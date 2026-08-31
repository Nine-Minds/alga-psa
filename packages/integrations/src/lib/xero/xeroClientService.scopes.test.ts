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
  getXeroOAuthScopeConfig,
  getXeroOAuthScopes,
  getXeroOAuthScopesString
} from './xeroClientService';

const REDUCED_DEFAULTS = [
  'offline_access',
  'accounting.settings.read',
  'accounting.invoices',
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

  it('defaults new authorizations to the reduced scope set', () => {
    const config = getXeroOAuthScopeConfig();

    expect(config.scopes).toEqual(REDUCED_DEFAULTS);
    expect(config.source).toBe('default');
    expect(config.invalidOverrideScopes).toBeUndefined();
    expect(getXeroOAuthScopes()).toEqual(REDUCED_DEFAULTS);
    expect(getXeroOAuthScopesString()).toBe(REDUCED_DEFAULTS.join(' '));
  });

  it('does not request manage-level settings, bank transaction, or payment scopes by default', () => {
    const scopes = getXeroOAuthScopes();

    expect(scopes).not.toContain('accounting.settings');
    expect(scopes).not.toContain('accounting.banktransactions');
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
});
