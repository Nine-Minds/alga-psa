import { describe, expect, it } from 'vitest';

import {
  ENTRA_ALL_SECRET_KEYS,
  ENTRA_CIPP_SECRET_KEYS,
  ENTRA_DIRECT_SECRET_KEYS,
  ENTRA_SHARED_MICROSOFT_SECRET_KEYS,
} from '@ee/lib/integrations/entra/secrets';

describe('Entra secret key constants', () => {
  it('T045: maps required direct/CIPP/shared secret names consistently', () => {
    expect(ENTRA_SHARED_MICROSOFT_SECRET_KEYS).toEqual({
      clientId: 'microsoft_client_id',
      clientSecret: 'microsoft_client_secret',
      tenantId: 'microsoft_tenant_id',
    });

    expect(ENTRA_DIRECT_SECRET_KEYS).toEqual({
      accessToken: 'entra_direct_access_token',
      refreshToken: 'entra_direct_refresh_token',
      tokenExpiresAt: 'entra_direct_token_expires_at',
      partnerTenantId: 'entra_direct_partner_tenant_id',
      tokenScope: 'entra_direct_token_scope',
    });

    expect(ENTRA_CIPP_SECRET_KEYS).toEqual({
      baseUrl: 'entra_cipp_base_url',
      apiToken: 'entra_cipp_api_token',
    });

    const allKeys = [...ENTRA_ALL_SECRET_KEYS];
    expect(new Set(allKeys).size).toBe(allKeys.length);

    const expectedKeys = [
      ...Object.values(ENTRA_SHARED_MICROSOFT_SECRET_KEYS),
      ...Object.values(ENTRA_DIRECT_SECRET_KEYS),
      ...Object.values(ENTRA_CIPP_SECRET_KEYS),
    ];
    expect(allKeys.sort()).toEqual(expectedKeys.sort());
  });
});
