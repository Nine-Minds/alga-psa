import { describe, expect, it, vi } from 'vitest';
import { assertInvoiceNotExported, findInvoiceAccountingMapping } from './invoiceExportGuards';

function makeKnex(mappingRow: { id: string } | undefined) {
  const first = vi.fn(async () => mappingRow);
  const where = vi.fn(() => ({ first }));
  const knex: any = vi.fn(() => ({ where }));
  knex.__where = where;
  return knex;
}

describe('invoiceExportGuards', () => {
  it('looks up the invoice mapping by tenant, integration type, and entity', async () => {
    const knex = makeKnex(undefined);

    await findInvoiceAccountingMapping(knex, 't1', 'inv-1');

    expect(knex).toHaveBeenCalledWith('tenant_external_entity_mappings');
    expect(knex.__where).toHaveBeenCalledWith({
      tenant: 't1',
      integration_type: 'quickbooks_online',
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
