import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTenantInstall } from './registry';

const mocks = vi.hoisted(() => ({
  getAdminConnection: vi.fn(),
  tenantDb: vi.fn(),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: mocks.getAdminConnection,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: mocks.tenantDb,
}));

interface RecordedRow {
  install_id: string;
  version_id: string;
  tenant_id: string;
}

function buildTable(recorder: { wheres: unknown[] }, row: RecordedRow | null) {
  const chain: any = {
    select: () => chain,
    where: (...args: unknown[]) => {
      recorder.wheres.push(['where', ...args]);
      return chain;
    },
    andWhere: (...args: unknown[]) => {
      recorder.wheres.push(['andWhere', ...args]);
      return chain;
    },
    first: async () => row,
  };
  return chain;
}

describe('extension gateway fallback install resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminConnection.mockResolvedValue({ conn: true });
  });

  it('requires both is_enabled=true and status=enabled, matching the canonical active-install predicate', async () => {
    const recorder: { wheres: unknown[] } = { wheres: [] };
    mocks.tenantDb.mockImplementation(() => ({
      table: () =>
        buildTable(recorder, { install_id: 'install-1', version_id: 'version-1', tenant_id: 'tenant-a' }),
    }));

    const result = await getTenantInstall('tenant-a', 'registry-1');

    expect(result).toEqual({ install_id: 'install-1', version_id: 'version-1', tenant_id: 'tenant-a' });
    const clauses = recorder.wheres.map((entry) => JSON.stringify(entry));
    expect(clauses).toContain(JSON.stringify(['where', 'ti.registry_id', 'registry-1']));
    expect(clauses).toContain(JSON.stringify(['andWhere', 'ti.is_enabled', true]));
    expect(clauses).toContain(JSON.stringify(['andWhere', 'ti.status', 'enabled']));
  });

  it('returns null when no row matches, so a status-disabled install is denied on this fallback path too', async () => {
    mocks.tenantDb.mockImplementation(() => ({ table: () => buildTable({ wheres: [] }, null) }));

    expect(await getTenantInstall('tenant-a', 'registry-1')).toBeNull();
  });
});
