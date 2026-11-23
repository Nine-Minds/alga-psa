import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STOCK_EMAIL_PALETTE, applyEmailPalette, decorateBrandedHtml, resolveEmailPalette } from '@alga-psa/email/branding';
import { fakeTenantDb, quoteBody } from '../../../../email/src/__tests__/helpers/quoteTemplateFixtures';

const TENANT = 'session-tenant';
const state = vi.hoisted(() => ({ tables: {} as Record<string, any[]> }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u', user_type: 'internal', tenant: TENANT }, { tenant: TENANT }, ...args),
  hasPermission: async () => true,
}));
vi.mock('@alga-psa/types', () => ({ isLicensedUserType: () => true }));
vi.mock('@alga-psa/db', async () => {
  const { fakeTenantDb } = await import('../../../../email/src/__tests__/helpers/quoteTemplateFixtures');
  return {
    createTenantKnex: async () => ({ knex: {} }),
    withTransaction: (_knex: any, callback: any) => callback({}),
    tenantDb: () => ({ ...fakeTenantDb(state.tables), tenantJoin: (query: any) => query }),
  };
});
vi.mock('@alga-psa/tenancy/server/tenantSettingsStore', () => ({
  mergeTenantSettingsJson: async (_tenant: string, patch: Record<string, unknown>) => {
    state.tables.tenant_settings[0].settings = { ...state.tables.tenant_settings[0].settings, ...patch };
  },
}));
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: true }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { lookupEmailTemplate } = await import('@alga-psa/email/templateLookup');
const { applyEmailBrandingAction } = await import('./emailBrandingActions');

const PALETTE = { primary: '#aa2200', secondary: '#112233' };
const TARGET = resolveEmailPalette(PALETTE);
const NEW = quoteBody('quoteEmail', 'en', true);
const BRANDING = { logoUrl: '/logo.png', clientName: 'RightPath' };

function install(emailBranding: object, branding: object) {
  state.tables = {
    system_email_templates: [{ id: 7, name: 'quote-email', language_code: 'en', category: 'Quotes', ...NEW }],
    tenant_email_templates: [],
    tenant_settings: [{ settings: { emailBranding, branding } }],
  };
}
const settingsNow = (patch: { emailBranding?: object; branding?: object }) => {
  const current = state.tables.tenant_settings[0].settings;
  state.tables.tenant_settings[0].settings = { ...current, ...patch };
};
const served = async () => (await lookupEmailTemplate(fakeTenantDb(state.tables), 'quote-email', 'en'))!;

describe('applyEmailBrandingAction records the decoration it wrote', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores the options it applied, and the served email keeps them when settings change without a re-apply', async () => {
    install({ ...PALETTE, logo: { variant: 'default' } }, BRANDING);
    const result = await applyEmailBrandingAction({ names: ['quote-email'], languages: ['en'] } as any);
    expect(result.failed).toEqual([]);

    const row = state.tables.tenant_email_templates[0];
    const written = { logo: { variant: 'default' as const, alt: 'RightPath' }, hideAttribution: false };
    expect(row).toMatchObject({ derived_from_system_id: 7, derived_palette: TARGET, derived_decoration: written });
    const expected = decorateBrandedHtml(applyEmailPalette(NEW.html_content, STOCK_EMAIL_PALETTE, TARGET), written);
    expect(row.html_content).toBe(expected);
    expect((await served()).template.html_content).toBe(expected);

    // The tenant now drops the logo, renames the company and hides the attribution — without re-applying.
    settingsNow({ emailBranding: { ...PALETTE, hideAttribution: true }, branding: { clientName: 'Renamed' } });
    const after = await served();
    expect(after.source).toBe('tenant-derived');
    expect(after.template.html_content).toBe(expected);
    expect(after.template.html_content).toContain('alt="RightPath"');
    expect(after.template.html_content).toContain('Powered by AlgaPSA');
  });

  it('keeps a logo-less, attribution-hidden write logo-less when the tenant later adds a logo', async () => {
    install({ ...PALETTE, hideAttribution: true }, BRANDING);
    await applyEmailBrandingAction({ names: ['quote-email'], languages: ['en'] } as any);
    expect(state.tables.tenant_email_templates[0].derived_decoration).toEqual({ hideAttribution: true });

    settingsNow({ emailBranding: { ...PALETTE, logo: { variant: 'default' }, hideAttribution: false } });
    const html = (await served()).template.html_content;
    expect(html).not.toContain('data-alga-brand-logo');
    expect(html).not.toContain('Powered by AlgaPSA');
  });
});
