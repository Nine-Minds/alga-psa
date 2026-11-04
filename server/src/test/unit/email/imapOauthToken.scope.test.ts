import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentGeneration: 'generation-new',
  axiosPost: vi.fn(),
  secretReads: [] as string[],
  filters: {} as Record<string, unknown>,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: () => ({
      where: (filter: Record<string, unknown>) => {
        Object.assign(mocks.filters, filter);
        return {
          andWhere: (column: string, value: unknown) => {
            mocks.filters[column] = value;
            return {
              update: async () => mocks.filters.credential_generation === mocks.currentGeneration ? 1 : 0,
            };
          },
        };
      },
    }),
  }),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: async (_tenant: string, key: string) => {
      mocks.secretReads.push(key);
      return key.endsWith('_generation-old') ? `secret:${key}` : undefined;
    },
  }),
}));
vi.mock('axios', () => ({ default: { post: mocks.axiosPost } }));
vi.mock('node:dns/promises', () => ({ default: { lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) } }));

import { refreshImapAccessToken } from '@alga-psa/shared/services/email/imapOauthToken';

describe('shared IMAP OAuth refresh generation guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentGeneration = 'generation-new';
    mocks.secretReads.length = 0;
    for (const key of Object.keys(mocks.filters)) delete mocks.filters[key];
    mocks.axiosPost.mockResolvedValue({ data: { access_token: 'old-scope-token', expires_in: 3600 } });
  });

  it('uses only generation-bound secrets and rejects a refresh response for an old generation', async () => {
    const provider: any = {
      id: 'provider-1',
      tenant: 'tenant-1',
      credential_generation: 'generation-old',
      oauth_token_url: 'https://idp.example.test/token',
      oauth_client_id: 'client-id',
      access_token: null,
      token_expires_at: null,
      refresh_token: 'refresh-token',
    };

    await expect(refreshImapAccessToken({ provider, db: { fn: { now: () => 'NOW' } } as any }))
      .rejects.toThrow(/credential scope changed/i);
    expect(mocks.secretReads).toEqual([
      'imap_oauth_client_secret_provider-1_generation-old',
      'imap_refresh_token_provider-1_generation-old',
    ]);
    expect(mocks.filters).toMatchObject({
      email_provider_id: 'provider-1',
      credential_generation: 'generation-old',
    });
    expect(provider.access_token).toBeNull();
  });

  it('does not save access-token state when the OAuth token endpoint redirects', async () => {
    const provider: any = {
      id: 'provider-1',
      tenant: 'tenant-1',
      credential_generation: 'generation-new',
      oauth_token_url: 'https://idp.example.test/token',
      oauth_client_id: 'client-id',
      access_token: null,
      token_expires_at: null,
      refresh_token: 'refresh-token',
    };
    mocks.axiosPost.mockRejectedValueOnce(Object.assign(new Error('OAuth token request redirected'), {
      response: { status: 302 },
    }));

    await expect(refreshImapAccessToken({ provider, db: { fn: { now: () => 'NOW' } } as any }))
      .rejects.toThrow(/redirected/i);

    expect(mocks.filters).toEqual({});
    expect(provider.access_token).toBeNull();
  });
});
