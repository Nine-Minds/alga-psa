import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  bundleChildRowsShowChange,
  detectBundleChildRowsPreset,
} from '@alga-psa/billing/lib/invoice-template-ast/bundleChildRows';
import { getStandardTemplateAstByCode } from '@alga-psa/billing/lib/invoice-template-ast/standardTemplates';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '../20261015090100_add_bundle_quantities_standard_invoice_template.cjs'));

const findChildRows = (node: any): any => {
  if (!node || typeof node !== 'object') return undefined;
  if (node.childRows) return node.childRows;
  return Object.values(node).map(findChildRows).find(Boolean);
};

describe('bundle quantities standard invoice template migration', () => {
  it('seeds the stock quantities preset with change enabled and matching the code template', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const table: any = () => ({
      where: () => ({ first: async () => undefined, update: async () => undefined }),
      insert,
    });
    table.schema = { hasTable: async () => true, hasColumn: async () => true };
    table.raw = (_sql: string, bindings: unknown[]) => ({ bindings });
    table.fn = { now: () => 'now' };

    await migration.up(table);

    expect(insert).toHaveBeenCalledTimes(1);
    const seeded = JSON.parse(insert.mock.calls[0][0].templateAst.bindings[0]);
    const seededChildRows = findChildRows(seeded);
    expect(seededChildRows).toBeTruthy();
    expect(detectBundleChildRowsPreset(seededChildRows)).toBe('quantities');
    expect(bundleChildRowsShowChange(seededChildRows)).toBe(true);
    expect(seededChildRows).toEqual(findChildRows(getStandardTemplateAstByCode('standard-bundle-quantities')));
  });
});
