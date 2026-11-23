import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRAND_LOGO_MARKER,
  STOCK_EMAIL_PALETTE,
  applyEmailPalette,
  brandDecorator,
  resolveEmailPalette,
} from '@alga-psa/email/branding';
import { stampDerivedTemplate } from '@alga-psa/email/derivedTemplates';
import { fakeTenantDb, quoteBody } from '../../../email/src/__tests__/helpers/quoteTemplateFixtures';

const state = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, tenants: [] as string[] }));

vi.mock('@alga-psa/core/features', () => ({ isEnterprise: true }));
vi.mock('@alga-psa/db', async () => {
  const { fakeTenantDb } = await import('../../../email/src/__tests__/helpers/quoteTemplateFixtures');
  return {
    createTenantKnex: async () => ({ knex: {} as any }),
    getConnection: async () => ({} as any),
    tenantDb: (_knex: unknown, tenant: string) => {
      state.tenants.push(tenant);
      return fakeTenantDb(state.tables);
    },
  };
});
vi.mock('@alga-psa/email', () => ({
  TenantEmailService: { getInstance: vi.fn(), getTenantEmailSettings: vi.fn() },
  StaticTemplateProcessor: class {},
  TenantEmailOutboundAdapter: class { send = vi.fn(); },
}));

const TARGET = resolveEmailPalette({ primary: '#aa2200', secondary: '#112233' });
const OLD_BODY = quoteBody('quoteEmail', 'en', false);
const NEW_BODY = quoteBody('quoteEmail', 'en', true);
const BRANDING = { logoUrl: '/logo.png', clientName: 'RightPath' };
const decorate = brandDecorator({ logo: { variant: 'default' } }, BRANDING, true, TARGET);

function storedDerivedRow() {
  const stored = {
    subject: OLD_BODY.subject,
    html_content: decorate!(applyEmailPalette(OLD_BODY.html_content, STOCK_EMAIL_PALETTE, TARGET)),
    text_content: OLD_BODY.text_content,
  };
  return {
    id: 1, tenant: 'tenant-1', name: 'quote-email', language_code: 'en', ...stored,
    ...stampDerivedTemplate(stored, { id: 7, ...OLD_BODY }, TARGET, decorate),
  };
}

function seed(overrides: { tenant?: any[]; system?: any[] } = {}) {
  state.tenants = [];
  state.tables = {
    tenant_email_templates: overrides.tenant ?? [storedDerivedRow()],
    system_email_templates: overrides.system ?? [{ id: 7, name: 'quote-email', language_code: 'en', ...NEW_BODY }],
    tenant_settings: [{ settings: { emailBranding: { primary: '#aa2200', secondary: '#112233', logo: { variant: 'default' } }, branding: BRANDING } }],
  };
}

async function service() {
  const { getEmailNotificationService } = await import('./email');
  return getEmailNotificationService();
}

describe('EmailNotificationService.getEffectiveTemplate', () => {
  beforeEach(seed);

  it('serves an untouched derived row as the current system template in the row\'s palette', async () => {
    const template: any = await (await service()).getEffectiveTemplate('tenant-1', 'quote-email', 'en');

    expect(template.subject).toBe(NEW_BODY.subject);
    expect(template.html_content).toContain('quoteReviewLink');
    expect(template.text_content).toBe(NEW_BODY.text_content);
    expect(template.text_content).toContain('quoteReviewLink');
    expect(template.html_content).toContain('#aa2200');
    expect(template.html_content).not.toContain(STOCK_EMAIL_PALETTE.primary);
    expect(template.html_content).toContain(BRAND_LOGO_MARKER);
    expect(template.html_content).toBe(decorate!(applyEmailPalette(NEW_BODY.html_content, STOCK_EMAIL_PALETTE, TARGET)));
    expect(state.tenants.every((t) => t === 'tenant-1')).toBe(true);
  });

  it('returns the stored body of a row the tenant edited', async () => {
    const row = storedDerivedRow();
    const edited = {
      ...row, html_content: `${row.html_content}<p>our own footer</p>`,
      derived_from_system_id: null, derived_palette: null, derived_snapshot_hash: null,
    };
    seed({ tenant: [edited] });
    const template: any = await (await service()).getEffectiveTemplate('tenant-1', 'quote-email', 'en');

    expect(template.html_content).toBe(edited.html_content);
    expect(template.html_content).not.toContain('quoteReviewLink');
    expect(template.subject).toBe(OLD_BODY.subject);
  });

  it('falls back to the system template when the tenant has no row', async () => {
    seed({ tenant: [] });
    const template: any = await (await service()).getEffectiveTemplate('tenant-1', 'quote-email', 'en');
    expect(template.html_content).toBe(NEW_BODY.html_content);
    expect(template.subject).toBe(NEW_BODY.subject);
  });

  it('falls back from the recipient locale to the English system template', async () => {
    seed({ tenant: [] });
    const template: any = await (await service()).getEffectiveTemplate('tenant-1', 'quote-email', 'fr');
    expect(template.language_code).toBe('en');
    expect(template.html_content).toBe(NEW_BODY.html_content);
  });

  it('prefers the tenant English row over the system row in the recipient locale', async () => {
    const frSystem = quoteBody('quoteEmail', 'fr', true);
    seed({
      tenant: [{ id: 5, tenant: 'tenant-1', name: 'quote-email', language_code: 'en', subject: 'mine', html_content: '<p>mine</p>', text_content: 'mine' }],
      system: [{ id: 8, name: 'quote-email', language_code: 'fr', ...frSystem }],
    });
    const template: any = await (await service()).getEffectiveTemplate('tenant-1', 'quote-email', 'fr');
    expect(template.subject).toBe('mine');
  });

  it('with no locale and no tenant row, takes the system template of that name in any language', async () => {
    seed({ tenant: [], system: [{ id: 8, name: 'quote-email', language_code: 'fr', ...quoteBody('quoteEmail', 'fr', true) }] });
    const template: any = await (await service()).getEffectiveTemplate('tenant-1', 'quote-email');
    expect(template.language_code).toBe('fr');
  });

  it('throws when no template of that name exists anywhere', async () => {
    seed({ tenant: [], system: [] });
    await expect((await service()).getEffectiveTemplate('tenant-1', 'quote-email', 'en')).rejects.toThrow(/not found/);
  });
});
