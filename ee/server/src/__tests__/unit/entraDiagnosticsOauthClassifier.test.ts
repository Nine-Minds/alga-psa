import { describe, it, expect } from 'vitest';
import {
  classifyEntraOAuthFailure,
  buildCustomerConsentUrl,
} from '@ee/lib/integrations/entra/diagnostics/oauthClassifier';

describe('classifyEntraOAuthFailure', () => {
  it('treats invalid_grant with AADSTS65001 as a consent problem, not a refresh problem', () => {
    const result = classifyEntraOAuthFailure({
      message: 'invalid_grant AADSTS65001: The user or administrator has not consented.',
      context: 'partner',
    });
    expect(result.aadstsCode).toBe('AADSTS65001');
    expect(result.category).toBe('need_consent');
    expect(result.recommendation?.code).toBe('partner_consent_required');
  });

  it('builds a customer consent URL from the bound application client id', () => {
    const tenantId = '11111111-2222-3333-4444-555555555555';
    const appId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const result = classifyEntraOAuthFailure({
      message: 'AADSTS65001 consent_required',
      context: 'customer',
      customer: { entraTenantId: tenantId, applicationClientId: appId },
    });
    expect(result.category).toBe('need_consent');
    expect(result.recommendation?.action).toEqual({
      kind: 'open_url',
      payload: `https://login.microsoftonline.com/${tenantId}/adminconsent?client_id=${appId}`,
    });
    expect(result.remedy).toMatch(/Reconnecting the partner will not fix/i);
  });

  it.each([
    ['AADSTS7000222', 'client_secret_invalid'],
    ['AADSTS700016', 'app_not_found'],
    ['AADSTS50076', 'conditional_access'],
    ['AADSTS50079', 'conditional_access'],
    ['AADSTS70000', 'refresh_token_invalid'],
    ['AADSTS90002', 'tenant_not_found'],
    ['AADSTS50020', 'account_not_allowed'],
  ])('maps %s to %s', (code, expected) => {
    const result = classifyEntraOAuthFailure({
      message: `error ${code}`,
      context: 'partner',
    });
    expect(result.recommendation?.code).toBe(expected);
  });

  it('classifies invalid_client as a secret rotation remedy when no AADSTS code is present', () => {
    const result = classifyEntraOAuthFailure({
      message: 'invalid_client',
      context: 'partner',
    });
    expect(result.recommendation?.code).toBe('client_secret_invalid');
  });

  it('lets a specific AADSTS code beat a generic invalid_client', () => {
    // Reproduced regression: AADSTS700016 + invalid_client was reported as a
    // secret-rotation problem instead of app-not-found.
    const result = classifyEntraOAuthFailure({
      message: 'invalid_client AADSTS700016: Application with identifier was not found',
      oauthError: 'invalid_client',
      aadstsCode: 'AADSTS700016',
      context: 'partner',
    });
    expect(result.recommendation?.code).toBe('app_not_found');
  });

  it('classifies a customer users 403 as a GDAP directory-role failure', () => {
    const result = classifyEntraOAuthFailure({
      httpStatus: 403,
      context: 'customer',
      customer: {
        entraTenantId: 'tenant',
        operation: 'users',
      },
    });
    expect(result.category).toBe('missing_role');
    expect(result.recommendation?.code).toBe('customer_directory_role_missing');
  });

  it('distinguishes DNS from other network failures', () => {
    const dns = classifyEntraOAuthFailure({
      message: 'getaddrinfo ENOTFOUND login.microsoftonline.com',
      code: 'ENOTFOUND',
      context: 'partner',
    });
    expect(dns.networkCause).toBe('dns');
    expect(dns.recommendation?.code).toBe('network_unreachable');

    const timeout = classifyEntraOAuthFailure({
      message: 'timeout of 15000ms exceeded',
      code: 'ECONNABORTED',
      context: 'partner',
    });
    expect(timeout.networkCause).toBe('timeout');
  });
});

describe('buildCustomerConsentUrl', () => {
  it('returns null when either identifier is missing', () => {
    expect(buildCustomerConsentUrl(null, 'aaaaaaaa-bbbb')).toBeNull();
    expect(buildCustomerConsentUrl('tenant', null)).toBeNull();
    expect(buildCustomerConsentUrl('', '')).toBeNull();
  });

  it('encodes the tenant and app identifiers', () => {
    const url = buildCustomerConsentUrl('tenant-id', 'app-id-1234');
    expect(url).toBe('https://login.microsoftonline.com/tenant-id/adminconsent?client_id=app-id-1234');
  });
});
