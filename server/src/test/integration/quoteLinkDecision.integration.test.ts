/**
 * alga-2026-0002820 (4/6): accept / reject through an email-link token.
 * Real Postgres, real QuoteAccessLinks.mint, real decideQuote. Only onQuoteAccepted is spied
 * on (and still runs). Covers the authoritative submit service end to end.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
  getSecretProviderInstance: vi.fn(async () => ({ getAppSecret: async () => '' })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
      (envVar && process.env[envVar]) || fallback || ''),
  },
}));

const onQuoteAcceptedSpy = vi.fn();
vi.mock('@alga-psa/opportunities/lib/quoteLifecycleHooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/opportunities/lib/quoteLifecycleHooks')>();
  return {
    ...actual,
    onQuoteAccepted: (...args: Parameters<typeof actual.onQuoteAccepted>) => {
      onQuoteAcceptedSpy(args[1]);
      return actual.onQuoteAccepted(...args);
    },
  };
});

let testDb: Knex;
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async (tenant?: string) => ({ knex: testDb, tenant })),
    getConnection: vi.fn(async () => testDb),
  };
});

let db: Knex;
const tenantsToCleanup = new Set<string>();
const tt = (tenantId: string, table: string) => tenantDb(db, tenantId).table(table);
const tenantRows = () =>
  tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');

async function cleanupTenant(tenantId: string) {
  for (const table of [
    'quote_decisions', 'quote_access_links', 'quote_activities', 'quote_items', 'quotes', 'next_number',
    'user_roles', 'role_permissions', 'roles', 'permissions', 'users', 'contacts', 'clients', 'tax_rates', 'tax_regions', 'tenant_settings',
  ]) {
    await tt(tenantId, table).del();
  }
  await tenantRows().where({ tenant: tenantId }).del();
}

async function createTenantFixture() {
  const tenantId = uuidv4();
  tenantsToCleanup.add(tenantId);
  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Link decisions ${tenantId.slice(0, 8)}`,
    email: `t-${tenantId.slice(0, 8)}@example.com`,
  });
  return tenantId;
}

async function setup(opts: { status?: string } = {}) {
  const tenantId = await createTenantFixture();
  const clientId = uuidv4();
  await tt(tenantId, 'clients').insert({ tenant: tenantId, client_id: clientId, client_name: 'Client' });
  const contactId = uuidv4();
  const email = `jane-${contactId.slice(0, 6)}@client.example`;
  await tt(tenantId, 'contacts').insert({
    tenant: tenantId, contact_name_id: contactId, full_name: 'Jane Contact', email, client_id: clientId,
  });
  const quoteId = uuidv4();
  await tt(tenantId, 'quotes').insert({
    tenant: tenantId, quote_id: quoteId, client_id: clientId, title: 'Link fixture', status: opts.status ?? 'sent',
  });
  const required = uuidv4();
  const optional = uuidv4();
  await tt(tenantId, 'quote_items').insert([
    { tenant: tenantId, quote_item_id: required, quote_id: quoteId, description: 'Core', quantity: 1, unit_price: 15000, total_price: 15000, net_amount: 15000, is_optional: false, is_selected: true, display_order: 0 },
    { tenant: tenantId, quote_item_id: optional, quote_id: quoteId, description: 'Optional', quantity: 1, unit_price: 5000, total_price: 5000, net_amount: 5000, is_optional: true, is_selected: true, display_order: 1 },
  ]);
  const { QuoteAccessLinks } = await import('@alga-psa/billing/services');
  const { link, token } = await QuoteAccessLinks.mint(db, tenantId, {
    quote: { quote_id: quoteId, valid_until: null },
    recipient: { contactId, email },
  });
  fixtures.set(token, { tenantId, quoteId });
  return { tenantId, clientId, contactId, email, quoteId, required, optional, link, token };
}

const quoteRow = (t: string, q: string) => tt(t, 'quotes').where({ quote_id: q }).first();
const decisionRows = (t: string, q: string) => tt(t, 'quote_decisions').where({ quote_id: q });
const CTX = { ip: '203.0.113.9', userAgent: 'vitest/agent' };

async function agreement() {
  const { getCurrentQuoteAgreement } = await import('@alga-psa/billing/services');
  return getCurrentQuoteAgreement();
}
async function acceptInput(over: Record<string, unknown> = {}) {
  const a = await agreement();
  return {
    action: 'accept' as const,
    signer: { name: '  Jane Doe ', title: 'CFO' },
    agreed: true,
    agreementVersion: a.version,
    agreementTextHash: a.hash,
    selectedOptionalQuoteItemIds: [] as string[],
    ...over,
  };
}
const fixtures = new Map<string, { tenantId: string; quoteId: string }>();
async function fingerprintOf(s: { tenantId: string; quoteId: string }) {
  const { computePublicQuoteFingerprint } = await import('@alga-psa/billing/services');
  return computePublicQuoteFingerprint(db, s.tenantId, s.quoteId);
}
/** Submits like the page would: the fingerprint of the current content is supplied unless the caller sets the key. */
async function submit(token: string, input: any, ctx = CTX) {
  const { submitQuoteLinkDecision } = await import('@alga-psa/billing/services');
  const fx = fixtures.get(token);
  const withFp = fx && !('quoteFingerprint' in input) ? { ...input, quoteFingerprint: await fingerprintOf(fx) } : input;
  return submitQuoteLinkDecision(token, withFp, ctx);
}

describe('submitQuoteLinkDecision (alga-2026-0002820 4/6)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    testDb = db;
    // Cold-import the service graph once, outside any test's timeout.
    await import('@alga-psa/billing/services');
    await import('@alga-psa/billing/services/quoteAccessLinks');
  }, 240_000);
  beforeEach(async () => {
    onQuoteAcceptedSpy.mockClear();
    const { resetQuoteAccessRateLimiters } = await import('@alga-psa/billing/services/quoteAccessLinks');
    resetQuoteAccessRateLimiters();
  });
  afterEach(async () => {
    for (const t of tenantsToCleanup) await cleanupTenant(t);
    tenantsToCleanup.clear();
  });
  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('1. accept: quote accepted, full audit row, optional deselection applied, hook once', async () => {
    const s = await setup();
    const a = await agreement();
    const out: any = await submit(s.token, await acceptInput({ selectedOptionalQuoteItemIds: [] }));

    expect(out.status).toBe('decided');
    expect(out.decision).toBe('accepted');
    const q = await quoteRow(s.tenantId, s.quoteId);
    expect(q.status).toBe('accepted');
    expect(q.accepted_by).toBeNull();
    expect(Number(q.subtotal)).toBe(15000);
    const item = await tt(s.tenantId, 'quote_items').where({ quote_item_id: s.optional }).first();
    expect(item.is_selected).toBe(false);

    const rows = await decisionRows(s.tenantId, s.quoteId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      decision: 'accepted',
      method: 'email_link',
      link_id: s.link.link_id,
      contact_id: s.contactId,
      signer_name: 'Jane Doe',
      signer_email: s.email,
      signer_title: 'CFO',
      ip: CTX.ip,
      user_agent: CTX.userAgent,
      agreement_text_hash: a.hash,
      agreement_version: a.version,
    });
    // The activity carries the decision_id so the MSP UI can look the signer up exactly.
    const [acceptedActivity] = await tt(s.tenantId, 'quote_activities').where({ quote_id: s.quoteId, activity_type: 'accepted' });
    expect(acceptedActivity.metadata).toMatchObject({ accepted_via: 'email_link', decision_id: rows[0].decision_id });
    expect(rows[0].selections).toEqual({
      selected_optional_quote_item_ids: [],
      deselected_optional_quote_item_ids: [s.optional],
    });
    expect(onQuoteAcceptedSpy).toHaveBeenCalledTimes(1);
  });

  it('1c. optional-item live preview: loaded view carries numeric tax, preview total == committed total', async () => {
    const s = await setup();
    // A taxable client region so every base row resolves a non-zero tax_amount_if_included.
    await tt(s.tenantId, 'tax_regions').insert({ tenant: s.tenantId, region_code: 'TST-LINK', region_name: 'Test', is_active: true });
    await tt(s.tenantId, 'tax_rates').insert({
      tax_rate_id: uuidv4(), tenant: s.tenantId, region_code: 'TST-LINK', tax_percentage: 8.875,
      description: 'Test tax', start_date: '2025-01-01T00:00:00.000Z', is_active: true,
    });
    await tt(s.tenantId, 'clients').where({ client_id: s.clientId }).update({ region_code: 'TST-LINK', is_tax_exempt: false });

    const { loadPublicQuoteView } = await import('@alga-psa/billing/services');
    const { computePublicQuotePreview } = await import(
      '../../../../packages/client-portal/src/components/billing/publicQuotePreview'
    );
    const view = await loadPublicQuoteView(db, s.tenantId, s.quoteId);
    expect(view).not.toBeNull();
    const base = view!.items.filter((i) => !i.is_discount);
    expect(base.length).toBe(2);
    for (const item of base) {
      expect(typeof item.tax_amount_if_included).toBe('number');
    }
    expect(view!.items.find((i) => i.quote_item_id === s.required)!.tax_amount_if_included).toBe(Math.ceil((15000 * 8.875) / 100));

    const previewFor = (selected: string[]) =>
      computePublicQuotePreview(
        view!.items.map((i) => (i.is_optional ? { ...i, is_selected: selected.includes(i.quote_item_id) } : i)) as any,
      );
    expect(previewFor([s.optional])).not.toBeNull();
    const withoutOptional = previewFor([])!;
    expect(withoutOptional).not.toBeNull();
    expect(withoutOptional.subtotal).toBe(15000);

    // Commit with the optional item toggled off, using the fingerprint of the enriched view.
    const out: any = await submit(s.token, await acceptInput({ selectedOptionalQuoteItemIds: [] }));
    expect(out.status).toBe('decided');
    const q = await quoteRow(s.tenantId, s.quoteId);
    expect(Number(q.total_amount)).toBe(withoutOptional.totalAmount);
    expect(Number(q.tax)).toBe(withoutOptional.tax);
    expect(Number(q.total_amount)).toBeGreaterThan(15000);
  });

  it('1d. optional kept: previewed total == committed total', async () => {
    const s = await setup();
    await tt(s.tenantId, 'tax_regions').insert({ tenant: s.tenantId, region_code: 'TST-LINK', region_name: 'Test', is_active: true });
    await tt(s.tenantId, 'tax_rates').insert({
      tax_rate_id: uuidv4(), tenant: s.tenantId, region_code: 'TST-LINK', tax_percentage: 8.875,
      description: 'Test tax', start_date: '2025-01-01T00:00:00.000Z', is_active: true,
    });
    await tt(s.tenantId, 'clients').where({ client_id: s.clientId }).update({ region_code: 'TST-LINK', is_tax_exempt: false });
    const { loadPublicQuoteView, computePublicQuoteFingerprint } = await import('@alga-psa/billing/services');
    const { computePublicQuotePreview } = await import(
      '../../../../packages/client-portal/src/components/billing/publicQuotePreview'
    );
    const view = await loadPublicQuoteView(db, s.tenantId, s.quoteId);
    const preview = computePublicQuotePreview(view!.items as any)!;
    expect(preview).not.toBeNull();
    // The fingerprint the page renders (outside a transaction) equals the one the submit recomputes (inside one).
    const rendered = await computePublicQuoteFingerprint(db, s.tenantId, s.quoteId);
    const inTrx = await db.transaction((trx) => computePublicQuoteFingerprint(trx, s.tenantId, s.quoteId));
    expect(inTrx).toBe(rendered);
    const out: any = await submit(s.token, await acceptInput({ selectedOptionalQuoteItemIds: [s.optional], quoteFingerprint: rendered }));
    expect(out.status).toBe('decided');
    expect(Number((await quoteRow(s.tenantId, s.quoteId)).total_amount)).toBe(preview.totalAmount);
  });

  it('1b. accept keeping an optional item leaves it selected', async () => {
    const s = await setup();
    const out: any = await submit(s.token, await acceptInput({ selectedOptionalQuoteItemIds: [s.optional] }));
    expect(out.status).toBe('decided');
    expect(Number((await quoteRow(s.tenantId, s.quoteId)).subtotal)).toBe(20000);
  });

  it('1c. signer email comes from the link, not the form', async () => {
    const s = await setup();
    await submit(s.token, await acceptInput({ signer: { name: 'Jane', title: '', email: 'attacker@evil.example' } }));
    const [row] = await decisionRows(s.tenantId, s.quoteId);
    expect(row.signer_email).toBe(s.email);
    expect(row.signer_title).toBeNull();
  });

  it('2. reject stores the comment; missing comment is refused with no state change', async () => {
    const s = await setup();
    const refused: any = await submit(s.token, { action: 'reject', comment: '   ' });
    expect(refused).toEqual({ status: 'invalid_input', problem: 'comment_required' });
    expect((await quoteRow(s.tenantId, s.quoteId)).status).toBe('sent');
    expect(await decisionRows(s.tenantId, s.quoteId)).toHaveLength(0);

    const out: any = await submit(s.token, { action: 'reject', comment: ' Too expensive ' });
    expect(out.status).toBe('decided');
    expect(out.decision).toBe('rejected');
    const q = await quoteRow(s.tenantId, s.quoteId);
    expect(q).toMatchObject({ status: 'rejected', rejection_reason: 'Too expensive' });
    const [row] = await decisionRows(s.tenantId, s.quoteId);
    expect(row).toMatchObject({
      decision: 'rejected', method: 'email_link', link_id: s.link.link_id, comment: 'Too expensive',
      signer_email: s.email, ip: CTX.ip, user_agent: CTX.userAgent,
    });
    expect(onQuoteAcceptedSpy).not.toHaveBeenCalled();
  });

  it('3. accept validation refuses with no state change', async () => {
    const s = await setup();
    const a = await agreement();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ signer: { name: '   ' } }, 'name_required'],
      [{ agreed: false }, 'agreement_required'],
      [{ agreementVersion: '2020-01-01.0' }, 'agreement_outdated'],
      [{ agreementTextHash: 'f'.repeat(64) }, 'agreement_outdated'],
      [{ agreementVersion: undefined }, 'agreement_outdated'],
      [{ signer: { name: 'x'.repeat(201) } }, 'too_long'],
      [{ selectedOptionalQuoteItemIds: [uuidv4()] }, 'invalid_selection'],
      [{ selectedOptionalQuoteItemIds: [s.required] }, 'invalid_selection'],
    ];
    for (const [over, problem] of cases) {
      const out: any = await submit(s.token, await acceptInput(over));
      expect(out).toEqual({ status: 'invalid_input', problem });
    }
    expect(a.version).toBeTruthy();
    expect((await quoteRow(s.tenantId, s.quoteId)).status).toBe('sent');
    expect(await decisionRows(s.tenantId, s.quoteId)).toHaveLength(0);
    expect(onQuoteAcceptedSpy).not.toHaveBeenCalled();
  });

  it('4. second accept is refused with the existing decision date; one row; quote unchanged', async () => {
    const s = await setup();
    const first: any = await submit(s.token, await acceptInput());
    expect(first.status).toBe('decided');
    const before = await quoteRow(s.tenantId, s.quoteId);

    const second: any = await submit(s.token, await acceptInput({ signer: { name: 'Someone Else' } }));
    expect(second.status).toBe('already_decided');
    expect(second.decision).toBe('accepted');
    expect(second.decidedAt).toBe(first.decidedAt);
    expect(await decisionRows(s.tenantId, s.quoteId)).toHaveLength(1);
    expect(await quoteRow(s.tenantId, s.quoteId)).toEqual(before);
    expect(onQuoteAcceptedSpy).toHaveBeenCalledTimes(1);

    // A reject after an accept is equally refused.
    const third: any = await submit(s.token, { action: 'reject', comment: 'changed my mind' });
    expect(third.status).toBe('already_decided');
    expect((await quoteRow(s.tenantId, s.quoteId)).status).toBe('accepted');
  });

  it('4b. two concurrent submits: exactly one wins', async () => {
    const s = await setup();
    const input = await acceptInput();
    const results: any[] = await Promise.all([submit(s.token, input), submit(s.token, input)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual(['already_decided', 'decided']);
    expect(await decisionRows(s.tenantId, s.quoteId)).toHaveLength(1);
    expect((await quoteRow(s.tenantId, s.quoteId)).status).toBe('accepted');
    expect(onQuoteAcceptedSpy).toHaveBeenCalledTimes(1);

    const s2 = await setup();
    const mixed: any[] = await Promise.all([
      submit(s2.token, await acceptInput()),
      submit(s2.token, { action: 'reject', comment: 'no' }),
    ]);
    expect(mixed.filter((r) => r.status === 'decided')).toHaveLength(1);
    expect(await decisionRows(s2.tenantId, s2.quoteId)).toHaveLength(1);
  });

  it('5a. MSP edits an item price while the quote stays sent: "changed", no decision, hook not called', async () => {
    const QuoteItem = (await import('@alga-psa/billing/models/quoteItem')).default;
    const s = await setup();
    const rendered = await fingerprintOf(s);
    await QuoteItem.update(db, s.tenantId, s.required, { unit_price: 99999 });
    expect((await quoteRow(s.tenantId, s.quoteId)).status).toBe('sent');
    expect(await fingerprintOf(s)).not.toBe(rendered);
    const out: any = await submit(s.token, await acceptInput({ quoteFingerprint: rendered }));
    expect(out).toEqual({ status: 'changed' });
    expect((await quoteRow(s.tenantId, s.quoteId)).status).toBe('sent');
    expect(await decisionRows(s.tenantId, s.quoteId)).toHaveLength(0);
    expect(onQuoteAcceptedSpy).not.toHaveBeenCalled();
    // Reject is refused the same way.
    expect(await submit(s.token, { action: 'reject', comment: 'x', quoteFingerprint: rendered })).toEqual({ status: 'changed' });
    // Re-rendering gives the new fingerprint, and signing that succeeds.
    const ok: any = await submit(s.token, await acceptInput({ quoteFingerprint: await fingerprintOf(s) }));
    expect(ok.status).toBe('decided');
    expect(onQuoteAcceptedSpy).toHaveBeenCalledTimes(1);
  });

  it('5e. MSP changes valid_until / quote_date while the quote stays sent: "changed", nothing written', async () => {
    for (const patch of [{ valid_until: new Date('2030-01-01T00:00:00Z') }, { quote_date: new Date('2026-01-02T00:00:00Z') }]) {
      const s = await setup();
      const rendered = await fingerprintOf(s);
      await tt(s.tenantId, 'quotes').where({ quote_id: s.quoteId }).update(patch);
      expect(await fingerprintOf(s)).not.toBe(rendered);
      const out: any = await submit(s.token, await acceptInput({ quoteFingerprint: rendered }));
      expect(out).toEqual({ status: 'changed' });
      expect((await quoteRow(s.tenantId, s.quoteId)).status).toBe('sent');
      expect(await decisionRows(s.tenantId, s.quoteId)).toHaveLength(0);
      expect(onQuoteAcceptedSpy).not.toHaveBeenCalled();
    }
  });

  it('5b. MSP adds an item while the quote stays sent: "changed", nothing written', async () => {
    const s = await setup();
    const rendered = await fingerprintOf(s);
    await tt(s.tenantId, 'quote_items').insert({
      tenant: s.tenantId, quote_item_id: uuidv4(), quote_id: s.quoteId, description: 'Sneaky add', quantity: 1,
      unit_price: 100, total_price: 100, net_amount: 100, is_optional: false, is_selected: true, display_order: 2,
    });
    const out: any = await submit(s.token, await acceptInput({ quoteFingerprint: rendered }));
    expect(out).toEqual({ status: 'changed' });
    expect((await quoteRow(s.tenantId, s.quoteId)).status).toBe('sent');
    expect(await decisionRows(s.tenantId, s.quoteId)).toHaveLength(0);
    expect(onQuoteAcceptedSpy).not.toHaveBeenCalled();
  });

  it('5c. the signed content fingerprint is stored on the decision row', async () => {
    const s = await setup();
    const rendered = await fingerprintOf(s);
    expect(rendered).toMatch(/^[0-9a-f]{64}$/);
    const out: any = await submit(s.token, await acceptInput({ quoteFingerprint: rendered }));
    expect(out.status).toBe('decided');
    const [row] = await decisionRows(s.tenantId, s.quoteId);
    expect(row.content_fingerprint).toBe(rendered);
  });

  it('5d. a missing, null or wrong fingerprint is "changed" and writes nothing', async () => {
    const s = await setup();
    for (const quoteFingerprint of [undefined, null, '', 'f'.repeat(64)]) {
      const out: any = await submit(s.token, await acceptInput({ quoteFingerprint }));
      expect(out).toEqual({ status: 'changed' });
    }
    expect(await submit(s.token, { action: 'reject', comment: 'x', quoteFingerprint: undefined })).toEqual({ status: 'changed' });
    expect((await quoteRow(s.tenantId, s.quoteId)).status).toBe('sent');
    expect(await decisionRows(s.tenantId, s.quoteId)).toHaveLength(0);
    expect(onQuoteAcceptedSpy).not.toHaveBeenCalled();
  });

  it('5. MSP moved the quote out of sent: "changed", nothing written', async () => {
    const s = await setup();
    await tt(s.tenantId, 'quotes').where({ quote_id: s.quoteId }).update({ status: 'cancelled' });
    const out: any = await submit(s.token, await acceptInput());
    expect(out).toEqual({ status: 'changed' });
    expect((await quoteRow(s.tenantId, s.quoteId)).status).toBe('cancelled');
    expect(await decisionRows(s.tenantId, s.quoteId)).toHaveLength(0);
    expect(onQuoteAcceptedSpy).not.toHaveBeenCalled();
  });

  it('6. expired, revoked and superseded links get the generic outcome and write nothing', async () => {
    const { QuoteAccessLinks } = await import('@alga-psa/billing/services');
    const expired = await setup();
    await tt(expired.tenantId, 'quote_access_links').where({ link_id: expired.link.link_id })
      .update({ expires_at: new Date(Date.now() - 60_000) });
    const revoked = await setup();
    await QuoteAccessLinks.revoke(db, revoked.tenantId, { linkId: revoked.link.link_id }, 'manual');
    const superseded = await setup();
    await QuoteAccessLinks.revoke(db, superseded.tenantId, { linkId: superseded.link.link_id }, 'superseded');
    for (const s of [expired, revoked, superseded]) {
      expect(await submit(s.token, await acceptInput())).toEqual({ status: 'invalid_link' });
      expect(await submit(s.token, { action: 'reject', comment: 'x' })).toEqual({ status: 'invalid_link' });
      expect((await quoteRow(s.tenantId, s.quoteId)).status).toBe('sent');
      expect(await decisionRows(s.tenantId, s.quoteId)).toHaveLength(0);
    }
    // Unknown and malformed tokens are indistinguishable from the above.
    expect(await submit('A'.repeat(43), await acceptInput())).toEqual({ status: 'invalid_link' });
    expect(await submit('not-a-token', await acceptInput())).toEqual({ status: 'invalid_link' });
    expect(onQuoteAcceptedSpy).not.toHaveBeenCalled();
  });

  it('7. event parity: an email-link accept fires the same hook and writes the same activities as a portal accept', async () => {
    const { decideQuote } = await import('@alga-psa/billing/services');
    const link = await setup();
    await submit(link.token, await acceptInput());
    expect(onQuoteAcceptedSpy).toHaveBeenCalledTimes(1);
    const linkQuote = onQuoteAcceptedSpy.mock.calls[0][0];

    onQuoteAcceptedSpy.mockClear();
    const portal = await setup();
    // Portal actor: an MSP-style actor path is not needed; use a real portal user for the same quote shape.
    const userId = uuidv4();
    const roleId = uuidv4();
    const permId = uuidv4();
    await tt(portal.tenantId, 'users').insert({
      tenant: portal.tenantId, user_id: userId, username: `u-${userId.slice(0, 6)}`, hashed_password: 'x',
      user_type: 'client', email: `u-${userId.slice(0, 6)}@example.com`, is_inactive: false, contact_id: portal.contactId,
    });
    await tt(portal.tenantId, 'roles').insert({ tenant: portal.tenantId, role_id: roleId, role_name: 'r', msp: false, client: true });
    await tt(portal.tenantId, 'user_roles').insert({ tenant: portal.tenantId, user_id: userId, role_id: roleId });
    await tt(portal.tenantId, 'permissions').insert({ tenant: portal.tenantId, permission_id: permId, resource: 'billing', action: 'read', msp: false, client: true });
    await tt(portal.tenantId, 'role_permissions').insert({ tenant: portal.tenantId, role_id: roleId, permission_id: permId });
    const res: any = await db.transaction((trx) => decideQuote({
      tenantId: portal.tenantId, quoteId: portal.quoteId, action: 'accept',
      actor: { kind: 'portal_user', userId }, selections: { selectedOptionalQuoteItemIds: [] },
    }, trx));
    expect(res.status).toBe('decided');
    expect(onQuoteAcceptedSpy).toHaveBeenCalledTimes(1);
    const portalQuote = onQuoteAcceptedSpy.mock.calls[0][0];

    expect(linkQuote).toMatchObject({ status: 'accepted', quote_id: link.quoteId });
    expect(portalQuote).toMatchObject({ status: 'accepted', quote_id: portal.quoteId });

    const types = async (t: string, q: string) =>
      (await tt(t, 'quote_activities').where({ quote_id: q }).select('activity_type')).map((r: any) => r.activity_type).sort();
    expect(await types(link.tenantId, link.quoteId)).toEqual(await types(portal.tenantId, portal.quoteId));
  });

  it('8. MSP data path returns the contact signer with accepted_by null', async () => {
    const { listQuoteDecisions } = await import('@alga-psa/billing/services');
    const s = await setup();
    await submit(s.token, await acceptInput());
    const q = await quoteRow(s.tenantId, s.quoteId);
    expect(q.accepted_by).toBeNull();
    const decisions = await listQuoteDecisions(db, s.tenantId, s.quoteId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      decision: 'accepted', method: 'email_link', signer_name: 'Jane Doe', signer_email: s.email, signer_title: 'CFO',
    });
    expect(new Date(decisions[0].decided_at).getTime()).toBeGreaterThan(0);
  });
});
