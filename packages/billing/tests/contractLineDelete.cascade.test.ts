import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  requireTenantId: vi.fn(async () => 'tenant-1'),
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
    unscoped: (table: string) => conn(table)
  })
}));

import ContractLine from '../src/models/contractLine';

type Op = { table: string; type: 'count' | 'delete'; where: Record<string, unknown> };

function makeKnex(rows: Record<string, number>) {
  const ops: Op[] = [];

  function builder(table: string) {
    const state: { where: Record<string, unknown> } = { where: {} };
    const b: any = {};
    b.where = (filters: Record<string, unknown>) => {
      state.where = { ...state.where, ...filters };
      return b;
    };
    b.count = (_col: string) => {
      ops.push({ table, type: 'count', where: state.where });
      return {
        first: async () => ({ count: String(rows[table] ?? 0) })
      };
    };
    b.delete = async () => {
      ops.push({ table, type: 'delete', where: state.where });
      return rows[table] === undefined ? 1 : rows[table];
    };
    return b;
  }

  const knex: any = (table: string) => builder(table);
  return { knex, ops };
}

describe('ContractLine.delete cascade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes contract_line_service_configuration and contract_line_services before contract_lines', async () => {
    const { knex, ops } = makeKnex({
      client_contract_lines: 0,
      contract_lines: 1
    });

    await ContractLine.delete(knex, 'cl-1');

    const deletes = ops.filter((op) => op.type === 'delete').map((op) => op.table);

    expect(deletes).toEqual([
      'contract_line_service_configuration',
      'contract_line_services',
      'contract_lines'
    ]);

    const configDelete = ops.find((op) => op.table === 'contract_line_service_configuration' && op.type === 'delete');
    expect(configDelete?.where).toEqual({ contract_line_id: 'cl-1', tenant: 'tenant-1' });

    const servicesDelete = ops.find((op) => op.table === 'contract_line_services' && op.type === 'delete');
    expect(servicesDelete?.where).toEqual({ contract_line_id: 'cl-1', tenant: 'tenant-1' });
  });

  it('refuses to delete when contract line is in use by a client', async () => {
    const { knex, ops } = makeKnex({
      client_contract_lines: 1,
      contract_lines: 1
    });

    await expect(ContractLine.delete(knex, 'cl-2')).rejects.toThrow(/in use by clients/i);

    expect(ops.some((op) => op.type === 'delete')).toBe(false);
  });

  it('throws when contract line does not exist', async () => {
    const { knex } = makeKnex({
      client_contract_lines: 0,
      contract_lines: 0
    });

    await expect(ContractLine.delete(knex, 'cl-missing')).rejects.toThrow(/not found/i);
  });
});
