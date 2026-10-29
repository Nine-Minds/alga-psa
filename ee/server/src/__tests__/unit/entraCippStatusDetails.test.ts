import { describe, expect, it } from 'vitest';
import { buildCippStatusDetails } from '@ee/lib/integrations/entra/providers/cipp/cippConnectionDetails';

describe('buildCippStatusDetails', () => {
  it('exposes identifiers for an API client and never its secret', () => {
    const details = buildCippStatusDetails({
      authType: 'api_client',
      baseUrl: 'https://cipp-api.example.net',
      clientId: 'client-1',
      clientSecret: 'SECRET-VALUE-do-not-leak',
      directoryId: 'dir-1',
    });
    expect(details).toEqual({
      cippBaseUrl: 'https://cipp-api.example.net',
      cippAuthType: 'api_client',
      cippClientId: 'client-1',
      cippDirectoryId: 'dir-1',
    });
    expect(JSON.stringify(details)).not.toContain('SECRET-VALUE-do-not-leak');
  });

  it('labels a legacy key as legacy and never returns the key', () => {
    const details = buildCippStatusDetails({
      authType: 'legacy_api_token',
      baseUrl: 'https://cipp-api.example.net',
      apiToken: 'LEGACY-TOKEN-do-not-leak',
    });
    expect(details).toEqual({
      cippBaseUrl: 'https://cipp-api.example.net',
      cippAuthType: 'legacy_api_token',
      cippClientId: null,
      cippDirectoryId: null,
    });
    expect(JSON.stringify(details)).not.toContain('LEGACY-TOKEN-do-not-leak');
  });

  it('is all null when credentials are unreadable', () => {
    expect(buildCippStatusDetails(null)).toEqual({
      cippBaseUrl: null,
      cippAuthType: null,
      cippClientId: null,
      cippDirectoryId: null,
    });
  });
});
