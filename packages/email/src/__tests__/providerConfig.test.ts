import { describe, expect, it } from 'vitest';
import { createDefaultProviderConfig } from '../providerConfig';

describe('createDefaultProviderConfig', () => {
  it('creates a blank SMTP config with the requested enablement', () => {
    expect(createDefaultProviderConfig('smtp', { isEnabled: false })).toEqual({
      providerId: 'smtp-provider',
      providerType: 'smtp',
      isEnabled: false,
      config: {
        host: '',
        port: 587,
        username: '',
        password: '',
        from: '',
      },
    });
  });

  it('creates a blank Resend config with the requested enablement', () => {
    expect(createDefaultProviderConfig('resend', { isEnabled: true })).toEqual({
      providerId: 'resend-provider',
      providerType: 'resend',
      isEnabled: true,
      config: {
        apiKey: '',
        from: '',
      },
    });
  });
});
