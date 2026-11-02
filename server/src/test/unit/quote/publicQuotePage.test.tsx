import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  resolve: vi.fn(),
  record: vi.fn(async () => true),
  load: vi.fn(),
  generatePDF: vi.fn(async () => Buffer.from('%PDF-1.4')),
  recipientLocale: vi.fn(async () => 'en'),
}));

vi.mock('next/headers.js', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }));
vi.mock('@alga-psa/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@alga-psa/billing/services', () => ({
  QuoteAccessLinks: { resolve: (...a: unknown[]) => m.resolve(...a) },
  loadPublicQuoteView: (...a: unknown[]) => m.load(...a),
  recordQuoteViewedViaEmailLink: (...a: unknown[]) => m.record(...a),
  resolveQuoteRecipientLocale: (...a: unknown[]) => m.recipientLocale(...a),
  createPDFGenerationService: () => ({ generatePDF: m.generatePDF }),
}));
vi.mock('@alga-psa/client-portal/components', () => ({ PublicQuoteReview: () => null }));
vi.mock('@alga-psa/tenancy/actions/tenant-actions/getTenantBrandingByDomain', () => ({
  getTenantBrandingByTenantId: async () => ({ clientName: 'Acme MSP', logoUrl: null }),
}));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  resolveRequestLocale: async () => 'en',
  getServerTranslation: async () => ({ t: (_k: string, o?: any) => o?.defaultValue ?? _k }),
}));
vi.mock('../../../lib/quote/publicQuoteOutcome', async (orig) => ({
  ...(await orig<any>()),
  loadPublicQuoteResources: async () => ({}),
}));

import PublicQuotePage from '../../../app/quote/[token]/page';
import { GET as pdfGET } from '../../../app/api/quote/[token]/pdf/route';

const TOKEN = 'B'.repeat(43);
const okResult = {
  status: 'ok',
  tenant: 't1',
  quote: { quote_id: 'q1', quote_number: 'Q-1', status: 'sent', created_by: 'u1' },
  link: { link_id: 'l1', created_by: 'u1' },
  recipient: { contactId: 'c1', email: 'a@example.com' },
  readOnly: false,
};
const view = { quote: { quote_id: 'q1', status: 'sent' }, items: [], locations: [] };

beforeEach(() => {
  vi.clearAllMocks();
  m.load.mockResolvedValue(view);
  m.recipientLocale.mockResolvedValue('en');
});

describe('public quote page reader', () => {
  const render = async () =>
    (await PublicQuotePage({ params: Promise.resolve({ token: TOKEN }) })) as React.ReactElement<any>;

  it("renders in the recipient's language, resolving the token once", async () => {
    m.resolve.mockResolvedValue(okResult);
    m.recipientLocale.mockResolvedValue('de');
    const el = await render();
    expect(el.props.locale).toBe('de');
    expect(m.recipientLocale).toHaveBeenCalledWith({}, 't1', okResult.recipient);
    expect(m.resolve).toHaveBeenCalledTimes(1);
  });

  it('falls back to English for an unsupported recipient locale', async () => {
    m.resolve.mockResolvedValue(okResult);
    m.recipientLocale.mockResolvedValue('kl');
    const el = await render();
    expect(el.props.locale).toBe('en');
  });

  it('never resolves a reader for a failed token', async () => {
    m.resolve.mockResolvedValue({ status: 'expired' });
    await render();
    expect(m.recipientLocale).not.toHaveBeenCalled();
  });
});

describe('public quote page telemetry', () => {
  it('records one view on ok and resolves exactly once', async () => {
    m.resolve.mockResolvedValue(okResult);
    await PublicQuotePage({ params: Promise.resolve({ token: TOKEN }) });
    expect(m.resolve).toHaveBeenCalledTimes(1);
    expect(m.record).toHaveBeenCalledTimes(1);
    expect(m.record).toHaveBeenCalledWith({}, 't1', { quoteId: 'q1', linkId: 'l1', recipientEmail: 'a@example.com' });
    expect(JSON.stringify(m.record.mock.calls)).not.toContain(TOKEN);
  });

  it.each(['not_found', 'expired', 'revoked', 'superseded', 'decided', 'rate_limited'])(
    'writes nothing and loads nothing on %s',
    async (status) => {
      m.resolve.mockResolvedValue({ status });
      await PublicQuotePage({ params: Promise.resolve({ token: TOKEN }) });
      expect(m.record).not.toHaveBeenCalled();
      expect(m.load).not.toHaveBeenCalled();
    },
  );

  it('does not fail the page if recording throws', async () => {
    m.resolve.mockResolvedValue(okResult);
    m.record.mockRejectedValueOnce(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(PublicQuotePage({ params: Promise.resolve({ token: TOKEN }) })).resolves.toBeTruthy();
    expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
    spy.mockRestore();
  });
});

describe('public quote PDF route', () => {
  const call = () =>
    pdfGET(new Request(`http://x/api/quote/${TOKEN}/pdf`) as any, { params: Promise.resolve({ token: TOKEN }) });

  it('serves a PDF on ok, with hardening headers and no activity entry', async () => {
    m.resolve.mockResolvedValue(okResult);
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(m.record).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 404],
    ['revoked', 404],
    ['expired', 410],
    ['rate_limited', 429],
  ])('%s -> %i with an empty body', async (status, code) => {
    m.resolve.mockResolvedValue({ status });
    const res = await call();
    expect(res.status).toBe(code);
    expect(await res.text()).toBe('');
    expect(m.generatePDF).not.toHaveBeenCalled();
  });
});
