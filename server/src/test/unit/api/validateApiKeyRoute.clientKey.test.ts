import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const validateApiKeyMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/auth', () => ({
  ApiKeyService: {
    validateApiKey: validateApiKeyMock,
  },
}));

import { POST } from '@/app/api/auth/validate-api-key/route';

describe('/api/auth/validate-api-key', () => {
  beforeEach(() => {
    validateApiKeyMock.mockReset();
  });

  it('rejects a client-owned key (validator returns null) with 401', async () => {
    validateApiKeyMock.mockResolvedValue(null);

    const res = await POST(
      new NextRequest('http://localhost/api/auth/validate-api-key', {
        headers: { 'x-api-key': 'client-owned-key' },
      })
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid API key' });
  });

  it('accepts an internal-owned key', async () => {
    validateApiKeyMock.mockResolvedValue({
      user_id: 'internal-user-1',
      tenant: 'tenant-1',
      api_key_id: 'key-1',
    });

    const res = await POST(
      new NextRequest('http://localhost/api/auth/validate-api-key', {
        headers: { 'x-api-key': 'internal-key' },
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      isValid: true,
      userId: 'internal-user-1',
      tenant: 'tenant-1',
    });
  });
});
