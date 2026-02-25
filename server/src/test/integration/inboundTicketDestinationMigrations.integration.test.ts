import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);

describe('inbound ticket destination migrations (integration)', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = await createTestDbConnection();
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('T001: migration adds clients.inbound_ticket_defaults_id as nullable UUID', async () => {
    await expect(knex.schema.hasColumn('clients', 'inbound_ticket_defaults_id')).resolves.toBe(true);

    const column = await knex('information_schema.columns')
      .where({
        table_schema: 'public',
        table_name: 'clients',
        column_name: 'inbound_ticket_defaults_id',
      })
      .select<{ is_nullable: string; data_type: string }[]>('is_nullable', 'data_type')
      .first();

    expect(column).toBeTruthy();
    expect(column?.is_nullable).toBe('YES');
    expect(column?.data_type).toBe('uuid');
  });

  it('T002: migration adds contacts.inbound_ticket_defaults_id as nullable UUID', async () => {
    await expect(knex.schema.hasColumn('contacts', 'inbound_ticket_defaults_id')).resolves.toBe(true);

    const column = await knex('information_schema.columns')
      .where({
        table_schema: 'public',
        table_name: 'contacts',
        column_name: 'inbound_ticket_defaults_id',
      })
      .select<{ is_nullable: string; data_type: string }[]>('is_nullable', 'data_type')
      .first();

    expect(column).toBeTruthy();
    expect(column?.is_nullable).toBe('YES');
    expect(column?.data_type).toBe('uuid');
  });

  it('T003: migration adds tenant-scoped lookup indexes for client/contact destination columns', async () => {
    const result = await knex.raw<{
      rows: Array<{ indexname: string; tablename: string; indexdef: string }>;
    }>(`
      SELECT indexname, tablename, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'idx_clients_tenant_inbound_ticket_defaults',
          'idx_contacts_tenant_inbound_ticket_defaults'
        )
    `);

    const rows = result.rows ?? [];
    const byName = new Map(rows.map((row) => [row.indexname, row]));

    const clientsIndex = byName.get('idx_clients_tenant_inbound_ticket_defaults');
    const contactsIndex = byName.get('idx_contacts_tenant_inbound_ticket_defaults');

    expect(clientsIndex?.tablename).toBe('clients');
    expect(clientsIndex?.indexdef).toContain('(tenant, inbound_ticket_defaults_id)');

    expect(contactsIndex?.tablename).toBe('contacts');
    expect(contactsIndex?.indexdef).toContain('(tenant, inbound_ticket_defaults_id)');
  });

  it('T004: migration down path removes added columns/indexes and up restores them', async () => {
    const clientDestinationMigration = require('../../../../migrations/20260225120000_add_client_inbound_ticket_defaults_id.cjs');
    const contactDestinationMigration = require('../../../../migrations/20260225120500_add_contact_inbound_ticket_defaults_id.cjs');
    const indexMigration = require('../../../../migrations/20260225121000_add_inbound_ticket_defaults_lookup_indexes.cjs');

    const trx = await knex.transaction();
    let testError: unknown = null;

    try {
      await indexMigration.down(trx);
      await contactDestinationMigration.down(trx);
      await clientDestinationMigration.down(trx);

      await expect(trx.schema.hasColumn('clients', 'inbound_ticket_defaults_id')).resolves.toBe(false);
      await expect(trx.schema.hasColumn('contacts', 'inbound_ticket_defaults_id')).resolves.toBe(false);

      const downIndexesResult = await trx.raw<{
        rows: Array<{ indexname: string }>;
      }>(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'idx_clients_tenant_inbound_ticket_defaults',
            'idx_contacts_tenant_inbound_ticket_defaults'
          )
      `);

      expect(downIndexesResult.rows ?? []).toHaveLength(0);

      await clientDestinationMigration.up(trx);
      await contactDestinationMigration.up(trx);
      await indexMigration.up(trx);

      await expect(trx.schema.hasColumn('clients', 'inbound_ticket_defaults_id')).resolves.toBe(true);
      await expect(trx.schema.hasColumn('contacts', 'inbound_ticket_defaults_id')).resolves.toBe(true);

      const upIndexesResult = await trx.raw<{
        rows: Array<{ indexname: string }>;
      }>(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'idx_clients_tenant_inbound_ticket_defaults',
            'idx_contacts_tenant_inbound_ticket_defaults'
          )
      `);

      expect((upIndexesResult.rows ?? []).map((row) => row.indexname)).toEqual(
        expect.arrayContaining([
          'idx_clients_tenant_inbound_ticket_defaults',
          'idx_contacts_tenant_inbound_ticket_defaults',
        ])
      );
    } catch (error) {
      testError = error;
    } finally {
      await trx.rollback();
    }

    if (testError) {
      throw testError;
    }
  });
});
