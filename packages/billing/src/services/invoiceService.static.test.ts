import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(testDir, 'invoiceService.ts'), 'utf8');

describe('invoiceService time-entry link contract', () => {
  it('persists invoice_charges.item_id into invoice_time_entries for time charges only', () => {
    expect(source).toContain('invoiceItemId: string');
    expect(source).toContain('invoiceItemId: invoiceItem.item_id');
    expect(source).toContain("if (charge.type === 'time')");
    expect(source).toContain("tenantScopedTable(tx, tenant, 'invoice_time_entries').insert");
    expect(source).toContain('item_id: invoiceItemId');
    expect(source).toContain('entry_id: entryId');
    expect(source).toContain('return;');
  });
});
