import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = {
    rows: [] as any[],
    joins: [] as any[],
    wheres: [] as any[],
    selects: [] as any[],
  };
  const query: any = {
    where(...args: any[]) {
      state.wheres.push(args);
      return query;
    },
    orderBy() {
      return query;
    },
    async select(...columns: string[]) {
      state.selects.push(columns);
      return state.rows.map((row) => ({ ...row }));
    },
  };
  return {
    state,
    query,
    hasPermissionMock: vi.fn(async () => true),
  };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: hoisted.hasPermissionMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: (_knex: any, tenant: string) => ({
    table: (name: string) => {
      hoisted.state.wheres.push([{ table: name, tenant }]);
      return hoisted.query;
    },
    tenantJoin: (builder: any, table: string, left: string, right: string) => {
      hoisted.state.joins.push([table, left, right]);
      return builder;
    },
  }),
}));

import { getInteractionCallArtifacts } from './interactionCallArtifactActions';

describe('getInteractionCallArtifacts', () => {
  beforeEach(() => {
    hoisted.state.rows.length = 0;
    hoisted.state.joins.length = 0;
    hoisted.state.wheres.length = 0;
    hoisted.state.selects.length = 0;
    hoisted.hasPermissionMock.mockReset();
    hoisted.hasPermissionMock.mockResolvedValue(true);
  });

  it('T172: returns the call artifacts joined through the call record of the interaction, tenant-scoped', async () => {
    hoisted.state.rows.push(
      { artifact_id: 'a-1', artifact_type: 'transcript', document_id: 'doc-1', file_id: null, created_date_time: '2026-09-15T10:00:00.000Z' },
      { artifact_id: 'a-2', artifact_type: 'recording', document_id: null, file_id: 'file-1', created_date_time: null },
    );

    const result = await getInteractionCallArtifacts('interaction-1');

    expect(result).toEqual({
      artifacts: [
        { artifactId: 'a-1', artifactType: 'transcript', documentId: 'doc-1', fileId: null, createdDateTime: '2026-09-15T10:00:00.000Z' },
        { artifactId: 'a-2', artifactType: 'recording', documentId: null, fileId: 'file-1', createdDateTime: null },
      ],
    });
    expect(hoisted.state.wheres[0]).toEqual([{ table: 'telephony_call_artifacts as artifact', tenant: 'tenant-1' }]);
    expect(hoisted.state.wheres).toContainEqual(['call.interaction_id', 'interaction-1']);
    expect(hoisted.state.joins).toEqual([['telephony_call_records as call', 'artifact.call_record_id', 'call.call_record_id']]);
  });

  it('T173: an interaction without artifacts yields an empty list', async () => {
    await expect(getInteractionCallArtifacts('interaction-2')).resolves.toEqual({ artifacts: [] });
  });

  it('rejects missing interaction ids before querying', async () => {
    await expect(getInteractionCallArtifacts('')).rejects.toThrow('Interaction ID is required');
    expect(hoisted.state.selects).toHaveLength(0);
  });

  it('rejects callers without interaction:read', async () => {
    hoisted.hasPermissionMock.mockResolvedValue(false);

    await expect(getInteractionCallArtifacts('interaction-1')).rejects.toThrow('Forbidden');
    expect(hoisted.state.selects).toHaveLength(0);
  });
});
