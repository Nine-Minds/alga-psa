import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const binding = require('../20261109180000_bind_imap_oauth_credentials_to_token_endpoint.cjs');
const reauthorization = require('../20261110090000_add_imap_oauth_reauthorization_status.cjs');
const TABLE = 'imap_email_provider_config';
let db: Knex;

beforeAll(() => {
  const database = process.env.DB_NAME_SERVER;
  if (!database || ['server', 'production', 'prod', 'postgres'].includes(database.toLowerCase())) {
    throw new Error('Explicit test database required');
  }
  db = knex({ client: 'pg', connection: {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database,
    user: process.env.DB_USER_ADMIN, password: process.env.DB_PASSWORD_ADMIN,
  }, pool: { min: 0, max: 1 } });
});
afterAll(async () => { await db?.destroy(); });

async function withLegacyTable(run: (trx: Knex.Transaction) => Promise<void>) {
  const trx = await db.transaction();
  try {
    const schema = `imap_oauth_migration_${randomUUID().replaceAll('-', '')}`;
    await trx.raw('CREATE SCHEMA ??', [schema]);
    await trx.raw('SET LOCAL search_path TO ??, public', [schema]);
    await trx.schema.createTable(TABLE, table => {
      table.uuid('tenant').notNullable();
      table.uuid('email_provider_id').notNullable();
      table.text('oauth_token_url');
      table.primary(['tenant', 'email_provider_id']);
    });
    if (process.env.TEST_DB_BACKEND === 'citus') {
      await trx.raw("SELECT create_distributed_table(?, 'tenant')", [`${schema}.${TABLE}`]);
    }
    await run(trx);
  } finally {
    await trx.rollback();
  }
}

async function updateSizes(trx: Knex.Transaction, run: () => Promise<void>): Promise<number[]> {
  const sizes: number[] = [];
  const record = (response: unknown, query: { method?: string }) => {
    if (query.method === 'update' && typeof response === 'number') sizes.push(response);
  };
  trx.on('query-response', record);
  try { await run(); } finally { trx.removeListener('query-response', record); }
  return sizes;
}

describe('IMAP OAuth migration backfills', () => {
  it('binds all legacy issuers in bounded writes and never rebinds credentials on retry', async () => {
    await withLegacyTable(async trx => {
      const tenants = [randomUUID(), randomUUID()];
      const rows = Array.from({ length: 1001 }, (_, index) => ({
        tenant: tenants[index % 2], email_provider_id: randomUUID(),
        oauth_token_url: `https://issuer-${index}.example.test/token`,
      }));
      const noIssuer = { tenant: tenants[0], email_provider_id: randomUUID(), oauth_token_url: null };
      await trx(TABLE).insert([...rows, noIssuer]);

      const sizes = await updateSizes(trx, () => binding.up(trx));
      expect(sizes.reduce((total, size) => total + size, 0)).toBe(rows.length);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(500);
      const stored = await trx(TABLE).select('*');
      expect(stored).toHaveLength(rows.length + 1);
      for (const row of stored) {
        expect(row.oauth_credentials_token_url).toBe(row.oauth_token_url);
        expect(row.oauth_credentials_secret_version).toBe(0);
      }

      const identity = { tenant: rows[0].tenant, email_provider_id: rows[0].email_provider_id };
      await trx(TABLE).where(identity).update({ oauth_credentials_token_url: null, oauth_credentials_secret_version: 3 });
      expect(await updateSizes(trx, () => binding.up(trx))).toEqual([]);
      expect(await trx(TABLE).where(identity).first()).toMatchObject({
        oauth_credentials_token_url: null, oauth_credentials_secret_version: 3,
      });
    });
  });

  it('flags every mismatched issuer in bounded writes while preserving other authorization states', async () => {
    await withLegacyTable(async trx => {
      await binding.up(trx);
      const tenants = [randomUUID(), randomUUID()];
      const mismatches = Array.from({ length: 1001 }, (_, index) => ({
        tenant: tenants[index % 2], email_provider_id: randomUUID(),
        oauth_token_url: 'https://new.example.test/token',
        oauth_credentials_token_url: 'https://old.example.test/token',
      }));
      const unchanged = [
        { tenant: tenants[0], email_provider_id: randomUUID(), oauth_token_url: 'https://same.example.test/token', oauth_credentials_token_url: 'https://same.example.test/token' },
        { tenant: tenants[1], email_provider_id: randomUUID(), oauth_token_url: 'https://new.example.test/token', oauth_credentials_token_url: null },
        { tenant: tenants[1], email_provider_id: randomUUID(), oauth_token_url: null, oauth_credentials_token_url: 'https://old.example.test/token' },
      ];
      await trx(TABLE).insert([...mismatches, ...unchanged]);

      const sizes = await updateSizes(trx, () => reauthorization.up(trx));
      expect(sizes.reduce((total, size) => total + size, 0)).toBe(mismatches.length);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(500);
      const stored = await trx(TABLE).select('*');
      const mismatchIds = new Set(mismatches.map(row => row.email_provider_id));
      expect(stored).toHaveLength(mismatches.length + unchanged.length);
      for (const row of stored) {
        expect(row.oauth_reauthorization_required).toBe(mismatchIds.has(row.email_provider_id));
      }

      const identity = { tenant: unchanged[0].tenant, email_provider_id: unchanged[0].email_provider_id };
      await trx(TABLE).where(identity).update({ oauth_reauthorization_required: true });
      const retried = await updateSizes(trx, () => reauthorization.up(trx));
      expect(retried.reduce((total, size) => total + size, 0)).toBe(0);
      expect(await trx(TABLE).where(identity).first()).toMatchObject({ oauth_reauthorization_required: true });
    });
  });
});
