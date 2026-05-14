import { describe, expect, it, vi } from 'vitest';

import { upsertSearchDoc } from '../../lib/search/upsert';
import type { SearchDoc } from '../../lib/search/types';

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
    expect(sql).toContain('indexed_at = now()');
    expect(sql).toContain("setweight(to_tsvector('english', public.process_large_lexemes(?)), 'A')");
    expect(bindings).toContain('ACME Corp Updated');
    expect(bindings).toContain('Updated searchable body');
    expect(bindings.at(-1)).toEqual(doc.sourceUpdatedAt);
  });
});
