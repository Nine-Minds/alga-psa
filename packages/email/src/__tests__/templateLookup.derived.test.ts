import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRAND_LOGO_MARKER,
  STOCK_EMAIL_PALETTE,
  applyEmailPalette,
  brandDecorator,
  decorateBrandedHtml,
  isDarkEmailHeader,
  pickBrandLogoVariant,
  planEmailBrandingApply,
  resolveEmailPalette,
  templateVariables,
} from '../branding';
import { NO_DERIVED_PROVENANCE, stampDerivedTemplate, templateSnapshotHash } from '../derivedTemplates';
import { fakeTenantDb, quoteBody } from './helpers/quoteTemplateFixtures';

const enterprise = vi.hoisted(() => ({ value: true }));
vi.mock('@alga-psa/core/features', () => ({
  get isEnterprise() { return enterprise.value; },
}));

const { lookupEmailTemplate } = await import('../templateLookup');

const TARGET = resolveEmailPalette({ primary: '#aa2200', secondary: '#112233' });
const OLD_BODY = quoteBody('quoteEmail', 'en', false);
const NEW_BODY = quoteBody('quoteEmail', 'en', true);
const BRANDING = { logoUrl: '/logo.png', clientName: 'RightPath' };
const SETTINGS = { emailBranding: { primary: '#aa2200', secondary: '#112233', logo: { variant: 'default' } }, branding: BRANDING };

/** Exactly what the apply flow stores for a system body: palette, then the shared decorator. */
function applied(body: typeof OLD_BODY) {
  const decorate = brandDecorator({ logo: { variant: 'default' } }, BRANDING, true, TARGET);
  return {
    subject: body.subject,
    html_content: decorate!(applyEmailPalette(body.html_content, STOCK_EMAIL_PALETTE, TARGET)),
    text_content: body.text_content,
  };
}

function tables(overrides: { system?: any[]; tenant?: any[] } = {}) {
  const stored = applied(OLD_BODY);
  return {
    system_email_templates: overrides.system ?? [{ id: 7, name: 'quote-email', language_code: 'en', ...NEW_BODY }],
    tenant_email_templates: overrides.tenant ?? [{
      id: 1, name: 'quote-email', language_code: 'en', ...stored,
      ...stampDerivedTemplate(stored, { id: 7, ...OLD_BODY }, TARGET, brandDecorator({ logo: { variant: 'default' } }, BRANDING, true, TARGET)),
    }],
    tenant_settings: [{ settings: SETTINGS }],
  };
}

describe('lookupEmailTemplate derived rows', () => {
  beforeEach(() => { enterprise.value = true; });

  it('serves the current system body in the row\'s palette and brand for an untouched derived row', async () => {
    const found = await lookupEmailTemplate(fakeTenantDb(tables()), 'quote-email', 'en');

    expect(found?.source).toBe('tenant-derived');
    const html = found!.template.html_content;
    expect(html).toContain('quoteReviewLink');
    expect(html).toContain('#aa2200');
    expect(html).not.toContain(STOCK_EMAIL_PALETTE.primary);
    expect(html).toContain(BRAND_LOGO_MARKER);
    // Exactly what a fresh apply of the new system body would store.
    expect(html).toBe(applied(NEW_BODY).html_content);
    expect(found!.template.subject).toBe(NEW_BODY.subject);
    expect(found!.template.id).toBe(1);
  });

  it('derives the plain text from the system row too', async () => {
    const found = await lookupEmailTemplate(fakeTenantDb(tables()), 'quote-email', 'en');
    expect(found!.template.text_content).toBe(NEW_BODY.text_content);
    expect(templateVariables(found!.template.text_content!).has('quoteReviewLink')).toBe(true);
  });

  it('serves the row itself once it has been edited after stamping', async () => {
    const data = tables();
    data.tenant_email_templates[0].html_content += '<p>our own footer</p>';
    const found = await lookupEmailTemplate(fakeTenantDb(data), 'quote-email', 'en');

    expect(found?.source).toBe('tenant');
    expect(found!.template.html_content).toContain('our own footer');
    expect(found!.template.html_content).not.toContain('quoteReviewLink');
  });

  it('serves the row itself when the plain text was edited after stamping', async () => {
    const data = tables();
    data.tenant_email_templates[0].text_content = 'custom text';
    expect((await lookupEmailTemplate(fakeTenantDb(data), 'quote-email', 'en'))?.source).toBe('tenant');
  });

  it('serves the stored row when the system row is gone', async () => {
    const data = tables({ system: [] });
    const found = await lookupEmailTemplate(fakeTenantDb(data), 'quote-email', 'en');
    expect(found?.source).toBe('tenant');
    expect(found!.template.html_content).toBe(data.tenant_email_templates[0].html_content);
  });

  it('serves the stored row when the system template has no row in the row\'s language', async () => {
    const stored = applied(OLD_BODY);
    const data = tables({
      tenant: [{ id: 2, name: 'quote-email', language_code: 'fr', ...stored, ...stampDerivedTemplate(stored, { id: 7, ...OLD_BODY }, TARGET, brandDecorator({ logo: { variant: 'default' } }, BRANDING, true, TARGET)) }],
    });
    const found = await lookupEmailTemplate(fakeTenantDb(data), 'quote-email', 'fr');
    expect(found?.source).toBe('tenant');
    expect(found!.template.html_content).toBe(stored.html_content);
  });

  it('derives per language from that language\'s system row', async () => {
    const oldFr = quoteBody('quoteEmail', 'fr', false);
    const newFr = quoteBody('quoteEmail', 'fr', true);
    const decorate = brandDecorator({ logo: { variant: 'default' } }, BRANDING, true, TARGET);
    const stored = applied(oldFr);
    const data = tables({
      system: [
        { id: 7, name: 'quote-email', language_code: 'en', ...NEW_BODY },
        { id: 8, name: 'quote-email', language_code: 'fr', ...newFr },
      ],
      tenant: [{ id: 3, name: 'quote-email', language_code: 'fr', ...stored, ...stampDerivedTemplate(stored, { id: 8, ...oldFr }, TARGET, decorate) }],
    });
    const found = await lookupEmailTemplate(fakeTenantDb(data), 'quote-email', 'fr');
    expect(found?.source).toBe('tenant-derived');
    expect(found!.template.subject).toBe(newFr.subject);
    expect(found!.template.html_content).toBe(applied(newFr).html_content);
  });

  it('uses the tenant\'s own palette and brand, not the current saved palette, for the colors', async () => {
    const data = tables();
    (data.tenant_settings[0].settings as any).emailBranding.primary = '#00aa00';
    const found = await lookupEmailTemplate(fakeTenantDb(data), 'quote-email', 'en');
    expect(found!.template.html_content).toContain('#aa2200');
    expect(found!.template.html_content).not.toContain('#00aa00');
  });

  it('leaves a row with no provenance exactly as before', async () => {
    const data = tables();
    Object.assign(data.tenant_email_templates[0], NO_DERIVED_PROVENANCE);
    const found = await lookupEmailTemplate(fakeTenantDb(data), 'quote-email', 'en');
    expect(found?.source).toBe('tenant');
    expect(found!.template.html_content).toBe(data.tenant_email_templates[0].html_content);
  });

  it('adds no logo on Community, as the apply flow would not', async () => {
    enterprise.value = false;
    const stored = { ...OLD_BODY, html_content: applyEmailPalette(OLD_BODY.html_content, STOCK_EMAIL_PALETTE, TARGET) };
    const data = tables({ tenant: [{ id: 1, name: 'quote-email', language_code: 'en', ...stored, ...stampDerivedTemplate(stored, { id: 7, ...OLD_BODY }, TARGET) }] });
    const found = await lookupEmailTemplate(fakeTenantDb(data), 'quote-email', 'en');
    expect(found?.source).toBe('tenant-derived');
    expect(found!.template.html_content).not.toContain(BRAND_LOGO_MARKER);
    expect(found!.template.html_content).toBe(applyEmailPalette(NEW_BODY.html_content, STOCK_EMAIL_PALETTE, TARGET));
  });
});

describe('stampDerivedTemplate', () => {
  it('stamps content that is exactly the derivation, with the hash of what is stored', () => {
    const stored = applied(OLD_BODY);
    const decorate = brandDecorator({ logo: { variant: 'default' } }, BRANDING, true, TARGET);
    const stamped = stampDerivedTemplate(stored, { id: 7, ...OLD_BODY }, TARGET, decorate);
    expect(stamped).toMatchObject({ derived_from_system_id: 7, derived_palette: TARGET });
    expect(stamped.derived_snapshot_hash).toBe(templateSnapshotHash(stored));
  });

  it('refuses to stamp content that is not the derivation', () => {
    const edited = { ...OLD_BODY, html_content: `${OLD_BODY.html_content}<p>mine</p>` };
    expect(stampDerivedTemplate(edited, { id: 7, ...OLD_BODY }, STOCK_EMAIL_PALETTE)).toMatchObject(NO_DERIVED_PROVENANCE);
  });
});

describe('shared decoration is byte-identical to the apply flow it was extracted from', () => {
  /** The composition as it was written inside the apply action before the extraction. */
  function legacyDecorator(palette: any, branding: any, target: any) {
    const variant = palette.logo
      ? pickBrandLogoVariant(palette.logo.variant, isDarkEmailHeader(target), {
          logoUrl: branding?.logoUrl || undefined,
          logoDarkUrl: branding?.logoDarkUrl || undefined,
          logoWideUrl: branding?.logoWideUrl || undefined,
          logoWideDarkUrl: branding?.logoWideDarkUrl || undefined,
        }, palette.logo.artwork)
      : null;
    const logo = variant ? { variant, alt: branding?.clientName ?? '' } : undefined;
    const hideAttribution = palette.hideAttribution === true;
    return (html: string) => decorateBrandedHtml(html, { logo, hideAttribution });
  }

  const cases = [
    { palette: { logo: { variant: 'default' } }, branding: BRANDING },
    { palette: { logo: { variant: 'wide' }, hideAttribution: true }, branding: { ...BRANDING, logoWideUrl: '/wide.png' } },
    { palette: { hideAttribution: true }, branding: null },
    { palette: {}, branding: BRANDING },
  ];

  it.each(cases)('plans the same rows with either decorator: %j', ({ palette, branding }) => {
    const systemRows = [
      { id: 1, name: 'quote-email', language_code: 'en', ...NEW_BODY },
      { id: 2, name: 'quote-reminder-email', language_code: 'en', ...quoteBody('quoteReminder', 'en', true) },
    ];
    const plan = (decorate: any) => planEmailBrandingApply({
      systemRows, tenantRows: [], target: TARGET, appliedPalette: null,
      scope: { names: systemRows.map((r) => r.name), languages: ['en'] }, decorate,
    });
    expect(plan(brandDecorator(palette as any, branding, true, TARGET))).toEqual(plan(legacyDecorator(palette, branding, TARGET)));
    expect(brandDecorator(palette as any, branding, false, TARGET)).toBeUndefined();
  });
});

describe('templateVariables', () => {
  it('lists value paths and ignores helpers, data and block syntax', () => {
    const vars = templateVariables('{{#if quoteReviewLink}}<a href="{{quoteReviewLink}}">{{company.name}}</a>{{else}}{{portalLink}}{{/if}}{{#each items}}{{@index}}{{this}}{{/each}}');
    expect([...vars].sort()).toEqual(['company', 'items', 'portalLink', 'quoteReviewLink']);
  });

  it('reads nothing from a template that does not parse', () => {
    expect(templateVariables('{{#if}}').size).toBe(0);
  });
});
