import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { mint } from '@alga-psa/billing/services';

import {
  applyTestEnvDefaults,
  createTestDbConnection,
  createTestTenant,
  getBaseUrl,
  type TenantTestData,
} from './helpers/testSetup';

applyTestEnvDefaults();

// Public, session-less quote review page (alga-2026-0002820 3/6).
// No login / storage state is used anywhere in this file: the bearer token in
// the URL is the only credential.
test.describe('public quote review page', () => {
  test('renders by token without a session, rejects bad tokens, serves the PDF', async ({ page, request }) => {
    test.setTimeout(180000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const quoteId = uuidv4();

    try {
      tenantData = await createTestTenant(db, { companyName: `Quote Review ${uuidv4().slice(0, 6)}` });
      const tenantId = tenantData.tenant.tenantId;

      await tenantDb(db, tenantId).table('quotes').insert({
        tenant: tenantId,
        quote_id: quoteId,
        quote_number: `PQ-${uuidv4().slice(0, 6)}`,
        title: 'Public review e2e quote',
        status: 'sent',
        currency_code: 'EUR',
        client_id: tenantData.client?.clientId ?? null,
        internal_notes: 'INTERNAL-ONLY-MARKER',
      });

      const { token } = await mint(db, tenantId, {
        quote: { quote_id: quoteId, valid_until: null } as any,
        recipient: { contactId: null, email: 'recipient@example.test' },
      });

      // 1. Valid token, no session cookies.
      const thirdParty: string[] = [];
      const appHost = new URL(test.info().project.use.baseURL ?? getBaseUrl()).host;
      page.on('request', (req) => {
        const u = new URL(req.url());
        if (!['http:', 'https:'].includes(u.protocol)) return;
        if (u.host !== appHost) thirdParty.push(req.url());
      });
      const response = await page.goto(`/quote/${token}`);
      expect(response?.status()).toBe(200);
      expect(response?.headers()['referrer-policy']).toBe('no-referrer');
      expect(response?.headers()['x-robots-tag']).toContain('noindex');
      await expect(page.getByText('Public review e2e quote')).toBeVisible();
      await expect(page.locator('body')).not.toContainText('INTERNAL-ONLY-MARKER');
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      expect(page.url()).not.toContain('/auth/');
      expect(thirdParty).toEqual([]);

      // 2. PDF endpoint, token in path, no session.
      const pdf = await request.get(`/api/quote/${token}/pdf`);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()['content-type']).toContain('application/pdf');

      // 3. Bad (well-formed but unknown) token: generic outcome, no quote data.
      const bad = 'z'.repeat(43);
      await page.goto(`/quote/${bad}`);
      await expect(page.locator('#public-quote-outcome')).toBeVisible();
      await expect(page.locator('#public-quote-signin-link')).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Public review e2e quote');
      expect((await request.get(`/api/quote/${bad}/pdf`)).status()).toBe(404);

      // 4. Expired link: 410 on the PDF, outcome page on the page.
      await tenantDb(db, tenantId)
        .table('quote_access_links')
        .where({ quote_id: quoteId })
        .update({ expires_at: new Date(Date.now() - 60_000) });
      expect((await request.get(`/api/quote/${token}/pdf`)).status()).toBe(410);
      await page.goto(`/quote/${token}`);
      await expect(page.locator('#public-quote-outcome')).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Public review e2e quote');
    } finally {
      if (tenantData) {
        const tenantId = tenantData.tenant.tenantId;
        for (const table of ['quote_access_links', 'quote_activities', 'quote_items', 'quotes']) {
          await tenantDb(db, tenantId).table(table).where({ tenant: tenantId }).del().catch(() => undefined);
        }
      }
      await db.destroy();
    }
  });
});
