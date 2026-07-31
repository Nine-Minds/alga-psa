import { describe, expect, it } from 'vitest';
import {
  selectMicrosoftEmailRuntimeCredentials,
  type MicrosoftEmailRuntimeCredentials,
} from '@alga-psa/shared/services/email/microsoftEmailProviderConfig';

function credential(
  clientId: string,
  clientSecret: string,
  source: MicrosoftEmailRuntimeCredentials['source']
): MicrosoftEmailRuntimeCredentials {
  return { clientId, clientSecret, tenantId: 'common', source };
}

describe('Microsoft email runtime credential selection', () => {
  it('uses the bound profile and its rotated secret when the issuing client id matches', () => {
    const selected = selectMicrosoftEmailRuntimeCredentials({
      issuingClientId: 'premise-app',
      profileCredentials: credential('premise-app', 'rotated-secret', 'profile'),
      fallbackCredentials: credential('premise-app', 'old-secret', 'vendor'),
    });

    expect(selected).toMatchObject({
      clientId: 'premise-app',
      clientSecret: 'rotated-secret',
      source: 'profile',
    });
  });

  it('keeps using stored issuing-app credentials after a profile swap', () => {
    const selected = selectMicrosoftEmailRuntimeCredentials({
      issuingClientId: 'hosted-app',
      profileCredentials: credential('tenant-app', 'tenant-secret', 'profile'),
      fallbackCredentials: credential('hosted-app', 'hosted-secret', 'vendor'),
    });

    expect(selected).toMatchObject({
      clientId: 'hosted-app',
      clientSecret: 'hosted-secret',
      source: 'vendor',
    });
  });

  it('does not cross clients when the stored issuing credentials are unavailable', () => {
    const selected = selectMicrosoftEmailRuntimeCredentials({
      issuingClientId: 'old-app',
      profileCredentials: credential('new-app', 'new-secret', 'profile'),
      fallbackCredentials: null,
    });

    expect(selected).toBeNull();
  });

  it('does not use environment credentials from a different app than the issuer', () => {
    const selected = selectMicrosoftEmailRuntimeCredentials({
      issuingClientId: 'premise-app',
      profileCredentials: null,
      fallbackCredentials: credential('hosted-app', 'hosted-secret', 'environment'),
    });

    expect(selected).toBeNull();
  });
});
