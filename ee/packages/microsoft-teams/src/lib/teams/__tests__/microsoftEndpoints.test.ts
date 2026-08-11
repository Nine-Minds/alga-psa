import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getMicrosoftGraphBaseUrl,
  getMicrosoftLoginBaseUrl,
  getMicrosoftTokenUrl,
} from '../microsoftEndpoints';

/**
 * These endpoints receive the bot secret, the setup-probe credentials, the
 * Graph client secret, and activity-notification bearer tokens, so the
 * emulator overrides must not survive into production.
 */

const EMULATOR = 'http://127.0.0.1:4010';

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubOverrides(): void {
  vi.stubEnv('MICROSOFT_LOGIN_BASE_URL', EMULATOR);
  vi.stubEnv('MICROSOFT_GRAPH_BASE_URL', `${EMULATOR}/v1.0`);
}

describe('Teams Microsoft endpoints', () => {
  it('honors the overrides outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    stubOverrides();

    expect(getMicrosoftLoginBaseUrl()).toBe(EMULATOR);
    expect(getMicrosoftGraphBaseUrl()).toBe(`${EMULATOR}/v1.0`);
    expect(getMicrosoftTokenUrl('tenant-1')).toBe(`${EMULATOR}/tenant-1/oauth2/v2.0/token`);
  });

  it('ignores the overrides in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    stubOverrides();

    expect(getMicrosoftLoginBaseUrl()).toBe('https://login.microsoftonline.com');
    expect(getMicrosoftGraphBaseUrl()).toBe('https://graph.microsoft.com/v1.0');
    expect(getMicrosoftTokenUrl('tenant-1')).toBe(
      'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token'
    );
  });

  it('falls back to the Microsoft defaults when nothing is set', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MICROSOFT_LOGIN_BASE_URL', '');
    vi.stubEnv('MICROSOFT_GRAPH_BASE_URL', '');

    expect(getMicrosoftLoginBaseUrl()).toBe('https://login.microsoftonline.com');
    expect(getMicrosoftGraphBaseUrl()).toBe('https://graph.microsoft.com/v1.0');
  });
});
