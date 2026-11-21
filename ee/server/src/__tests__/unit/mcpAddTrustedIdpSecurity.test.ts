import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ inserts: [] as Record<string, unknown>[] }));
vi.mock('@ee/lib/mcp/idpPresets', () => ({
  resolveIdpFromPreset: vi.fn(async () => ({
    issuer: 'https://[::1]/issuer',
    jwksUri: 'https://[::ffff:127.0.0.1]/metadata-key',
    subjectClaim: 'sub',
  })),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  runWithTenant: vi.fn(async (_tenant: string, fn: () => unknown) => fn()),
  getConnection: vi.fn(),
  tenantDb: vi.fn(() => ({
    table: () => ({
      insert: (row: Record<string, unknown>) => {
        db.inserts.push(row);
        return { onConflict: () => ({ merge: vi.fn() }) };
      },
    }),
  })),
}));

import { addTrustedIdp } from '@ee/lib/mcp/agents';

describe('addTrustedIdp destination validation', () => {
  beforeEach(() => {
    db.inserts.length = 0;
  });

  it('rejects a discovered unsafe JWKS destination before persistence', async () => {
    await expect(addTrustedIdp({
      tenant: 'tenant-1',
      kind: 'google',
      audience: 'mcp-resource',
    })).rejects.toThrow();
    expect(db.inserts).toHaveLength(0);
  });
});
