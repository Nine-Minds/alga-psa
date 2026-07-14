import type { EmailProviderConfig, TenantEmailSettings } from '@alga-psa/types';

export type EditableEmailProviderType = TenantEmailSettings['emailProvider'];

export function createDefaultProviderConfig(
  providerType: EditableEmailProviderType,
  { isEnabled }: { isEnabled: boolean }
): EmailProviderConfig {
  return {
    providerId: `${providerType}-provider`,
    providerType,
    isEnabled,
    config: providerType === 'smtp'
      ? {
          host: '',
          port: 587,
          username: '',
          password: '',
          from: '',
        }
      : {
          apiKey: '',
          from: '',
        },
  };
}
