import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import knex, { type Knex } from 'knex';
import { getSecret } from '../../lib/utils/getSecret';
import { checkInternalUserLicenseLimit } from '../../../../packages/users/src/lib/internalUserLicenseGuard';

/**
 * A team invitation checks the seat limit inside its write transaction, then
 * sends the invitation email before committing. The email service records the
 * send in email_sending_logs on its own connection, and that row references the
 * tenant. When the seat check locked the tenant row FOR UPDATE, the log insert
 * waited on the invitation transaction while the transaction waited on the
 * send: every team invitation hung with no timeout.
 *
 * The admission lock must still serialize admissions, but must not block
 * another connection from inserting a row that references the tenant.
 */
const databaseName = `admission_lock_test_${randomUUID().replaceAll('-', '')}`;
let admin: Knex;
let db: Knex;
let created = false;
const tenant = randomUUID();

beforeAll(async () => {
  const connection = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN'),
  };
  admin = knex({ client: 'pg', connection: { ...connection, database: 'postgres' } });
  await admin.raw('CREATE DATABASE ??', [databaseName]);
  created = true;
  db = knex({ client: 'pg', connection: { ...connection, database: databaseName }, pool: { min: 0, max: 4 } });
  await db.schema.createTable('tenants', table => {
    table.uuid('tenant').primary();
    table.integer('licensed_user_count');
    table.text('plan').notNullable().defaultTo('pro');
    table.text('product_code').notNullable().defaultTo('psa');
  });
  await db.schema.createTable('users', table => {
    table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
    table.uuid('user_id').notNullable();
    table.text('user_type').notNullable();
    table.boolean('is_inactive').notNullable().defaultTo(false);
    table.primary(['tenant', 'user_id']);
  });
  await db.schema.createTable('user_invitations', table => {
    table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
    table.uuid('invitation_id').notNullable().defaultTo(db.raw('gen_random_uuid()'));
    table.text('email').notNullable();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('used_at', { useTz: true });
    table.primary(['tenant', 'invitation_id']);
  });
  // Stands in for email_sending_logs: any row written on another connection
  // with a foreign key to the tenant.
  await db.schema.createTable('email_sending_logs', table => {
    table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
    table.uuid('log_id').notNullable().defaultTo(db.raw('gen_random_uuid()'));
    table.primary(['tenant', 'log_id']);
  });
  await db('tenants').insert({ tenant, licensed_user_count: 10 });
});

afterAll(async () => {
  await db?.destroy();
  if (created) await admin.raw('DROP DATABASE IF EXISTS ?? WITH (FORCE)', [databaseName]);
  await admin?.destroy();
});

async function insertLogFromAnotherConnection(): Promise<void> {
  await db.transaction(async other => {
    await other.raw("SET LOCAL lock_timeout = '2s'");
    await other('email_sending_logs').insert({ tenant });
  });
}

describe('internal user admission lock', () => {
  it('lets another connection reference the tenant while an invitation holds the admission lock', async () => {
    await db.transaction(async trx => {
      const result = await checkInternalUserLicenseLimit(trx, tenant, { email: 'new@example.test', kind: 'invitation' });
      expect(result).toEqual({ ok: true });
      // The invitation would send its email here, before commit.
      await expect(insertLogFromAnotherConnection()).resolves.toBeUndefined();
    });
  });

  it('still serializes two admissions for the same tenant', async () => {
    await db.transaction(async first => {
      await checkInternalUserLicenseLimit(first, tenant, { email: 'a@example.test', kind: 'invitation' });
      await expect(db.transaction(async second => {
        await second.raw("SET LOCAL lock_timeout = '500ms'");
        await checkInternalUserLicenseLimit(second, tenant, { email: 'b@example.test', kind: 'invitation' });
      })).rejects.toThrow(/lock timeout/);
    });
  });
});
