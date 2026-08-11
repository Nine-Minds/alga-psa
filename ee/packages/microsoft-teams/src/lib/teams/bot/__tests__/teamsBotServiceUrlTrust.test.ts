import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTrustedServiceUrl } from '../teamsBotConnector';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function enableEmulatorMode(): void {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('TEAMS_EMULATOR_MODE', 'true');
}

describe('isTrustedServiceUrl', () => {
  it('rejects non-Microsoft service urls when no allowlist is configured', () => {
    vi.stubEnv('TEAMS_BOT_SERVICE_URL_ALLOWLIST', undefined);
    expect(isTrustedServiceUrl('http://localhost:4010')).toBe(false);
    expect(isTrustedServiceUrl('http://localhost:4010/')).toBe(false);
    expect(isTrustedServiceUrl('http://127.0.0.1:4010')).toBe(false);
    expect(isTrustedServiceUrl('https://attacker.example.com')).toBe(false);
  });

  it('keeps accepting real Bot Framework service urls', () => {
    expect(isTrustedServiceUrl('https://smba.trafficmanager.net/amer/')).toBe(true);
    expect(isTrustedServiceUrl('https://europe.botframework.com')).toBe(true);
    expect(isTrustedServiceUrl('http://smba.trafficmanager.net/amer/')).toBe(false);
  });

  it('accepts exact allowlisted origins when the emulator gate is on', () => {
    enableEmulatorMode();
    vi.stubEnv('TEAMS_BOT_SERVICE_URL_ALLOWLIST', 'http://localhost:4010, http://127.0.0.1:4010');
    expect(isTrustedServiceUrl('http://localhost:4010')).toBe(true);
    expect(isTrustedServiceUrl('http://localhost:4010/v3/conversations')).toBe(true);
    expect(isTrustedServiceUrl('http://127.0.0.1:4010')).toBe(true);
    // Exact origins only: a different port or host is still untrusted.
    expect(isTrustedServiceUrl('http://localhost:4011')).toBe(false);
    expect(isTrustedServiceUrl('http://evil.localhost:4010')).toBe(false);
  });

  it('ignores the allowlist entirely in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TEAMS_EMULATOR_MODE', 'true');
    vi.stubEnv('TEAMS_BOT_SERVICE_URL_ALLOWLIST', 'http://localhost:4010');
    expect(isTrustedServiceUrl('http://localhost:4010')).toBe(false);
    expect(isTrustedServiceUrl('https://smba.trafficmanager.net/amer/')).toBe(true);
  });

  // Deny by default: an unset or unrecognized gate must leave the trust list
  // exactly as narrow as production's, whatever NODE_ENV says.
  it.each([
    ['unset NODE_ENV and no gate', undefined, undefined],
    ['staging with no gate', 'staging', undefined],
    ['unset NODE_ENV with an unrecognized gate value', undefined, 'staging'],
    ['development with the gate explicitly off', 'development', 'false'],
  ])('ignores the allowlist with %s', (_label, nodeEnv, gate) => {
    vi.stubEnv('NODE_ENV', nodeEnv as string | undefined);
    vi.stubEnv('TEAMS_EMULATOR_MODE', gate as string | undefined);
    vi.stubEnv('TEAMS_BOT_SERVICE_URL_ALLOWLIST', 'http://localhost:4010');
    expect(isTrustedServiceUrl('http://localhost:4010')).toBe(false);
    expect(isTrustedServiceUrl('https://smba.trafficmanager.net/amer/')).toBe(true);
  });

  /**
   * `new URL('localhost:4010')` does not throw — it yields the opaque origin
   * "null". Admitting that would trust every opaque-origin serviceUrl, so the
   * entry is dropped and reported instead.
   */
  it('rejects a scheme-less allowlist entry instead of trusting opaque origins', () => {
    enableEmulatorMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('TEAMS_BOT_SERVICE_URL_ALLOWLIST', 'localhost:4010');

    expect(isTrustedServiceUrl('http://localhost:4010')).toBe(false);
    expect(isTrustedServiceUrl('localhost:4010')).toBe(false);
    expect(isTrustedServiceUrl('data:text/plain,hi')).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('TEAMS_BOT_SERVICE_URL_ALLOWLIST'),
      { entry: 'localhost:4010' }
    );
  });

  it('drops unparseable and non-http entries but keeps the valid ones', () => {
    enableEmulatorMode();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv(
      'TEAMS_BOT_SERVICE_URL_ALLOWLIST',
      'not a url, ftp://localhost:4010, http://127.0.0.1:4010'
    );

    expect(isTrustedServiceUrl('http://127.0.0.1:4010')).toBe(true);
    expect(isTrustedServiceUrl('ftp://localhost:4010')).toBe(false);
  });
});
