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
});
