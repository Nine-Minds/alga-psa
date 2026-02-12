import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  tenant: 'tenant-test',
  user: { user_type: 'internal' } as any,
  hasPermission: vi.fn(async () => true),
}));

let knexStub: any;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(authState.user, { tenant: authState.tenant }, ...args),
  hasPermission: (...args: any[]) => authState.hasPermission(...args),
}));

vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexStub, tenant: authState.tenant })),
}));

import { fetchExtensionVersions } from '@ee/lib/actions/extensionVersionActions';

type VersionRow = {
  id: string;
  registry_id: string;
  version: string;
  created_at: Date;
};

type BundleRow = {
  version_id: string;
  content_hash: string;
  created_at: Date;
};

function createKnexStub(input: {
  versions: VersionRow[];
  bundles: BundleRow[];
  installVersionId?: string | null;
}) {
  const { versions, bundles, installVersionId = null } = input;

  return (table: string) => {
    if (table === 'extension_version') {
      const state: { registryId?: string } = {};
      return {
        where(whereClause: { registry_id?: string }) {
          state.registryId = whereClause.registry_id;
          return this;
        },
        select() {
          return this;
        },
        orderBy() {
          const rows = versions
            .filter((row) => row.registry_id === state.registryId)
            .slice()
            .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.id.localeCompare(a.id));
          return Promise.resolve(rows);
        },
      };
    }

    if (table === 'extension_bundle') {
      const state: { versionIds: string[] } = { versionIds: [] };
      return {
        whereIn(_column: string, values: string[]) {
          state.versionIds = values;
          return this;
        },
        select() {
          return this;
        },
        orderBy() {
          const rows = bundles
            .filter((row) => state.versionIds.includes(row.version_id))
            .slice()
            .sort((a, b) => {
              if (a.version_id !== b.version_id) return a.version_id.localeCompare(b.version_id);
              const byTime = b.created_at.getTime() - a.created_at.getTime();
              if (byTime !== 0) return byTime;
              return b.content_hash.localeCompare(a.content_hash);
            });
          return Promise.resolve(rows);
        },
      };
    }

    if (table === 'tenant_extension_install') {
      return {
        where() {
          return this;
        },
        first() {
          return Promise.resolve(installVersionId ? { version_id: installVersionId } : undefined);
        },
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  };
}

describe('Extension versions list action', () => {
  beforeEach(() => {
    authState.user = { user_type: 'internal' };
    authState.hasPermission.mockReset();
    authState.hasPermission.mockResolvedValue(true);
  });

  it('T011: returns all versions for extension sorted newest first', async () => {
    knexStub = createKnexStub({
      versions: [
        { id: 'v1', registry_id: 'ext-1', version: '1.0.0', created_at: new Date('2026-01-01T00:00:00.000Z') },
        { id: 'v2', registry_id: 'ext-1', version: '1.1.0', created_at: new Date('2026-01-02T00:00:00.000Z') },
        { id: 'v3', registry_id: 'ext-1', version: '2.0.0', created_at: new Date('2026-01-03T00:00:00.000Z') },
      ],
      bundles: [],
    });

    const rows = await fetchExtensionVersions('ext-1');

    expect(rows.map((row) => row.version)).toEqual(['2.0.0', '1.1.0', '1.0.0']);
  });

  it('T012: includes version string and publish timestamp fields', async () => {
    knexStub = createKnexStub({
      versions: [{ id: 'v1', registry_id: 'ext-1', version: '1.2.3', created_at: new Date('2026-01-04T00:00:00.000Z') }],
      bundles: [],
    });

    const [row] = await fetchExtensionVersions('ext-1');

    expect(typeof row.version).toBe('string');
    expect(row.version).toBe('1.2.3');
    expect(row.publishedAt instanceof Date).toBe(true);
    expect(Number.isNaN(row.publishedAt.getTime())).toBe(false);
  });

  it('T013: includes deterministic latest content hash metadata per version', async () => {
    knexStub = createKnexStub({
      versions: [{ id: 'v1', registry_id: 'ext-1', version: '1.0.0', created_at: new Date('2026-01-01T00:00:00.000Z') }],
      bundles: [
        {
          version_id: 'v1',
          content_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          created_at: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          version_id: 'v1',
          content_hash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          created_at: new Date('2026-01-02T00:00:00.000Z'),
        },
      ],
    });

    const [row] = await fetchExtensionVersions('ext-1');

    expect(row.contentHash).toBe('sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('T014: marks installed=true only for row matching tenant_extension_install.version_id', async () => {
    knexStub = createKnexStub({
      versions: [
        { id: 'v1', registry_id: 'ext-1', version: '1.0.0', created_at: new Date('2026-01-01T00:00:00.000Z') },
        { id: 'v2', registry_id: 'ext-1', version: '2.0.0', created_at: new Date('2026-01-02T00:00:00.000Z') },
      ],
      bundles: [],
      installVersionId: 'v2',
    });

    const rows = await fetchExtensionVersions('ext-1');

    const byVersion = new Map(rows.map((row) => [row.version, row.installed]));
    expect(byVersion.get('2.0.0')).toBe(true);
    expect(byVersion.get('1.0.0')).toBe(false);
    expect(rows.filter((row) => row.installed)).toHaveLength(1);
  });

  it('T015: without install row, all rows are installed=false', async () => {
    knexStub = createKnexStub({
      versions: [
        { id: 'v1', registry_id: 'ext-1', version: '1.0.0', created_at: new Date('2026-01-01T00:00:00.000Z') },
        { id: 'v2', registry_id: 'ext-1', version: '1.1.0', created_at: new Date('2026-01-02T00:00:00.000Z') },
      ],
      bundles: [],
      installVersionId: null,
    });

    const rows = await fetchExtensionVersions('ext-1');

    expect(rows.length).toBe(2);
    expect(rows.every((row) => row.installed === false)).toBe(true);
  });

  it('T016: legacy one-version multi-bundle data returns one deterministic viewer row', async () => {
    knexStub = createKnexStub({
      versions: [{ id: 'v3', registry_id: 'ext-1', version: '3.0.0', created_at: new Date('2026-01-01T00:00:00.000Z') }],
      bundles: [
        {
          version_id: 'v3',
          content_hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
          created_at: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          version_id: 'v3',
          content_hash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
          created_at: new Date('2026-01-02T00:00:00.000Z'),
        },
      ],
    });

    const rows = await fetchExtensionVersions('ext-1');

    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe('3.0.0');
    expect(rows[0].contentHash).toBe('sha256:2222222222222222222222222222222222222222222222222222222222222222');
  });

  it('T021: unauthorized caller cannot access version-list action without extension read permission', async () => {
    knexStub = createKnexStub({
      versions: [{ id: 'v1', registry_id: 'ext-1', version: '1.0.0', created_at: new Date('2026-01-01T00:00:00.000Z') }],
      bundles: [],
    });

    authState.hasPermission.mockResolvedValue(false);

    await expect(fetchExtensionVersions('ext-1')).rejects.toThrow('Insufficient permissions');
  });

  it('T022: authorized extension-read caller can access version-list action', async () => {
    knexStub = createKnexStub({
      versions: [{ id: 'v1', registry_id: 'ext-1', version: '1.0.0', created_at: new Date('2026-01-01T00:00:00.000Z') }],
      bundles: [],
    });

    authState.hasPermission.mockResolvedValue(true);

    const rows = await fetchExtensionVersions('ext-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe('1.0.0');
  });
});
