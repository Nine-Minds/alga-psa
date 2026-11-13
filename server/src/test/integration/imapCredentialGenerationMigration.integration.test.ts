import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import { v4 as uuid } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20261103090000_add_imap_credential_generation.cjs');

let db: Knex;

describe('IMAP credential generation migration', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
  }, 600_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('preserves provider rows and supports repeated up/down and up after down', async () => {
    const trx = await db.transaction();
    const schema = `imap_credential_generation_${uuid().replaceAll('-', '')}`;
    try {
      await trx.raw('CREATE SCHEMA ??', [schema]);
      await trx.raw('SET LOCAL search_path TO ??, public', [schema]);
      await trx.schema.createTable('imap_email_provider_config', (table) => {
        table.uuid('id').primary();
        table.uuid('tenant').notNullable();
        table.string('host').notNullable();
        table.string('username').notNullable();
      });

      const originalRows = [
        { id: uuid(), tenant: uuid(), host: 'imap.example.test', username: 'support' },
        { id: uuid(), tenant: uuid(), host: 'mail.example.test', username: 'billing' },
      ];
      await trx('imap_email_provider_config').insert(originalRows);

      await migration.up(trx);
      await migration.up(trx);
      expect(await trx.schema.hasColumn('imap_email_provider_config', 'credential_generation')).toBe(true);
      expect(await trx('imap_email_provider_config').select('id', 'tenant', 'host', 'username', 'credential_generation').orderBy('id'))
        .toEqual([...originalRows].sort((a, b) => a.id.localeCompare(b.id))
          .map((row) => ({ ...row, credential_generation: null })));

      await migration.down(trx);
      await migration.down(trx);
      expect(await trx.schema.hasColumn('imap_email_provider_config', 'credential_generation')).toBe(false);
      expect(await trx('imap_email_provider_config').select('id', 'tenant', 'host', 'username').orderBy('id'))
        .toEqual([...originalRows].sort((a, b) => a.id.localeCompare(b.id)));

      await migration.up(trx);
      expect(await trx.schema.hasColumn('imap_email_provider_config', 'credential_generation')).toBe(true);
      expect(await trx('imap_email_provider_config').select('id', 'tenant', 'host', 'username').orderBy('id'))
        .toEqual([...originalRows].sort((a, b) => a.id.localeCompare(b.id)));
    } finally {
      await trx.rollback();
    }
  });
});
