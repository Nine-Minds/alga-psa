import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTrustedServiceUrl } from '../teamsBotConnector';

afterEach(() => {
  vi.unstubAllEnvs();
});

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

  it('accepts exact allowlisted origins outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
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
    vi.stubEnv('TEAMS_BOT_SERVICE_URL_ALLOWLIST', 'http://localhost:4010');
    expect(isTrustedServiceUrl('http://localhost:4010')).toBe(false);
    expect(isTrustedServiceUrl('https://smba.trafficmanager.net/amer/')).toBe(true);
  });
});
