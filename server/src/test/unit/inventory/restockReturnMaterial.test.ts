import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory, { type Knex } from 'knex';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  hasPermission: vi.fn(async () => true),
  authorizeTicketRecordAccess: vi.fn(async () => undefined),
  recordStockMovement: vi.fn(async () => ({ movement_id: 'return-1' })),
  ensureStockLevel: vi.fn(async () => undefined),
  assertLocationWritable: vi.fn(async () => undefined),
  detachDeliveredAssetAssociation: vi.fn(async () => undefined),
  revalidatePath: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (user: unknown, context: unknown, input: unknown) => Promise<unknown>) =>
    (input: unknown) => action({ user_id: 'user-1' }, { tenant: 'tenant-1' }, input),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/authorization/ticketRecordAuthorization', () => ({
  authorizeTicketRecordAccess: mocks.authorizeTicketRecordAccess,
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: async (connection: Knex, callback: (trx: Knex) => Promise<unknown>) => callback(connection),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('../../../../../packages/inventory/src/lib', () => ({
  recordStockMovement: mocks.recordStockMovement,
  ensureStockLevel: mocks.ensureStockLevel,
  assertLocationWritable: mocks.assertLocationWritable,
}));
vi.mock('../../../../../packages/inventory/src/lib/assetLink', () => ({
  detachDeliveredAssetAssociation: mocks.detachDeliveredAssetAssociation,
}));

import { restockReturn } from '../../../../../packages/inventory/src/actions/restockReturnActions';

const compiler = knexFactory({ client: 'pg' });

afterAll(async () => {
  await compiler.destroy();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function setupReturn(parentType: 'ticket' | 'project', isBilled = false) {
  const statements: Array<{ sql: string; bindings: readonly unknown[] }> = [];
  let stagingReferenceExists = parentType === 'project';
  const connection = new Proxy(compiler, {
    apply(target, thisArg, argumentsList) {
      const builder: Knex.QueryBuilder = Reflect.apply(target, thisArg, argumentsList);
      Object.defineProperty(builder, 'then', {
        value: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
          const { sql, bindings } = builder.toSQL();
          statements.push({ sql, bindings });
          let result: unknown;
          if (sql.includes('from "stock_units"')) {
            result = {
              status: 'delivered', service_id: 'service-1', location_id: 'location-1',
              client_id: 'client-1', serial_number: 'serial-1',
            };
          } else if (sql.includes('from "stock_movements"')) {
            result = { source_doc_type: `${parentType}_material`, source_doc_id: 'material-1' };
          } else if (sql.startsWith(`select`) && sql.includes(`from "${parentType}_materials"`)) {
            result = { is_billed: isBilled, [`${parentType}_id`]: 'parent-1' };
          } else if (sql.startsWith('update "project_staging_lines"')) {
            stagingReferenceExists = false;
            result = 1;
          } else if (sql.startsWith(`delete from "${parentType}_materials"`)) {
            if (stagingReferenceExists) {
              return Promise.reject(new Error('project_staging_lines still references the material')).then(resolve, reject);
            }
            result = 1;
          } else {
            return Promise.reject(new Error(`Unexpected restock query: ${sql}`)).then(resolve, reject);
          }
          return Promise.resolve(result).then(resolve, reject);
        },
      });
      return builder;
    },
  });
  mocks.createTenantKnex.mockResolvedValue({ knex: connection, tenant: 'tenant-1' });
  return { connection, statements };
}

describe('serialized material restock', () => {
  it('releases the tenant-scoped staging reference before deleting a project material', async () => {
    const { connection, statements } = setupReturn('project');

    await expect(restockReturn({ unit_id: 'unit-1' })).resolves.toMatchObject({
      movement: { movement_id: 'return-1' },
      client_id: 'client-1',
    });

    const releaseIndex = statements.findIndex(({ sql }) => sql.startsWith('update "project_staging_lines"'));
    const deleteIndex = statements.findIndex(({ sql }) => sql.startsWith('delete from "project_materials"'));
    expect(releaseIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeGreaterThan(releaseIndex);
    expect(statements.find(({ sql }) => sql.includes('from "stock_movements"'))?.bindings).toContain('tenant-1');
    expect(statements.find(({ sql }) => sql.startsWith('select') && sql.includes('from "project_materials"'))?.bindings)
      .toContain('tenant-1');
    expect(statements[releaseIndex].bindings).toEqual(expect.arrayContaining(['tenant-1', 'material-1']));
    expect(statements[deleteIndex].bindings).toEqual(expect.arrayContaining(['tenant-1', 'material-1']));
    expect(mocks.detachDeliveredAssetAssociation).toHaveBeenCalledWith(
      connection, 'tenant-1', 'unit-1', 'project', 'parent-1',
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/msp/projects/parent-1');
  });

  it('retains ticket authorization and removes a ticket material without a staging update', async () => {
    const { statements } = setupReturn('ticket');

    await expect(restockReturn({ unit_id: 'unit-1' })).resolves.toMatchObject({
      movement: { movement_id: 'return-1' },
    });
    expect(mocks.authorizeTicketRecordAccess).toHaveBeenCalledWith(expect.objectContaining({
      tenant: 'tenant-1', ticketId: 'parent-1', action: 'update',
    }));
    expect(statements.some(({ sql }) => sql.includes('project_staging_lines'))).toBe(false);
    expect(statements.find(({ sql }) => sql.startsWith('delete from "ticket_materials"'))?.bindings)
      .toEqual(expect.arrayContaining(['tenant-1', 'material-1']));
  });

  it('does not release staging or remove a billed material', async () => {
    const { statements } = setupReturn('project', true);

    await expect(restockReturn({ unit_id: 'unit-1' })).resolves.toMatchObject({
      messageKey: 'features/inventory:errors.restock.billedMaterialLine',
    });
    expect(statements.some(({ sql }) => sql.startsWith('update ') || sql.startsWith('delete '))).toBe(false);
    expect(mocks.detachDeliveredAssetAssociation).not.toHaveBeenCalled();
  });
});
