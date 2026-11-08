import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  bundleChildRowsShowChange,
  detectBundleChildRowsPreset,
} from '@alga-psa/billing/lib/invoice-template-ast/bundleChildRows';
import { getStandardTemplateAstByCode } from '@alga-psa/billing/lib/invoice-template-ast/standardTemplates';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '../20261107120100_add_bundle_quantities_standard_invoice_template.cjs'));

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

  it('refreshes only its own catalog entry on repeated runs', async () => {
    const ownCode = 'standard-bundle-quantities';
    const unrelated = { standard_invoice_template_code: 'standard-default', templateAst: 'unchanged' };
    const own = { standard_invoice_template_code: ownCode, templateAst: 'outdated', created_at: 'original' };
    const rows: Record<string, any> = { [ownCode]: own, 'standard-default': unrelated };
    const insert = vi.fn();
    const table: any = () => ({
      where: ({ standard_invoice_template_code: code }: { standard_invoice_template_code: string }) => ({
        first: async () => rows[code],
        update: async (values: unknown) => Object.assign(rows[code], values),
      }),
      insert,
    });
    table.schema = { hasTable: async () => true, hasColumn: async () => true };
    table.raw = (_sql: string, bindings: unknown[]) => ({ bindings });
    table.fn = { now: () => 'now' };

    await migration.up(table);
    const refreshed = structuredClone(own);
    await migration.up(table);

    expect(insert).not.toHaveBeenCalled();
    expect(own).toEqual(refreshed);
    expect(own.created_at).toBe('original');
    expect(unrelated).toEqual({ standard_invoice_template_code: 'standard-default', templateAst: 'unchanged' });
    const seeded = JSON.parse((own.templateAst as any).bindings[0]);
    expect(findChildRows(seeded)).toEqual(findChildRows(getStandardTemplateAstByCode(ownCode)));
  });
});
