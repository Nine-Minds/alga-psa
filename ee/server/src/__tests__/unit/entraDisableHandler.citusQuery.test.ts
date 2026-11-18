import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const runWithTenantMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

import {
  excludeSharedMailboxEntraIdentities,
  selectDeactivatableExcludedEntraIdentities,
  selectLinkedEntraIdentities,
} from '@ee/lib/integrations/entra/sync/disableHandler';

const sqlKnex = knexFactory({ client: 'pg' });

afterAll(async () => {
  await sqlKnex.destroy();
});

interface CapturedQuery {
  sql: string;
  bindings: readonly unknown[];
}

/**
 * Hand the handler a real pg builder that records its SQL instead of connecting.
 *
 * The defect these cover is invisible from the returned rows: joining `contacts`
 * to `entra_contact_links` without the tenant makes Citus plan a re-partition
 * join that ships intermediate results over loopback connections, which dies
 * with "cannot connect to /var/run/postgresql:5432 to fetch intermediate
 * results" whenever the coordinator is out of connection slots. Only the
 * generated SQL shows it.
 */
function recordingKnex(captured: CapturedQuery[]) {
  return Object.assign(
    vi.fn((table: string) => {
      const builder: any = sqlKnex(table);
      builder.then = function recordingThen(onFulfilled?: any, onRejected?: any) {
        const compiled = builder.toSQL();
        captured.push({ sql: compiled.sql, bindings: compiled.bindings });
        return Promise.resolve([]).then(onFulfilled, onRejected);
      };
      return builder;
    }),
    { raw: (sql: string, bindings?: unknown) => sqlKnex.raw(sql, bindings as any) }
  ) as any;
}

const identity = { entraTenantId: 'entra-tenant-1', entraObjectId: 'entra-object-1' };

describe('disableHandler Citus-safe query shapes', () => {
  beforeEach(() => {
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
  });

  function run(handler: (tenantId: string, identities: typeof identity[]) => Promise<unknown>) {
    const captured: CapturedQuery[] = [];
    createTenantKnexMock.mockResolvedValue({ knex: recordingKnex(captured), tenant: 'tenant-1' });
    return handler('tenant-1', [identity]).then(() => captured);
  }

  it('scopes the deactivatable-exclusion contact join by tenant', async () => {
    const [query, ...rest] = await run(selectDeactivatableExcludedEntraIdentities);

    expect(rest).toEqual([]);
    expect(query.sql).toMatch(
      /inner join "contacts" as "contact" on "link"\."contact_name_id" = "contact"\."contact_name_id" and "contact"\."tenant" = "link"\."tenant"/i
    );
    // Exactly one contacts join, and it carries the tenant conjunct.
    expect(query.sql.match(/join "contacts"/gi)).toHaveLength(1);
    expect(query.sql.match(/"contact"\."tenant" = "link"\."tenant"/g)).toHaveLength(1);

    // The root scope and the eligibility predicates are unchanged.
    expect(query.sql).toMatch(/where "link"\."tenant" = \?/i);
    expect(query.bindings[0]).toBe('tenant-1');
    expect(query.sql).toMatch(/"link"\."is_active" = \?/i);
    expect(query.sql).toMatch(/"contact"\."is_inactive" = \?/i);
    expect(query.sql).toMatch(/"contact"\."entra_sync_status_reason" is null/i);
    expect(query.sql).toMatch(/select "link"\."contact_name_id"/i);
    expect(query.bindings).toEqual([
      'tenant-1',
      identity.entraTenantId,
      identity.entraObjectId,
      true,
      false,
    ]);
  });

  it.each([
    ['selectLinkedEntraIdentities', selectLinkedEntraIdentities],
    ['excludeSharedMailboxEntraIdentities', excludeSharedMailboxEntraIdentities],
    ['selectDeactivatableExcludedEntraIdentities', selectDeactivatableExcludedEntraIdentities],
  ] as const)('%s joins contacts through the tenant facade', async (_name, handler) => {
    const captured = await run(handler as any);

    expect(captured).not.toHaveLength(0);
    for (const query of captured) {
      expect(query.sql).toMatch(/join "contacts" as "contact" on /i);
      expect(query.sql).toMatch(/and "contact"\."tenant" = "link"\."tenant"/i);
    }
  });
});
