import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { tenantDb } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/auth';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';

// Journey (docs: journey-first testing pivot): the recipient-language walk a
// customer document actually takes — the full resolution HIERARCHY against
// real rows (billing contact's user preference → client default locale →
// tenant default), the real migration-seeded standard quote template rendered
// with the real locale packs, and the client-portal download leg: a portal
// user triggers the real generate-and-file path, the stored document records
// the rendered locale, and the document authorizer admits the owning client's
// portal user (documents reach clients through quote/invoice/sales-order
// associations) while refusing a sibling client's user. Nothing in
// resolution, template selection, rendering, or authorization is mocked;
// translation strings come from the shipped packs on disk.

let db: Knex;
let tenantId: string;
// The MSP/portal identities alternate through the journey; the withAuth mocks
// read this at call time so each step runs as the right persona.
let activeActor: any;

function tenantTable<Row extends object = Record<string, unknown>>(
  connection: Knex,
  tenant: string,
  tableExpression: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(connection, tenant).table<Row>(tableExpression);
}

function tenantRows(connection: Knex): Knex.QueryBuilder<Record<string, unknown>, Record<string, unknown>[]> {
  return tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn())
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getConnection: vi.fn(async () => db),
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      callback(knexOrTrx as unknown as Knex.Transaction),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(activeActor, { tenant: tenantId }, ...args),
  withOptionalAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(activeActor ?? null, activeActor ? { tenant: tenantId } : null, ...args),
  withAuthCheck: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(activeActor, { tenant: tenantId }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

const HOOK_TIMEOUT = 240_000;
const TEST_TIMEOUT = 120_000;

const runTag = uuidv4().slice(0, 8);

let storageBaseDir: string;
let previousTenantSettings: unknown;
let createPDFGenerationService: typeof import('@alga-psa/billing/services/pdfGenerationService').createPDFGenerationService;
let browserPoolService: typeof import('@alga-psa/billing/services/browserPoolService').browserPoolService;
let downloadClientQuotePdf: typeof import('@alga-psa/client-portal/actions/client-portal-actions/client-billing').downloadClientQuotePdf;
let getAuthorizedDocumentByFileId: typeof import('@alga-psa/documents/actions/documentActions').getAuthorizedDocumentByFileId;

// One client per resolution tier. Portal users exist for the pt client (the
// download leg) and the tenant-default client (the cross-client negative).
let contactPrefClient: { clientId: string; quoteId: string };
let clientDefaultClient: { clientId: string; quoteId: string; portalUser: any };
let tenantDefaultClient: { clientId: string; quoteId: string; portalUser: any };

function actAs(user: any): void {
  activeActor = user;
  vi.mocked(getCurrentUser).mockImplementation(async () => user);
}

async function seedClientWithQuote(options: {
  name: string;
  properties?: Record<string, unknown>;
  quoteStatus: string;
}): Promise<{ clientId: string; quoteId: string }> {
  const clientId = uuidv4();
  await tenantTable(db, tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `${options.name} ${runTag}`,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    ...(options.properties ? { properties: JSON.stringify(options.properties) } : {}),
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  const quoteId = uuidv4();
  await tenantTable(db, tenantId, 'quotes').insert({
    tenant: tenantId,
    quote_id: quoteId,
    quote_number: `QL-${options.name.replace(/\s+/g, '').slice(0, 6)}-${runTag}`,
    client_id: clientId,
    title: 'Language resolution journey quote',
    quote_date: '2026-06-01T00:00:00Z',
    valid_until: '2026-09-15T00:00:00Z',
    status: options.quoteStatus,
    subtotal: 50000,
    discount_total: 0,
    tax: 0,
    total_amount: 50000,
    currency_code: 'USD',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  await tenantTable(db, tenantId, 'quote_items').insert({
    tenant: tenantId,
    quote_item_id: uuidv4(),
    quote_id: quoteId,
    description: 'Onboarding & Migration',
    quantity: 1,
    unit_price: 50000,
    total_price: 50000,
    tax_amount: 0,
    net_amount: 50000,
    display_order: 1,
  });
  return { clientId, quoteId };
}

// downloadClientQuotePdf gates on a real role_permissions read (billing/read,
// client-scoped) — grant it through a shared journey role, no RBAC mocks.
let portalBillingRoleId: string | null = null;
async function ensurePortalBillingRole(): Promise<string> {
  if (portalBillingRoleId) return portalBillingRoleId;
  const permission = await tenantTable(db, tenantId, 'permissions')
    .where({ resource: 'billing', action: 'read', client: true })
    .first<{ permission_id: string }>('permission_id');
  if (!permission) throw new Error('Seeded client billing/read permission not found');
  portalBillingRoleId = uuidv4();
  await tenantTable(db, tenantId, 'roles').insert({
    tenant: tenantId,
    role_id: portalBillingRoleId,
    role_name: `Journey Portal Billing ${runTag}`,
    msp: false,
    client: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await tenantTable(db, tenantId, 'role_permissions').insert({
    tenant: tenantId,
    role_id: portalBillingRoleId,
    permission_id: permission.permission_id,
  });
  return portalBillingRoleId;
}

async function seedPortalUser(clientId: string, emailTag: string): Promise<any> {
  const contactId = uuidv4();
  const email = `${emailTag}-${runTag}@journey.test`;
  await tenantTable(db, tenantId, 'contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    client_id: clientId,
    full_name: `Portal ${emailTag}`,
    email,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  const userId = uuidv4();
  await tenantTable(db, tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: email,
    email,
    first_name: 'Portal',
    last_name: emailTag,
    hashed_password: 'journey-fixture',
    user_type: 'client',
    contact_id: contactId,
    created_at: db.fn.now(),
  });
  const roleId = await ensurePortalBillingRole();
  await tenantTable(db, tenantId, 'user_roles').insert({
    tenant: tenantId,
    user_id: userId,
    role_id: roleId,
  });
  return { user_id: userId, tenant: tenantId, user_type: 'client', contact_id: contactId, email, roles: [] };
}

describe('journey: recipient language hierarchy → localized render → portal download', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    storageBaseDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'document-language-journey-'));
    process.env.STORAGE_DEFAULT_PROVIDER = 'local';
    process.env.STORAGE_LOCAL_BASE_PATH = storageBaseDir;

    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureTenant(db);
    setupCommonMocks({ tenantId, userId: uuidv4(), permissionCheck: () => true });

    // Tenant default locale: the bottom of the hierarchy. The journey DB is
    // shared with sibling journey files, so the prior settings are restored in
    // afterAll — a German tenant default would localize their renders too.
    const settingsRow = await tenantTable(db, tenantId, 'tenant_settings').first('settings');
    previousTenantSettings = settingsRow ? settingsRow.settings : undefined;
    const mergedSettings = { ...(previousTenantSettings as Record<string, unknown> ?? {}), defaultLocale: 'de' };
    if (settingsRow) {
      await tenantTable(db, tenantId, 'tenant_settings').update({ settings: JSON.stringify(mergedSettings) });
    } else {
      await tenantTable(db, tenantId, 'tenant_settings').insert({ tenant: tenantId, settings: JSON.stringify(mergedSettings) });
    }

    // Tier 1 — billing contact whose portal user prefers French.
    contactPrefClient = await seedClientWithQuote({ name: 'Contact Pref', quoteStatus: 'draft' });
    const billingContactUser = await seedPortalUser(contactPrefClient.clientId, 'fr-billing');
    await tenantTable(db, tenantId, 'clients')
      .where({ client_id: contactPrefClient.clientId })
      .update({ billing_contact_id: billingContactUser.contact_id });
    await tenantTable(db, tenantId, 'user_preferences').insert({
      tenant: tenantId,
      user_id: billingContactUser.user_id,
      setting_name: 'locale',
      setting_value: JSON.stringify('fr'),
      updated_at: new Date(),
    });

    // Tier 2 — client default locale, stored region-tagged the way imports
    // write it: pt_BR must normalize to the shipped pt pack.
    clientDefaultClient = {
      ...(await seedClientWithQuote({
        name: 'Client Default',
        properties: { defaultLocale: 'pt_BR' },
        quoteStatus: 'sent',
      })),
      portalUser: null,
    };
    clientDefaultClient.portalUser = await seedPortalUser(clientDefaultClient.clientId, 'pt-portal');

    // Tier 3 — nothing set anywhere: the tenant default (de) applies.
    tenantDefaultClient = {
      ...(await seedClientWithQuote({ name: 'Tenant Default', quoteStatus: 'sent' })),
      portalUser: null,
    };
    tenantDefaultClient.portalUser = await seedPortalUser(tenantDefaultClient.clientId, 'de-portal');

    ({ createPDFGenerationService } = await import('@alga-psa/billing/services/pdfGenerationService'));
    ({ browserPoolService } = await import('@alga-psa/billing/services/browserPoolService'));
    ({ downloadClientQuotePdf } = await import('@alga-psa/client-portal/actions/client-portal-actions/client-billing'));
    ({ getAuthorizedDocumentByFileId } = await import('@alga-psa/documents/actions/documentActions'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    // Restore the shared tenant's settings so sibling journeys keep rendering
    // in their expected (English) default.
    if (db && tenantId) {
      await tenantTable(db, tenantId, 'tenant_settings')
        .update({ settings: previousTenantSettings === undefined || previousTenantSettings === null
          ? null
          : JSON.stringify(previousTenantSettings) })
        .catch(() => undefined);
    }
    await browserPoolService?.shutdown?.().catch(() => undefined);
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('resolves the recipient locale through the real hierarchy: contact preference → client default → tenant default', async () => {
    actAs({ user_id: uuidv4(), tenant: tenantId, user_type: 'internal', roles: [{ role_name: 'Admin' }] });
    const service = createPDFGenerationService(tenantId);

    await expect(service.resolveRenderLocale({ quoteId: contactPrefClient.quoteId })).resolves.toBe('fr');
    // pt_BR (region-tagged, as imports store it) lands on the shipped pt pack.
    await expect(service.resolveRenderLocale({ quoteId: clientDefaultClient.quoteId })).resolves.toBe('pt');
    await expect(service.resolveRenderLocale({ quoteId: tenantDefaultClient.quoteId })).resolves.toBe('de');
  }, TEST_TIMEOUT);

  it('renders the migration-seeded standard quote template with the real locale packs, one language per document', async () => {
    actAs({ user_id: uuidv4(), tenant: tenantId, user_type: 'internal', roles: [{ role_name: 'Admin' }] });
    const service = createPDFGenerationService(tenantId);

    const french = await service.renderQuotePreview({ quoteId: contactPrefClient.quoteId });
    expect(french.html).toContain('DEVIS');
    expect(french.html).toContain('Valable jusqu&#x27;au');

    const portuguese = await service.renderQuotePreview({ quoteId: clientDefaultClient.quoteId });
    expect(portuguese.html).toContain('COTAÇÃO');
    expect(portuguese.html).toContain('Válido até');

    const german = await service.renderQuotePreview({ quoteId: tenantDefaultClient.quoteId });
    expect(german.html).toContain('ANGEBOT');
    expect(german.html).toContain('Gültig bis');
    expect(german.html).not.toContain('QUOTE');
  }, TEST_TIMEOUT);

  it('portal download files a PDF in the client language and the authorizer scopes it to that client', async () => {
    actAs(clientDefaultClient.portalUser);

    const download = await downloadClientQuotePdf(clientDefaultClient.quoteId);
    expect(download).toMatchObject({ success: true });
    const fileId = (download as { success: true; fileId: string }).fileId;
    expect(fileId).toBeTruthy();

    // The filed artifact answers "what language was this?" and is published to
    // the client (quote documents are client-visible on filing).
    const documentRow = await tenantTable(db, tenantId, 'documents')
      .where({ file_id: fileId })
      .first<{ document_id: string; rendered_locale?: string | null; is_client_visible?: boolean }>();
    expect(documentRow).toBeTruthy();
    expect(documentRow!.rendered_locale).toBe('pt');
    expect(documentRow!.is_client_visible).toBe(true);

    const association = await tenantTable(db, tenantId, 'document_associations')
      .where({ document_id: documentRow!.document_id, entity_type: 'quote', entity_id: clientDefaultClient.quoteId })
      .first();
    expect(association).toBeTruthy();

    // The owning client's portal user passes document authorization through
    // the quote association; a sibling client's portal user does not.
    const authorized = await db.transaction((trx) =>
      getAuthorizedDocumentByFileId(trx, tenantId, {
        ...clientDefaultClient.portalUser,
        clientId: clientDefaultClient.clientId,
      }, fileId)
    );
    expect(authorized?.document_id).toBe(documentRow!.document_id);

    const crossClient = await db.transaction((trx) =>
      getAuthorizedDocumentByFileId(trx, tenantId, {
        ...tenantDefaultClient.portalUser,
        clientId: tenantDefaultClient.clientId,
      }, fileId)
    );
    expect(crossClient).toBeNull();
  }, TEST_TIMEOUT);
});

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await tenantRows(connection).first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }
  const newTenantId = uuidv4();
  await tenantRows(connection).insert({
    tenant: newTenantId,
    client_name: 'Journey Integration Tenant',
    email: 'journeys@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now()
  });
  return newTenantId;
}
