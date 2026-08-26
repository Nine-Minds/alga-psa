import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');

describe('interaction table pagination contract', () => {
  it('builds tenant-scoped hydrated count and data queries with stable server pagination', () => {
    const source = read('./interactions.ts');
    const method = source.slice(source.indexOf('static async getInteractionsPage('));

    expect(method).toContain("facade.table('interactions as i')");
    for (const table of [
      'interaction_types as it',
      'system_interaction_types as sit',
      'contacts as c',
      'clients as cl',
      'users as u',
      'statuses as s',
    ]) {
      expect(method).toContain(`facade.tenantJoin(query, '${table}'`);
    }
    expect(method).toContain("countDistinct('i.interaction_id as count')");
    expect(method).toContain(".orderBy('i.interaction_date', 'desc')");
    expect(method).toContain(".orderBy('i.interaction_id', 'desc')");
    expect(method).toContain('.limit(pageSize)');
    expect(method).toContain('.offset((page - 1) * pageSize)');
    expect(method).toContain("filters.pageSize ?? 10");
  });

  it('keeps the authenticated action permission-checked and transaction-bound', () => {
    const source = read('../actions/interactionActions.ts');
    const action = source.slice(source.indexOf('export const getInteractionsPage'));

    expect(action).toContain("assertMspPermission(user, 'interaction', 'read'");
    expect(action).toContain('withTransaction(knex, async (trx: Knex.Transaction)');
    expect(action).toContain('InteractionModel.getInteractionsPage(filters, tenant, trx)');
  });
});
