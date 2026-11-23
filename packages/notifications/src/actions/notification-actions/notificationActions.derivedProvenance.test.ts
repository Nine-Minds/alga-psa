import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STOCK_EMAIL_PALETTE,
  applyEmailPalette,
  resolveEmailPalette,
} from '@alga-psa/email/branding';
import { fakeTenantDb, quoteBody } from '../../../../email/src/__tests__/helpers/quoteTemplateFixtures';

const TENANT = 'session-tenant';
const facade = vi.hoisted(() => ({ current: null as any }));
const service = vi.hoisted(() => ({
  createTenantTemplate: vi.fn(async (_tenant: string, template: any) => ({ id: 9, ...template })),
  updateTenantTemplate: vi.fn(async () => ({ id: 9 })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u', user_type: 'internal', tenant: TENANT }, { tenant: TENANT }, ...args),
  hasPermission: async () => true,
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: (_knex: any, callback: any) => callback({ raw: vi.fn() }),
  tenantDb: () => ({ table: (name: string) => facade.current.table(name), tenantJoin: (query: any) => query }),
}));
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: false }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../notifications/email', () => ({ getEmailNotificationService: () => service }));
vi.mock('@alga-psa/email', () => ({
  TenantEmailService: { validateEmailSettings: async () => ({ valid: true }), getInstance: vi.fn() },
  StaticTemplateProcessor: class {},
}));

const TARGET = resolveEmailPalette({ primary: '#aa2200', secondary: '#112233' });
const NEW = quoteBody('quoteEmail', 'en', true);
const OLD = quoteBody('quoteEmail', 'en', false);

function install(settings: object, tenantRows: any[] = []) {
  facade.current = fakeTenantDb({
    system_email_templates: [{ id: 7, name: 'quote-email', language_code: 'en', category: 'Quotes', ...NEW }],
    tenant_email_templates: tenantRows,
    tenant_settings: [{ settings }],
  });
}

describe('template actions and derived provenance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stamps an untouched clone as following the standard template', async () => {
    install({});
    const actions = await import('./notificationActions');
    await actions.cloneSystemTemplateAction(7);

    expect(service.createTenantTemplate).toHaveBeenCalledWith(TENANT, expect.objectContaining({
      html_content: NEW.html_content,
      derived_from_system_id: 7,
      derived_palette: STOCK_EMAIL_PALETTE,
      derived_snapshot_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  });

  it('wears the tenant palette on a clone and still stamps it', async () => {
    install({ emailBranding: { primary: '#aa2200', secondary: '#112233' } });
    const actions = await import('./notificationActions');
    await actions.cloneSystemTemplateAction(7);

    const written = service.createTenantTemplate.mock.calls[0][1];
    expect(written.html_content).toBe(applyEmailPalette(NEW.html_content, STOCK_EMAIL_PALETTE, TARGET));
    expect(written).toMatchObject({ derived_from_system_id: 7, derived_palette: TARGET });
  });

  it('does not stamp a created template whose content is the tenant\'s own, and ignores caller-supplied provenance', async () => {
    install({});
    const actions = await import('./notificationActions');
    await actions.createTenantTemplateAction({
      name: 'quote-email', language_code: 'en', subject: 'Mine', html_content: '<p>mine</p>', text_content: 'mine',
      derived_from_system_id: 7, derived_palette: TARGET, derived_snapshot_hash: 'forged',
    } as any);

    expect(service.createTenantTemplate.mock.calls[0][1]).toMatchObject({
      derived_from_system_id: null, derived_palette: null, derived_snapshot_hash: null,
    });
  });

  it('clears provenance when the tenant saves an edit', async () => {
    install({});
    const actions = await import('./notificationActions');
    await actions.updateTenantTemplateAction(9, { html_content: '<p>edited</p>' });
    expect(service.updateTenantTemplate).toHaveBeenCalledWith(TENANT, 9, {
      html_content: '<p>edited</p>', derived_from_system_id: null, derived_palette: null, derived_snapshot_hash: null,
    });
  });

  it('shows a derived row as the current standard template and flags what an edited copy lacks', async () => {
    const { stampDerivedTemplate } = await import('@alga-psa/email/derivedTemplates');
    const stored = { ...OLD, html_content: applyEmailPalette(OLD.html_content, STOCK_EMAIL_PALETTE, TARGET) };
    const derivedRow = { id: 1, name: 'quote-email', language_code: 'en', ...stampDerivedTemplate(stored, { id: 7, ...OLD }, TARGET) };
    const editedRow = { id: 2, name: 'quote-email', language_code: 'en', ...stored, html_content: `${stored.html_content}<p>ours</p>` };

    install({}, [derivedRow]);
    const actions = await import('./notificationActions');
    const derivedView = (await actions.getTemplatesAction()).tenantTemplates[0];
    expect(derivedView).toMatchObject({ derived: true, missingVariables: [] });
    expect(derivedView.html_content).toBe(applyEmailPalette(NEW.html_content, STOCK_EMAIL_PALETTE, TARGET));

    install({}, [editedRow]);
    const editedView = (await actions.getTemplatesAction()).tenantTemplates[0];
    expect(editedView.derived).toBe(false);
    expect(editedView.html_content).toContain('ours');
    expect(editedView.missingVariables).toEqual(['quoteReviewLink']);
  });
});
