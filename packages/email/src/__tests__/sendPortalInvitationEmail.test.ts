import type { Knex } from 'knex';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getConnectionMock,
  resolveEmailLocaleMock,
  systemSendMock,
  tenantSendMock,
} = vi.hoisted(() => ({
  getConnectionMock: vi.fn(),
  resolveEmailLocaleMock: vi.fn(),
  systemSendMock: vi.fn(),
  tenantSendMock: vi.fn(),
}));

// The real tenantDb is kept: template selection goes through it, and whether a
// tenant row or a system row wins is exactly what these tests are about.
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    getConnection: getConnectionMock,
    runWithTenant: (_tenant: string, callback: () => Promise<unknown>) => callback(),
  };
});

vi.mock('../index', () => ({
  getSystemEmailService: vi.fn(async () => ({ sendEmail: systemSendMock })),
  TenantEmailService: {
    getInstance: vi.fn(() => ({ sendEmail: tenantSendMock })),
  },
}));

vi.mock('../emailLocaleResolver', () => ({
  getUserInfoForEmail: vi.fn(async () => null),
  resolveEmailLocale: resolveEmailLocaleMock,
}));

import { sendPortalInvitationEmail } from '../sendPortalInvitationEmail';

const TENANT = 'tenant-1';

type TemplateRow = {
  __table: 'tenant_email_templates' | 'system_email_templates';
  tenant?: string;
  name: string;
  language_code: string;
  subject: string;
  html_content: string;
  text_content: string | null;
};

/**
 * A disposable stand-in for tenant_email_templates / system_email_templates:
 * enough of a knex builder for `tenantDb(...).table(...).where(...).first()`,
 * so the real DatabaseTemplateProcessor walks its real lookup order over the
 * rows a test seeds.
 */
function createFakeTemplateKnex(rows: TemplateRow[]): Knex {
  const normalizeColumn = (column: string) => column.split('.').pop() ?? column;
  const normalizeFilters = (args: unknown[]): Record<string, unknown> => {
    const [first, second] = args;
    if (typeof first === 'string') {
      return { [normalizeColumn(first)]: second };
    }
    return Object.fromEntries(
      Object.entries(first as Record<string, unknown>).map(([key, value]) => [normalizeColumn(key), value])
    );
  };

  const createQuery = (table: string, filters: Record<string, unknown>): any => ({
    where(...args: unknown[]) {
      return createQuery(table, { ...filters, ...normalizeFilters(args) });
    },
    async first() {
      return rows.find(
        (row) =>
          row.__table === table &&
          Object.entries(filters).every(([key, value]) => (row as Record<string, unknown>)[key] === value)
      );
    },
  });

  return ((table: string) => createQuery(table, {})) as unknown as Knex;
}

const warning = {
  en: 'Time-Sensitive Invitation — This invitation link will expire in <strong>{{expirationTime}}</strong>.',
  de: 'Zeitkritische Einladung — Dieser Einladungslink läuft in <strong>{{expirationTime}}</strong> ab.',
  fr: "Ce lien d’invitation expirera dans <strong>{{expirationTime}}</strong>.",
  es: 'Este enlace de invitación expirará en <strong>{{expirationTime}}</strong>.',
  sv: 'Den här inbjudningslänken slutar gälla om <strong>{{expirationTime}}</strong>.',
} as const;

const subjects = {
  en: 'Portal Invitation - {{tenantName}}',
  de: 'Kundenportal-Einladung - {{tenantName}}',
  fr: 'Invitation au portail client - {{tenantName}}',
  es: 'Invitación al portal del cliente - {{tenantName}}',
  sv: 'Inbjudan till kundportalen – {{tenantName}}',
} as const;

function systemRow(language: keyof typeof warning): TemplateRow {
  return {
    __table: 'system_email_templates',
    name: 'portal-invitation',
    language_code: language,
    subject: subjects[language],
    html_content: `<p>${warning[language]}</p>`,
    text_content: null,
  };
}

function tenantRow(language: keyof typeof warning): TemplateRow {
  return {
    __table: 'tenant_email_templates',
    tenant: TENANT,
    name: 'portal-invitation',
    language_code: language,
    subject: `[Example MSP] ${subjects[language]}`,
    html_content: `<p>Example MSP copy — ${warning[language]}</p>`,
    text_content: null,
  };
}

/** Every supported locale has a system template, as production does. */
const SYSTEM_TEMPLATES = (['en', 'de', 'fr', 'es', 'sv'] as const).map(systemRow);

function seedTemplates(rows: TemplateRow[]): void {
  getConnectionMock.mockResolvedValue(createFakeTemplateKnex(rows));
}

const params = {
  email: 'contact@example.test',
  contactName: 'Casey Client',
  clientName: 'Example Client',
  tenantName: 'Example MSP',
  portalLink: 'https://portal.example.test/setup',
  validityDays: 7,
  tenant: TENANT,
  supportEmail: 'support@example.test',
  fromName: 'Example MSP Portal',
};

/** Render what a provider was handed, the way BaseEmailService would. */
async function renderedBy(sendMock: typeof tenantSendMock) {
  const call = sendMock.mock.calls[0]?.[0];
  expect(call, 'expected the provider to be called').toBeTruthy();
  return call.templateProcessor.process({
    templateData: call.templateData,
    tenantId: call.tenantId,
    locale: call.locale,
  });
}

describe('sendPortalInvitationEmail sender identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedTemplates(SYSTEM_TEMPLATES);
    resolveEmailLocaleMock.mockResolvedValue('en');
    tenantSendMock.mockResolvedValue({ success: true });
    systemSendMock.mockResolvedValue({ success: true });
  });

  it('forwards the explicit portal display name to the tenant provider', async () => {
    await sendPortalInvitationEmail(params);

    expect(tenantSendMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      fromName: 'Example MSP Portal',
      replyTo: 'support@example.test',
    }));
    expect(systemSendMock).not.toHaveBeenCalled();
  });

  it('forwards the same display name to the system fallback without a tenant From address', async () => {
    tenantSendMock.mockResolvedValue({ success: false, error: 'provider unavailable' });

    await sendPortalInvitationEmail(params);

    expect(systemSendMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      fromName: 'Example MSP Portal',
      replyTo: 'support@example.test',
    }));
    expect(systemSendMock.mock.calls[0]?.[0]).not.toHaveProperty('from');
  });
});

/**
 * The tenant's validity is a number of days; what the recipient reads has to be
 * their own language, not the English "24 hours" the invitation used to promise.
 */
describe('sendPortalInvitationEmail validity wording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No tenant override: the system template exists in the recipient's
    // language, so the template language is the resolved locale.
    seedTemplates(SYSTEM_TEMPLATES);
    resolveEmailLocaleMock.mockResolvedValue('en');
    tenantSendMock.mockResolvedValue({ success: true });
    systemSendMock.mockResolvedValue({ success: true });
  });

  // Which space ICU puts between the number and the unit is its business (fr
  // uses a narrow no-break space), so compare on the wording.
  const expirationTimeOf = () => String(
    tenantSendMock.mock.calls[0]?.[0]?.templateData?.expirationTime ?? '',
  ).replace(/\s/gu, ' ');

  // German and Swedish are read out of DAY_UNIT_OVERRIDES, not ICU: the
  // carrier sentence "läuft in … ab" wants the dative plural "Tagen", and a
  // Swedish invitation says "dagar" rather than ICU's 24-hour "dygn".
  it.each([
    ['en', 7, '7 days'],
    ['en', 1, '1 day'],
    ['de', 7, '7 Tagen'],
    ['de', 1, '1 Tag'],
    ['fr', 3, '3 jours'],
    ['es', 1, '1 día'],
    ['sv', 7, '7 dagar'],
    ['sv', 1, '1 dag'],
  ])('renders %s validity of %i day(s) as "%s"', async (locale, validityDays, expected) => {
    resolveEmailLocaleMock.mockResolvedValue(locale);

    await sendPortalInvitationEmail({ ...params, validityDays });

    expect(expirationTimeOf()).toBe(expected);
  });

  it('never promises an expiry that already passed when handed a nonsense validity', async () => {
    await sendPortalInvitationEmail({ ...params, validityDays: 0 });

    expect(expirationTimeOf()).toBe('1 day');
  });
});

/**
 * The duration belongs to the template that is actually sent, not to the
 * recipient's resolved locale: a tenant that keeps an English-only copy of
 * 'portal-invitation' mails an English body, and an English body saying
 * "expire in 14 Tagen" is the half-translated email this covers.
 */
describe('sendPortalInvitationEmail duration follows the template that is sent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveEmailLocaleMock.mockResolvedValue('de');
    tenantSendMock.mockResolvedValue({ success: true });
    systemSendMock.mockResolvedValue({ success: true });
  });

  it('writes an English duration into a tenant English-only template for a German recipient', async () => {
    seedTemplates([...SYSTEM_TEMPLATES, tenantRow('en')]);

    await sendPortalInvitationEmail({ ...params, validityDays: 14 });

    const rendered = await renderedBy(tenantSendMock);
    expect(rendered.subject).toBe('[Example MSP] Portal Invitation - Example MSP');
    expect(rendered.html).toContain('This invitation link will expire in <strong>14 days</strong>');
    expect(rendered.text).toContain('14 days');
    expect(rendered.html).not.toContain('Tage');
    expect(rendered.text).not.toContain('Tage');
  });

  it('writes "1 day" into that same English-only template for a one-day validity', async () => {
    seedTemplates([...SYSTEM_TEMPLATES, tenantRow('en')]);

    await sendPortalInvitationEmail({ ...params, validityDays: 1 });

    const rendered = await renderedBy(tenantSendMock);
    expect(rendered.html).toContain('This invitation link will expire in <strong>1 day</strong>');
    expect(rendered.html).not.toContain('Tag<');
  });

  it('uses the German system template and "14 Tagen" when the tenant has no copy', async () => {
    seedTemplates(SYSTEM_TEMPLATES);

    await sendPortalInvitationEmail({ ...params, validityDays: 14 });

    const rendered = await renderedBy(tenantSendMock);
    expect(rendered.subject).toBe('Kundenportal-Einladung - Example MSP');
    expect(rendered.html).toContain('Dieser Einladungslink läuft in <strong>14 Tagen</strong> ab');
    expect(rendered.html).not.toContain('14 days');
  });

  it('uses the tenant German template and "14 Tagen" when the tenant has one', async () => {
    seedTemplates([...SYSTEM_TEMPLATES, tenantRow('en'), tenantRow('de')]);

    await sendPortalInvitationEmail({ ...params, validityDays: 14 });

    const rendered = await renderedBy(tenantSendMock);
    expect(rendered.subject).toBe('[Example MSP] Kundenportal-Einladung - Example MSP');
    expect(rendered.html).toContain('Example MSP copy');
    expect(rendered.html).toContain('<strong>14 Tagen</strong>');
    expect(rendered.html).not.toContain('14 days');
  });

  it('renders the same language pairing on the system email fallback', async () => {
    seedTemplates([...SYSTEM_TEMPLATES, tenantRow('en')]);
    tenantSendMock.mockResolvedValue({ success: false, error: 'provider unavailable' });

    await sendPortalInvitationEmail({ ...params, validityDays: 14 });

    const rendered = await renderedBy(systemSendMock);
    expect(rendered.subject).toBe('[Example MSP] Portal Invitation - Example MSP');
    expect(rendered.html).toContain('This invitation link will expire in <strong>14 days</strong>');
    expect(rendered.html).not.toContain('Tage');
  });
});
