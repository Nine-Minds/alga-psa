import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * addTrustedIdp write side: a trusted agent IdP must carry an audience for
 * every kind, refused before any discovery call, and stored trimmed.
 */
const inserted: Record<string, unknown>[] = [];
const merge = vi.fn().mockResolvedValue(undefined);

vi.mock('@ee/lib/mcp/idpPresets', () => ({
  resolveIdpFromPreset: vi.fn(async () => ({ issuer: 'https://idp.test', jwksUri: 'https://idp.test/jwks', subjectClaim: 'sub' })),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  runWithTenant: vi.fn(async (_t: string, fn: () => unknown) => fn()),
  getConnection: vi.fn(),
  tenantDb: vi.fn(() => ({
    table: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return { onConflict: () => ({ merge }) };
      },
      where: () => ({ first: async () => ({ ...inserted[0] }) }),
    }),
  })),
}));

import { addTrustedIdp } from '@ee/lib/mcp/agents';
import { resolveIdpFromPreset } from '@ee/lib/mcp/idpPresets';

beforeEach(() => {
  inserted.length = 0;
  vi.clearAllMocks();
});

const base = { tenant: 't1', issuer: 'https://idp.test', jwksUri: 'https://idp.test/jwks', entraTenantId: 'tid' };

describe('addTrustedIdp audience requirement', () => {
  for (const kind of ['custom', 'google', 'microsoft'] as const) {
    for (const audience of [undefined, '', '   ']) {
      it(`rejects ${kind} with audience ${JSON.stringify(audience)} before discovery`, async () => {
        await expect(addTrustedIdp({ ...base, kind, audience })).rejects.toThrow(/audience/i);
        expect(resolveIdpFromPreset).not.toHaveBeenCalled();
        expect(inserted).toHaveLength(0);
      });
    }
    it(`persists the trimmed audience for ${kind}`, async () => {
      await addTrustedIdp({ ...base, kind, audience: '  api://mcp  ' });
      expect(inserted[0].audience).toBe('api://mcp');
    });
  }
});
