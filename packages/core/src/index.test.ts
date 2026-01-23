import { describe, expect, it } from 'vitest';

describe('@alga-psa/core public exports', () => {
  it('exports logger, secrets, events, and encryption APIs', async () => {
    const core = await import('./index');

    expect(core.logger).toBeTruthy();
    expect(typeof core.getSecretProviderInstance).toBe('function');
    expect(typeof core.getSecret).toBe('function');
    expect(typeof core.publishEvent).toBe('function');
    expect(typeof core.hashPassword).toBe('function');
    expect(typeof core.verifyPassword).toBe('function');
    expect(typeof core.generateSecurePassword).toBe('function');
  });
});

