import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant } from '../../../test-utils/testDataFactory';
import { lookupEmailTemplate } from '../../lib/notifications/emailTemplateLookup';

/**
 * Which template row an email is rendered with, against the real tables. A client template and
 * the internal template it was split from are separate emails: each uses the tenant's row under
 * its own name, else the stock row, and nothing is borrowed from the other.
 */
describe('email template lookup (integration)', () => {
  let testDb: Knex;

  /** Each case gets its own tenant: cases run in any order and must not see each other's rows. */
  async function freshTenant() {
    const tenant = await createTenant(testDb, `Lookup ${uuidv4().slice(0, 6)}`);
    const db = tenantDb(testDb, tenant);
    const customize = (name: string, language: string, marker: string) => db.table('tenant_email_templates').insert({
      tenant, name, language_code: language, subject: `${marker} subject`,
      html_content: `<p>${marker}</p>`, text_content: marker,
    });
    return { db, customize };
  }

  beforeAll(async () => {
    testDb = await createTestDbConnection();
  }, 900_000);

  afterAll(async () => {
    await testDb?.destroy();
  });

  it('uses the stock client template for a tenant that customized nothing', async () => {
    const { db } = await freshTenant();
    const found = await lookupEmailTemplate(db, 'ticket-closed-client', 'fr');
    expect(found?.source).toBe('system');
    expect(found?.template).toMatchObject({ name: 'ticket-closed-client', language_code: 'fr' });
  });

  it('falls back to English when the stock template has no row in the recipient language', async () => {
    const { db } = await freshTenant();
    const found = await lookupEmailTemplate(db, 'ticket-closed-client', 'xx');
    expect(found?.template).toMatchObject({ name: 'ticket-closed-client', language_code: 'en' });
  });

  it('never sends clients a tenant\'s internal template: customizing ticket-closed leaves the client email stock', async () => {
    const { db, customize } = await freshTenant();
    await customize('ticket-closed', 'en', 'TENANT-INTERNAL-CLOSED');

    const client = await lookupEmailTemplate(db, 'ticket-closed-client', 'en');
    expect(client?.source).toBe('system');
    expect(client?.template.name).toBe('ticket-closed-client');
    expect(client?.template.html_content).not.toContain('TENANT-INTERNAL-CLOSED');
    // Staff get the customized internal template.
    const internal = await lookupEmailTemplate(db, 'ticket-closed', 'en');
    expect(internal?.source).toBe('tenant');
    expect(internal?.template.html_content).toContain('TENANT-INTERNAL-CLOSED');
  });

  it('uses the tenant\'s client template for clients, and its English row for another language', async () => {
    const { db, customize } = await freshTenant();
    await customize('ticket-closed', 'en', 'TENANT-INTERNAL-CLOSED');
    await customize('ticket-closed-client', 'en', 'TENANT-CLIENT-CLOSED');

    const found = await lookupEmailTemplate(db, 'ticket-closed-client', 'fr');
    expect(found?.source).toBe('tenant');
    expect(found?.template.html_content).toContain('TENANT-CLIENT-CLOSED');
  });

  it('does the same for the comment email', async () => {
    const { db, customize } = await freshTenant();
    await customize('ticket-comment-added', 'en', 'TENANT-INTERNAL-COMMENT');
    expect((await lookupEmailTemplate(db, 'ticket-comment-added-client', 'en'))?.source).toBe('system');
  });

  it('returns nothing for a template that does not exist', async () => {
    const { db } = await freshTenant();
    expect(await lookupEmailTemplate(db, 'no-such-template', 'en')).toBeNull();
  });
});
