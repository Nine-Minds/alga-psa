import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { TestContext } from '../../../../test-utils/testContext';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import {
  StorageServiceError,
  StorageValidationError,
} from '../../../../../ee/server/src/lib/extensions/storage/v2/errors';
import { getStorageServiceForInstall } from '../../../../../ee/server/src/lib/extensions/storage/v2/factory';
import type {
  StorageBulkPutRequest,
  StorageListRequest,
} from '../../../../../ee/server/src/lib/extensions/storage/v2/types';
import { isStorageApiEnabled } from '../../../../../ee/server/src/lib/extensions/storage/v2/config';
import baseKnexConfig from '@/lib/db/knexfile';

const namespace = 'settings';
let ctx: TestContext;
let tenantId: string;
let installId: string;
let registryId: string;
let versionId: string;
let originalFlag: string | undefined;
const testHelpers = TestContext.createHelpers();

process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'postgres';
process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'test_password';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';

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

describe('Extension Storage API E2E Tests', () => {

  beforeAll(async () => {
    originalFlag = process.env.EXT_STORAGE_API_ENABLED;
    process.env.EXT_STORAGE_API_ENABLED = 'true';

    ctx = await testHelpers.beforeAll();
    tenantId = ctx.tenantId;
    await ensureExtensionStorageTables();
    await seedExtensionData(tenantId);
  }, 60000);

  afterAll(async () => {
    try {
      await testHelpers.afterAll();
    } finally {
      if (originalFlag === undefined) {
        delete process.env.EXT_STORAGE_API_ENABLED;
      } else {
        process.env.EXT_STORAGE_API_ENABLED = originalFlag;
      }
    }
  });

  beforeEach(async () => {
    ctx = await testHelpers.beforeEach();
    tenantId = ctx.tenantId;
    await seedExtensionData(tenantId);
  });

  afterEach(async () => {
    await testHelpers.afterEach();
  });

  describe('Record operations', () => {
    it('should create and retrieve a record via PUT/GET', async () => {
      const key = 'preferences';
      const payload = {
        value: { theme: 'dark', notifications: true },
        metadata: { contentType: 'application/json' },
      };

      const putResponse = await callRecordRoute('PUT', key, { body: payload });
      expect(putResponse.status).toBe(200);
      const putData = await readJson(putResponse);
      expect(putData).toMatchObject({
        namespace,
        key,
        revision: 1,
      });

      const getResponse = await callRecordRoute('GET', key);
      expect(getResponse.status).toBe(200);
      const getData = await readJson(getResponse);
      expect(getData.value).toEqual(payload.value);
      expect(getData.metadata).toEqual(payload.metadata);
    });

    it('should list records with optional value and metadata', async () => {
      const keys = ['list-one', 'list-two'];
      for (const key of keys) {
        await callRecordRoute('PUT', key, {
          body: {
            value: { key },
            metadata: { index: key },
          },
        });
      }

      const listResponse = await callRecordsRoute('GET', {
        query: {
          includeValues: 'true',
          includeMetadata: 'true',
          limit: '10',
        },
      });

      expect(listResponse.status).toBe(200);
      const listData = await readJson(listResponse);
      expect(Array.isArray(listData.items)).toBe(true);
      expect(listData.items.length).toBeGreaterThanOrEqual(2);
      const returnedKeys = listData.items.map((item: any) => item.key);
      expect(returnedKeys).toEqual(expect.arrayContaining(keys));
      const sample = listData.items.find((item: any) => item.key === 'list-one');
      expect(sample.value).toEqual({ key: 'list-one' });
      expect(sample.metadata).toEqual({ index: 'list-one' });
    });

    it('should enforce optimistic concurrency', async () => {
      const key = 'revision-check';
      const initialResponse = await callRecordRoute('PUT', key, {
        body: { value: { attempt: 1 } },
      });
      expect(initialResponse.status).toBe(200);
      const initialData = await readJson(initialResponse);
      expect(initialData.revision).toBe(1);

      const updateResponse = await callRecordRoute('PUT', key, {
        body: { value: { attempt: 2 }, ifRevision: initialData.revision },
      });
      expect(updateResponse.status).toBe(200);
      const updateData = await readJson(updateResponse);
      expect(updateData.revision).toBe(2);

      const staleResponse = await callRecordRoute('PUT', key, {
        body: { value: { attempt: 3 }, ifRevision: 1 },
      });
      expect(staleResponse.status).toBe(409);
      const staleData = await readJson(staleResponse);
      expect(staleData?.error?.code).toBe('REVISION_MISMATCH');
    });

    it('should delete a record', async () => {
      const key = 'delete-me';
      await callRecordRoute('PUT', key, { body: { value: { keep: false } } });

      const deleteResponse = await callRecordRoute('DELETE', key);
      expect(deleteResponse.status).toBe(204);

      const getResponse = await callRecordRoute('GET', key);
      expect(getResponse.status).toBe(404);
      const errorBody = await readJson(getResponse);
      expect(errorBody?.error?.code).toBe('NOT_FOUND');
    });
  });

  describe('Bulk operations', () => {
    it('should insert multiple records with bulkPut', async () => {
      const bulkResponse = await callRecordsRoute('POST', {
        body: {
          items: [
            { key: 'bulk-one', value: { id: 1 } },
            { key: 'bulk-two', value: { id: 2 }, metadata: { kind: 'pair' } },
          ],
        },
      });

      expect(bulkResponse.status).toBe(200);
      const bulkData = await readJson(bulkResponse);
      expect(bulkData.items).toHaveLength(2);

      const getOne = await callRecordRoute('GET', 'bulk-one');
      expect(getOne.status).toBe(200);
      const getOneData = await readJson(getOne);
      expect(getOneData.value).toEqual({ id: 1 });

      const getTwo = await callRecordRoute('GET', 'bulk-two');
      expect(getTwo.status).toBe(200);
      const getTwoData = await readJson(getTwo);
      expect(getTwoData.metadata).toEqual({ kind: 'pair' });
    });
  });
});

async function ensureExtensionStorageTables(): Promise<void> {
  const db = await createTestDbConnection();
  try {
    const { rows } = await db.raw('SELECT current_database() AS name');
    const currentDatabase = rows?.[0]?.name as string | undefined;
    const safeDbName = (currentDatabase ?? 'sebastian_test').replace(/"/g, '""');

    await db.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
          CREATE ROLE app_user WITH LOGIN PASSWORD 'test_password';
        ELSE
          ALTER ROLE app_user WITH LOGIN PASSWORD 'test_password';
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
        table.uuid('tenant_id').notNullable();
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
        table.primary(['tenant_id', 'extension_install_id', 'namespace', 'key'], { constraintName: 'ext_storage_records_pk' });
      });
      await db.schema.raw(`
        CREATE INDEX IF NOT EXISTS ext_storage_records_namespace_idx
          ON ext_storage_records (tenant_id, extension_install_id, namespace, key)
      `);
      await db.schema.raw(`
        CREATE INDEX IF NOT EXISTS ext_storage_records_ttl_idx
          ON ext_storage_records (tenant_id, extension_install_id, namespace, key)
          WHERE ttl_expires_at IS NOT NULL
      `);
    }

    if (!(await db.schema.hasTable('ext_storage_schemas'))) {
      await db.schema.createTable('ext_storage_schemas', (table) => {
        table.uuid('tenant_id').notNullable();
        table.uuid('extension_install_id').notNullable();
        table.string('namespace', 128).notNullable();
        table.integer('schema_version').notNullable();
        table.jsonb('schema_document').notNullable();
        table.enu('status', ['active', 'deprecated', 'draft']).notNullable().defaultTo('active');
        table.uuid('created_by').nullable();
        table.timestamp('created_at').notNullable().defaultTo(db.fn.now());
        table.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
        table.primary(['tenant_id', 'extension_install_id', 'namespace', 'schema_version'], { constraintName: 'ext_storage_schemas_pk' });
        table.unique(['tenant_id', 'extension_install_id', 'namespace'], { indexName: 'ext_storage_schemas_namespace_uq' });
      });
    }

    if (!(await db.schema.hasTable('ext_storage_usage'))) {
      await db.schema.createTable('ext_storage_usage', (table) => {
        table.uuid('tenant_id').notNullable();
        table.uuid('extension_install_id').notNullable();
        table.bigInteger('bytes_used').notNullable().defaultTo(0);
        table.integer('keys_count').notNullable().defaultTo(0);
        table.integer('namespaces_count').notNullable().defaultTo(0);
        table.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
        table.primary(['tenant_id', 'extension_install_id'], { constraintName: 'ext_storage_usage_pk' });
      });
    }
  } finally {
    await db.destroy();
  }
}

async function seedExtensionData(tenant: string): Promise<void> {
  const db = await createTestDbConnection();
  registryId = uuidv4();
  versionId = uuidv4();
  installId = uuidv4();

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
    description: 'Extension storage E2E tests',
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
}

type RequestOptions = {
  body?: unknown;
  query?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
};

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  keyPrefix: z.string().max(256).optional(),
  includeValues: z.coerce.boolean().optional(),
  includeMetadata: z.coerce.boolean().optional(),
});

const bulkPutSchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().min(1).max(256),
        value: z.any(),
        metadata: z.record(z.any()).optional(),
        ttlSeconds: z.number().int().positive().optional(),
        ifRevision: z.number().int().nonnegative().optional(),
        schemaVersion: z.number().int().positive().optional(),
      }),
    )
    .min(1),
});

const deleteQuerySchema = z.object({
  ifRevision: z.coerce.number().int().nonnegative().optional(),
});

function buildHeaders(hasBody: boolean, overrides?: Record<string, string>): Headers {
  const headers = new Headers({
    'x-tenant-id': tenantId,
  });
  if (hasBody) {
    headers.set('content-type', 'application/json');
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      headers.set(key, value);
    }
  }
  return headers;
}

function mapError(error: unknown): NextResponse {
  if (error instanceof StorageServiceError || error instanceof StorageValidationError) {
    const status = (() => {
      switch (error.code) {
        case 'VALIDATION_FAILED':
        case 'LIMIT_EXCEEDED':
          return 400;
        case 'UNAUTHORIZED':
          return 401;
        case 'NAMESPACE_DENIED':
          return 403;
        case 'NOT_FOUND':
          return 404;
        case 'REVISION_MISMATCH':
          return 409;
        case 'QUOTA_EXCEEDED':
        case 'RATE_LIMITED':
          return 429;
        default:
          return 500;
      }
    })();
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
      },
      { status },
    );
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation error',
          details: error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  console.error('[ext-storage-test] unexpected error', error);
  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal error',
      },
    },
    { status: 500 },
  );
}

async function getTenantIdFromAuth(req: NextRequest): Promise<string | null> {
  const headerTenant = req.headers.get('x-tenant-id') ?? req.headers.get('x-tenant');
  if (headerTenant && headerTenant.trim().length > 0) {
    return headerTenant;
  }
  if (process.env.NODE_ENV !== 'production') {
    return 'tenant-dev';
  }
  return null;
}

async function ensureTenantAccess(req: NextRequest, targetTenantId: string): Promise<void> {
  const callerTenant = await getTenantIdFromAuth(req);
  if (!callerTenant) {
    throw new StorageServiceError('UNAUTHORIZED', 'Authentication required');
  }
  if (callerTenant !== targetTenantId) {
    throw new StorageServiceError('UNAUTHORIZED', 'Tenant mismatch');
  }
}

async function handleRecordsGet(
  req: NextRequest,
  params: { installId: string; namespace: string },
): Promise<Response> {
  if (!isStorageApiEnabled()) {
    return NextResponse.json({ error: 'Storage API disabled' }, { status: 404 });
  }
  try {
    const url = new URL(req.url);
    const search = Object.fromEntries(url.searchParams.entries());
    const input = listQuerySchema.parse(search);
    const { service, tenantId: installTenantId } = await getStorageServiceForInstall(params.installId);
    await ensureTenantAccess(req, installTenantId);

    const request: StorageListRequest = {
      namespace: params.namespace,
      limit: input.limit,
      cursor: input.cursor,
      keyPrefix: input.keyPrefix,
      includeValues: input.includeValues,
      includeMetadata: input.includeMetadata,
    };

    const result = await service.list(request);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return mapError(error);
  }
}

async function handleRecordsPost(
  req: NextRequest,
  params: { installId: string; namespace: string },
): Promise<Response> {
  if (!isStorageApiEnabled()) {
    return NextResponse.json({ error: 'Storage API disabled' }, { status: 404 });
  }
  try {
    const body = await req.json();
    const input = bulkPutSchema.parse(body);
    const { service, tenantId: installTenantId } = await getStorageServiceForInstall(params.installId);
    await ensureTenantAccess(req, installTenantId);

    const request: StorageBulkPutRequest = {
      namespace: params.namespace,
      items: input.items,
    };

    const result = await service.bulkPut(request);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return mapError(error);
  }
}

async function handleRecordGet(
  req: NextRequest,
  params: { installId: string; namespace: string; key: string },
): Promise<Response> {
  if (!isStorageApiEnabled()) {
    return NextResponse.json({ error: 'Storage API disabled' }, { status: 404 });
  }
  try {
    const { service, tenantId: installTenantId } = await getStorageServiceForInstall(params.installId);
    await ensureTenantAccess(req, installTenantId);
    const result = await service.get({ namespace: params.namespace, key: params.key });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return mapError(error);
  }
}

async function handleRecordPut(
  req: NextRequest,
  params: { installId: string; namespace: string; key: string },
): Promise<Response> {
  if (!isStorageApiEnabled()) {
    return NextResponse.json({ error: 'Storage API disabled' }, { status: 404 });
  }
  try {
    const body = await req.json();
    const { service, tenantId: installTenantId } = await getStorageServiceForInstall(params.installId);
    await ensureTenantAccess(req, installTenantId);
    const result = await service.put({
      namespace: params.namespace,
      key: params.key,
      value: body.value,
      metadata: body.metadata,
      ttlSeconds: body.ttlSeconds,
      ifRevision: body.ifRevision,
      schemaVersion: body.schemaVersion,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return mapError(error);
  }
}

async function handleRecordDelete(
  req: NextRequest,
  params: { installId: string; namespace: string; key: string },
): Promise<Response> {
  if (!isStorageApiEnabled()) {
    return NextResponse.json({ error: 'Storage API disabled' }, { status: 404 });
  }
  try {
    const url = new URL(req.url);
    const search = Object.fromEntries(url.searchParams.entries());
    const input = deleteQuerySchema.parse(search);
    const { service, tenantId: installTenantId } = await getStorageServiceForInstall(params.installId);
    await ensureTenantAccess(req, installTenantId);
    await service.delete({
      namespace: params.namespace,
      key: params.key,
      ifRevision: input.ifRevision,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return mapError(error);
  }
}

async function callRecordRoute(
  method: 'GET' | 'PUT' | 'DELETE',
  key: string,
  options: RequestOptions = {},
): Promise<Response> {
  const url = new URL(`https://example.test/api/ext-storage/install/${installId}/${namespace}/records/${encodeURIComponent(key)}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      url.searchParams.set(k, String(v));
    }
  }

  const hasBody = options.body !== undefined && options.body !== null;
  const headers = buildHeaders(hasBody, options.headers);
  const init: RequestInit = { method, headers };
  if (hasBody) {
    init.body = JSON.stringify(options.body);
  }

  const request = new NextRequest(url.toString(), init);

  switch (method) {
    case 'GET':
      return handleRecordGet(request, { installId, namespace, key });
    case 'PUT':
      return handleRecordPut(request, { installId, namespace, key });
    case 'DELETE':
      return handleRecordDelete(request, { installId, namespace, key });
    default:
      throw new Error(`Unsupported method ${method}`);
  }
}

async function callRecordsRoute(
  method: 'GET' | 'POST',
  options: RequestOptions = {},
): Promise<Response> {
  const url = new URL(`https://example.test/api/ext-storage/install/${installId}/${namespace}/records`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      url.searchParams.set(k, String(v));
    }
  }

  const hasBody = options.body !== undefined && options.body !== null;
  const headers = buildHeaders(hasBody, options.headers);
  const init: RequestInit = { method, headers };
  if (hasBody) {
    init.body = JSON.stringify(options.body);
  }

  const request = new NextRequest(url.toString(), init);

  if (method === 'GET') {
    return handleRecordsGet(request, { installId, namespace });
  }
  if (method === 'POST') {
    return handleRecordsPost(request, { installId, namespace });
  }
  throw new Error(`Unsupported method ${method}`);
}

async function readJson(response: Response): Promise<any> {
  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
