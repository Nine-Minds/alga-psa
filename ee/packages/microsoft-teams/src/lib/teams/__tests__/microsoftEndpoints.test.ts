import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getMicrosoftGraphBaseUrl,
  getMicrosoftLoginBaseUrl,
  getMicrosoftTokenUrl,
} from '../microsoftEndpoints';

/**
 * These endpoints receive the bot secret, the setup-probe credentials, the
 * Graph client secret, and activity-notification bearer tokens, so the
 * emulator overrides are honored only behind an explicit opt-in — never
 * because NODE_ENV happens not to be the literal string "production".
 */

const EMULATOR = 'http://127.0.0.1:4010';
const MICROSOFT_LOGIN = 'https://login.microsoftonline.com';
const MICROSOFT_GRAPH = 'https://graph.microsoft.com/v1.0';

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubOverrides(): void {
  vi.stubEnv('MICROSOFT_LOGIN_BASE_URL', EMULATOR);
  vi.stubEnv('MICROSOFT_GRAPH_BASE_URL', `${EMULATOR}/v1.0`);
}

function expectMicrosoftDefaults(): void {
  expect(getMicrosoftLoginBaseUrl()).toBe(MICROSOFT_LOGIN);
  expect(getMicrosoftGraphBaseUrl()).toBe(MICROSOFT_GRAPH);
  expect(getMicrosoftTokenUrl('tenant-1')).toBe(`${MICROSOFT_LOGIN}/tenant-1/oauth2/v2.0/token`);
}

describe('Teams Microsoft endpoints', () => {
  it('honors the overrides when the emulator gate is explicitly on', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('TEAMS_EMULATOR_MODE', 'true');
    stubOverrides();

    expect(getMicrosoftLoginBaseUrl()).toBe(EMULATOR);
    expect(getMicrosoftGraphBaseUrl()).toBe(`${EMULATOR}/v1.0`);
    expect(getMicrosoftTokenUrl('tenant-1')).toBe(`${EMULATOR}/tenant-1/oauth2/v2.0/token`);
  });

  it('ignores the overrides in production even with the gate on', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TEAMS_EMULATOR_MODE', 'true');
    stubOverrides();

    expectMicrosoftDefaults();
  });

  // The fail-open case this replaced: a worker or staging host that never sets
  // NODE_ENV used to honor every override.
  it.each([
    ['unset NODE_ENV and no gate', undefined, undefined],
    ['staging with no gate', 'staging', undefined],
    ['unset NODE_ENV with the gate on a value it does not recognize', undefined, 'staging'],
    ['development with the gate explicitly off', 'development', 'false'],
    ['development with an empty gate', 'development', ''],
  ])('ignores the overrides with %s', (_label, nodeEnv, gate) => {
    vi.stubEnv('NODE_ENV', nodeEnv as string | undefined);
    vi.stubEnv('TEAMS_EMULATOR_MODE', gate as string | undefined);
    stubOverrides();

    expectMicrosoftDefaults();
  });

  it('falls back to the Microsoft defaults when nothing is set', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('TEAMS_EMULATOR_MODE', 'true');
    vi.stubEnv('MICROSOFT_LOGIN_BASE_URL', '');
    vi.stubEnv('MICROSOFT_GRAPH_BASE_URL', '');

    expect(getMicrosoftLoginBaseUrl()).toBe(MICROSOFT_LOGIN);
    expect(getMicrosoftGraphBaseUrl()).toBe(MICROSOFT_GRAPH);
  });
});
