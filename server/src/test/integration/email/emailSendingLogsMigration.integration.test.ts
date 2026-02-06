import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);

describe('email_sending_logs entity context migrations', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = await createTestDbConnection();
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('adds entity_type column', async () => {
    await expect(knex.schema.hasColumn('email_sending_logs', 'entity_type')).resolves.toBe(true);
  });

  it('adds entity_id column', async () => {
    await expect(knex.schema.hasColumn('email_sending_logs', 'entity_id')).resolves.toBe(true);
  });

  it('adds contact_id column', async () => {
    await expect(knex.schema.hasColumn('email_sending_logs', 'contact_id')).resolves.toBe(true);
  });

  it('adds notification_subtype_id column', async () => {
    await expect(knex.schema.hasColumn('email_sending_logs', 'notification_subtype_id')).resolves.toBe(true);
  });

  it('creates tenant/entity index', async () => {
    const result = await knex.raw(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'email_sending_logs'`
    );
    const indexNames = (result?.rows ?? []).map((row: any) => row.indexname);
    expect(indexNames).toContain('idx_email_sending_logs_tenant_entity');
  });

  it('creates tenant/contact index', async () => {
    const result = await knex.raw(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'email_sending_logs'`
    );
    const indexNames = (result?.rows ?? []).map((row: any) => row.indexname);
    expect(indexNames).toContain('idx_email_sending_logs_tenant_contact');
  });

  it('migration files export up/down functions', async () => {
    const indexesMigration = require('../../../../migrations/20260127153100_add_email_sending_log_entity_indexes.cjs');
    const columnsMigration = require('../../../../migrations/20260127153000_add_email_sending_log_entity_columns.cjs');

    expect(typeof columnsMigration.up).toBe('function');
    expect(typeof columnsMigration.down).toBe('function');
    expect(typeof indexesMigration.up).toBe('function');
    expect(typeof indexesMigration.down).toBe('function');
  });
});
