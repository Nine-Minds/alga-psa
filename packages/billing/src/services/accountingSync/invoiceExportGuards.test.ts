import { describe, expect, it, vi } from 'vitest';
import { assertInvoiceNotExported, findInvoiceAccountingMapping } from './invoiceExportGuards';

function makeKnex(mappingRow: { id: string } | undefined) {
  const firstMapping = vi.fn(async () => mappingRow);
  const secondFirst = vi.fn(async () => undefined);
  const makeQuery = (first: ReturnType<typeof vi.fn>) => {
    const query: any = {
      where: vi.fn(() => query),
      join: vi.fn(() => query),
      whereIn: vi.fn(() => query),
      whereNotIn: vi.fn(() => query),
      orWhereIn: vi.fn(() => query),
      first,
    };
    return query;
  };
  const mappingQuery = makeQuery(firstMapping);
  const batchQuery = makeQuery(secondFirst);
  const knex: any = vi.fn((table: string) => table === 'tenant_external_entity_mappings' ? mappingQuery : batchQuery);
  knex.__where = mappingQuery.where;
  return knex;
}

describe('invoiceExportGuards', () => {
  it('looks up invoice mappings by tenant and entity, regardless of supported provider', async () => {
    const knex = makeKnex(undefined);

    await findInvoiceAccountingMapping(knex, 't1', 'inv-1');

    expect(knex).toHaveBeenCalledWith('tenant_external_entity_mappings');
    expect(knex.__where).toHaveBeenCalledWith({
      tenant: 't1',
      alga_entity_type: 'invoice',
      alga_entity_id: 'inv-1'
    });
  });

  it('unfinalize: throws when the invoice has an accounting mapping', async () => {
    const knex = makeKnex({ id: 'map-1' });

    await expect(assertInvoiceNotExported(knex, 't1', 'inv-1', 'unfinalize')).rejects.toThrow(
      /cannot be reopened/i
    );
  });

  it('delete: throws with the void-instead message when mapped', async () => {
    const knex = makeKnex({ id: 'map-1' });

    await expect(assertInvoiceNotExported(knex, 't1', 'inv-1', 'delete')).rejects.toThrow(
      /void it instead of deleting/i
    );
  });

  it('resolves silently when the invoice has no mapping', async () => {
    const knex = makeKnex(undefined);

    await expect(assertInvoiceNotExported(knex, 't1', 'inv-1', 'unfinalize')).resolves.toBeUndefined();
    await expect(assertInvoiceNotExported(knex, 't1', 'inv-1', 'delete')).resolves.toBeUndefined();
  });
});
