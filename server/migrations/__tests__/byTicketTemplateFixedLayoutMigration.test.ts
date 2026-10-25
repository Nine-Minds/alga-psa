import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getStandardTemplateAstByCode } from '@alga-psa/billing/lib/invoice-template-ast/standardTemplates';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '../20261022210000_by_ticket_template_fixed_layout.cjs'));

const findNode = (node: any, id: string): any =>
  node?.id === id ? node : (node?.children ?? []).map((c: any) => findNode(c, id)).find(Boolean);

/** The by-ticket AST as the earlier migrations left it: no fixed layout, old widths. */
const legacyAst = () => {
  const ast = structuredClone(getStandardTemplateAstByCode('standard-invoice-by-ticket')) as any;
  const table = findNode(ast.layout, 'ticket-time-summary');
  delete table.style.inline.tableLayout;
  const old: Record<string, string> = { ticket: '26%', 'ticket-description': '34%', 'ticket-hours': '10%', 'ticket-rate': '14%', 'ticket-amount': '16%' };
  for (const column of table.columns) column.style = { inline: { width: old[column.id], ...(column.style.inline.textAlign ? { textAlign: 'right' } : {}) } };
  return ast;
};

const fakeKnex = (row: any) => {
  const update = vi.fn().mockResolvedValue(1);
  const builder: any = { where: () => builder, first: async () => row, update };
  const knex: any = () => builder;
  return { knex, update };
};

describe('by-ticket fixed layout migration', () => {
  it('updates the stock row to the code template layout', async () => {
    const { knex, update } = fakeKnex({ templateAst: JSON.stringify(legacyAst()) });
    await migration.up(knex);
    expect(update).toHaveBeenCalledTimes(1);
    const written = JSON.parse(update.mock.calls[0][0].templateAst);
    expect(findNode(written.layout, 'ticket-time-summary')).toEqual(
      findNode(getStandardTemplateAstByCode('standard-invoice-by-ticket')!.layout, 'ticket-time-summary'),
    );
  });

  it('is idempotent', async () => {
    const first = fakeKnex({ templateAst: JSON.stringify(legacyAst()) });
    await migration.up(first.knex);
    const second = fakeKnex({ templateAst: first.update.mock.calls[0][0].templateAst });
    await migration.up(second.knex);
    expect(second.update).not.toHaveBeenCalled();
  });

  it('skips a row whose summary table is no longer the stock one, and a missing row', async () => {
    const ast = legacyAst();
    findNode(ast.layout, 'ticket-time-summary').columns.pop();
    const custom = fakeKnex({ templateAst: ast });
    await migration.up(custom.knex);
    expect(custom.update).not.toHaveBeenCalled();
    const none = fakeKnex(undefined);
    await migration.up(none.knex);
    expect(none.update).not.toHaveBeenCalled();
  });
});
