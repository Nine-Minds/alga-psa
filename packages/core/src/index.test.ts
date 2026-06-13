import { describe, expect, it } from 'vitest';

describe('@alga-psa/core public exports', () => {
  it('exports a client-safe logger from the root barrel', async () => {
    const core = await import('./index');

    expect(core.logger).toBeTruthy();
  });

  // Secrets, events, and encryption are server-only and moved off the root
  // barrel (which must stay client-safe). They are re-exported from the
  // `@alga-psa/core/server` barrel (src/server.ts).
  it('exports logger, secrets, events, and encryption APIs from the server barrel', async () => {
    const server = await import('./server');

    expect(server.logger).toBeTruthy();
    expect(typeof server.getSecretProviderInstance).toBe('function');
    expect(typeof server.getSecret).toBe('function');
    expect(typeof server.publishEvent).toBe('function');
    expect(typeof server.hashPassword).toBe('function');
    expect(typeof server.verifyPassword).toBe('function');
    expect(typeof server.generateSecurePassword).toBe('function');
  });
});
