import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock('redis', () => ({
  createClient: mocks.createClient,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: async () => null,
  }),
}));

vi.mock('@alga-psa/event-bus', () => ({
  getRedisConfig: () => ({ url: 'redis://localhost:6379' }),
}));

import {
  consumeMicrosoftEmailOAuthNonce,
  storeMicrosoftEmailOAuthNonce,
} from './microsoftEmailOAuthStateStore';

describe('Microsoft email OAuth nonce store (memory fallback)', () => {
  beforeEach(() => {
    mocks.createClient.mockImplementation(() => {
      throw new Error('redis unavailable');
    });
  });

  it('allows the first consume of a nonce and rejects the second (replay)', async () => {
    await storeMicrosoftEmailOAuthNonce('nonce-1');

    expect(await consumeMicrosoftEmailOAuthNonce('nonce-1')).toBe(true);
    expect(await consumeMicrosoftEmailOAuthNonce('nonce-1')).toBe(false);
  });

  it('rejects an unknown nonce', async () => {
    expect(await consumeMicrosoftEmailOAuthNonce('never-stored')).toBe(false);
  });
});
