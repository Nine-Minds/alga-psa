import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import baseKnexConfig from '@/lib/db/knexfile';

export const STORAGE_NAMESPACE = 'settings';

export interface ExtensionStorageSeed {
  installId: string;
  registryId: string;
  versionId: string;
}

export function configureExtensionStorageTestDatabase(): void {
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

export async function ensureExtensionStorageTables(): Promise<void> {
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

    if (!(await db.schema.hasTable('extension_registry'))) {
      await db.schema.createTable('extension_registry', (table) => {
        table.uuid('id').primary();
        table.string('publisher').notNullable();
        table.string('name').notNullable();
        table.string('display_name');
        table.text('description');
        table.timestamp('created_at').defaultTo(db.fn.now());
        table.timestamp('updated_at').defaultTo(db.fn.now());
        table.unique(['publisher', 'name']);
      });
    }

    if (!(await db.schema.hasColumn('extension_version', 'api_endpoints'))) {
      const hasTable = await db.schema.hasTable('extension_version');
      if (!hasTable) {
        await db.schema.createTable('extension_version', (table) => {
          table.uuid('id').primary();
          table.uuid('registry_id').notNullable().references('id').inTable('extension_registry').onDelete('CASCADE');
          table.string('version').notNullable();
          table.string('runtime').notNullable();
          table.string('main_entry').notNullable();
          table.jsonb('api').notNullable().defaultTo(db.raw(`'{}'::jsonb`));
          table.jsonb('api_endpoints').notNullable().defaultTo(db.raw(`'[]'::jsonb`));
          table.jsonb('ui').defaultTo(null);
          table.jsonb('capabilities').notNullable().defaultTo(db.raw(`'[]'::jsonb`));
          table.timestamp('created_at').defaultTo(db.fn.now());
          table.unique(['registry_id', 'version']);
        });
      } else {
        await db.schema.alterTable('extension_version', (table) => {
          table.jsonb('api_endpoints').notNullable().defaultTo(db.raw(`'[]'::jsonb`));
        });
      }
    }

    if (!(await db.schema.hasColumn('extension_version', 'capabilities'))) {
      await db.schema.alterTable('extension_version', (table) => {
        table.jsonb('capabilities').notNullable().defaultTo(db.raw(`'[]'::jsonb`));
      });
    }

    const installExists = await db.schema.hasTable('tenant_extension_install');
    if (!installExists) {
      await db.schema.createTable('tenant_extension_install', (table) => {
        table.uuid('id').primary();
        table.string('tenant_id').notNullable();
        table.uuid('registry_id').notNullable().references('id').inTable('extension_registry').onDelete('CASCADE');
        table.uuid('version_id').notNullable().references('id').inTable('extension_version');
        table.text('status').notNullable().defaultTo('enabled');
        table.jsonb('granted_caps').notNullable().defaultTo(db.raw(`'[]'::jsonb`));
        table.jsonb('config').notNullable().defaultTo(db.raw(`'{}'::jsonb`));
        table.boolean('is_enabled').notNullable().defaultTo(true);
        table.boolean('enabled').notNullable().defaultTo(true);
        table.text('runner_domain').defaultTo(null);
        table.jsonb('runner_status').notNullable().defaultTo(db.raw(`'{"state":"pending"}'::jsonb`));
        table.jsonb('runner_ref').defaultTo(null);
        table.timestamp('created_at').notNullable().defaultTo(db.fn.now());
        table.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
        table.unique(['tenant_id', 'registry_id']);
        table.index(['tenant_id', 'registry_id'], 'tenant_extension_install_tenant_registry_idx');
      });
    } else {
      const columns: Array<[string, (table: Knex.AlterTableBuilder) => void]> = [
        ['status', (table) => table.text('status').notNullable().defaultTo('enabled')],
        ['is_enabled', (table) => table.boolean('is_enabled').notNullable().defaultTo(true)],
        ['enabled', (table) => table.boolean('enabled').notNullable().defaultTo(true)],
        ['runner_domain', (table) => table.text('runner_domain').defaultTo(null)],
        ['runner_status', (table) => table.jsonb('runner_status').notNullable().defaultTo(db.raw(`'{"state":"pending"}'::jsonb`))],
        ['runner_ref', (table) => table.jsonb('runner_ref').defaultTo(null)],
        ['granted_caps', (table) => table.jsonb('granted_caps').notNullable().defaultTo(db.raw(`'[]'::jsonb`))],
        ['config', (table) => table.jsonb('config').notNullable().defaultTo(db.raw(`'{}'::jsonb`))],
        ['updated_at', (table) => table.timestamp('updated_at').notNullable().defaultTo(db.fn.now())],
      ];

      for (const [column, addColumn] of columns) {
        if (!(await db.schema.hasColumn('tenant_extension_install', column))) {
          await db.schema.alterTable('tenant_extension_install', addColumn);
        }
      }
    }

    if (!(await db.schema.hasTable('ext_storage_records'))) {
      await db.schema.createTable('ext_storage_records', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('extension_install_id').notNullable();
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
        table.primary(['tenant', 'extension_install_id', 'namespace', 'key'], { constraintName: 'ext_storage_records_pk' });
      });
      await db.schema.raw(`
        CREATE INDEX IF NOT EXISTS ext_storage_records_namespace_idx
          ON ext_storage_records (tenant, extension_install_id, namespace, key)
      `);
      await db.schema.raw(`
        CREATE INDEX IF NOT EXISTS ext_storage_records_ttl_idx
          ON ext_storage_records (tenant, extension_install_id, namespace, key)
          WHERE ttl_expires_at IS NOT NULL
      `);
    }

    if (!(await db.schema.hasTable('ext_storage_schemas'))) {
      await db.schema.createTable('ext_storage_schemas', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('extension_install_id').notNullable();
        table.string('namespace', 128).notNullable();
        table.integer('schema_version').notNullable();
        table.jsonb('schema_document').notNullable();
        table.enu('status', ['active', 'deprecated', 'draft']).notNullable().defaultTo('active');
        table.uuid('created_by').nullable();
        table.timestamp('created_at').notNullable().defaultTo(db.fn.now());
        table.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
        table.primary(['tenant', 'extension_install_id', 'namespace', 'schema_version'], { constraintName: 'ext_storage_schemas_pk' });
      });
      await db.schema.raw(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'i' AND c.relname = 'ext_storage_schemas_namespace_active_uq'
          ) THEN
            CREATE UNIQUE INDEX ext_storage_schemas_namespace_active_uq
              ON ext_storage_schemas (tenant, extension_install_id, namespace)
              WHERE status = 'active';
          END IF;
        END$$;
      `);
    }

    if (!(await db.schema.hasTable('ext_storage_usage'))) {
      await db.schema.createTable('ext_storage_usage', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('extension_install_id').notNullable();
        table.bigInteger('bytes_used').notNullable().defaultTo(0);
        table.integer('keys_count').notNullable().defaultTo(0);
        table.integer('namespaces_count').notNullable().defaultTo(0);
        table.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
        table.primary(['tenant', 'extension_install_id'], { constraintName: 'ext_storage_usage_pk' });
      });
    }
  } finally {
    await db.destroy();
  }
}

export async function seedExtensionData(tenant: string, namespace: string): Promise<ExtensionStorageSeed> {
  const db = await createTestDbConnection();
  const registryId = uuidv4();
  const versionId = uuidv4();
  const installId = uuidv4();

  await db('ext_storage_records').delete().catch(() => undefined);
  await db('ext_storage_usage').delete().catch(() => undefined);
  await db('ext_storage_schemas').delete().catch(() => undefined);
  await db('tenant_extension_install').delete().catch(() => undefined);
  await db('extension_version').delete().catch(() => undefined);
  await db('extension_registry').delete().catch(() => undefined);

  await db('extension_registry').insert({
    id: registryId,
    publisher: 'test-publisher',
    name: `storage-suite-${uuidv4()}`,
    display_name: 'Storage Test Extension',
    description: 'Extension storage tests',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await db('extension_version').insert({
    id: versionId,
    registry_id: registryId,
    version: '1.0.0',
    runtime: 'wasm-js@1',
    main_entry: 'dist/main.wasm',
    api: JSON.stringify({ endpoints: [] }),
    api_endpoints: JSON.stringify([]),
    ui: null,
    capabilities: JSON.stringify(['alga.storage']),
    created_at: new Date().toISOString(),
  });

  await db('tenant_extension_install').insert({
    id: installId,
    tenant_id: tenant,
    registry_id: registryId,
    version_id: versionId,
    status: 'enabled',
    granted_caps: JSON.stringify([{ capability: 'alga.storage', access: ['read', 'write'], namespaces: [namespace] }]),
    config: JSON.stringify({}),
    is_enabled: true,
    runner_domain: `storage-tests-${uuidv4()}.extensions.test`,
    runner_status: JSON.stringify({ state: 'ready' }),
    runner_ref: JSON.stringify({}),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await db.destroy();

  return { installId, registryId, versionId };
}
