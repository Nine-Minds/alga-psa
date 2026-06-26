import { afterAll, describe, expect, it } from 'vitest';
import knexFactory from 'knex';
import { BaseService, type ServiceContext } from './BaseService';
import type { Knex } from 'knex';

const db = knexFactory({ client: 'pg' });

afterAll(async () => {
  await db.destroy();
});

class TestService extends BaseService<Record<string, unknown>> {
  exposeBuildBaseQuery(conn: Knex, context: ServiceContext): Knex.QueryBuilder {
    return this.buildBaseQuery(conn, context);
  }
}

describe('BaseService tenant-scoped queries', () => {
  it('builds the root query through the tenant-scoped query primitive', () => {
    const service = new TestService({
      tableName: 'extensions',
      primaryKey: 'extension_id',
      tenantColumn: 'tenant_id',
      softDelete: true,
    });

    const query = service.exposeBuildBaseQuery(db, {
      tenant: 'tenant-1',
      userId: 'user-1',
    });

    expect(query.toString()).toBe(
      `select * from "extensions" where "extensions"."tenant_id" = 'tenant-1' and "deleted_at" is null`
    );
  });
});
