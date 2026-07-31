import { describe, expect, it, vi } from 'vitest';

import { deleteSearchDoc, upsertSearchDoc } from '@alga-psa/search/upsert';
import type { SearchDoc } from '@alga-psa/types';

const sampleDoc = (overrides: Partial<SearchDoc> = {}): SearchDoc => ({
  tenant: '11111111-1111-4111-8111-111111111111',
  objectType: 'client',
  objectId: 'client-1',
  title: 'ACME Corp',
  subtitle: 'support@acme.example',
  body: 'Priority client notes',
  url: '/msp/clients/client-1',
  metadata: { identifier: 'ACME' },
  acl: {
    requiredPermission: 'client:read',
  },
  sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
  ...overrides,
});

function createRawKnex() {
  return {
    raw: vi.fn().mockResolvedValue({ rows: [] }),
  };
}

function createDeleteKnex(deletedRows = 0) {
  const queryBuilder = {
    where: vi.fn().mockReturnThis(),
    delete: vi.fn().mockResolvedValue(deletedRows),
  };
  const knex = vi.fn().mockReturnValue(queryBuilder);
  return { knex, queryBuilder };
}

describe('search index upsert helpers', () => {
  it('T023 emits an insert for a new app_search_index row', async () => {
    const knex = createRawKnex();
    const doc = sampleDoc();

    await upsertSearchDoc(knex as never, doc);

    expect(knex.raw).toHaveBeenCalledTimes(1);
    const [sql, bindings] = knex.raw.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO app_search_index');
    expect(sql).toContain('tenant,');
    expect(sql).toContain('object_type,');
    expect(sql).toContain('object_id,');
    expect(sql).toContain('search_vector,');
    expect(sql).toContain('ON CONFLICT (tenant, object_type, object_id)');
    expect(bindings.slice(0, 10)).toEqual([
      doc.tenant,
      doc.objectType,
      doc.objectId,
      null,
      null,
      doc.title,
      doc.subtitle,
      doc.body,
      doc.url,
      JSON.stringify(doc.metadata),
    ]);
  });

  it('T024 refreshes an existing app_search_index row on conflict', async () => {
    const knex = createRawKnex();
    const doc = sampleDoc({
      title: 'ACME Corp Updated',
      body: 'Updated searchable body',
      sourceUpdatedAt: new Date('2026-05-14T09:15:00.000Z'),
    });

    await upsertSearchDoc(knex as never, doc);

    const [sql, bindings] = knex.raw.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('DO UPDATE SET');
    expect(sql).toContain('title = EXCLUDED.title');
    expect(sql).toContain('body = EXCLUDED.body');
    expect(sql).toContain('search_vector = EXCLUDED.search_vector');
    expect(sql).toContain('source_updated_at = EXCLUDED.source_updated_at');
    // indexed_at must be a bound param, not now(): Citus forbids non-IMMUTABLE
    // functions in the DO UPDATE SET clause of distributed-table upserts.
    expect(sql).toContain('indexed_at = ?');
    expect(sql).not.toContain('indexed_at = now()');
    expect(sql).toContain("setweight(public.process_large_lexemes(?), 'A')");
    expect(bindings).toContain('ACME Corp Updated');
    expect(bindings).toContain('Updated searchable body');
    // ...source_updated_at, then the same indexedAt bound twice (VALUES + DO UPDATE)
    const indexedAt = bindings.at(-1);
    expect(indexedAt).toBeInstanceOf(Date);
    expect(bindings.at(-2)).toBe(indexedAt);
    expect(bindings.at(-3)).toEqual(doc.sourceUpdatedAt);
  });

  it('T025 deletes a search row by tenant/type/id and tolerates no matching row', async () => {
    const { knex, queryBuilder } = createDeleteKnex(0);

    await expect(
      deleteSearchDoc(
        knex as never,
        '11111111-1111-4111-8111-111111111111',
        'client',
        'client-1',
      ),
    ).resolves.toBeUndefined();

    expect(knex).toHaveBeenCalledWith('app_search_index');
    // tenantDb applies the tenant predicate as a qualified column on the root query.
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'app_search_index.tenant',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(queryBuilder.where).toHaveBeenCalledWith({
      object_type: 'client',
      object_id: 'client-1',
    });
    expect(queryBuilder.delete).toHaveBeenCalledTimes(1);
  });

  it('T026 concurrent upserts for the same key use the conflict target and last call wins', async () => {
    const store = new Map<string, { title: unknown; body: unknown }>();
    const knex = {
      raw: vi.fn(async (sql: string, bindings: unknown[]) => {
        expect(sql).toContain('ON CONFLICT (tenant, object_type, object_id)');
        const key = [bindings[0], bindings[1], bindings[2]].join(':');
        store.set(key, {
          title: bindings[5],
          body: bindings[7],
        });
        return { rows: [] };
      }),
    };

    await Promise.all([
      upsertSearchDoc(knex as never, sampleDoc({ title: 'ACME old', body: 'old body' })),
      upsertSearchDoc(knex as never, sampleDoc({ title: 'ACME newest', body: 'new body' })),
    ]);

    expect(knex.raw).toHaveBeenCalledTimes(2);
    expect(store).toHaveLength(1);
    expect([...store.values()][0]).toEqual({
      title: 'ACME newest',
      body: 'new body',
    });
  });

  it('T179 co-locates Citus upsert writes by tenant', async () => {
    const knex = createRawKnex();
    const doc = sampleDoc({
      tenant: '22222222-2222-4222-8222-222222222222',
      objectType: 'ticket',
      objectId: 'ticket-1',
      title: 'Tenant-local ticket',
    });

    await upsertSearchDoc(knex as never, doc);

    const [sql, bindings] = knex.raw.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO app_search_index');
    expect(sql).toContain('VALUES (\n        ?::uuid,');
    expect(sql).toContain('ON CONFLICT (tenant, object_type, object_id)');
    expect(bindings[0]).toBe(doc.tenant);
    expect(bindings[1]).toBe(doc.objectType);
    expect(bindings[2]).toBe(doc.objectId);
  });

  it('T183 invokes process_large_lexemes when computing search_vector', async () => {
    const knex = createRawKnex();

    await upsertSearchDoc(knex as never, sampleDoc({
      title: 'Vector title',
      subtitle: 'Vector subtitle',
      body: 'Vector body',
    }));

    const [sql] = knex.raw.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("setweight(public.process_large_lexemes(?), 'A')");
    expect(sql).toContain("setweight(public.process_large_lexemes(?), 'B')");
    expect(sql).toContain("setweight(public.process_large_lexemes(?), 'C')");
  });
});
