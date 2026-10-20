import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getSecret } from '../../lib/utils/getSecret';

const context = vi.hoisted(() => ({ tenant: '', userId: '', db: null as any }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: context.userId, tenant: context.tenant, user_type: 'internal' }, { tenant: context.tenant }, ...args),
  withAuthCheck: (fn: any) => fn,
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/db', async importOriginal => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: context.db, tenant: context.tenant }),
}));

import { getEntityImageUrlsBatch } from '@alga-psa/formatting/avatarUtils';

// alga-2026-0002754: getEntityImageUrlsBatch used to run one external_files
// query (in its own transaction) per entity. Real Postgres, no mocking of the
// function under test.

let db: Knex;
const databaseName = `logo_batch_test_${randomUUID().replaceAll('-', '')}`;
beforeAll(async () => {
  db = await createTestDbConnection({ databaseName, runSeeds: false });
  context.db = db;
}, 180_000);
afterAll(async () => {
  await db?.destroy();
  const admin = knex({ client: 'pg', connection: {
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123'), database: 'postgres',
  }, pool: { min: 0, max: 1 } });
  try { await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]); }
  finally { await admin.destroy(); }
});

async function seedTenant(): Promise<void> {
  context.tenant = randomUUID();
  context.userId = randomUUID();
  await db('tenants').insert({ tenant: context.tenant, client_name: 'Card B', email: `${context.tenant}@example.test`, product_code: 'psa' });
  await db('users').insert({ tenant: context.tenant, user_id: context.userId, username: context.userId,
    email: `${context.userId}@example.test`, first_name: 'Test', last_name: 'Admin', user_type: 'internal', hashed_password: 'unused' });
}

async function seedClient(name: string): Promise<string> {
  const client_id = randomUUID();
  await db('clients').insert({ tenant: context.tenant, client_id, client_name: name });
  return client_id;
}

type LogoSpec = { mime: string | null; fileId?: boolean; variant?: string; updatedAt?: Date };

async function seedLogo(clientId: string, spec: LogoSpec) {
  const file_id = randomUUID();
  if (spec.fileId !== false) {
    await db('external_files').insert({ tenant: context.tenant, file_id, file_name: `${file_id}.bin`, original_name: 'logo',
      mime_type: spec.mime ?? 'application/octet-stream', file_size: 10, storage_path: `/x/${file_id}`, uploaded_by_id: context.userId });
  }
  const document_id = randomUUID();
  await db('documents').insert({ tenant: context.tenant, document_id, document_name: 'logo', user_id: context.userId,
    created_by: context.userId, file_id: spec.fileId === false ? null : file_id, ...(spec.updatedAt ? { updated_at: spec.updatedAt } : {}) });
  await db('document_associations').insert({ tenant: context.tenant, document_id, entity_id: clientId, entity_type: 'client',
    is_entity_logo: true, entity_logo_variant: spec.variant ?? 'default' });
  return { file_id, document_id };
}

async function countQueries(fn: () => Promise<unknown>): Promise<number> {
  let n = 0;
  const listener = () => { n += 1; };
  db.on('query', listener);
  try { await fn(); } finally { db.removeListener('query', listener); }
  return n;
}

it('returns exact URLs and null for non-image / no-file / no-logo clients', async () => {
  await seedTenant();
  const stamps = [new Date('2026-01-02T03:04:05.678Z'), new Date('2026-02-03T04:05:06.789Z'), new Date('2026-03-04T05:06:07.890Z')];
  const imageClients: string[] = []; const files: string[] = [];
  for (let i = 0; i < 3; i++) {
    const c = await seedClient(`img-${i}`); imageClients.push(c);
    files.push((await seedLogo(c, { mime: i === 1 ? 'image/svg+xml' : 'image/png', updatedAt: stamps[i] })).file_id);
  }
  const nonImage = await seedClient('pdf'); await seedLogo(nonImage, { mime: 'application/pdf' });
  const noFile = await seedClient('nofile'); await seedLogo(noFile, { mime: null, fileId: false });
  const noLogo = await seedClient('nologo');
  const darkOnly = await seedClient('dark-only'); const dark = await seedLogo(darkOnly, { mime: 'image/png', variant: 'dark' });
  const both = await seedClient('both');
  const bothDefault = await seedLogo(both, { mime: 'image/png', variant: 'default', updatedAt: stamps[0] });
  await seedLogo(both, { mime: 'image/png', variant: 'dark', updatedAt: stamps[1] });

  const ids = [...imageClients, nonImage, noFile, noLogo, darkOnly, both];
  const def = await getEntityImageUrlsBatch('client', ids, context.tenant);
  imageClients.forEach((c, i) => expect(def.get(c)).toBe(`/api/documents/view/${files[i]}?t=${stamps[i].getTime()}`));
  expect(def.get(nonImage)).toBeNull();
  expect(def.get(noFile)).toBeNull();
  expect(def.get(noLogo)).toBeNull();
  expect(def.get(darkOnly)).toBeNull();
  expect(def.get(both)).toBe(`/api/documents/view/${bothDefault.file_id}?t=${stamps[0].getTime()}`);
  expect(def.size).toBe(ids.length);

  const darkMap = await getEntityImageUrlsBatch('client', ids, context.tenant, 'dark');
  expect(darkMap.get(darkOnly)).toMatch(new RegExp(`^/api/documents/view/${dark.file_id}\\?t=\\d+$`));
  expect(darkMap.get(imageClients[0])).toBeNull();

  expect((await getEntityImageUrlsBatch('client', [], context.tenant)).size).toBe(0);
}, 120_000);

it('issues a constant number of queries regardless of how many logos are resolved', async () => {
  await seedTenant();
  const make = async (n: number) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) { const c = await seedClient(`q-${n}-${i}`); await seedLogo(c, { mime: 'image/png' }); ids.push(c); }
    return ids;
  };
  const three = await make(3);
  const six = await make(6);
  const q3 = await countQueries(() => getEntityImageUrlsBatch('client', three, context.tenant));
  const q6 = await countQueries(() => getEntityImageUrlsBatch('client', six, context.tenant));
  expect(q6).toBe(q3);
  expect(q3).toBe(3); // associations, documents, external_files
}, 120_000);
