import { test, expect, type APIResponse } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

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
//
// Links are minted by inserting a quote_access_links row directly (token ->
// sha256 hex, the encoding card 2's resolve() looks up) because
// @alga-psa/billing/services is CJS/TS and cannot be loaded by Playwright.

const INTERNAL_NOTE = 'RV36-INTERNAL-NOTE-DO-NOT-LEAK';

/** 43-char base64url token (32 random bytes), as generateQuoteAccessToken. */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

const DAY = 24 * 60 * 60 * 1000;

test.describe('public quote review page', () => {
  test('renders by token without a session, keeps every failure outcome opaque, serves the PDF', async ({
    page,
    request,
    context,
  }) => {
    test.setTimeout(240000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      tenantData = await createTestTenant(db, { companyName: `Quote Review ${uuidv4().slice(0, 6)}` });
      const tenantId = tenantData.tenant.tenantId;
      const scoped = tenantDb(db, tenantId);

      // German-speaking client + contact (client properties.defaultLocale = de).
      const deClientId = uuidv4();
      const deContactId = uuidv4();
      await scoped.table('clients').insert({
        client_id: deClientId,
        tenant: tenantId,
        client_name: 'RV36 Kunde GmbH',
        properties: JSON.stringify({ defaultLocale: 'de' }),
        created_at: new Date(),
        updated_at: new Date(),
      });
      await scoped.table('contacts').insert({
        contact_name_id: deContactId,
        tenant: tenantId,
        full_name: 'Greta Review',
        email: `greta-${uuidv4().slice(0, 6)}@kunde.example`,
        client_id: deClientId,
      });

      const mintQuote = async (opts: {
        number: string;
        title: string;
        status?: string;
        clientId: string;
        contactId?: string | null;
      }) => {
        const quoteId = uuidv4();
        await scoped.table('quotes').insert({
          tenant: tenantId,
          quote_id: quoteId,
          quote_number: opts.number,
          title: opts.title,
          status: opts.status ?? 'sent',
          currency_code: 'EUR',
          client_id: opts.clientId,
          contact_id: opts.contactId ?? null,
          // calendar days, stored as midnight UTC
          quote_date: '2026-10-18T00:00:00Z',
          valid_until: '2026-12-31T00:00:00Z',
          subtotal: 500000,
          tax: 0,
          total_amount: 500000,
          discount_total: 0,
          terms_and_conditions: 'Payment due within 30 days of acceptance.',
          internal_notes: INTERNAL_NOTE,
          is_template: false,
          version: 1,
        });
        await scoped.table('quote_items').insert([
          {
            tenant: tenantId,
            quote_item_id: uuidv4(),
            quote_id: quoteId,
            description: 'Looking Glass Maintenance',
            quantity: 1,
            unit_price: 500000,
            total_price: 500000,
            is_optional: false,
            is_selected: true,
            is_recurring: false,
            is_discount: false,
            display_order: 1,
          },
          {
            tenant: tenantId,
            quote_item_id: uuidv4(),
            quote_id: quoteId,
            description: 'Shrinking Potion (optional)',
            quantity: 3,
            unit_price: 33333,
            total_price: 99999,
            is_optional: true,
            is_selected: false,
            is_recurring: false,
            is_discount: false,
            display_order: 2,
          },
        ]);
        return quoteId;
      };

      const mintLink = async (
        quoteId: string,
        overrides: Record<string, unknown> = {},
        recipient: { email: string; contactId?: string | null } = { email: 'recipient@example.test' },
      ) => {
        const token = newToken();
        await scoped.table('quote_access_links').insert({
          tenant: tenantId,
          link_id: uuidv4(),
          quote_id: quoteId,
          contact_id: recipient.contactId ?? null,
          recipient_email: recipient.email,
          token_hash: hashToken(token),
          expires_at: new Date(Date.now() + 30 * DAY),
          ...overrides,
        });
        return token;
      };

      const quoteNumber = `PQ-${uuidv4().slice(0, 6).toUpperCase()}`;
      const quoteId = await mintQuote({
        number: quoteNumber,
        title: 'Public review e2e quote',
        clientId: tenantData.client!.clientId,
      });
      const validToken = await mintLink(quoteId);
      const revokedToken = await mintLink(quoteId, { revoked_at: new Date(), revoked_reason: 'manual' });
      const expiredToken = await mintLink(quoteId, { expires_at: new Date(Date.now() - 60_000) });
      const supersededToken = await mintLink(quoteId, { revoked_at: new Date(), revoked_reason: 'superseded' });
      const unknownToken = newToken();

      const acceptedQuoteId = await mintQuote({
        number: `PQA-${uuidv4().slice(0, 6).toUpperCase()}`,
        title: 'Decided e2e quote',
        status: 'accepted',
        clientId: tenantData.client!.clientId,
      });
      const decidedToken = await mintLink(acceptedQuoteId);

      const deQuoteId = await mintQuote({
        number: `PQD-${uuidv4().slice(0, 6).toUpperCase()}`,
        title: 'Verwaltete Dienste',
        clientId: deClientId,
        contactId: deContactId,
      });
      const deEmail = (await scoped.table('contacts').where({ contact_name_id: deContactId }).first('email')).email;
      const germanToken = await mintLink(deQuoteId, {}, { email: deEmail, contactId: deContactId });

      const linkRow = (token: string) =>
        scoped.table('quote_access_links').where({ token_hash: hashToken(token) }).first();
      const viewCount = async (id: string) => {
        const row = await scoped
          .table('quote_activities')
          .where({ quote_id: id, activity_type: 'viewed_via_email_link' })
          .count<{ count: string }[]>('* as count')
          .first();
        return Number(row?.count ?? 0);
      };

      // No request may leave the app's own origin.
      const appHost = new URL(test.info().project.use.baseURL ?? getBaseUrl()).host;
      const foreign: string[] = [];
      page.on('request', (req) => {
        const u = new URL(req.url());
        if (!['http:', 'https:'].includes(u.protocol)) return;
        if (u.host !== appHost) foreign.push(req.url());
      });

      const expectHardenedHeaders = (headers: Record<string, string>) => {
        expect(headers['cache-control']).toContain('no-store');
        expect(headers['cache-control']).toContain('private');
        expect(headers['referrer-policy']).toBe('no-referrer');
        expect(headers['x-robots-tag']).toContain('noindex');
        expect(headers['access-control-allow-origin']).toBeUndefined();
        expect(headers['access-control-allow-credentials']).toBeUndefined();
      };

      const expectNoSessionCookie = async () => {
        const names = (await context.cookies()).map((c) => c.name.toLowerCase());
        // The auth wrapper hands every visitor a csrf-token / callback-url cookie; what
        // must never exist is an actual session.
        expect(names.filter((n) => /session-token|sessiontoken/.test(n))).toEqual([]);
      };

      // ---- 1. valid token, no session -------------------------------------------------
      await expectNoSessionCookie();
      const before = await linkRow(validToken);
      expect(before.last_used_at).toBeNull();

      const validResponse = await page.goto(`/quote/${validToken}`);
      expect(validResponse?.status()).toBe(200);
      expectHardenedHeaders(validResponse!.headers());
      expect(page.url()).not.toContain('/auth/');
      await expect(page.getByText('Public review e2e quote').first()).toBeVisible();
      const body = page.locator('body');
      await expect(body).toContainText(quoteNumber);
      await expect(body).toContainText('Looking Glass Maintenance');
      await expect(body).toContainText('Shrinking Potion (optional)');
      await expect(body).toContainText('Payment due within 30 days of acceptance.');
      // Quote currency (EUR), never USD
      await expect(body).toContainText('€');
      await expect(body).not.toContainText('$');
      // valid-until: the stored calendar day, named month (any timezone)
      await expect(body).toContainText(/31\b/);
      await expect(body).toContainText(/December|Dec/);
      await expect(body).not.toContainText(INTERNAL_NOTE);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expectNoSessionCookie();

      // exactly one view activity + last_used_at
      await expect.poll(() => viewCount(quoteId)).toBe(1);
      expect((await linkRow(validToken)).last_used_at).not.toBeNull();

      // the RSC/prefetch flavour of the same path is not cacheable either
      const rsc = await request.get(`/quote/${validToken}`, { headers: { RSC: '1' } });
      expect(rsc.headers()['cache-control']).toContain('no-store');
      expect(rsc.headers()['cache-control']).toContain('private');

      // ---- 2. PDF endpoint ------------------------------------------------------------
      const pdf = await request.get(`/api/quote/${validToken}/pdf`);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()['content-type']).toContain('application/pdf');
      expectHardenedHeaders(pdf.headers());
      expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');

      // ---- 3. unknown and revoked are indistinguishable --------------------------------
      const snapshot = async (token: string) => {
        const res = await page.goto(`/quote/${token}`);
        const html = await page.content();
        expectHardenedHeaders(res!.headers());
        return {
          status: res!.status(),
          text: (await page.locator('body').innerText()).trim(),
          title: await page.title(),
          lang: await page.locator('html').getAttribute('lang'),
          copy: await page.locator('[data-outcome-copy]').getAttribute('data-outcome-copy'),
          html,
        };
      };
      const revokedBefore = await linkRow(revokedToken);
      const unknown = await snapshot(unknownToken);
      const revoked = await snapshot(revokedToken);
      expect(revoked.status).toBe(unknown.status);
      expect(revoked.text).toBe(unknown.text);
      expect(revoked.title).toBe(unknown.title);
      expect(revoked.lang).toBe(unknown.lang);
      expect(revoked.copy).toBe(unknown.copy);
      // revoked records no use
      const revokedAfter = await linkRow(revokedToken);
      expect(revokedAfter.last_used_at).toEqual(revokedBefore.last_used_at);
      expect(revokedAfter.use_count).toBe(revokedBefore.use_count);

      const shape = async (res: APIResponse) => {
        const h = { ...res.headers() };
        delete h['date'];
        delete h['x-request-id'];
        return { status: res.status(), headers: h, body: (await res.body()).toString() };
      };
      const pdfUnknown = await shape(await request.get(`/api/quote/${unknownToken}/pdf`));
      const pdfRevoked = await shape(await request.get(`/api/quote/${revokedToken}/pdf`));
      expect(pdfUnknown.status).toBe(404);
      expect(pdfRevoked).toEqual(pdfUnknown);
      expect(pdfUnknown.body).toBe('');
      expect(pdfUnknown.headers['cache-control']).toContain('no-store');

      // ---- 3b. rate limiting: 429 on the PDF route, opaque page ----------------------------
      // The resolver limits 30 attempts / 5 min per client IP; a private fake IP keeps
      // the burst away from every other request in this run.
      const burstIp = `203.0.113.${1 + Math.floor(Math.random() * 250)}`;
      const burstHeaders = { 'x-forwarded-for': burstIp };
      let limited: APIResponse | null = null;
      for (let i = 0; i < 40 && !limited; i += 1) {
        const res = await request.get(`/api/quote/${newToken()}/pdf`, { headers: burstHeaders });
        if (res.status() === 429) limited = res;
        else expect(res.status()).toBe(404);
      }
      expect(limited, 'PDF route never answered 429 to a burst from one IP').not.toBeNull();
      expectHardenedHeaders(limited!.headers());
      expect((await limited!.body()).length).toBe(0);
      // a limited valid token is not served either
      expect((await request.get(`/api/quote/${validToken}/pdf`, { headers: burstHeaders })).status()).toBe(429);

      // ---- 4. expired / superseded / decided each have their own page -------------------
      for (const [token, copy] of [
        [expiredToken, 'expired'],
        [supersededToken, 'superseded'],
      ] as const) {
        const outcome = await snapshot(token);
        expect(outcome.status).toBe(200);
        expect(outcome.copy).toBe(copy);
        expect(outcome.copy).not.toBe(unknown.copy);
        await expect(page.locator('#public-quote-signin-link')).toBeVisible();
        await expect(page.locator('body')).toContainText(/Reply to the email/i);
        expect(outcome.html).not.toContain(quoteNumber);
        expect(outcome.html).not.toContain(INTERNAL_NOTE);
        expect(outcome.html).not.toContain('Public review e2e quote');
        expect(outcome.html).not.toContain(tenantData.tenant.tenantName);
        expect((await request.get(`/api/quote/${token}/pdf`)).status()).toBe(410);
      }
      for (const token of [unknownToken, revokedToken]) {
        await page.goto(`/quote/${token}`);
        await expect(page.locator('#public-quote-signin-link')).toBeVisible();
      }
      expect(unknown.html).not.toContain(quoteNumber);
      expect(unknown.html).not.toContain(INTERNAL_NOTE);
      expect(revoked.html).not.toContain(quoteNumber);
      expect(revoked.html).not.toContain(INTERNAL_NOTE);
      expect(revoked.html).not.toContain(tenantData.tenant.tenantName);

      // Non-valid outcomes (unknown, revoked, expired, superseded) recorded no view:
      // the quote they point at still has exactly the one view from the valid token.
      expect(await viewCount(quoteId)).toBe(1);

      // Decided quotes stay viewable, read-only, with a neutral notice (design:
      // card 2 never produces the `decided` resolve status).
      const decidedResponse = await page.goto(`/quote/${decidedToken}`);
      expect(decidedResponse?.status()).toBe(200);
      expectHardenedHeaders(decidedResponse!.headers());
      await expect(page.locator('#public-quote-notice')).toBeVisible();
      await expect(page.locator('body')).not.toContainText(INTERNAL_NOTE);

      // ---- 5. German recipient ----------------------------------------------------------
      const deResponse = await page.goto(`/quote/${germanToken}`);
      expect(deResponse?.status()).toBe(200);
      expectHardenedHeaders(deResponse!.headers());
      await expect(page.locator('html')).toHaveAttribute('lang', 'de');
      await expect(page.getByText('Verwaltete Dienste').first()).toBeVisible();
      // valid_until / quote_date as a German named month, on the stored day
      await expect(page.locator('body')).toContainText('31. Dezember 2026');
      await expect(page.locator('body')).toContainText('18. Oktober 2026');
      await expect(page.locator('body')).not.toContainText('December');
      await expect(page.locator('body')).not.toContainText(INTERNAL_NOTE);

      // ---- 6. nothing left the origin and no cookie was ever needed ------------------------
      expect(foreign).toEqual([]);
      await expectNoSessionCookie();
    } finally {
      if (tenantData) {
        const tenantId = tenantData.tenant.tenantId;
        for (const table of ['quote_access_links', 'quote_activities', 'quote_items', 'quotes', 'contacts']) {
          await tenantDb(db, tenantId).table(table).where({ tenant: tenantId }).del().catch(() => undefined);
        }
      }
      await db.destroy();
    }
  });
  // Calendar dates are days, not instants: the same stored day must render on every
  // timezone, in the page's language. quote_date = 2026-10-18T00:00Z (the west-of-UTC
  // trap: 17 Oct in Los Angeles) and valid_until = 2026-12-31T00:00Z (the east trap:
  // 1 Jan in Kiritimati would be wrong the other way for a naive local formatter).
  test('dates keep their stored day in every timezone; outcome pages follow the request locale', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(240000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    try {
      tenantData = await createTestTenant(db, { companyName: `Quote TZ ${uuidv4().slice(0, 6)}` });
      const tenantId = tenantData.tenant.tenantId;
      const scoped = tenantDb(db, tenantId);

      const deClientId = uuidv4();
      const deContactId = uuidv4();
      await scoped.table('clients').insert({
        client_id: deClientId,
        tenant: tenantId,
        client_name: 'RV36 TZ Kunde GmbH',
        properties: JSON.stringify({ defaultLocale: 'de' }),
        created_at: new Date(),
        updated_at: new Date(),
      });
      const deEmail = `tz-${uuidv4().slice(0, 6)}@kunde.example`;
      await scoped.table('contacts').insert({
        contact_name_id: deContactId,
        tenant: tenantId,
        full_name: 'Tina Zeitzone',
        email: deEmail,
        client_id: deClientId,
      });

      const mint = async (clientId: string, contactId: string | null, email: string) => {
        const quoteId = uuidv4();
        await scoped.table('quotes').insert({
          tenant: tenantId,
          quote_id: quoteId,
          quote_number: `PQT-${uuidv4().slice(0, 6).toUpperCase()}`,
          title: 'Timezone e2e quote',
          status: 'sent',
          currency_code: 'EUR',
          client_id: clientId,
          contact_id: contactId,
          quote_date: '2026-10-18T00:00:00Z',
          valid_until: '2026-12-31T00:00:00Z',
          subtotal: 1000,
          tax: 0,
          total_amount: 1000,
          discount_total: 0,
          is_template: false,
          version: 1,
        });
        await scoped.table('quote_items').insert({
          tenant: tenantId,
          quote_item_id: uuidv4(),
          quote_id: quoteId,
          description: 'Zone item',
          quantity: 1,
          unit_price: 1000,
          total_price: 1000,
          is_optional: false,
          is_selected: true,
          is_recurring: false,
          is_discount: false,
          display_order: 1,
        });
        const token = newToken();
        await scoped.table('quote_access_links').insert({
          tenant: tenantId,
          link_id: uuidv4(),
          quote_id: quoteId,
          contact_id: contactId,
          recipient_email: email,
          token_hash: hashToken(token),
          expires_at: new Date(Date.now() + 30 * DAY),
        });
        return token;
      };
      const enToken = await mint(tenantData.client!.clientId, null, 'tz-en@example.test');
      const deToken = await mint(deClientId, deContactId, deEmail);

      for (const timezoneId of ['America/Los_Angeles', 'UTC', 'Pacific/Kiritimati']) {
        const context = await browser.newContext({ baseURL: baseURL!, timezoneId, locale: 'en-US' });
        try {
          const page = await context.newPage();
          await page.goto(`/quote/${enToken}`);
          await expect(page.locator('html')).toHaveAttribute('lang', 'en');
          const body = page.locator('body');
          await expect(body).toContainText('Zone item');
          await expect(body).toContainText(/October\s+18,\s+2026/);
          await expect(body).toContainText(/December\s+31,\s+2026/);
          await expect(body).not.toContainText(/October\s+17|October\s+19|January\s+1,|December\s+30/);

          await page.goto(`/quote/${deToken}`);
          await expect(page.locator('html')).toHaveAttribute('lang', 'de');
          await expect(body).toContainText('18. Oktober 2026');
          await expect(body).toContainText('31. Dezember 2026');
          await expect(body).not.toContainText(/17\. Oktober|19\. Oktober|1\. Januar|30\. Dezember/);
        } finally {
          await context.close();
        }
      }

      // Outcome pages know no tenant: <html lang> is the request's locale.
      const unknownToken = newToken();
      for (const [acceptLocale, expectedLang] of [
        ['de-DE', 'de'],
        ['en-US', 'en'],
      ] as const) {
        const context = await browser.newContext({ baseURL: baseURL!, locale: acceptLocale });
        try {
          const page = await context.newPage();
          await page.goto(`/quote/${unknownToken}`);
          await expect(page.locator('html')).toHaveAttribute('lang', expectedLang);
        } finally {
          await context.close();
        }
      }
    } finally {
      if (tenantData) {
        const tenantId = tenantData.tenant.tenantId;
        for (const table of ['quote_access_links', 'quote_activities', 'quote_items', 'quotes', 'contacts']) {
          await tenantDb(db, tenantId).table(table).where({ tenant: tenantId }).del().catch(() => undefined);
        }
      }
      await db.destroy();
    }
  });
});
