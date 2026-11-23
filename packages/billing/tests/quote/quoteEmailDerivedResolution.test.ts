import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STOCK_EMAIL_PALETTE,
  applyEmailPalette,
  brandDecorator,
  resolveEmailPalette,
} from '@alga-psa/email/branding';
import { stampDerivedTemplate } from '@alga-psa/email/derivedTemplates';
import { fakeTenantDb, quoteBody } from '../../../email/src/__tests__/helpers/quoteTemplateFixtures';

const facade = vi.hoisted(() => ({ current: null as any }));
vi.mock('@alga-psa/db', () => ({ tenantDb: () => facade.current }));
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: true }));

const { renderResolvedQuoteEmail, resolveQuoteEmail } = await import('../../src/lib/quoteEmailRendering');

const TARGET = resolveEmailPalette({ primary: '#aa2200', secondary: '#112233' });
const BRANDING = { logoUrl: '/logo.png', clientName: 'RightPath' };
const decorate = brandDecorator({ logo: { variant: 'default' } }, BRANDING, true, TARGET);
const OLD = quoteBody('quoteEmail', 'en', false);
const NEW = quoteBody('quoteEmail', 'en', true);

const brandedRow = (body: typeof OLD) => ({
  ...body,
  html_content: decorate!(applyEmailPalette(body.html_content, STOCK_EMAIL_PALETTE, TARGET)),
});

const quote = { quote_id: 'q-1', quote_number: 'Q-0001', total_amount: 12345, currency_code: 'USD', valid_until: null, accepted_at: null } as any;
const portalLink = 'https://portal.example.com/client-portal/billing';
const reviewLink = 'https://portal.example.com/review/abc123';

function install(tenantRows: any[]) {
  facade.current = fakeTenantDb({
    system_email_templates: [{ id: 7, name: 'quote-email', language_code: 'en', ...NEW }],
    tenant_email_templates: tenantRows,
    tenant_settings: [{ settings: { emailBranding: { primary: '#aa2200', secondary: '#112233', logo: { variant: 'default' } }, branding: BRANDING } }],
  });
}

const derivedOld = () => {
  const row = brandedRow(OLD);
  return { id: 1, name: 'quote-email', language_code: 'en', ...stampDerivedTemplate(row, { id: 7, ...OLD }, TARGET, decorate) };
};

describe('quote emails resolve branded copies through the shared resolver', () => {
  beforeEach(() => install([derivedOld()]));

  it('reports rendersReviewLink for an untouched branded copy that predates the link, and renders both links', async () => {
    const resolved = await resolveQuoteEmail({} as any, 'tenant-1', 'quote-email', 'en');
    expect(resolved.rendersReviewLink).toBe(true);
    expect(resolved.htmlRendersReviewLink).toBe(true);
    expect(resolved.textRendersReviewLink).toBe(true);

    const { html } = renderResolvedQuoteEmail({ resolved, quote, companyName: 'RightPath', portalLink, quoteReviewLink: reviewLink, hasPortalAccess: true });
    expect(html).toContain(reviewLink);
    expect(html).toContain(portalLink);
    expect(html).toContain('#aa2200');
  });

  it('renders the portal block exactly as before when email-link review is off', async () => {
    const resolved = await resolveQuoteEmail({} as any, 'tenant-1', 'quote-email', 'en');
    const derived = renderResolvedQuoteEmail({ resolved, quote, companyName: 'RightPath', portalLink, quoteReviewLink: '', hasPortalAccess: true });

    // The same branded copy before this change, served frozen (no provenance), with no link to render.
    install([{ id: 1, name: 'quote-email', language_code: 'en', ...brandedRow(OLD) }]);
    const frozen = renderResolvedQuoteEmail({
      resolved: await resolveQuoteEmail({} as any, 'tenant-1', 'quote-email', 'en'),
      quote, companyName: 'RightPath', portalLink, quoteReviewLink: '', hasPortalAccess: true,
    });

    expect(derived.html).toBe(frozen.html);
    expect(derived.text).toBe(frozen.text);
    expect(derived.subject).toBe(frozen.subject);
    expect(derived.html).not.toContain(reviewLink);
  });

  it('still reports a customized copy that omits the link as not rendering it', async () => {
    const custom = { ...derivedOld(), html_content: `${brandedRow(OLD).html_content}<p>edited</p>` };
    install([custom]);
    const resolved = await resolveQuoteEmail({} as any, 'tenant-1', 'quote-email', 'en');
    expect(resolved.rendersReviewLink).toBe(false);
    expect(resolved.template?.html_content).toContain('edited');
  });

  it('falls back to the system template for a tenant with no row, as before', async () => {
    install([]);
    const resolved = await resolveQuoteEmail({} as any, 'tenant-1', 'quote-email', 'en');
    expect(resolved.rendersReviewLink).toBe(true);
    expect(resolved.template?.subject).toBe(NEW.subject);
  });

  it('keeps the contract when no template exists anywhere: the code template renders the link', async () => {
    facade.current = fakeTenantDb({ system_email_templates: [], tenant_email_templates: [], tenant_settings: [] });
    const resolved = await resolveQuoteEmail({} as any, 'tenant-1', 'quote-email', 'en');
    expect(resolved).toMatchObject({ template: null, rendersReviewLink: true });
  });
});
