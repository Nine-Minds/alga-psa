import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getMicrosoftSsoEmulatorEndpoints,
  isMicrosoftSsoEmulatorEnabled,
} from './microsoftSsoEmulator';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Microsoft SSO simulator gate', () => {
  it('stays off unless explicitly turned on', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(isMicrosoftSsoEmulatorEnabled()).toBe(false);

    for (const value of ['', ' ', 'false', '0', 'yes', 'staging', 'TRUE ']) {
      vi.stubEnv('MICROSOFT_SSO_EMULATOR_MODE', value);
      expect(isMicrosoftSsoEmulatorEnabled(), `value ${JSON.stringify(value)}`).toBe(
        value.trim().toLowerCase() === 'true'
      );
    }
  });

  it('honours the recognized on-values outside production', () => {
    vi.stubEnv('NODE_ENV', 'test');
    for (const value of ['true', '1', 'TRUE']) {
      vi.stubEnv('MICROSOFT_SSO_EMULATOR_MODE', value);
      expect(isMicrosoftSsoEmulatorEnabled()).toBe(true);
    }
  });

  it('cannot be unlocked in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MICROSOFT_SSO_EMULATOR_MODE', 'true');
    expect(isMicrosoftSsoEmulatorEnabled()).toBe(false);
  });

  it('builds login and Graph endpoints from the simulator base URLs', () => {
    vi.stubEnv('MICROSOFT_LOGIN_BASE_URL', 'http://algasim.test:4010/');
    vi.stubEnv('MICROSOFT_GRAPH_BASE_URL', 'http://algasim.test:4010/v1.0/');

    expect(getMicrosoftSsoEmulatorEndpoints('tenant-1')).toEqual({
      authorization: 'http://algasim.test:4010/tenant-1/oauth2/v2.0/authorize',
      token: 'http://algasim.test:4010/tenant-1/oauth2/v2.0/token',
      userinfo: 'http://algasim.test:4010/v1.0/me',
    });
  });

  it('defaults the authority to common and Graph to the login origin', () => {
    vi.stubEnv('MICROSOFT_LOGIN_BASE_URL', 'http://127.0.0.1:4010');
    vi.stubEnv('MICROSOFT_GRAPH_BASE_URL', '');

    expect(getMicrosoftSsoEmulatorEndpoints()).toEqual({
      authorization: 'http://127.0.0.1:4010/common/oauth2/v2.0/authorize',
      token: 'http://127.0.0.1:4010/common/oauth2/v2.0/token',
      userinfo: 'http://127.0.0.1:4010/v1.0/me',
    });
  });
});
