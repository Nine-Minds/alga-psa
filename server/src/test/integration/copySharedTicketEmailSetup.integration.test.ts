import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(
  __dirname, '../../../migrations/20261115121000_copy_shared_ticket_email_setup_to_client_templates.cjs',
)) as { up: (knex: Knex) => Promise<void>; down: (knex: Knex) => Promise<void> };

/**
 * The split migration against the real schema: what a tenant had set up for the shared
 * ticket-closed / ticket-comment-added email is copied to the client templates once, nothing a
 * tenant already has is replaced, and a second run writes nothing. Each run happens inside a
 * transaction that is rolled back, so the shared test database keeps no trace of it.
 */
describe('copy shared ticket email setup to the client templates (integration)', () => {
  let testDb: Knex;

  class Rollback extends Error {}
  /** Runs `work` in a transaction that never commits. */
  async function inRolledBackTransaction(work: (trx: Knex.Transaction) => Promise<void>): Promise<void> {
    await testDb.transaction(async (trx) => {
      await work(trx);
      throw new Rollback();
    }).catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });
  }

  async function seedTenant(trx: Knex.Transaction, label: string) {
    const tenant = await createTenant(trx, `Copy ${label} ${uuidv4().slice(0, 6)}`);
    const db = tenantDb(trx, tenant);
    const template = (name: string, language: string, marker: string) => db.table('tenant_email_templates').insert({
      tenant, name, language_code: language, subject: `${marker} subject`, html_content: `<p>${marker}</p>`, text_content: marker,
    });
    const subtypeId = async (name: string) => (await db.table('notification_subtypes').where({ name }).first('id')).id as number;
    const rows = (name: string) => db.table('tenant_email_templates').where({ name }).orderBy('language_code')
      .select('language_code', 'subject', 'html_content', 'text_content', 'system_template_id');
    return { tenant, db, template, subtypeId, rows };
  }

  beforeAll(async () => {
    testDb = await createTestDbConnection();
  }, 900_000);

  afterAll(async () => {
    await testDb?.destroy();
  });

  it('copies each tenant\'s shared template rows unchanged, in every language it has', async () => {
    await inRolledBackTransaction(async (trx) => {
      const acme = await seedTenant(trx, 'acme');
      await acme.template('ticket-closed', 'en', 'ACME-CLOSED-EN');
      await acme.template('ticket-closed', 'fr', 'ACME-CLOSED-FR');
      await acme.template('ticket-comment-added', 'en', 'ACME-COMMENT-EN');
      const other = await seedTenant(trx, 'other');
      await other.template('ticket-closed', 'en', 'OTHER-CLOSED-EN');

      await migration.up(trx);

      const acmeClosed = await acme.rows('ticket-closed-client');
      expect(acmeClosed.map((row) => [row.language_code, row.subject, row.html_content, row.text_content])).toEqual([
        ['en', 'ACME-CLOSED-EN subject', '<p>ACME-CLOSED-EN</p>', 'ACME-CLOSED-EN'],
        ['fr', 'ACME-CLOSED-FR subject', '<p>ACME-CLOSED-FR</p>', 'ACME-CLOSED-FR'],
      ]);
      // Linked to the stock client template of the same language, like a row made with "Customize".
      const stock = await acme.db.table('system_email_templates').where({ name: 'ticket-closed-client' }).select('id', 'language_code');
      expect(acmeClosed.map((row) => row.system_template_id)).toEqual(
        ['en', 'fr'].map((language) => stock.find((row) => row.language_code === language)!.id),
      );
      expect((await acme.rows('ticket-comment-added-client')).map((row) => row.text_content)).toEqual(['ACME-COMMENT-EN']);
      // Each tenant gets its own rows and nobody else's.
      expect((await other.rows('ticket-closed-client')).map((row) => row.text_content)).toEqual(['OTHER-CLOSED-EN']);
      expect(await other.rows('ticket-comment-added-client')).toEqual([]);
      // The shared rows are untouched.
      expect((await acme.rows('ticket-closed')).map((row) => row.text_content)).toEqual(['ACME-CLOSED-EN', 'ACME-CLOSED-FR']);
    });
  });

  it('never replaces a client template a tenant already has, and writes nothing on a second run', async () => {
    await inRolledBackTransaction(async (trx) => {
      const acme = await seedTenant(trx, 'acme');
      await acme.template('ticket-closed', 'en', 'ACME-SHARED');
      await acme.template('ticket-closed-client', 'en', 'ACME-OWN-CLIENT');

      await migration.up(trx);
      expect((await acme.rows('ticket-closed-client')).map((row) => row.text_content)).toEqual(['ACME-OWN-CLIENT']);

      const before = await acme.db.table('tenant_email_templates').count({ count: '*' }).first();
      await migration.up(trx);
      expect(await acme.db.table('tenant_email_templates').count({ count: '*' }).first()).toEqual(before);
    });
  });

  it('leaves a tenant that customized nothing with no rows at all', async () => {
    await inRolledBackTransaction(async (trx) => {
      const plain = await seedTenant(trx, 'plain');
      await migration.up(trx);
      expect(await plain.db.table('tenant_email_templates').select('name')).toEqual([]);
    });
  });

  it('copies a switched-off notification and a user opt-out, and nothing that is on', async () => {
    await inRolledBackTransaction(async (trx) => {
      const acme = await seedTenant(trx, 'acme');
      const optedOut = await createUser(trx, acme.tenant, { email: `out.${uuidv4().slice(0, 6)}@example.com` });
      const optedIn = await createUser(trx, acme.tenant, { email: `in.${uuidv4().slice(0, 6)}@example.com` });
      const closed = await acme.subtypeId('Ticket Closed');
      const comment = await acme.subtypeId('Ticket Comment Added');
      const closedClient = await acme.subtypeId('Ticket Closed Client');
      const commentClient = await acme.subtypeId('Ticket Comment Added Client');
      await acme.db.table('tenant_notification_subtype_settings').insert([
        { tenant: acme.tenant, subtype_id: closed, is_enabled: false },
        { tenant: acme.tenant, subtype_id: comment, is_enabled: true },
      ]);
      await acme.db.table('user_notification_preferences').insert([
        { tenant: acme.tenant, user_id: optedOut, subtype_id: closed, is_enabled: false },
        { tenant: acme.tenant, user_id: optedIn, subtype_id: closed, is_enabled: true },
      ]);

      await migration.up(trx);

      const settings = await acme.db.table('tenant_notification_subtype_settings')
        .whereIn('subtype_id', [closedClient, commentClient]).select('subtype_id', 'is_enabled');
      expect(settings).toEqual([{ subtype_id: closedClient, is_enabled: false }]);
      const preferences = await acme.db.table('user_notification_preferences')
        .where({ subtype_id: closedClient }).select('user_id', 'is_enabled');
      expect(preferences).toEqual([{ user_id: optedOut, is_enabled: false }]);
    });
  });

  it('down removes untouched copies and keeps a client template a tenant edited since', async () => {
    await inRolledBackTransaction(async (trx) => {
      const acme = await seedTenant(trx, 'acme');
      await acme.template('ticket-closed', 'en', 'ACME-CLOSED');
      await acme.template('ticket-comment-added', 'en', 'ACME-COMMENT');
      await migration.up(trx);
      await acme.db.table('tenant_email_templates')
        .where({ name: 'ticket-comment-added-client' }).update({ html_content: '<p>Edited for clients</p>' });

      await migration.down(trx);

      expect(await acme.rows('ticket-closed-client')).toEqual([]);
      expect((await acme.rows('ticket-comment-added-client')).map((row) => row.html_content)).toEqual(['<p>Edited for clients</p>']);
      expect((await acme.rows('ticket-closed')).map((row) => row.text_content)).toEqual(['ACME-CLOSED']);
    });
  });
});
