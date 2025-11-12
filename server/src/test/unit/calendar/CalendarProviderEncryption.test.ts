import { beforeEach, describe, expect, it } from 'vitest';
import { CalendarProviderService } from '../../../services/calendar/CalendarProviderService';

// These tests focus on the encryption/decryption helpers used during the OAuth connection flow.

describe('CalendarProviderService encryption helpers', () => {
  let service: CalendarProviderService;

  beforeEach(() => {
    process.env.CALENDAR_OAUTH_ENCRYPTION_KEY = 'unit-test-calendar-key';
    service = new CalendarProviderService();
  });

  it('encrypts and decrypts Google provider credentials', async () => {
    const vendorConfig = {
      clientId: 'google-client-id',
      clientSecret: 'google-client-secret',
      refreshToken: 'google-refresh-token',
      accessToken: 'google-access-token',
      projectId: 'google-project',
      redirectUri: 'https://example.com/oauth/google',
      syncToken: 'google-sync-token'
    };

    const encrypted = await (service as any).prepareVendorConfigForStorage('google', vendorConfig);

    expect(encrypted.client_secret).toMatch(/^enc:/);
    expect(encrypted.refresh_token).toMatch(/^enc:/);
    expect(encrypted.access_token).toMatch(/^enc:/);
    expect(encrypted.project_id).toBe('google-project');

    const decrypted = await (service as any).decryptVendorConfigRow(encrypted);
    expect(decrypted.client_secret).toBe('google-client-secret');
    expect(decrypted.refresh_token).toBe('google-refresh-token');
    expect(decrypted.access_token).toBe('google-access-token');
    expect(decrypted.project_id).toBe('google-project');
  });

  it('encrypts and decrypts Microsoft provider credentials', async () => {
    const vendorConfig = {
      clientId: 'ms-client-id',
      clientSecret: 'ms-client-secret',
      tenantId: 'ms-tenant-id',
      refreshToken: 'ms-refresh-token',
      accessToken: 'ms-access-token',
      deltaLink: 'delta-token',
      redirectUri: 'https://example.com/oauth/microsoft'
    };

    const encrypted = await (service as any).prepareVendorConfigForStorage('microsoft', vendorConfig);

    expect(encrypted.client_secret).toMatch(/^enc:/);
    expect(encrypted.refresh_token).toMatch(/^enc:/);
    expect(encrypted.access_token).toMatch(/^enc:/);
    expect(encrypted.tenant_id).toBe('ms-tenant-id');

    const decrypted = await (service as any).decryptVendorConfigRow(encrypted);
    expect(decrypted.refresh_token).toBe('ms-refresh-token');
    expect(decrypted.access_token).toBe('ms-access-token');
    expect(decrypted.tenant_id).toBe('ms-tenant-id');
  });

  it('omits secrets when includeSecrets=false and returns them when includeSecrets=true', async () => {
    const row = {
      id: 'provider-1',
      tenant: 'tenant-1',
      provider_name: 'Test Provider',
      provider_type: 'google',
      calendar_id: 'primary',
      is_active: true,
      sync_direction: 'bidirectional',
      status: 'connected',
      last_sync_at: null,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const vendorConfig = await (service as any).prepareVendorConfigForStorage('google', {
      clientId: 'google-client-id',
      clientSecret: 'google-client-secret',
      refreshToken: 'google-refresh-token',
      accessToken: 'google-access-token'
    });

    const withoutSecrets = await (service as any).buildProviderConfig(row, vendorConfig, { includeSecrets: false });
    expect(withoutSecrets.provider_config).toBeUndefined();

    const withSecrets = await (service as any).buildProviderConfig(row, vendorConfig, { includeSecrets: true });
    expect(withSecrets.provider_config?.clientSecret).toBe('google-client-secret');
    expect(withSecrets.provider_config?.refreshToken).toBe('google-refresh-token');
  });
});
