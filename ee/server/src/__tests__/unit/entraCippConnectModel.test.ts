import { describe, expect, it } from 'vitest';
import {
  buildCippCredentialInput,
  cippTestFingerprint,
  classifyCippFailure,
  cippHostForDisplay,
  cippTransportCause,
  displayCippApiUrl,
  isCippFormComplete,
  normalizeCippApiUrl,
  type CippFormValues,
} from '@ee/components/settings/integrations/cippConnectModel';

const apiClient: CippFormValues = {
  shape: 'api_client',
  apiUrl: 'https://cipp-api.example.net/api',
  clientId: 'client',
  clientSecret: 'secret',
  tenantId: 'tenant',
  baseUrl: '',
  apiToken: '',
};

describe('normalizeCippApiUrl', () => {
  it.each([
    ['https://cipp-api.example.net/api', 'https://cipp-api.example.net'],
    ['https://cipp-api.example.net/api/', 'https://cipp-api.example.net'],
    ['https://cipp-api.example.net', 'https://cipp-api.example.net'],
    ['  cipp-api.example.net/API  ', 'https://cipp-api.example.net'],
    ['http://localhost:8080/api', 'http://localhost:8080'],
    ['https://host.example.net/base/api', 'https://host.example.net/base'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeCippApiUrl(input)).toBe(expected);
  });

  it('displays the CIPP form, ending in /api', () => {
    expect(displayCippApiUrl('cipp-api.example.net')).toBe('https://cipp-api.example.net/api');
    expect(displayCippApiUrl('https://cipp-api.example.net/api')).toBe('https://cipp-api.example.net/api');
  });
});

describe('cippTestFingerprint', () => {
  it('treats the URL with and without /api as one value', () => {
    expect(cippTestFingerprint({ ...apiClient, apiUrl: 'https://cipp-api.example.net' })).toBe(
      cippTestFingerprint(apiClient)
    );
  });

  it.each(['apiUrl', 'clientId', 'clientSecret', 'tenantId'] as const)('changes when %s changes', (key) => {
    expect(cippTestFingerprint({ ...apiClient, [key]: key === 'apiUrl' ? 'https://other.example.net' : 'x' })).not.toBe(
      cippTestFingerprint(apiClient)
    );
  });

  it('ignores the other shape\'s fields', () => {
    expect(cippTestFingerprint({ ...apiClient, apiToken: 'leftover' })).toBe(cippTestFingerprint(apiClient));
  });

  it('covers URL and token for legacy', () => {
    const legacy: CippFormValues = { ...apiClient, shape: 'legacy', baseUrl: 'https://a.example.net', apiToken: 't' };
    expect(cippTestFingerprint({ ...legacy, apiToken: 'u' })).not.toBe(cippTestFingerprint(legacy));
    expect(cippTestFingerprint({ ...legacy, baseUrl: 'https://b.example.net' })).not.toBe(cippTestFingerprint(legacy));
    expect(cippTestFingerprint(legacy)).not.toBe(cippTestFingerprint(apiClient));
  });
});

describe('form helpers', () => {
  it('requires every API-client field', () => {
    expect(isCippFormComplete(apiClient)).toBe(true);
    for (const key of ['apiUrl', 'clientId', 'clientSecret', 'tenantId'] as const) {
      expect(isCippFormComplete({ ...apiClient, [key]: '  ' })).toBe(false);
    }
  });

  it('builds the action input in each shape', () => {
    expect(buildCippCredentialInput(apiClient)).toEqual({
      authType: 'api_client',
      apiUrl: 'https://cipp-api.example.net',
      clientId: 'client',
      clientSecret: 'secret',
      tenantId: 'tenant',
    });
    expect(
      buildCippCredentialInput({ ...apiClient, shape: 'legacy', baseUrl: 'cipp.example.net/api', apiToken: 'k' })
    ).toEqual({ baseUrl: 'https://cipp.example.net', apiToken: 'k' });
  });

  it('classifies probe codes into the three operator situations', () => {
    expect(classifyCippFailure('api_client', 'html_response')).toBe('unreachable');
    expect(classifyCippFailure('api_client', 'token_mint_failed')).toBe('tokenRejected');
    expect(classifyCippFailure('api_client', 'ip_blocked')).toBe('apiRefused');
    expect(classifyCippFailure('api_client', 'auth_rejected')).toBe('apiRefused');
    expect(classifyCippFailure('legacy', 'auth_rejected')).toBe('legacyRejected');
    expect(classifyCippFailure('legacy', undefined)).toBeNull();
    expect(classifyCippFailure('api_client', 'unreachable')).toBe('unreachable');
    expect(classifyCippFailure('legacy', 'unreachable')).toBe('unreachable');
    expect(classifyCippFailure('api_client', 'role_blocked')).toBe('roleBlocked');
  });
});

describe('transport failures', () => {
  it('only localizes a known cause on an unreachable result', () => {
    expect(cippTransportCause('unreachable', 'dns')).toBe('dns');
    expect(cippTransportCause('unreachable', 'something-new')).toBeNull();
    expect(cippTransportCause('ip_blocked', 'dns')).toBeNull();
    expect(cippTransportCause(undefined, undefined)).toBeNull();
  });

  it('names the host the operator typed, with or without scheme and /api', () => {
    expect(cippHostForDisplay('https://cipp.example.net/api')).toBe('cipp.example.net');
    expect(cippHostForDisplay('cipp.example.net:8443')).toBe('cipp.example.net:8443');
  });
});
