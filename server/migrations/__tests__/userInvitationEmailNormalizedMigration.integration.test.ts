import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createTestDbConnection } from '../../test-utils/dbConfig';
import { getSecret } from '../../src/lib/utils/getSecret';

const context = vi.hoisted(() => ({ tenant: '' }));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  requireTenantId: async () => context.tenant,
}));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: async () => ({ user_id: 'migration-test-user', first_name: 'Migration', last_name: 'Test', username: 'migration-test' }),
}));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/auth')>(),
  checkPortalInvitationLimit: async () => ({ success: true }),
  formatRateLimitError: async () => 'rate limited',
}));

import { UserInvitationService } from '../../../packages/users/src/services/UserInvitationService';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '..', '20261103130000_add_normalized_email_to_user_invitations.cjs'));
const databaseName = `user_invitation_email_key_${randomUUID().replaceAll('-', '')}`;
let db: Knex;

async function seedTenant(): Promise<string> {
  const tenant = randomUUID();
  await db('tenants').insert({
    tenant, client_name: 'Invitation migration', email: `${tenant}@example.test`, product_code: 'psa', licensed_user_count: 10,
  });
  context.tenant = tenant;
  return tenant;
}

async function seedLegacyInvitation(tenant: string, email: string, emailNormalized?: string): Promise<string> {
  const [row] = await db('user_invitations').insert({
    tenant, email, first_name: 'Legacy', last_name: 'Invite', token: randomUUID(),
    ...(emailNormalized === undefined ? {} : { email_normalized: emailNormalized }),
    expires_at: db.raw("now() + interval '1 day'"), metadata: {},
  }).returning('invitation_id');
  return row.invitation_id;
}

async function resetInvitationRows(): Promise<void> {
  await db('user_invitations').del();
}

async function resetInvitationSchemaToOriginal(): Promise<void> {
  await db.raw('DROP INDEX IF EXISTS idx_user_invitations_email_normalized');
  await db.raw('ALTER TABLE user_invitations DROP COLUMN IF EXISTS email_normalized');
  await db.raw('ALTER TABLE user_invitations DROP COLUMN IF EXISTS invited_user_id');
}

async function expectRequiredColumn(): Promise<void> {
  const result = await db.raw(`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'user_invitations'
      AND column_name = 'email_normalized'
  `);
  expect(result.rows[0]?.is_nullable).toBe('NO');
}

describe('20261103130000_add_normalized_email_to_user_invitations', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName, runSeeds: false });
    // Construct the original migration schema directly. Bootstrap templates
    // may carry columns that do not correspond to their migration ledger.
    await db.schema.dropTableIfExists('user_invitations');
    await db.schema.createTable('user_invitations', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('invitation_id').defaultTo(db!.raw('gen_random_uuid()')).notNullable();
      table.text('email').notNullable();
      table.text('first_name').notNullable();
      table.text('last_name').notNullable();
      table.uuid('role_id').nullable();
      table.text('token').notNullable();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db!.fn.now());
      table.timestamp('used_at', { useTz: true }).nullable();
      table.jsonb('metadata').notNullable().defaultTo(db!.raw(`'{}'::jsonb`));
      table.primary(['tenant', 'invitation_id']);
      table.index(['tenant', 'email'], 'idx_user_invitations_email');
      table.index(['tenant', 'expires_at'], 'idx_user_invitations_expires');
      table.unique(['tenant', 'token'], 'unique_user_invitation_tenant_token');
    });
    expect(await db.schema.hasColumn('user_invitations', 'email_normalized')).toBe(false);
  }, 600_000);

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

  it('backfills the original schema, enforces the key, and permits service insertion', async () => {
    const tenant = await seedTenant();
    const invitationId = await seedLegacyInvitation(tenant, 'Legacy.User@Example.test');

    await migration.up(db);

    expect((await db('user_invitations').where({ tenant, invitation_id: invitationId }).first()).email_normalized)
      .toBe('legacy.user@example.test');
    await expectRequiredColumn();

    const result = await db.transaction((trx) => UserInvitationService.createInvitationWithTransaction(
      { email: 'Service.User@Example.test', firstName: 'Service', lastName: 'User', roleId: null }, trx,
    ));
    expect(result.success).toBe(true);
    expect((await db('user_invitations').where({ invitation_id: result.invitationId }).first()).email_normalized)
      .toBe('service.user@example.test');
  });

  it('accepts the already-drifted schema and preserves its normalized key', async () => {
    await resetInvitationSchemaToOriginal();
    await resetInvitationRows();
    const tenant = await seedTenant();
    await db.schema.alterTable('user_invitations', (table) => {
      table.text('email_normalized').notNullable();
      table.uuid('invited_user_id').nullable();
    });
    const invitationId = await seedLegacyInvitation(tenant, 'Drift.User@Example.test', 'drift.user@example.test');
    await db.raw('CREATE INDEX idx_user_invitations_email_normalized ON user_invitations (tenant, email_normalized)');
    await db.raw('ALTER TABLE user_invitations ALTER COLUMN email_normalized SET NOT NULL');

    await migration.up(db);

    expect((await db('user_invitations').where({ tenant, invitation_id: invitationId }).first()).email_normalized)
      .toBe('drift.user@example.test');
    await expectRequiredColumn();
    await migration.down(db);
    expect(await db.schema.hasColumn('user_invitations', 'email_normalized')).toBe(true);
    await expect(db('user_invitations').insert({
      tenant, email: 'omitted@example.test', first_name: 'No', last_name: 'Key', token: randomUUID(),
      expires_at: db.raw("now() + interval '1 day'"), metadata: {},
    })).rejects.toThrow(/email_normalized/);
  });

  it('finishes a partially applied backfill and is safe to rerun', async () => {
    await resetInvitationSchemaToOriginal();
    await resetInvitationRows();
    const tenant = await seedTenant();
    const completedId = await seedLegacyInvitation(tenant, 'Partial.Done@Example.test');
    const pendingId = await seedLegacyInvitation(tenant, 'Partial.Pending@Example.test');
    await db.schema.alterTable('user_invitations', (table) => table.text('email_normalized').nullable());
    await db('user_invitations').where({ tenant, invitation_id: completedId })
      .update({ email_normalized: 'partial.done@example.test' });

    await migration.up(db);
    await migration.up(db);

    expect((await db('user_invitations').where({ tenant, invitation_id: completedId }).first()).email_normalized)
      .toBe('partial.done@example.test');
    expect((await db('user_invitations').where({ tenant, invitation_id: pendingId }).first()).email_normalized)
      .toBe('partial.pending@example.test');
    await expectRequiredColumn();
  });
});
