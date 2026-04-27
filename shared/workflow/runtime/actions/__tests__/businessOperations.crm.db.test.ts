import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { knex, type Knex } from 'knex';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getSecret } from '@alga-psa/core/secrets';
import { v4 as uuidv4 } from 'uuid';

import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerCrmActions } from '../businessOperations/crm';
import { registerWorkflowEmailProvider, resetWorkflowEmailProvider } from '../../registries/workflowEmailRegistry';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../../..');
const TEST_DB_NAME = 'test_database';
const PRODUCTION_DB_NAMES = new Set(['sebastian_prod', 'production', 'prod', 'server']);

type PublishedWorkflowEvent = {
  eventType?: string;
  idempotencyKey?: string;
  [key: string]: unknown;
};

const publishWorkflowEventMock = vi.hoisted(() =>
  vi.fn(async (_event: PublishedWorkflowEvent) => undefined)
);

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: (event: PublishedWorkflowEvent) => publishWorkflowEventMock(event),
}));

function verifyTestDatabase(dbName: string): void {
  if (PRODUCTION_DB_NAMES.has(dbName.toLowerCase())) {
    throw new Error(`Attempting to use production database (${dbName}) for testing`);
  }
}

async function recreateDatabase(
  databaseName: string,
  dbHost: string,
  dbPort: number,
  adminUser: string,
  adminPassword: string,
  appUser: string,
  appPassword: string
): Promise<void> {
  const adminConnection = knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: dbPort,
      user: adminUser,
      password: adminPassword,
      database: 'postgres',
    },
    pool: { min: 1, max: 2 },
  });

  try {
    const safeDbName = databaseName.replace(/"/g, '""');
    await adminConnection.raw(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()',
      [databaseName]
    );
    await adminConnection.raw(`DROP DATABASE IF EXISTS "${safeDbName}"`);
    await adminConnection.raw(`CREATE DATABASE "${safeDbName}"`);
    await adminConnection.raw(`DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appUser}') THEN
          CREATE ROLE ${appUser} WITH LOGIN PASSWORD '${appPassword}';
        ELSE
          ALTER ROLE ${appUser} WITH LOGIN PASSWORD '${appPassword}';
        END IF;
      END;
    $$;`);
    await adminConnection.raw(`ALTER DATABASE "${safeDbName}" OWNER TO ${appUser}`);
    await adminConnection.raw(`GRANT ALL PRIVILEGES ON DATABASE "${safeDbName}" TO ${appUser}`);
  } finally {
    await adminConnection.destroy().catch(() => undefined);
  }
}

async function createTestDbConnection(): Promise<Knex> {
  const databaseName = process.env.DB_NAME_SERVER || TEST_DB_NAME;
  verifyTestDatabase(databaseName);

  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = Number.parseInt(process.env.DB_PORT || '5432', 10);
  const adminUser = process.env.DB_USER_ADMIN || 'postgres';
  const adminPassword = await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123');
  const appUser = process.env.DB_USER_SERVER || 'app_user';
  const appPassword = await getSecret('db_password_server', 'DB_PASSWORD_SERVER', 'postpass123');

  await recreateDatabase(databaseName, dbHost, dbPort, adminUser, adminPassword, appUser, appPassword);

  process.env.DB_HOST = dbHost;
  process.env.DB_PORT = String(dbPort);
  process.env.DB_NAME_SERVER = databaseName;
  process.env.DB_USER_SERVER = appUser;
  process.env.DB_USER_ADMIN = adminUser;

  const adminKnex = knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: dbPort,
      user: adminUser,
      password: adminPassword,
      database: databaseName,
    },
    migrations: { directory: path.join(repoRoot, 'server', 'migrations') },
    seeds: { directory: path.join(repoRoot, 'server', 'seeds', 'dev') },
  });

  await adminKnex.migrate.latest();
  await adminKnex.seed.run();
  await adminKnex.destroy();

  return knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: dbPort,
      user: appUser,
      password: appPassword,
      database: databaseName,
    },
    asyncStackTraces: true,
    pool: { min: 2, max: 20 },
  });
}

async function createTenant(db: Knex, name = 'Test Tenant'): Promise<string> {
  const tenantId = uuidv4();
  const now = new Date().toISOString();

  await db('tenants').insert({
    tenant: tenantId,
    client_name: name,
    phone_number: '555-0100',
    email: `test-${tenantId.substring(0, 8)}@example.com`,
    created_at: now,
    updated_at: now,
    payment_platform_id: `test-platform-${tenantId.substring(0, 8)}`,
    payment_method_id: `test-method-${tenantId.substring(0, 8)}`,
    auth_service_id: `test-auth-${tenantId.substring(0, 8)}`,
    plan: 'pro',
  });

  return tenantId;
}

async function createUser(db: Knex, tenantId: string, options: { email?: string; first_name?: string; last_name?: string } = {}): Promise<string> {
  const userId = uuidv4();

  await db('users').insert({
    user_id: userId,
    tenant: tenantId,
    username: `test.user.${userId}`,
    first_name: options.first_name || 'Test',
    last_name: options.last_name || 'User',
    email: options.email || `test.user.${userId}@example.com`,
    hashed_password: 'hashed_password_here',
    created_at: new Date(),
    two_factor_enabled: false,
    is_google_user: false,
    is_inactive: false,
    user_type: 'internal',
  });

  return userId;
}

async function createClient(db: Knex, tenantId: string, name = 'Test Client'): Promise<string> {
  const clientId = uuidv4();
  const now = new Date().toISOString();

  await db('clients').insert({
    client_id: clientId,
    client_name: name,
    tenant: tenantId,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    created_at: now,
    updated_at: now,
    is_inactive: false,
    credit_balance: 0,
  });

  return clientId;
}

async function createContact(db: Knex, tenantId: string, clientId: string, name: string): Promise<string> {
  const contactId = uuidv4();
  await db('contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    full_name: name,
    client_id: clientId,
    email: `${contactId.slice(0, 8)}@example.com`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_inactive: false,
  });
  return contactId;
}

async function getTicketStatusId(db: Knex, tenantId: string, actorUserId: string): Promise<string> {
  const existing = await db('statuses')
    .where({ tenant: tenantId, status_type: 'ticket' })
    .orderBy('order_number', 'asc')
    .first();
  if (existing?.status_id) return existing.status_id;

  const [inserted] = await db('statuses')
    .insert({
      tenant: tenantId,
      name: 'Open',
      status_type: 'ticket',
      order_number: 1,
      created_by: actorUserId,
      is_closed: false,
      is_default: true,
    })
    .returning('status_id');
  return inserted.status_id;
}

async function createTicket(db: Knex, params: { tenantId: string; actorUserId: string; clientId: string; contactId?: string | null }): Promise<string> {
  const ticketId = uuidv4();
  const statusId = await getTicketStatusId(db, params.tenantId, params.actorUserId);

  await db('tickets').insert({
    ticket_id: ticketId,
    tenant: params.tenantId,
    ticket_number: `WF-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    title: 'Workflow Ticket',
    status_id: statusId,
    client_id: params.clientId,
    entered_by: params.actorUserId,
    contact_name_id: params.contactId ?? null,
  });

  return ticketId;
}

async function getDefaultInteractionStatusId(db: Knex, tenantId: string, actorUserId: string): Promise<string> {
  const existing = await db('statuses').where({ tenant: tenantId, status_type: 'interaction', is_default: true }).first();
  if (existing?.status_id) return existing.status_id;

  const [created] = await db('statuses')
    .insert({
      tenant: tenantId,
      name: 'Logged',
      status_type: 'interaction',
      order_number: 1,
      created_by: actorUserId,
      is_closed: false,
      is_default: true,
    })
    .returning('status_id');

  return created.status_id;
}

async function createInteractionStatus(db: Knex, tenantId: string, actorUserId: string, name: string): Promise<string> {
  const [status] = await db('statuses')
    .insert({
      tenant: tenantId,
      name,
      status_type: 'interaction',
      order_number: Math.floor(Math.random() * 1000) + 2,
      created_by: actorUserId,
      is_closed: false,
      is_default: false,
    })
    .returning('status_id');
  return status.status_id;
}

async function getAnyInteractionTypeId(db: Knex, tenantId: string): Promise<string> {
  const tenantType = await db('interaction_types').where({ tenant: tenantId }).first();
  if (tenantType?.type_id) return tenantType.type_id;

  const systemType = await db('system_interaction_types').first();
  if (!systemType?.type_id) {
    throw new Error('Expected at least one system_interaction_types row in seeded DB');
  }
  return systemType.type_id;
}

async function createInteractionType(db: Knex, tenantId: string, name: string): Promise<string> {
  const typeId = uuidv4();
  await db('interaction_types').insert({
    tenant: tenantId,
    type_id: typeId,
    type_name: name,
    icon: 'phone',
  });
  return typeId;
}

async function createInteraction(
  db: Knex,
  params: {
    tenantId: string;
    actorUserId: string;
    clientId: string;
    contactId?: string | null;
    ticketId?: string | null;
    typeId: string;
    statusId?: string | null;
    title?: string;
    notes?: string;
    interactionDate?: string;
  }
): Promise<string> {
  const interactionId = uuidv4();
  const interactionDate = params.interactionDate ?? new Date().toISOString();

  await db('interactions').insert({
    tenant: params.tenantId,
    interaction_id: interactionId,
    type_id: params.typeId,
    contact_name_id: params.contactId ?? null,
    client_id: params.clientId,
    ticket_id: params.ticketId ?? null,
    user_id: params.actorUserId,
    title: params.title ?? 'Interaction',
    notes: params.notes ?? null,
    interaction_date: interactionDate,
    start_time: interactionDate,
    end_time: interactionDate,
    duration: 0,
    status_id: params.statusId ?? null,
    visibility: 'internal',
    category: 'general',
    tags: ['seed'],
  });

  return interactionId;
}

async function createQuote(
  db: Knex,
  params: {
    tenantId: string;
    actorUserId: string;
    clientId: string;
    contactId?: string | null;
    title?: string;
    status?: string;
    isTemplate?: boolean;
  }
): Promise<string> {
  const quoteId = uuidv4();
  await db('quotes').insert({
    tenant: params.tenantId,
    quote_id: quoteId,
    quote_number: `Q-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    client_id: params.clientId,
    contact_id: params.contactId ?? null,
    title: params.title ?? 'Workflow Quote',
    description: 'Quote description',
    quote_date: new Date().toISOString(),
    status: params.status ?? 'draft',
    version: 1,
    subtotal: 10000,
    discount_total: 0,
    tax: 0,
    total_amount: 10000,
    currency_code: 'USD',
    is_template: params.isTemplate ?? false,
    created_by: params.actorUserId,
    updated_by: params.actorUserId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return quoteId;
}

async function createQuoteItemRecord(
  db: Knex,
  params: {
    tenantId: string;
    actorUserId: string;
    quoteId: string;
    description: string;
    quantity?: number;
    unitPrice?: number;
    isRecurring?: boolean;
    billingFrequency?: string | null;
    isOptional?: boolean;
    isSelected?: boolean;
    displayOrder?: number;
  }
): Promise<string> {
  const quoteItemId = uuidv4();
  const quantity = params.quantity ?? 1;
  const unitPrice = params.unitPrice ?? 1000;
  const displayOrder = params.displayOrder ?? 0;
  const total = quantity * unitPrice;
  await db('quote_items').insert({
    tenant: params.tenantId,
    quote_item_id: quoteItemId,
    quote_id: params.quoteId,
    description: params.description,
    quantity,
    unit_price: unitPrice,
    total_price: total,
    net_amount: total,
    tax_amount: 0,
    display_order: displayOrder,
    is_optional: params.isOptional ?? false,
    is_selected: params.isSelected ?? true,
    is_recurring: params.isRecurring ?? false,
    billing_frequency: params.billingFrequency ?? null,
    created_by: params.actorUserId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return quoteItemId;
}

const runtimeState = vi.hoisted(() => ({
  db: null as Knex | null,
  tenantId: '',
  actorUserId: '',
  deniedPermissions: new Set<string>(),
}));

vi.mock('../businessOperations/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../businessOperations/shared')>();

  return {
    ...actual,
    withTenantTransaction: async (_ctx: any, fn: any) => {
      if (!runtimeState.db) {
        throw new Error('DB unavailable for test runtime state');
      }

      return runtimeState.db.transaction(async (trx) => {
        await trx.raw('select set_config(\'app.current_tenant\', ?, true)', [runtimeState.tenantId]);
        return fn({
          tenantId: runtimeState.tenantId,
          actorUserId: runtimeState.actorUserId,
          trx,
        });
      });
    },
    requirePermission: async (ctx: any, _tx: any, permission: { resource: string; action: string }) => {
      const key = `${permission.resource}:${permission.action}`;
      if (!runtimeState.deniedPermissions.has(key)) return;
      throw {
        category: 'ActionError',
        code: 'PERMISSION_DENIED',
        message: `Missing permission ${key}`,
        details: { permission: key },
        nodePath: ctx?.stepPath ?? 'steps.crm-action',
        at: new Date().toISOString(),
      };
    },
  };
});

function getAction(actionId: string) {
  const action = getActionRegistryV2().get(actionId, 1);
  if (!action) throw new Error(`Missing action ${actionId}@1`);
  return action;
}

function actionCtx(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    runId: uuidv4(),
    stepPath: 'steps.crm-action',
    idempotencyKey: uuidv4(),
    attempt: 1,
    nowIso: () => new Date().toISOString(),
    env: {},
    tenantId: runtimeState.tenantId,
    ...overrides,
  };
}

async function invokeAction(actionId: string, input: Record<string, unknown>, ctxOverrides: Record<string, unknown> = {}) {
  const action = getAction(actionId);
  const parsedInput = action.inputSchema.parse(input);
  return action.handler(parsedInput, actionCtx(ctxOverrides) as any);
}

describe('crm workflow runtime DB-backed action handlers', () => {
  let db: Knex;

  beforeAll(async () => {
    if (!getActionRegistryV2().get('crm.send_quote', 1)) {
      registerCrmActions();
    }

    db = await createTestDbConnection();
    runtimeState.db = db;
  }, 180000);

  beforeEach(async () => {
    publishWorkflowEventMock.mockClear();

    const tenantId = await createTenant(db, `Workflow CRM Runtime Test ${Date.now()}`);
    const actorUserId = await createUser(db, tenantId, {
      first_name: 'Workflow',
      last_name: 'Actor',
    });

    runtimeState.tenantId = tenantId;
    runtimeState.actorUserId = actorUserId;
    runtimeState.deniedPermissions.clear();

    registerWorkflowEmailProvider({
      TenantEmailService: {
        getInstance: () => ({
          sendEmail: async () => ({ success: true, messageId: 'msg-test-1' }),
        }),
        getTenantEmailSettings: async () => ({ providerConfigs: [] }),
      },
      StaticTemplateProcessor: class {
        subject: string;
        html: string;
        text?: string;

        constructor(subject: string, html: string, text?: string) {
          this.subject = subject;
          this.html = html;
          this.text = text;
        }

        async process() {
          return { subject: this.subject, html: this.html, text: this.text };
        }
      } as any,
      EmailProviderManager: class {
        async initialize() {}
        async getAvailableProviders() {
          return [];
        }
        async sendEmail() {
          return { success: true };
        }
      } as any,
    });
  });

  afterAll(async () => {
    resetWorkflowEmailProvider();
    await db?.destroy();
    runtimeState.db = null;
  });

  it('T003: crm.create_interaction_type creates tenant type, handles duplicates, audits, and requires settings:update', async () => {
    const created = await invokeAction('crm.create_interaction_type', {
      type_name: 'QBR Follow-up',
      icon: 'phone',
    });

    expect(created.interaction_type.created).toBe(true);
    expect(created.interaction_type.type_name).toBe('QBR Follow-up');
    expect(created.interaction_type.display_order).toBeGreaterThanOrEqual(0);

    const duplicate = await invokeAction('crm.create_interaction_type', {
      type_name: '  qbr follow-up  ',
      if_exists: 'return_existing',
    });
    expect(duplicate.interaction_type.created).toBe(false);
    expect(duplicate.interaction_type.type_id).toBe(created.interaction_type.type_id);

    await expect(
      invokeAction('crm.create_interaction_type', {
        type_name: 'QBR Follow-up',
        if_exists: 'error',
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const audit = await db('audit_logs')
      .where({ tenant: runtimeState.tenantId, operation: 'workflow_action:crm.create_interaction_type' })
      .first();
    expect(audit).toBeTruthy();

    runtimeState.deniedPermissions.add('settings:update');
    await expect(
      invokeAction('crm.create_interaction_type', { type_name: 'Blocked Type' })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    runtimeState.deniedPermissions.clear();
  });

  it('T004: crm.update_activity_status transitions statuses, no-ops, audits, and rejects invalid status/activity', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Status Client');
    const typeId = await getAnyInteractionTypeId(db, runtimeState.tenantId);
    const initialStatusId = await getDefaultInteractionStatusId(db, runtimeState.tenantId, runtimeState.actorUserId);
    const nextStatusId = await createInteractionStatus(db, runtimeState.tenantId, runtimeState.actorUserId, 'Completed');

    const activityId = await createInteraction(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      typeId,
      statusId: initialStatusId,
    });

    const changed = await invokeAction('crm.update_activity_status', {
      activity_id: activityId,
      status_id: nextStatusId,
    });
    expect(changed.no_op).toBe(false);
    expect(changed.previous_status_id).toBe(initialStatusId);
    expect(changed.current_status_id).toBe(nextStatusId);

    const noOp = await invokeAction('crm.update_activity_status', {
      activity_id: activityId,
      status_name: 'completed',
      no_op_if_already_status: true,
    });
    expect(noOp.no_op).toBe(true);
    expect(noOp.current_status_id).toBe(nextStatusId);

    await expect(
      invokeAction('crm.update_activity_status', {
        activity_id: activityId,
        status_name: 'not-a-real-status',
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const otherTenantId = await createTenant(db, 'Other Activity Tenant');
    const otherUserId = await createUser(db, otherTenantId);
    const otherClientId = await createClient(db, otherTenantId, 'Other Activity Client');
    const otherTypeId = await getAnyInteractionTypeId(db, otherTenantId);
    const otherActivityId = await createInteraction(db, {
      tenantId: otherTenantId,
      actorUserId: otherUserId,
      clientId: otherClientId,
      typeId: otherTypeId,
    });

    await expect(
      invokeAction('crm.update_activity_status', {
        activity_id: otherActivityId,
        status_id: nextStatusId,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('T005/T006/T007/T016/T017: quote creation/find/approval/item/template follow-up actions enforce tenant guards and audit', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Quote Flow Client');
    const contactId = await createContact(db, runtimeState.tenantId, clientId, 'Quote Flow Contact');
    const templateId = await createQuote(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      contactId,
      title: 'Template Quote',
      status: null as any,
      isTemplate: true,
    });

    await createQuoteItemRecord(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      quoteId: templateId,
      description: 'Template Item',
      unitPrice: 1500,
      displayOrder: 0,
    });

    const createdQuote = await invokeAction('crm.create_quote', {
      client_id: clientId,
      contact_id: contactId,
      title: 'Workflow Created Quote',
      quote_date: new Date('2026-01-01').toISOString(),
      valid_until: new Date('2026-02-01').toISOString(),
      currency_code: 'USD',
    });
    expect(createdQuote.quote.quote_id).toBeTruthy();

    const addItem = await invokeAction('crm.add_quote_item', {
      quote_id: createdQuote.quote.quote_id,
      description: 'Managed Service',
      quantity: 2,
      unit_price: 2000,
      display_order: 0,
    });
    expect(addItem.quote_item.quote_id).toBe(createdQuote.quote.quote_id);
    expect(addItem.quote.quote_id).toBe(createdQuote.quote.quote_id);

    const foundQuotes = await invokeAction('crm.find_quotes', {
      quote_id: createdQuote.quote.quote_id,
      on_empty: 'error',
      pageSize: 25,
    });
    expect(foundQuotes.count).toBe(1);
    expect(foundQuotes.first_quote?.quote_id).toBe(createdQuote.quote.quote_id);

    const submitted = await invokeAction('crm.submit_quote_for_approval', {
      quote_id: createdQuote.quote.quote_id,
      reason: 'auto-submit',
    });
    expect(submitted.previous_status).toBe('draft');
    expect(submitted.new_status).toBe('pending_approval');

    const noOpPending = await invokeAction('crm.submit_quote_for_approval', {
      quote_id: createdQuote.quote.quote_id,
      no_op_if_already_pending: true,
    });
    expect(noOpPending.no_op).toBe(true);

    const fromTemplate = await invokeAction('crm.create_quote_from_template', {
      template_id: templateId,
      client_id: clientId,
      contact_id: contactId,
      title: 'Templated Quote',
      quote_date: new Date('2026-03-01').toISOString(),
      valid_until: new Date('2026-03-30').toISOString(),
    });
    expect(fromTemplate.quote.quote_id).toBeTruthy();
    expect(fromTemplate.quote_items.length).toBeGreaterThan(0);

    await expect(
      invokeAction('crm.create_quote', {
        client_id: clientId,
        contact_id: contactId,
        title: 'Bad Dates',
        quote_date: new Date('2026-04-02').toISOString(),
        valid_until: new Date('2026-04-01').toISOString(),
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      invokeAction('crm.find_quotes', {
        on_empty: 'return_empty',
        pageSize: 100,
      })
    ).rejects.toThrow();

    const quoteAudit = await db('audit_logs')
      .where({ tenant: runtimeState.tenantId, operation: 'workflow_action:crm.create_quote' })
      .first();
    expect(quoteAudit).toBeTruthy();
  });

  it('T008/T009: crm.convert_quote converts accepted quotes and rejects ineligible/template/cross-tenant/permission cases', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Convert Client');
    const quoteId = await createQuote(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      title: 'Convert Me',
      status: 'accepted',
    });

    await createQuoteItemRecord(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      quoteId,
      description: 'Recurring Contract Line',
      unitPrice: 5000,
      isRecurring: true,
      billingFrequency: 'monthly',
      displayOrder: 0,
    });
    await createQuoteItemRecord(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      quoteId,
      description: 'One-time Setup',
      unitPrice: 2000,
      isRecurring: false,
      displayOrder: 1,
    });

    const converted = await invokeAction('crm.convert_quote', {
      quote_id: quoteId,
      target: 'contract_and_invoice',
    });
    expect(converted.no_op).toBe(false);
    expect(converted.contract_id).toBeTruthy();
    expect(converted.invoice_id).toBeTruthy();

    const noOp = await invokeAction('crm.convert_quote', {
      quote_id: quoteId,
      target: 'contract',
      no_op_if_already_converted: true,
    });
    expect(noOp.no_op).toBe(true);

    const draftQuoteId = await createQuote(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      status: 'draft',
    });
    await expect(
      invokeAction('crm.convert_quote', {
        quote_id: draftQuoteId,
        target: 'contract',
      })
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    const templateQuoteId = await createQuote(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      status: null as any,
      isTemplate: true,
    });
    await expect(
      invokeAction('crm.convert_quote', {
        quote_id: templateQuoteId,
        target: 'invoice',
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const otherTenant = await createTenant(db, 'Other Convert Tenant');
    const otherUser = await createUser(db, otherTenant);
    const otherClient = await createClient(db, otherTenant, 'Other Convert Client');
    const otherQuote = await createQuote(db, {
      tenantId: otherTenant,
      actorUserId: otherUser,
      clientId: otherClient,
      status: 'accepted',
    });
    await expect(
      invokeAction('crm.convert_quote', {
        quote_id: otherQuote,
        target: 'contract',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    runtimeState.deniedPermissions.add('billing:create');
    await expect(
      invokeAction('crm.convert_quote', {
        quote_id: quoteId,
        target: 'contract',
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    runtimeState.deniedPermissions.clear();
  });

  it('T010/T011: crm.tag_activity validates interactions, applies tags idempotently, enforces tag:create, audits, and emits tag events', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Tag Client');
    const typeId = await getAnyInteractionTypeId(db, runtimeState.tenantId);
    const activityId = await createInteraction(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      typeId,
    });

    const tagged = await invokeAction('crm.tag_activity', {
      activity_id: activityId,
      tags: ['Needs QBR', 'Upsell Candidate'],
    });

    expect(tagged.tagged_entity).toEqual({ type: 'client', id: clientId });
    expect(tagged.added_count).toBe(2);
    expect(tagged.existing_count).toBe(0);

    const unsupportedInteractionMappings = await db('tag_mappings')
      .where({ tenant: runtimeState.tenantId, tagged_id: activityId, tagged_type: 'interaction' });
    expect(unsupportedInteractionMappings).toHaveLength(0);

    const clientMappings = await db('tag_mappings')
      .where({ tenant: runtimeState.tenantId, tagged_id: clientId, tagged_type: 'client' });
    expect(clientMappings).toHaveLength(2);

    expect(publishWorkflowEventMock).toHaveBeenCalled();
    const publishedTypes = publishWorkflowEventMock.mock.calls.map((call) => call[0]?.eventType);
    expect(publishedTypes).toContain('TAG_DEFINITION_CREATED');
    expect(publishedTypes).toContain('TAG_APPLIED');

    const idempotent = await invokeAction('crm.tag_activity', {
      activity_id: activityId,
      tags: ['Needs QBR'],
      if_exists: 'no_op',
    });
    expect(idempotent.added_count).toBe(0);
    expect(idempotent.existing_count).toBe(1);

    await expect(
      invokeAction('crm.tag_activity', {
        activity_id: activityId,
        tags: ['Needs QBR'],
        if_exists: 'error',
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    runtimeState.deniedPermissions.add('tag:create');
    await expect(
      invokeAction('crm.tag_activity', {
        activity_id: activityId,
        tags: ['Brand New Tag'],
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    runtimeState.deniedPermissions.clear();

    const audit = await db('audit_logs')
      .where({ tenant: runtimeState.tenantId, operation: 'workflow_action:crm.tag_activity' })
      .first();
    expect(audit).toBeTruthy();
  });

  it('T004: crm.find_activities returns tenant-scoped filtered summaries and rejects unbounded searches', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Activity Client');
    const contactId = await createContact(db, runtimeState.tenantId, clientId, 'Activity Contact');
    const ticketId = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      contactId,
    });
    const typeId = await getAnyInteractionTypeId(db, runtimeState.tenantId);
    const statusId = await getDefaultInteractionStatusId(db, runtimeState.tenantId, runtimeState.actorUserId);

    await createInteraction(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      contactId,
      ticketId,
      typeId,
      statusId,
      title: 'Keep me',
      notes: 'Interaction details for preview behavior',
    });

    const otherTenant = await createTenant(db, 'Other CRM Tenant');
    const otherUser = await createUser(db, otherTenant);
    const otherClient = await createClient(db, otherTenant, 'Other Client');
    const otherTypeId = await getAnyInteractionTypeId(db, otherTenant);
    await createInteraction(db, {
      tenantId: otherTenant,
      actorUserId: otherUser,
      clientId: otherClient,
      typeId: otherTypeId,
      title: 'Other tenant interaction',
    });

    const result = await invokeAction('crm.find_activities', {
      client_id: clientId,
      limit: 10,
      on_empty: 'return_empty',
    });

    expect(result.count).toBe(1);
    expect(result.activities[0].client_id).toBe(clientId);
    expect(result.activities[0].title).toBe('Keep me');
    expect(result.activities[0].notes_preview).toContain('Interaction details');

    await expect(
      invokeAction('crm.find_activities', {
        limit: 10,
        on_empty: 'return_empty',
      })
    ).rejects.toThrow();
  });

  it('T005/T006: crm.update_activity updates allowed fields, validates status/type ids, and writes audit', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Update Client');
    const typeId = await getAnyInteractionTypeId(db, runtimeState.tenantId);
    const statusId = await getDefaultInteractionStatusId(db, runtimeState.tenantId, runtimeState.actorUserId);
    const nextStatusId = await createInteractionStatus(db, runtimeState.tenantId, runtimeState.actorUserId, 'Follow-up Complete');
    const nextTypeId = await createInteractionType(db, runtimeState.tenantId, 'QBR');

    const activityId = await createInteraction(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      typeId,
      statusId,
      title: 'Original Title',
      notes: 'Original notes',
    });

    const updated = await invokeAction('crm.update_activity', {
      activity_id: activityId,
      patch: {
        title: 'Updated Title',
        notes: 'Updated notes',
        status_id: nextStatusId,
        type_id: nextTypeId,
        visibility: 'client_visible',
        category: 'outcome',
        tags: ['completed', 'followup'],
      },
      reason: 'workflow update test',
    });

    expect(updated.activity_before.title).toBe('Original Title');
    expect(updated.activity_after.title).toBe('Updated Title');
    expect(updated.activity_after.status_id).toBe(nextStatusId);
    expect(updated.activity_after.type_id).toBe(nextTypeId);
    expect(updated.changed_fields).toEqual(expect.arrayContaining(['title', 'notes', 'status_id', 'type_id', 'visibility', 'category', 'tags']));

    const audit = await db('audit_logs')
      .where({ tenant: runtimeState.tenantId, operation: 'workflow_action:crm.update_activity' })
      .orderBy('timestamp', 'desc')
      .first();

    expect(audit).toBeTruthy();

    const otherTenantId = await createTenant(db, `Other Tenant ${Date.now()}`);
    const otherUserId = await createUser(db, otherTenantId);
    const otherClientId = await createClient(db, otherTenantId, 'Other Client');
    const otherTypeId = await getAnyInteractionTypeId(db, otherTenantId);
    const otherActivityId = await createInteraction(db, {
      tenantId: otherTenantId,
      actorUserId: otherUserId,
      clientId: otherClientId,
      typeId: otherTypeId,
    });

    await expect(
      invokeAction('crm.update_activity', {
        activity_id: otherActivityId,
        patch: { title: 'Should fail' },
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(
      invokeAction('crm.update_activity', {
        activity_id: activityId,
        patch: {},
      })
    ).rejects.toThrow();

    await expect(
      invokeAction('crm.update_activity', {
        activity_id: activityId,
        patch: { status_id: uuidv4() },
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      invokeAction('crm.update_activity', {
        activity_id: activityId,
        patch: { type_id: uuidv4() },
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('T007/T008/T009: crm.schedule_activity validates context, creates follow-up, audits, and publishes INTERACTION_LOGGED', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Schedule Client');
    const contactId = await createContact(db, runtimeState.tenantId, clientId, 'Schedule Contact');
    const ticketId = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      contactId,
    });
    const typeId = await getAnyInteractionTypeId(db, runtimeState.tenantId);
    await getDefaultInteractionStatusId(db, runtimeState.tenantId, runtimeState.actorUserId);

    const now = new Date();
    const startTime = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const endTime = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

    const scheduled = await invokeAction('crm.schedule_activity', {
      contact_id: contactId,
      ticket_id: ticketId,
      type_id: typeId,
      title: 'Schedule follow-up call',
      notes: 'Discuss deployment',
      start_time: startTime,
      end_time: endTime,
      visibility: 'internal',
      category: 'follow-up',
      tags: ['qbr'],
    });

    expect(scheduled.activity.client_id).toBe(clientId);
    expect(scheduled.activity.contact_id).toBe(contactId);
    expect(scheduled.activity.ticket_id).toBe(ticketId);
    expect(scheduled.activity.duration).toBe(60);

    const stored = await db('interactions')
      .where({ tenant: runtimeState.tenantId, interaction_id: scheduled.activity.activity_id })
      .first();

    expect(stored).toBeTruthy();

    const audit = await db('audit_logs')
      .where({ tenant: runtimeState.tenantId, operation: 'workflow_action:crm.schedule_activity' })
      .orderBy('timestamp', 'desc')
      .first();

    expect(audit).toBeTruthy();
    expect(publishWorkflowEventMock).toHaveBeenCalledTimes(1);
    expect(publishWorkflowEventMock.mock.calls[0]?.[0]).toMatchObject({
      eventType: 'INTERACTION_LOGGED',
      idempotencyKey: `interaction_logged:${scheduled.activity.activity_id}`,
    });

    await expect(
      invokeAction('crm.schedule_activity', {
        type_id: typeId,
        title: 'Missing context',
        start_time: startTime,
      })
    ).rejects.toThrow();

    const otherClientId = await createClient(db, runtimeState.tenantId, 'Other Client');
    const wrongContactId = await createContact(db, runtimeState.tenantId, otherClientId, 'Wrong Contact');

    await expect(
      invokeAction('crm.schedule_activity', {
        client_id: clientId,
        contact_id: wrongContactId,
        type_id: typeId,
        title: 'Mismatched contact',
        start_time: startTime,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      invokeAction('crm.schedule_activity', {
        client_id: clientId,
        ticket_id: ticketId,
        type_id: uuidv4(),
        title: 'Invalid type',
        start_time: startTime,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      invokeAction('crm.schedule_activity', {
        client_id: clientId,
        type_id: typeId,
        status_id: uuidv4(),
        title: 'Invalid status',
        start_time: startTime,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      invokeAction('crm.schedule_activity', {
        client_id: clientId,
        type_id: typeId,
        title: 'Invalid window',
        start_time: endTime,
        end_time: startTime,
      })
    ).rejects.toThrow();
  });

  it('T010/T011: crm.send_quote sends eligible quotes, writes activity/audit, and rejects ineligible cases', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Quote Client');
    const contactId = await createContact(db, runtimeState.tenantId, clientId, 'Quote Contact');

    const quoteId = await createQuote(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      contactId,
      status: 'draft',
      isTemplate: false,
    });

    const sent = await invokeAction('crm.send_quote', {
      quote_id: quoteId,
      email_addresses: ['custom@example.com'],
      subject: 'Workflow quote send',
      message: 'Please review this quote',
      no_op_if_already_sent: true,
    });

    expect(sent.previous_status).toBe('draft');
    expect(sent.new_status).toBe('sent');
    expect(sent.email_sent).toBe(true);
    expect(sent.recipients).toEqual(expect.arrayContaining(['custom@example.com']));
    expect(sent.message_id).toBe('msg-test-1');

    const updated = await db('quotes').where({ tenant: runtimeState.tenantId, quote_id: quoteId }).first();
    expect(updated.status).toBe('sent');
    expect(updated.sent_at).toBeTruthy();

    const sentActivity = await db('quote_activities')
      .where({ tenant: runtimeState.tenantId, quote_id: quoteId, activity_type: 'sent' })
      .first();
    expect(sentActivity).toBeTruthy();

    const sendAudit = await db('audit_logs')
      .where({ tenant: runtimeState.tenantId, operation: 'workflow_action:crm.send_quote' })
      .orderBy('timestamp', 'desc')
      .first();

    expect(sendAudit).toBeTruthy();

    const templateQuoteId = await createQuote(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      status: 'draft',
      isTemplate: true,
    });

    await expect(
      invokeAction('crm.send_quote', { quote_id: templateQuoteId })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const rejectedQuoteId = await createQuote(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      status: 'rejected',
      isTemplate: false,
    });

    await expect(
      invokeAction('crm.send_quote', { quote_id: rejectedQuoteId })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await db('tenant_settings')
      .insert({
        tenant: runtimeState.tenantId,
        settings: JSON.stringify({ billing: { quotes: { approvalRequired: true } } }),
      })
      .onConflict('tenant')
      .merge({ settings: JSON.stringify({ billing: { quotes: { approvalRequired: true } } }) });

    const pendingQuoteId = await createQuote(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      status: 'draft',
      isTemplate: false,
    });

    await expect(
      invokeAction('crm.send_quote', { quote_id: pendingQuoteId })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const otherTenantId = await createTenant(db, 'Other Quote Tenant');
    const otherUser = await createUser(db, otherTenantId);
    const otherClient = await createClient(db, otherTenantId, 'Other Quote Client');
    const otherQuoteId = await createQuote(db, {
      tenantId: otherTenantId,
      actorUserId: otherUser,
      clientId: otherClient,
      status: 'draft',
    });

    await expect(
      invokeAction('crm.send_quote', { quote_id: otherQuoteId })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('T012: CRM read/mutation/send actions return PERMISSION_DENIED based on mapped permissions', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Permission Client');
    const typeId = await getAnyInteractionTypeId(db, runtimeState.tenantId);
    const quoteId = await createQuote(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      status: 'draft',
    });

    const activityId = await createInteraction(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      typeId,
    });

    const checks: Array<{ actionId: string; denied: string; input: Record<string, unknown> }> = [
      {
        actionId: 'crm.find_activities',
        denied: 'client:read',
        input: { client_id: clientId, on_empty: 'return_empty' },
      },
      {
        actionId: 'crm.update_activity',
        denied: 'client:update',
        input: { activity_id: activityId, patch: { title: 'Denied' } },
      },
      {
        actionId: 'crm.schedule_activity',
        denied: 'client:update',
        input: { client_id: clientId, type_id: typeId, title: 'Denied', start_time: new Date().toISOString() },
      },
      {
        actionId: 'crm.send_quote',
        denied: 'billing:update',
        input: { quote_id: quoteId },
      },
      {
        actionId: 'crm.send_quote',
        denied: 'billing:read',
        input: { quote_id: quoteId },
      },
    ];

    for (const check of checks) {
      runtimeState.deniedPermissions.clear();
      runtimeState.deniedPermissions.add(check.denied);
      await expect(invokeAction(check.actionId, check.input)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    }

    runtimeState.deniedPermissions.clear();
  });

  it('T014: crm.create_activity_note remains functional after CRM action expansion', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Legacy Note Client');

    const note = await invokeAction('crm.create_activity_note', {
      target: {
        type: 'client',
        id: clientId,
      },
      body: 'Legacy note preserved',
      visibility: 'internal',
      category: 'note',
      tags: ['legacy'],
    });

    expect(note.note_id).toBeTruthy();

    const stored = await db('interactions')
      .where({ tenant: runtimeState.tenantId, interaction_id: note.note_id })
      .first();

    expect(stored).toBeTruthy();
    expect(stored.client_id).toBe(clientId);
    expect(stored.notes).toBe('Legacy note preserved');
  });
});
