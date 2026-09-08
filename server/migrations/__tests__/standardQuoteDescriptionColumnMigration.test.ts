import { createRequire } from 'node:module';
import path from 'node:path';
import type { Knex } from 'knex';
import { describe, expect, it } from 'vitest';
import type { TemplateAst, TemplateNode, TemplateTableColumn } from '@alga-psa/types';
import {
  STANDARD_QUOTE_TEMPLATE_ASTS,
} from '../../../packages/billing/src/lib/quote-template-ast/standardTemplates';

const require = createRequire(import.meta.url);
const MIGRATION_PATH = path.resolve(
  __dirname,
  '../20260908120000_stack_item_name_on_standard_quote_descriptions.cjs'
);

const migration = require(MIGRATION_PATH) as {
  up: (knex: Knex) => Promise<void>;
  down: (knex: Knex) => Promise<void>;
};

type Row = { template_id: string; templateAst: TemplateAst };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const collectDescriptionColumns = (node: TemplateNode, out: TemplateTableColumn[] = []): TemplateTableColumn[] => {
  if ((node.type === 'dynamic-table' || node.type === 'table') && Array.isArray(node.columns)) {
    out.push(...node.columns.filter((column) => column.id === 'description'));
  }
  if ('children' in node && Array.isArray(node.children)) {
    node.children.forEach((child) => collectDescriptionColumns(child, out));
  }
  return out;
};

// The seeded catalog rows predate the stacked cell: their Description column is
// bound straight to `description`. Recreate that shape from the shipped AST.
const buildSeededAst = (code: string): TemplateAst => {
  const ast = clone(STANDARD_QUOTE_TEMPLATE_ASTS[code]!);
  collectDescriptionColumns(ast.layout).forEach((column) => {
    column.value = { type: 'path', path: 'description' };
  });
  return ast;
};

const createFakeKnex = (rows: Row[]) => {
  const updatedIds: string[] = [];

  const knex = ((table: string) => {
    expect(table).toBe('standard_quote_document_templates');
    return {
      // JSONB comes back parsed and detached from the stored value, so hand out
      // clones: only an explicit update may change what the table holds.
      select: async () => rows.map((row) => ({ ...row, templateAst: clone(row.templateAst) })),
      where: (criteria: { template_id: string }) => ({
        update: async (patch: { templateAst: string }) => {
          const target = rows.find((row) => row.template_id === criteria.template_id);
          expect(target).toBeTruthy();
          target!.templateAst = JSON.parse(patch.templateAst) as TemplateAst;
          updatedIds.push(criteria.template_id);
        },
      }),
    };
  }) as unknown as Knex & { schema: unknown; fn: unknown };

  (knex as unknown as { schema: unknown }).schema = {
    hasTable: async () => true,
    hasColumn: async () => true,
  };
  (knex as unknown as { fn: unknown }).fn = { now: () => 'now()' };

  return { knex: knex as Knex, updatedIds };
};

// alga-2026-0002354 — the standard quote templates render from the global
// catalog table, not from the TypeScript module, so the stacked name/description
// cell only reaches users if this migration rewrites the seeded rows.
describe('stack item name on standard quote descriptions migration', () => {
  const codes = Object.keys(STANDARD_QUOTE_TEMPLATE_ASTS).sort();

  it('rewrites every seeded description column to the shipped expression', async () => {
    const rows: Row[] = codes.map((code) => ({ template_id: code, templateAst: buildSeededAst(code) }));
    const { knex, updatedIds } = createFakeKnex(rows);

    await migration.up(knex);

    expect(updatedIds.sort()).toEqual(codes);

    rows.forEach((row) => {
      const expected = collectDescriptionColumns(STANDARD_QUOTE_TEMPLATE_ASTS[row.template_id]!.layout);
      const actual = collectDescriptionColumns(row.templateAst.layout);

      expect(actual.length).toBe(expected.length);
      actual.forEach((column, index) => {
        expect(column.value).toEqual(expected[index]!.value);
        expect(column.value.type).toBe('template');
      });
    });
  });

  it('is idempotent', async () => {
    const rows: Row[] = codes.map((code) => ({ template_id: code, templateAst: buildSeededAst(code) }));
    const { knex } = createFakeKnex(rows);

    await migration.up(knex);
    const afterFirst = clone(rows);

    const second = createFakeKnex(rows);
    await migration.up(second.knex);

    expect(second.updatedIds).toEqual([]);
    expect(rows).toEqual(afterFirst);
  });

  it('restores the plain description binding on down', async () => {
    const rows: Row[] = codes.map((code) => ({ template_id: code, templateAst: buildSeededAst(code) }));
    const seeded = clone(rows);
    const { knex } = createFakeKnex(rows);

    await migration.up(knex);
    await migration.down(knex);

    expect(rows).toEqual(seeded);
  });

  it('leaves other columns untouched', async () => {
    const code = 'standard-quote-grouped';
    const rows: Row[] = [{ template_id: code, templateAst: buildSeededAst(code) }];
    const { knex } = createFakeKnex(rows);

    await migration.up(knex);

    const shipped = STANDARD_QUOTE_TEMPLATE_ASTS[code]!;
    expect(rows[0]!.templateAst).toEqual(shipped);
  });
});
