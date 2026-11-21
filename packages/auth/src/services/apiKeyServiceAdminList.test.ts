import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: () => ({
    table: () => {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const query: any = {
        select: () => query,
        where: (callback: Function) => {
          const clauses: Array<(row: Record<string, unknown>) => boolean> = [];
          const group = {
            whereNull: (column: string) => {
              clauses.push((row) => row[column.split('.').at(-1)!] == null);
              return group;
            },
            orWhereNot: (column: string, value: unknown) => {
              clauses.push((row) => row[column.split('.').at(-1)!] != null && row[column.split('.').at(-1)!] !== value);
              return group;
            },
          };
          callback.call(group);
          filters.push((row) => clauses.some((clause) => clause(row)));
          return query;
        },
        orderBy: () => query,
        then: (resolve: (rows: Array<Record<string, unknown>>) => unknown, reject: (error: unknown) => unknown) => {
          try {
            resolve(mocks.rows.filter((row) => filters.every((filter) => filter(row))));
          } catch (error) {
            reject(error);
          }
        },
      };
      return query;
    },
    tenantJoin: () => undefined,
  }),
}));

import { ApiKeyService } from './apiKeyService';

describe('ApiKeyService.listAllApiKeys administrative visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const knex: any = () => undefined;
    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    mocks.rows = [
      { api_key_id: 'ephemeral', purpose: 'mcp_agent', description: 'mcp-agent-session:temporary', user_type: 'service' },
      { api_key_id: 'mcp-permanent', purpose: 'service', description: 'permanent MCP key', user_type: 'service' },
      { api_key_id: 'service-permanent', purpose: 'service', description: 'mcp-agent-session permanent key', user_type: 'service' },
      { api_key_id: 'human', purpose: 'general', description: 'human key', user_type: 'internal' },
      { api_key_id: 'legacy', purpose: null, description: null, user_type: 'internal' },
    ];
  });

  it('filters only modeled mcp_agent purpose rows and preserves service, human, and legacy keys', async () => {
    const rows = await ApiKeyService.listAllApiKeys('tenant-1');

    expect(rows.map((row) => row.api_key_id)).toEqual([
      'mcp-permanent',
      'service-permanent',
      'human',
      'legacy',
    ]);
  });
});
