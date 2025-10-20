import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import baseKnexConfig from '@/lib/db/knexfile';

export const STORAGE_NAMESPACE = 'settings';

export function configureStorageTestDatabase(): void {
  baseKnexConfig.development.connection = {
    ...(baseKnexConfig.development.connection ?? {}),
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER_SERVER,
    password: process.env.DB_PASSWORD_SERVER,
    database: process.env.DB_NAME_SERVER,
  };
  if (baseKnexConfig.production) {
    baseKnexConfig.production.connection = {
      ...(baseKnexConfig.production.connection ?? {}),
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER_SERVER,
      password: process.env.DB_PASSWORD_SERVER,
      database: process.env.DB_NAME_SERVER,
    };
  }
}

export async function ensureStorageTables(): Promise<void> {
  const db = await createTestDbConnection();
  try {
    const { rows } = await db.raw('SELECT current_database() AS name');
    const currentDatabase = rows?.[0]?.name as string | undefined;
    const safeDbName = (currentDatabase ?? 'sebastian_test').replace(/"/g, '""');

    const appUserPassword = process.env.DB_PASSWORD_SERVER ?? 'test_password';
    await db.raw(`
      DO $$
      BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user WITH LOGIN PASSWORD '${appUserPassword}';
      ELSE
        ALTER ROLE app_user WITH LOGIN PASSWORD '${appUserPassword}';
      END IF;
      END
      $$;
    `);

    await db.raw(`GRANT ALL PRIVILEGES ON DATABASE "${safeDbName}" TO app_user`);
    await db.raw('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_user').catch(() => undefined);
    await db.raw('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_user').catch(() => undefined);
    await db.raw('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user').catch(() => undefined);
    await db.raw('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_user').catch(() => undefined);

    if (!(await db.schema.hasTable('storage_records'))) {
      await db.schema.createTable('storage_records', (table) => {
        table.uuid('tenant').notNullable();
        table.string('namespace', 128).notNullable();
        table.string('key', 256).notNullable();
        table.bigInteger('revision').notNullable().defaultTo(1);
        table.jsonb('value').notNullable();
        table.jsonb('metadata').notNullable().defaultTo(db.raw(`'{}'::jsonb`));
        table.bigInteger('value_size_bytes').notNullable().defaultTo(0);
        table.bigInteger('metadata_size_bytes').notNullable().defaultTo(0);
        table.timestamp('ttl_expires_at').nullable();
        table.timestamp('created_at').notNullable().defaultTo(db.fn.now());
        table.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
        table.primary(['tenant', 'namespace', 'key'], { constraintName: 'storage_records_pk' });
      });
      await db.schema.raw(`
        CREATE INDEX IF NOT EXISTS storage_records_namespace_idx
          ON storage_records (tenant, namespace, key)
      `);
      await db.schema.raw(`
        CREATE INDEX IF NOT EXISTS storage_records_ttl_idx
          ON storage_records (tenant, namespace, key)
          WHERE ttl_expires_at IS NOT NULL
      `);
    }

    if (!(await db.schema.hasTable('storage_schemas'))) {
      await db.schema.createTable('storage_schemas', (table) => {
        table.uuid('tenant').notNullable();
        table.string('namespace', 128).notNullable();
        table.integer('schema_version').notNullable();
        table.jsonb('schema_document').notNullable();
        table.enu('status', ['active', 'deprecated', 'draft']).notNullable().defaultTo('active');
        table.uuid('created_by').nullable();
        table.timestamp('created_at').notNullable().defaultTo(db.fn.now());
        table.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
        table.primary(['tenant', 'namespace', 'schema_version'], { constraintName: 'storage_schemas_pk' });
      });
      await db.schema.raw(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'i' AND c.relname = 'storage_schemas_namespace_active_uq'
          ) THEN
            CREATE UNIQUE INDEX storage_schemas_namespace_active_uq
              ON storage_schemas (tenant, namespace)
              WHERE status = 'active';
          END IF;
        END$$;
      `);
    }

    if (!(await db.schema.hasTable('storage_usage'))) {
      await db.schema.createTable('storage_usage', (table) => {
        table.uuid('tenant').notNullable();
        table.bigInteger('bytes_used').notNullable().defaultTo(0);
        table.integer('keys_count').notNullable().defaultTo(0);
        table.integer('namespaces_count').notNullable().defaultTo(0);
        table.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
        table.primary(['tenant'], { constraintName: 'storage_usage_pk' });
      });
    }
  } finally {
    await db.destroy();
  }
}

export async function resetStorageTables(tenantId?: string): Promise<void> {
  const db = await createTestDbConnection();
  try {
    if (tenantId) {
      await db('storage_records').where({ tenant: tenantId }).delete().catch(() => undefined);
      await db('storage_schemas').where({ tenant: tenantId }).delete().catch(() => undefined);
      await db('storage_usage').where({ tenant: tenantId }).delete().catch(() => undefined);
    } else {
      await db('storage_records').delete().catch(() => undefined);
      await db('storage_schemas').delete().catch(() => undefined);
      await db('storage_usage').delete().catch(() => undefined);
    }
  } finally {
    await db.destroy();
  }
}

export async function withTenantConnection<T>(tenantId: string, callback: (trx: Knex) => Promise<T>): Promise<T> {
  const db = await createTestDbConnection();
  try {
    return await callback(db.withSchema('public'));
  } finally {
    await db.destroy();
  }
}
