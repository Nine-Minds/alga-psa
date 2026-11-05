import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { withMigratedSchemaContract } from '../utils/schemaContract';

const connection = vi.hoisted(() => ({ db: undefined as Knex | undefined, tenant: undefined as string | undefined }));

vi.mock('@alga-psa/db', async (original) => ({
  ...await original<typeof import('@alga-psa/db')>(),
  getConnection: async () => connection.db!,
  createTenantKnex: async (tenant?: string) => ({ knex: connection.db!, tenant: tenant ?? connection.tenant ?? null }),
}));
vi.mock('../../../../../packages/db/src/lib/tenant', async (original) => ({
  ...await original<typeof import('../../../../../packages/db/src/lib/tenant')>(),
  getConnection: async () => connection.db!,
  createTenantKnex: async (tenant?: string) => ({ knex: connection.db!, tenant: tenant ?? connection.tenant ?? null }),
}));
vi.mock('server/src/lib/eventBus/publishers', () => ({ publishEvent: async () => undefined }));

import { BoardService } from '../../../lib/api/services/BoardService';
import { CategoryService } from '../../../lib/api/services/CategoryService';

describe('REST query contracts against the migrated schema', () => {
  let db: Knex;
  let tenant: string;

  beforeAll(async () => {
    db = await createTestDbConnection({ recreate: false });
    const row = await db('tenants').first<{ tenant: string }>('tenant');
    if (!row) throw new Error('The integration database has no tenant fixture');
    tenant = row.tenant;
  }, 300_000);

  afterAll(async () => { await db?.destroy(); });

  it('executes the board update and both category tree scopes inside rollback transactions', async () => {
    const board = await db('boards').where({ tenant }).first<{ board_id: string }>('board_id');
    if (!board) throw new Error('The integration database has no board fixture');

    const withServiceContract = (name: string, exercise: (context: { tenant: string; userId: string }) => Promise<void>) =>
      withMigratedSchemaContract(db, name, async (trx) => {
      connection.db = trx;
      connection.tenant = tenant;
      const context = { tenant, userId: randomUUID() };
      try {
        await exercise(context);
      } finally {
        connection.db = undefined;
        connection.tenant = undefined;
      }
    });

    await withServiceContract('board read/update', async (context) => {
      const boardService = new BoardService();
      expect(await boardService.getById(board.board_id, context)).toBeDefined();
      const updatedBoard = await boardService.update(board.board_id, {
          board_name: `Schema contract ${randomUUID()}`,
          default_assigned_team_id: null,
        }, context);
      expect(updatedBoard.default_assigned_team_id).toBeNull();
    });

    await withServiceContract('unscoped category tree', async (context) => {
      expect(await new CategoryService().getCategoryTree(null, context)).toBeDefined();
    });

    await withServiceContract('board-scoped category tree', async (context) => {
      expect(await new CategoryService().getCategoryTree(board.board_id, context)).toBeDefined();
    });
  });

  it('reports the missing relation column from an actual PostgreSQL 42703', async () => {
    await expect(withMigratedSchemaContract(db, 'deliberate mismatch', async (trx) => {
      await trx('boards').select('schema_contract_missing_column').where({ tenant }).limit(1);
    })).rejects.toThrow(/deliberate mismatch.*schema_contract_missing_column/);
  });
});
