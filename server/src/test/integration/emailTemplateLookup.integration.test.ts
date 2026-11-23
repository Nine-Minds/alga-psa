import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant } from '../../../test-utils/testDataFactory';
import { lookupEmailTemplate } from '../../lib/notifications/emailTemplateLookup';
import {
  STOCK_EMAIL_PALETTE,
  applyEmailPalette,
  brandDecorator,
  resolveEmailPalette,
} from '@alga-psa/email/branding';
import { backfillDerivedTemplatesForTenant } from '@alga-psa/email/backfillDerivedTemplates';
import { renderResolvedQuoteEmail, resolveQuoteEmail } from '../../../../packages/billing/src/lib/quoteEmailRendering';
import { getTemplate as quoteEmailTemplate } from '../../../migrations/utils/templates/email/quotes/quoteEmail.cjs';

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
    return { db, customize, tenant };
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

  describe('branded copies that follow the standard template', () => {
    const TARGET = resolveEmailPalette({ primary: '#aa2200', secondary: '#112233' });
    const BRANDING = { logoUrl: '/api/documents/view/logo', clientName: 'RightPath Consulting' };
    const decorate = () => brandDecorator({ logo: { variant: 'default' } }, BRANDING, true, TARGET);
    const bodyOf = (reviewLink: boolean) => {
      const translation = quoteEmailTemplate({ reviewLink }).translations.find((t: any) => t.language === 'en')!;
      return { subject: translation.subject, html_content: translation.htmlContent, text_content: translation.textContent };
    };

    /** A RightPath-shaped tenant: branded before the review link existed, palette and logo applied. */
    async function rightPathTenant() {
      const { db, customize, tenant } = await freshTenant();
      const branded = (body: ReturnType<typeof bodyOf>) => ({
        ...body,
        html_content: decorate()!(applyEmailPalette(body.html_content, STOCK_EMAIL_PALETTE, TARGET)),
      });
      const old = branded(bodyOf(false));
      await testDb('tenant_settings').insert({
        tenant,
        settings: JSON.stringify({
          emailBranding: { primary: '#aa2200', secondary: '#112233', logo: { variant: 'default' }, appliedPalette: TARGET },
          branding: BRANDING,
        }),
      }).onConflict('tenant').merge();
      await db.table('tenant_email_templates').insert({
        tenant, name: 'quote-email', language_code: 'en', ...old,
      });
      return { db, tenant, customize, old };
    }

    it('serves the review link to a branded copy that predates it, once the backfill has stamped the row', async () => {
      const { db, tenant, old } = await rightPathTenant();
      expect((await resolveQuoteEmail(testDb, tenant, 'quote-email', 'en')).rendersReviewLink).toBe(false);

      const summary = await backfillDerivedTemplatesForTenant(testDb, tenant);
      expect(summary).toMatchObject({ considered: 1, unmatched: 0 });
      expect(summary.stamped).toHaveLength(1);

      const stored = await db.table('tenant_email_templates').where({ name: 'quote-email' }).first();
      expect(stored.html_content).toBe(old.html_content); // nothing rewritten, only provenance added
      expect(stored.derived_snapshot_hash).toMatch(/^[0-9a-f]{64}$/);

      const resolved = await resolveQuoteEmail(testDb, tenant, 'quote-email', 'en');
      expect(resolved.rendersReviewLink).toBe(true);
      const rendered = renderResolvedQuoteEmail({
        resolved,
        quote: { quote_id: 'q', quote_number: 'Q-1', total_amount: 5000, currency_code: 'USD' } as any,
        companyName: 'RightPath Consulting',
        portalLink: 'https://portal.example.com/client-portal/billing',
        quoteReviewLink: 'https://portal.example.com/quote/token123',
        hasPortalAccess: true,
      });
      expect(rendered.html).toContain('https://portal.example.com/quote/token123');
      expect(rendered.html).toContain('https://portal.example.com/client-portal/billing');
      expect(rendered.html).toContain('#aa2200');
    });

    it('is idempotent, and leaves a row that matches nothing untouched', async () => {
      const { db, tenant, customize } = await rightPathTenant();
      await customize('quote-reminder-email', 'en', 'OUR OWN REMINDER');
      const before = await db.table('tenant_email_templates').where({ name: 'quote-reminder-email' }).first();

      const first = await backfillDerivedTemplatesForTenant(testDb, tenant);
      expect(first).toMatchObject({ considered: 2, unmatched: 1 });
      const second = await backfillDerivedTemplatesForTenant(testDb, tenant);
      expect(second.skipped).toBe('already-run');
      const forced = await backfillDerivedTemplatesForTenant(testDb, tenant, { force: true });
      expect(forced.stamped).toEqual([]);

      const after = await db.table('tenant_email_templates').where({ name: 'quote-reminder-email' }).first();
      expect(after).toEqual(before);
      expect(after.derived_snapshot_hash).toBeNull();
      expect((await lookupEmailTemplate(db, 'quote-reminder-email', 'en'))?.source).toBe('tenant');
    });

    it('serves an edited row as the tenant wrote it, and a missing system row as the stored row', async () => {
      const { db, tenant } = await rightPathTenant();
      await backfillDerivedTemplatesForTenant(testDb, tenant);
      expect((await lookupEmailTemplate(db, 'quote-email', 'en'))?.source).toBe('tenant-derived');

      await db.table('tenant_email_templates').where({ name: 'quote-email' })
        .update({ html_content: testDb.raw("html_content || '<p>edited</p>'") });
      const edited = await lookupEmailTemplate(db, 'quote-email', 'en');
      expect(edited?.source).toBe('tenant');
      expect(edited?.template.html_content).toContain('<p>edited</p>');
    });
  });
});
